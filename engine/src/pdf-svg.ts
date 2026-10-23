// A PDF picture as SVG, for \includegraphics of a PDF that has no rendition (a logo, an icon: LIPIcs's
// ORCID sign, the CC BY badge). Before this, assets.ts drew such a PDF as a framed placeholder with its name.
//
//   await pdfToSvg(bytes) -> string | null       the first page, at its CropBox (else MediaBox), in PDF points
//
// What it draws: vector graphics — paths (m l c v y h re), fills and strokes with their rules, widths, caps, joins,
// dashes, clipping (W, W*), the colour operators in DeviceGray / DeviceRGB / DeviceCMYK and ICC-based spaces (by
// their component count), opacity from ExtGState (CA, ca), form XObjects (Do, with /Matrix, /BBox), JPEG image
// XObjects (DCTDecode, embedded as they are), marked content (ignored); FlateDecode streams and object streams.
// What it does not: text (BT … ET: fonts), other images, shadings and patterns, soft masks, rotated pages. A page
// that uses any of those gives null, and the caller keeps its placeholder: a picture is drawn whole or not at all.
// CMYK to RGB: the interpolation over the CMYK cube's 16 corners that Xpdf/Poppler use without a colour profile.

type Obj = number | boolean | null | string | Name | Ref | Obj[] | Dict | Stream | Op;
class Name { n: string; constructor(n: string) { this.n = n; } }
class Ref { num: number; gen: number; constructor(num: number, gen: number) { this.num = num; this.gen = gen; } }
class Op { op: string; constructor(op: string) { this.op = op; } }
type Dict = Map<string, Obj>;
interface Stream { dict: Dict; data: Uint8Array }
const isDict = (x: unknown): x is Dict => x instanceof Map;
const isStream = (x: unknown): x is Stream => !!x && typeof x === 'object' && 'data' in (x as object) && 'dict' in (x as object);
class Unsupported extends Error {}

const latin1 = (b: Uint8Array, from = 0, to = b.length) => {
  let s = '';
  for (let i = from; i < to; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(to, i + 0x8000))));
  return s;
};
// written into the stream directly, no Blob: in WebKit a Blob read in a worker that a blob: URL started on a file://
// page fails ("Cannot load blob:null/…", the release's WebKit smoke)
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => { /* reported by the read */ });
  w.close().catch(() => { /* reported by the read */ });
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// ── the lexer and parser (objects and content streams alike) ──
const WS = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%]/;
class Lexer {
  i = 0;
  s: string;
  constructor(s: string, from = 0) { this.s = s; this.i = from; }
  skip() {
    for (;;) {
      while (this.i < this.s.length && WS.test(this.s[this.i])) this.i++;
      if (this.s[this.i] === '%') { while (this.i < this.s.length && this.s[this.i] !== '\n' && this.s[this.i] !== '\r') this.i++; continue; }
      return;
    }
  }
  /** one object; numbers followed by `g R` are references; bare keywords are Ops */
  value(): Obj | undefined {
    this.skip();
    const s = this.s, c = s[this.i];
    if (c === undefined) return undefined;
    if (c === '/') {
      let j = this.i + 1;
      while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
      const n = s.slice(this.i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
      this.i = j;
      return new Name(n);
    }
    if (c === '<' && s[this.i + 1] === '<') {
      this.i += 2;
      const d: Dict = new Map();
      for (;;) {
        this.skip();
        if (s[this.i] === '>' && s[this.i + 1] === '>') { this.i += 2; return d; }
        const k = this.value();
        if (!(k instanceof Name)) throw new Unsupported('a dictionary key');
        d.set(k.n, this.value() ?? null);
      }
    }
    if (c === '[') {
      this.i++;
      const a: Obj[] = [];
      for (;;) {
        this.skip();
        if (s[this.i] === ']') { this.i++; return a; }
        if (this.i >= s.length) throw new Unsupported('an open array');
        a.push(this.value()!);
      }
    }
    if (c === '(') {
      let depth = 1, j = this.i + 1, out = '';
      while (j < s.length && depth) {
        const ch = s[j];
        if (ch === '\\') { out += s[j + 1] ?? ''; j += 2; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (!depth) break; }
        out += ch; j++;
      }
      this.i = j + 1;
      return out;
    }
    if (c === '<') {
      const j = s.indexOf('>', this.i);
      const hex = s.slice(this.i + 1, j).replace(/\s+/g, '');
      this.i = j + 1;
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt((hex[k] + (hex[k + 1] ?? '0')), 16));
      return out;
    }
    if (c === '{' || c === '}') { this.i++; return new Op(c); }
    let j = this.i;
    while (j < s.length && !WS.test(s[j]) && !DELIM.test(s[j])) j++;
    if (j === this.i) { this.i++; throw new Unsupported(`a stray ${c}`); }
    const w = s.slice(this.i, j);
    this.i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = Number(w);
      // `n g R`: a reference (in object syntax only: content streams have no R)
      const save = this.i;
      if (/^\d+$/.test(w)) {
        const m = /^\s+(\d+)\s+R(?=[\s/<>[\]()%]|$)/.exec(s.slice(this.i, this.i + 24));
        if (m) { this.i += m[0].length; return new Ref(n, Number(m[1])); }
      }
      this.i = save;
      return n;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return new Op(w);
  }
}

// ── the file: objects by number (plain and in object streams), the first page ──
class Pdf {
  bytes: Uint8Array;
  text: string;
  offsets = new Map<number, number>();
  cache = new Map<number, Obj>();
  inStm = new Map<number, Obj>();
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.text = latin1(bytes);
    for (const m of this.text.matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)) this.offsets.set(Number(m[1]), m.index! + m[0].length);
  }
  async init() {
    // object streams (PDF 1.5): their objects, parsed once
    for (const num of [...this.offsets.keys()]) {
      const o = await this.get(num);
      if (isStream(o) && (o.dict.get('Type') as Name)?.n === 'ObjStm') {
        const data = latin1(await this.decode(o));
        const n = Number(o.dict.get('N')), first = Number(o.dict.get('First'));
        const lx = new Lexer(data);
        const pairs: [number, number][] = [];
        for (let k = 0; k < n; k++) pairs.push([lx.value() as number, lx.value() as number]);
        for (const [onum, off] of pairs) if (!this.offsets.has(onum)) this.inStm.set(onum, new Lexer(data, first + off).value() ?? null);
      }
    }
  }
  async get(num: number): Promise<Obj> {
    if (this.cache.has(num)) return this.cache.get(num)!;
    if (this.inStm.has(num)) return this.inStm.get(num)!;
    const at = this.offsets.get(num);
    if (at == null) return null;
    const lx = new Lexer(this.text, at);
    let v: Obj = lx.value() ?? null;
    lx.skip();
    if (isDict(v) && this.text.startsWith('stream', lx.i)) {
      let start = lx.i + 6;
      if (this.text[start] === '\r') start++;
      if (this.text[start] === '\n') start++;
      let len = v.get('Length');
      if (len instanceof Ref) len = await this.get(len.num);
      let end = -1;
      if (typeof len === 'number') { const after = this.text.slice(start + len, start + len + 24); if (/^\s*endstream/.test(after)) end = start + len; }
      if (end < 0) { end = this.text.indexOf('endstream', start); if (end > start && this.text[end - 1] === '\n') end--; if (end > start && this.text[end - 1] === '\r') end--; }
      v = { dict: v, data: this.bytes.subarray(start, end) };
    }
    this.cache.set(num, v);
    return v;
  }
  async resolve(x: Obj | undefined): Promise<Obj> { let v = x ?? null; for (let k = 0; v instanceof Ref && k < 32; k++) v = await this.get(v.num); return v; }
  async decode(s: Stream): Promise<Uint8Array> {
    let f = await this.resolve(s.dict.get('Filter'));
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map((x) => (x as Name).n);
    if (await this.resolve(s.dict.get('DecodeParms'))) {
      const p = await this.resolve(s.dict.get('DecodeParms'));
      const pr = isDict(p) ? await this.resolve(p.get('Predictor')) : Array.isArray(p) ? null : null;
      if (pr && pr !== 1) throw new Unsupported('a predictor');
    }
    let data = s.data;
    for (const name of filters) {
      if (name === 'FlateDecode') data = await inflate(data);
      else throw new Unsupported(`the ${name} filter`);
    }
    return data;
  }
  async firstPage(): Promise<{ page: Dict; inherit: (k: string) => Promise<Obj> } | null> {
    const trailer = /trailer\s*<</.exec(this.text);
    let root: Obj = null;
    if (trailer) root = (new Lexer(this.text, trailer.index + trailer[0].length - 2).value() as Dict).get('Root') ?? null;
    if (!root) {
      // a cross-reference stream's dictionary carries /Root
      for (const num of this.offsets.keys()) { const o = await this.get(num); if (isStream(o) && (o.dict.get('Type') as Name)?.n === 'XRef') { root = o.dict.get('Root') ?? null; break; } }
    }
    if (!root) for (const num of this.offsets.keys()) { const o = await this.get(num); if (isDict(o) && (o.get('Type') as Name)?.n === 'Catalog') { root = o; break; } }
    const cat = await this.resolve(root);
    if (!isDict(cat)) return null;
    let node = await this.resolve(cat.get('Pages'));
    for (let k = 0; isDict(node) && (node.get('Type') as Name)?.n !== 'Page' && k < 64; k++) {
      const kids = await this.resolve(node.get('Kids'));
      if (!Array.isArray(kids) || !kids.length) return null;
      node = await this.resolve(kids[0]);
    }
    if (!isDict(node)) return null;
    const page = node;
    const inherit = async (key: string) => {
      for (let n: Obj = page, k = 0; isDict(n) && k < 64; n = await this.resolve(n.get('Parent')), k++) if (n.has(key)) return this.resolve(n.get(key));
      return null;
    };
    return { page, inherit };
  }
}

// ── colour ──
function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const c1 = 1 - c, m1 = 1 - m, y1 = 1 - y, k1 = 1 - k;
  let x = c1 * m1 * y1 * k1, r = x, g = x, b = x;
  x = c1 * m1 * y1 * k; r += 0.1373 * x; g += 0.1216 * x; b += 0.1255 * x;
  x = c1 * m1 * y * k1; r += x; g += 0.949 * x;
  x = c1 * m1 * y * k; r += 0.1098 * x; g += 0.102 * x;
  x = c1 * m * y1 * k1; r += 0.9255 * x; b += 0.549 * x;
  x = c1 * m * y1 * k; r += 0.1412 * x;
  x = c1 * m * y * k1; r += 0.9294 * x; g += 0.1098 * x; b += 0.1412 * x;
  x = c1 * m * y * k; r += 0.1333 * x;
  x = c * m1 * y1 * k1; g += 0.6784 * x; b += 0.9373 * x;
  x = c * m1 * y1 * k; g += 0.0588 * x; b += 0.1412 * x;
  x = c * m1 * y * k1; g += 0.651 * x; b += 0.3137 * x;
  x = c * m1 * y * k; g += 0.0745 * x;
  x = c * m * y1 * k1; r += 0.1804 * x; g += 0.1922 * x; b += 0.5725 * x;
  x = c * m * y1 * k; b += 0.0078 * x;
  x = c * m * y * k1; r += 0.2118 * x; g += 0.2119 * x; b += 0.2235 * x;
  return [r, g, b];
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function rgbOf(n: number, v: number[]): string {
  let r: number, g: number, b: number;
  if (n === 1) r = g = b = v[0];
  else if (n === 3) [r, g, b] = v;
  else if (n === 4) [r, g, b] = cmykToRgb(clamp(v[0]), clamp(v[1]), clamp(v[2]), clamp(v[3]));
  else throw new Unsupported('a colour space');
  const h = (x: number) => Math.round(clamp(x) * 255);
  return `rgb(${h(r)},${h(g)},${h(b)})`;
}

// ── the interpreter ──
type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const fmt = (x: number) => { const r = Math.round(x * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
interface GState {
  ctm: M; fill: string; stroke: string; fillN: number; strokeN: number; fa: number; sa: number;
  lw: number; cap: number; join: number; miter: number; dash: number[]; dashOff: number; groups: number;
}

export async function pdfToSvg(input: Uint8Array | ArrayBuffer): Promise<string | null> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (latin1(bytes, 0, Math.min(bytes.length, 1024)).indexOf('%PDF') < 0) return null;
  try {
    const pdf = new Pdf(bytes);
    await pdf.init();
    const fp = await pdf.firstPage();
    if (!fp) return null;
    const rot = Number(await fp.inherit('Rotate') ?? 0);
    if (rot % 360) throw new Unsupported('a rotated page');
    const boxOf = async (k: string) => { const b = await fp.inherit(k); return Array.isArray(b) && b.length === 4 ? (await Promise.all(b.map((x) => pdf.resolve(x)))).map(Number) : null; };
    const box = (await boxOf('CropBox')) ?? (await boxOf('MediaBox'));
    if (!box || box.some((x) => !Number.isFinite(x))) return null;
    const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
    const res0 = await fp.inherit('Resources');
    const contents = await pdf.resolve(fp.page.get('Contents'));
    const streams = Array.isArray(contents) ? await Promise.all(contents.map((c) => pdf.resolve(c))) : [contents];
    let src = '';
    for (const s of streams) if (isStream(s)) src += `${latin1(await pdf.decode(s))}\n`;
    const idp = `pdf${hashOf(bytes)}`;
    const out: string[] = [];
    const defs: string[] = [];
    let clipN = 0;

    async function run(code: string, resources: Obj, st: GState, depth: number) {
      if (depth > 8) throw new Unsupported('forms nested too deep');
      const res = isDict(resources) ? resources : new Map() as Dict;
      const resOf = async (kind: string, name: string) => { const d = await pdf.resolve(res.get(kind)); return isDict(d) ? pdf.resolve(d.get(name)) : null; };
      const stack: GState[] = [];
      const lx = new Lexer(code);
      let ops: Obj[] = [];
      let path = '', clip: string | null = null;
      const num = (k: number) => Number(ops[ops.length - k]);
      const nums = () => ops.map(Number);
      const pt = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
      const matrix = (m: M) => `matrix(${m.map(fmt).join(' ')})`;
      const spaceN = async (o: Obj): Promise<number> => {
        const n = o instanceof Name ? o.n : '';
        if (n === 'DeviceGray' || n === 'G' || n === 'CalGray') return 1;
        if (n === 'DeviceRGB' || n === 'RGB' || n === 'CalRGB') return 3;
        if (n === 'DeviceCMYK' || n === 'CMYK') return 4;
        let cs: Obj = o instanceof Name ? await resOf('ColorSpace', n) : o;
        cs = await pdf.resolve(cs);
        if (cs instanceof Name) return spaceN(cs);
        if (Array.isArray(cs) && cs[0] instanceof Name) {
          const kind = cs[0].n;
          if (kind === 'ICCBased') { const s = await pdf.resolve(cs[1]); const nn = isStream(s) ? Number(await pdf.resolve(s.dict.get('N'))) : NaN; if ([1, 3, 4].includes(nn)) return nn; }
          if (kind === 'CalRGB' || kind === 'Lab') return kind === 'Lab' ? Promise.reject(new Unsupported('Lab')) : 3;
          if (kind === 'CalGray') return 1;
        }
        throw new Unsupported(`the colour space ${n || 'array'}`);
      };
      const paint = (fill: boolean, stroke: boolean, evenOdd: boolean, close: boolean) => {
        if (close) path += ' Z';
        if (clip != null) {
          const id = `${idp}-c${++clipN}`;
          defs.push(`<clipPath id="${id}"><path d="${path.trim()}" transform="${matrix(st.ctm)}" clip-rule="${clip}"/></clipPath>`);
          out.push(`<g clip-path="url(#${id})">`);
          st.groups++;
          clip = null;
        }
        if ((fill || stroke) && path.trim()) {
          const a: string[] = [`d="${path.trim()}"`, `transform="${matrix(st.ctm)}"`];
          a.push(fill ? `fill="${st.fill}"` : 'fill="none"');
          if (fill && evenOdd) a.push('fill-rule="evenodd"');
          if (fill && st.fa < 1) a.push(`fill-opacity="${fmt(st.fa)}"`);
          if (stroke) {
            a.push(`stroke="${st.stroke}"`);
            if (st.lw > 0) a.push(`stroke-width="${fmt(st.lw)}"`);
            else a.push('stroke-width="0.5" vector-effect="non-scaling-stroke"');
            if (st.cap) a.push(`stroke-linecap="${['butt', 'round', 'square'][st.cap] ?? 'butt'}"`);
            if (st.join) a.push(`stroke-linejoin="${['miter', 'round', 'bevel'][st.join] ?? 'miter'}"`);
            if (st.miter !== 10) a.push(`stroke-miterlimit="${fmt(Math.max(1, st.miter))}"`);
            if (st.dash.length) a.push(`stroke-dasharray="${st.dash.map(fmt).join(' ')}"`, `stroke-dashoffset="${fmt(st.dashOff)}"`);
            if (st.sa < 1) a.push(`stroke-opacity="${fmt(st.sa)}"`);
          }
          out.push(`<path ${a.join(' ')}/>`);
        }
        path = '';
      };
      for (;;) {
        const v = lx.value();
        if (v === undefined) break;
        if (!(v instanceof Op)) { ops.push(v); continue; }
        const op = v.op;
        switch (op) {
          case 'q': stack.push({ ...st, dash: [...st.dash] }); st.groups = 0; break;
          case 'Q': {
            for (let k = 0; k < st.groups; k++) out.push('</g>');
            const p = stack.pop();
            if (p) Object.assign(st, p); else st.groups = 0;
            break;
          }
          case 'cm': st.ctm = mul(nums() as M, st.ctm); break;
          case 'w': st.lw = num(1); break;
          case 'J': st.cap = num(1); break;
          case 'j': st.join = num(1); break;
          case 'M': st.miter = num(1); break;
          case 'd': st.dash = (ops[0] as Obj[]).map(Number); st.dashOff = Number(ops[1] ?? 0); break;
          case 'i': case 'ri': break;
          case 'gs': {
            const g = await resOf('ExtGState', (ops[0] as Name).n);
            if (isDict(g)) {
              const sm = await pdf.resolve(g.get('SMask'));
              if (sm && !(sm instanceof Name && sm.n === 'None')) throw new Unsupported('a soft mask');
              const CA = await pdf.resolve(g.get('CA')), ca = await pdf.resolve(g.get('ca')), LW = await pdf.resolve(g.get('LW'));
              if (typeof CA === 'number') st.sa = CA;
              if (typeof ca === 'number') st.fa = ca;
              if (typeof LW === 'number') st.lw = LW;
            }
            break;
          }
          case 'g': st.fill = rgbOf(1, nums()); st.fillN = 1; break;
          case 'G': st.stroke = rgbOf(1, nums()); st.strokeN = 1; break;
          case 'rg': st.fill = rgbOf(3, nums()); st.fillN = 3; break;
          case 'RG': st.stroke = rgbOf(3, nums()); st.strokeN = 3; break;
          case 'k': st.fill = rgbOf(4, nums()); st.fillN = 4; break;
          case 'K': st.stroke = rgbOf(4, nums()); st.strokeN = 4; break;
          case 'cs': st.fillN = await spaceN(ops[0]); st.fill = rgbOf(st.fillN, st.fillN === 4 ? [0, 0, 0, 1] : [0, 0, 0]); break;
          case 'CS': st.strokeN = await spaceN(ops[0]); st.stroke = rgbOf(st.strokeN, st.strokeN === 4 ? [0, 0, 0, 1] : [0, 0, 0]); break;
          case 'sc': case 'scn':
            if (ops.some((o) => o instanceof Name)) throw new Unsupported('a pattern');
            st.fill = rgbOf(st.fillN, nums()); break;
          case 'SC': case 'SCN':
            if (ops.some((o) => o instanceof Name)) throw new Unsupported('a pattern');
            st.stroke = rgbOf(st.strokeN, nums()); break;
          case 'm': path += ` M${pt(num(2), num(1))}`; break;
          case 'l': path += ` L${pt(num(2), num(1))}`; break;
          case 'c': path += ` C${pt(num(6), num(5))} ${pt(num(4), num(3))} ${pt(num(2), num(1))}`; break;
          case 'v': {
            // the first control point is the current point: SVG's S would mirror the previous one, so it is spelt out
            const cur = /(-?[\d.]+) (-?[\d.]+)\s*$/.exec(path);
            const c0 = cur ? `${cur[1]} ${cur[2]}` : pt(num(4), num(3));
            path += ` C${c0} ${pt(num(4), num(3))} ${pt(num(2), num(1))}`; break;
          }
          case 'y': path += ` C${pt(num(4), num(3))} ${pt(num(2), num(1))} ${pt(num(2), num(1))}`; break;
          case 'h': path += ' Z'; break;
          case 're': { const [x, y, w, h] = nums(); path += ` M${pt(x, y)} L${pt(x + w, y)} L${pt(x + w, y + h)} L${pt(x, y + h)} Z`; break; }
          case 'W': clip = 'nonzero'; break;
          case 'W*': clip = 'evenodd'; break;
          case 'n': paint(false, false, false, false); break;
          case 'f': case 'F': paint(true, false, false, false); break;
          case 'f*': paint(true, false, true, false); break;
          case 'S': paint(false, true, false, false); break;
          case 's': paint(false, true, false, true); break;
          case 'B': paint(true, true, false, false); break;
          case 'B*': paint(true, true, true, false); break;
          case 'b': paint(true, true, false, true); break;
          case 'b*': paint(true, true, true, true); break;
          case 'BMC': case 'BDC': case 'EMC': case 'MP': case 'DP': case 'BX': case 'EX': break;
          case 'Do': {
            const x = await resOf('XObject', (ops[0] as Name).n);
            if (!isStream(x)) break;
            const sub = (await pdf.resolve(x.dict.get('Subtype')) as Name)?.n;
            if (sub === 'Form') {
              const inner: GState = { ...st, dash: [...st.dash], groups: 0 };
              const mx = await pdf.resolve(x.dict.get('Matrix'));
              if (Array.isArray(mx) && mx.length === 6) inner.ctm = mul(mx.map(Number) as M, inner.ctm);
              const bb = await pdf.resolve(x.dict.get('BBox'));
              if (Array.isArray(bb) && bb.length === 4) {
                const [a, b, c, d] = bb.map(Number);
                const id = `${idp}-c${++clipN}`;
                defs.push(`<clipPath id="${id}"><rect x="${fmt(Math.min(a, c))}" y="${fmt(Math.min(b, d))}" width="${fmt(Math.abs(c - a))}" height="${fmt(Math.abs(d - b))}" transform="${matrix(inner.ctm)}"/></clipPath>`);
                out.push(`<g clip-path="url(#${id})">`);
              } else out.push('<g>');
              const fres = (await pdf.resolve(x.dict.get('Resources'))) ?? res;
              await run(latin1(await pdf.decode(x)), fres, inner, depth + 1);
              out.push('</g>');
            } else if (sub === 'Image') {
              const f = await pdf.resolve(x.dict.get('Filter'));
              const fl = (Array.isArray(f) ? f : f ? [f] : []).map((n) => (n as Name).n);
              if (fl.length !== 1 || fl[0] !== 'DCTDecode' || await pdf.resolve(x.dict.get('SMask')) || await pdf.resolve(x.dict.get('Mask'))) throw new Unsupported('an image');
              const m: M = [st.ctm[0], st.ctm[1], st.ctm[2], st.ctm[3], st.ctm[4], st.ctm[5]];
              // the unit square, the image drawn top down in it
              out.push(`<image width="1" height="1" preserveAspectRatio="none" transform="${matrix(mul([1, 0, 0, -1, 0, 1], m))}"${st.fa < 1 ? ` opacity="${fmt(st.fa)}"` : ''} href="data:image/jpeg;base64,${b64(x.data)}"/>`);
            } else throw new Unsupported(`an XObject ${sub}`);
            break;
          }
          default: throw new Unsupported(`the operator ${op}`);
        }
        ops = [];
      }
      for (let k = 0; k < st.groups; k++) out.push('</g>');
      st.groups = 0;
    }

    const st: GState = { ctm: [1, 0, 0, 1, 0, 0], fill: 'rgb(0,0,0)', stroke: 'rgb(0,0,0)', fillN: 1, strokeN: 1, fa: 1, sa: 1,
      lw: 1, cap: 0, join: 0, miter: 10, dash: [], dashOff: 0, groups: 0 };
    await run(src, res0, st, 0);
    const w = x1 - x0, h = y1 - y0;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(w)}pt" height="${fmt(h)}pt" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`
      + `${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<g transform="matrix(1 0 0 -1 ${fmt(-x0)} ${fmt(y1)})">${out.join('')}</g></svg>`;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

function hashOf(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i += Math.max(1, b.length >> 12)) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  h ^= b.length; h = Math.imul(h, 0x01000193);
  return (h >>> 0).toString(36);
}
function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}
