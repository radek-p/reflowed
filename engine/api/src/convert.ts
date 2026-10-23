// The engine's capture stream (<job>.rtxc.jsonl, written by the patched
// Tectonic) → reflowtex's output.json, in the shape
// src/extract/serializer.lua writes from LuaTeX. No Node APIs: the inputs are
// the stream's text and a readFile over the engine's file system (the font
// files it loaded), so this runs next to the wasm engine in a browser too.
import { readOtf, type Otf } from './fonts.ts';
import { tfmDiscretionaries, tfmMayHyphenate, tfmRunEnd, type TfmHyphContext } from './tfm-hyphenation.ts';
import { attachModel, topologyError, affineError } from './rtx/pipeline/display-model.ts';
import { walkParallel } from './rtx/shared/tree.ts';
import { placeDisplay, placementOf } from './display-place.ts';

type J = Record<string, any>;

export interface ConvertInputs {
  stream: string;
  readFile: (name: string) => Uint8Array | null;
  /** Which words get discretionaries: LuaTeX's choice (every word but one
   *  before an explicit kern), or XeTeX's own second pass (TeX82's). */
  hyphenation?: 'luatex' | 'tex82';
  /** Attach the display model from the engine's width samples. */
  displayModel?: boolean;
}

const RUNNING = -1073741824;
const order = (o: number | undefined) => (!o ? 0 : o + 1);      // LuaTeX counts "fi" first

interface FontRec {
  id: number; name: string; size: number; params: number[]; hyphenchar: number;
  file?: string; index?: number; upem?: number; native?: boolean;
  g: number[][];
}
interface Font {
  rec: FontRec; otf?: Otf; filename: string; psName: string;
  metrics: Map<number, { w: number; h: number; d: number; adv?: number; lp: number; rp: number }>;
}

export function convert(inp: ConvertInputs): J {
  const recs: J[] = [];
  for (const line of inp.stream.split('\n')) if (line) recs.push(JSON.parse(line));
  const lua = (inp.hyphenation ?? 'luatex') === 'luatex';
  const stats = { words: 0, raw: 0, noraw: 0, kerns: 0, hyphens: 0, ligsplit: 0, explicitHyphens: 0, yoffsets: 0,
                  eqno: 0, transforms: 0, fixed: 0, samples: 0, route1: 0, route1no: 0, modelled: 0, wide: 0, unmodelled: 0 };

  // ── Fonts ─────────────────────────────────────────────────────────────────
  const fonts = new Map<number, Font>();
  for (const r of recs) if (r.t === 'font') {
    const rec = r as FontRec;
    const metrics = new Map<number, any>();
    let otf: Otf | undefined, filename = 'unknown', psName = rec.name;
    if (rec.native && rec.file) {
      const base = rec.file.replace(/^.*\//, '');
      for (const cand of /\.[a-z]+$/i.test(base) ? [base] : [base, `${base}.otf`, `${base}.ttf`]) {
        const data = inp.readFile(cand);
        if (data) { try { otf = readOtf(data); filename = cand; } catch { /* keep the engine's numbers */ } break; }
      }
      if (otf) psName = otf.psName;
      else { filename = /\.[a-z]+$/i.test(base) ? base : `${base}.otf`; psName = base; }
      for (const [g, w, h, d, adv, lp, rp] of rec.g) metrics.set(g, { w, h, d, adv, lp, rp });
    } else {
      for (const [c, w, h, d, , lp, rp] of rec.g) metrics.set(c, { w, h, d, lp, rp });
    }
    fonts.set(rec.id, { rec, otf, filename, psName, metrics });
  }
  const usedFonts: Record<string, J> = {};
  const noteFont = (f: Font) => {
    if (usedFonts[f.rec.id]) return;
    usedFonts[f.rec.id] = { name: f.rec.native ? f.psName : f.rec.name, size_sp: f.rec.size, filename: f.filename, quad: f.rec.params[5] };
  };
  const fontOf = (id: number): Font => {
    const f = fonts.get(id);
    if (!f) throw new Error(`convert: font ${id} not in the stream`);
    return f;
  };

  // ── Colour (xcolor's specials for xdvipdfmx) and graphicx transforms ─────
  const colorStack: (string | null)[] = [];
  let color: string | null = null;
  const hex = (v: number) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0');
  const parseColor = (s: string): string | null => {
    let m: RegExpExecArray | null;
    if ((m = /^\s*rgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s))) { const c = '#' + hex(+m[1]) + hex(+m[2]) + hex(+m[3]); return c === '#000000' ? null : c; }
    if ((m = /^\s*gray\s+([\d.]+)/.exec(s))) { const h = hex(+m[1]); const c = '#' + h + h + h; return c === '#000000' ? null : c; }
    if ((m = /^\s*cmyk\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s))) {
      const k = +m[4]; const ch = (v: number) => hex(1 - Math.min(1, v + k));
      const c = '#' + ch(+m[1]) + ch(+m[2]) + ch(+m[3]); return c === '#000000' ? null : c;
    }
    return null;
  };
  const special = (text: string) => {
    let m: RegExpExecArray | null;
    if ((m = /^color push (.*)$/.exec(text))) { colorStack.push(color); color = parseColor(m[1]); }
    else if (/^color pop/.test(text)) { color = colorStack.length ? colorStack.pop()! : null; }
    else if ((m = /^color (?!push|pop)(.*)$/.exec(text))) color = parseColor(m[1]);
  };
  const transformSpecial = (text: string): J | null => {
    let m: RegExpExecArray | null;
    const rot = (deg: number) => { const r = deg * Math.PI / 180; const c = Math.cos(r), s = Math.sin(r); return { a: c, b: s, c: -s, d: c }; };
    if ((m = /^pdf:btrans\s*(.*)$/.exec(text))) {
      const arg = m[1].trim();
      let mat: J | null = null, mm: RegExpExecArray | null;
      if ((mm = /rotate\s+(-?[\d.]+)/.exec(arg))) mat = rot(Number(mm[1]));
      else if ((mm = /matrix\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(arg))) mat = { a: +mm[1], b: +mm[2], c: +mm[3], d: +mm[4] };
      else if (/scale/.test(arg)) {
        const xs = /xscale\s+(-?[\d.]+)/.exec(arg), ys = /yscale\s+(-?[\d.]+)/.exec(arg), s = /(?:^|\s)scale\s+(-?[\d.]+)/.exec(arg);
        mat = { a: xs ? +xs[1] : s ? +s[1] : 1, b: 0, c: 0, d: ys ? +ys[1] : s ? +s[1] : 1 };
      }
      return { type: '_open', matrix: mat };
    }
    if (text === 'x:gsave') return { type: '_open', matrix: null };
    if ((m = /^x:rotate\s+(-?[\d.]+)/.exec(text))) return { type: '_matrix', matrix: rot(Number(m[1])) };
    if ((m = /^x:scale\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(text))) return { type: '_matrix', matrix: { a: +m[1], b: 0, c: 0, d: +m[2] } };
    if (/^pdf:etrans/.test(text) || text === 'x:grestore') return { type: '_close' };
    return null;
  };
  const foldTransforms = (list: J[]): J[] => {
    if (!list.some(n => n.type === '_open' || n.type === '_close' || n.type === '_matrix')) return list;
    const root: J[] = [];
    let cur = root;
    const frames: { parent: J[]; list: J[]; matrix: J | null }[] = [];
    for (const n of list) {
      if (n.type === '_open') { const f = { parent: cur, list: [] as J[], matrix: n.matrix }; frames.push(f); cur = f.list; }
      else if (n.type === '_matrix') { if (frames.length) frames[frames.length - 1].matrix = n.matrix; }
      else if (n.type === '_close') {
        const f = frames.pop();
        if (!f) continue;
        cur = f.parent;
        if (f.matrix) { cur.push({ type: 'transform', m_a: f.matrix.a, m_b: f.matrix.b, m_c: f.matrix.c, m_d: f.matrix.d, children: f.list }); stats.transforms++; }
        else cur.push(...f.list);
      } else cur.push(n);
    }
    for (let i = frames.length - 1; i >= 0; i--) frames[i].parent.push(...frames[i].list);
    return root;
  };

  // ── Glyphs ────────────────────────────────────────────────────────────────
  // LuaTeX's (luaotfload's) numbers: advances and outline extrema in font
  // units, scaled once and rounded; without the font file, XeTeX's own.
  const charsUsed = new Map<number, Map<number, number>>();      // font → char → gid (protrusion codes)
  const glyph = (f: Font, gid: number, char: number): J => {
    noteFont(f);
    if (!charsUsed.has(f.rec.id)) charsUsed.set(f.rec.id, new Map());
    charsUsed.get(f.rec.id)!.set(char, gid);
    const size = f.rec.size;
    if (f.otf) {
      const upem = f.otf.unitsPerEm, r = (u: number) => Math.round(u * size / upem);
      const b = f.otf.bounds(gid);
      return { type: 'glyph', char, gindex: gid, font: f.rec.id, width: r(f.otf.advance(gid)),
               height: b ? Math.max(0, r(b.yMax)) : 0, depth: b ? Math.max(0, r(-b.yMin)) : 0, color: color ?? undefined };
    }
    const m = f.metrics.get(gid);
    return { type: 'glyph', char, gindex: gid, font: f.rec.id, width: m?.w ?? 0, height: Math.max(0, m?.h ?? 0),
             depth: Math.max(0, m?.d ?? 0), color: color ?? undefined };
  };
  const tfmGlyph = (f: Font, c: number): J => {
    noteFont(f);
    if (!charsUsed.has(f.rec.id)) charsUsed.set(f.rec.id, new Map());
    charsUsed.get(f.rec.id)!.set(c, c);
    const m = f.metrics.get(c);
    return { type: 'glyph', char: c, font: f.rec.id, width: m?.w ?? 0, height: m?.h ?? 0, depth: m?.d ?? 0, color: color ?? undefined };
  };
  // a glyph's LuaTeX height and depth, without noting it as used
  const exactHD = (fid: number, gid: number): { h: number; d: number } => {
    const f = fontOf(fid);
    if (f.otf) {
      const b = f.otf.bounds(gid), r = (u: number) => Math.round(u * f.rec.size / f.otf!.unitsPerEm);
      return { h: b ? Math.max(0, r(b.yMax)) : 0, d: b ? Math.max(0, r(-b.yMin)) : 0 };
    }
    const m = f.metrics.get(gid);
    return { h: Math.max(0, m?.h ?? 0), d: Math.max(0, m?.d ?? 0) };
  };
  // A line's height and depth as LuaTeX would have them: from the glyphs the
  // engine names as reaching them (line_extents in the engine)
  const lineHD = (n: J): { h: number; d: number } => {
    let h = n.hb ? n.h : -Infinity, d = n.db ? n.d : -Infinity;
    for (const [f, g, y] of n.hx ?? []) h = Math.max(h, exactHD(f, g).h - y);
    for (const [f, g, y] of n.dx ?? []) d = Math.max(d, exactHD(f, g).d + y);
    return { h: h === -Infinity ? n.h : h, d: d === -Infinity ? n.d : d };
  };
  const advUnits = (f: Font, gid: number) => f.otf ? f.otf.advance(gid) : (f.metrics.get(gid)?.adv ?? 0);
  const upemOf = (f: Font) => f.otf?.unitsPerEm ?? f.rec.upem ?? 1000;
  const cps = (s: string) => [...s].map(c => c.codePointAt(0)!);
  const nfkd = (c: number) => cps(String.fromCodePoint(c).normalize('NFKD'));
  const ligTables = new Map<number, Map<string, number>>();
  const ligatureFor = (f: Font, chars: number[]): J | null => {
    if (!f.otf) return null;
    let t = ligTables.get(f.rec.id);
    if (!t) {
      t = new Map();
      for (const c of f.otf.cmap.keys()) {
        const d = String.fromCodePoint(c).normalize('NFKD');
        if ([...d].length > 1 && /^\p{L}+$/u.test(d)) t.set(d, c);
      }
      ligTables.set(f.rec.id, t);
    }
    const c = t.get(String.fromCodePoint(...chars));
    return c === undefined ? null : glyph(f, f.otf.cmap.get(c)!, c);
  };
  const nominal = (f: Font, c: number): J | null => {
    const g = f.otf?.cmap.get(c);
    return g === undefined ? null : glyph(f, g, c);
  };

  // A native word: its glyphs as HarfBuzz gave them, with the characters each
  // stands for from HarfBuzz's clusters, font kerns from the advances in font
  // units, and the hyphenation points XeTeX's patterns gave (as LuaTeX-style
  // discretionaries) when the word is one LuaTeX (or TeX82) would hyphenate.
  interface Seg { node: J; start: number; end: number }  // UTF-16 range a glyph covers
  const nativeWord = (w: J, hyphenate: boolean): J[] => {
    const f = fontOf(w.f);
    stats.words++;
    const text: string = w.s;
    const units: number[] = [];                      // UTF-16 code units, for cluster offsets
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
    const n = w.gi.length;
    const size = f.rec.size, upem = upemOf(f);
    const scale = (u: number) => Math.round(u * size / upem);
    const out: J[] = [];
    const segs: Seg[] = [];
    const upos = unitPositions(w);
    let starts: number[] | null = null;
    if (w.cl) {
      stats.raw++;
      starts = w.cl as number[];
    } else stats.noraw++;
    for (let k = 0; k < n; k++) {
      const gid = w.gi[k];
      let start = -1, end = -1, char: number;
      if (starts) {
        const c = starts[k];
        const isFirst = k === 0 || starts[k - 1] !== c;
        let next = units.length;
        for (let j = k + 1; j < n; j++) if (starts[j] !== c) { next = starts[j] > c ? starts[j] : next; break; }
        if (isFirst) { start = c; end = next; }
        const chars = isFirst ? cps(text.slice(c, next)) : [];
        if (chars.length === 1) char = chars[0];
        else if (chars.length > 1) {
          const cands = f.otf?.reverse.get(gid) ?? [];
          const pick = cands.find(x => { const d = nfkd(x); return d.length === chars.length && d.every((y, i) => y === chars[i]); });
          char = pick ?? cands[0] ?? chars[0];
        } else char = f.otf?.reverse.get(gid)?.[0] ?? 0xF0000 + gid;
      } else {
        char = f.otf?.reverse.get(gid)?.[0] ?? 0xF0000 + gid;
      }
      const g = glyph(f, gid, char);
      if (upos && start >= 0) { const s = srcOf(upos, start, end); if (s) g.src = s; }
      out.push(g);
      segs.push({ node: g, start, end });
      if (w.yo?.[k]) stats.yoffsets++;
      // the font kern after this glyph
      let kern = 0;
      if (w.xa) kern = scale(w.xa[k] - advUnits(f, gid));
      else {
        const next = k + 1 < n ? w.gx[k + 1] : w.w;
        const raw = next - w.gx[k] - g.width;
        kern = Math.round(Math.round(raw * upem / size) * size / upem);
      }
      if (kern !== 0) { const kn = { type: 'kern', kern, subtype: 0 }; out.push(kn); segs.push({ node: kn, start: -1, end: -1 }); stats.kerns++; }
    }
    if (!hyphenate || !w.hy || !starts) return out;
    // Liang's points → discretionaries: "har" disc(-) "monic"; a ligature over
    // a point goes into the replace list, its letters split into pre and post
    const hc = f.rec.hyphenchar;
    // the characters of a split ligature: each piece its own units
    const place = (gs: J[], from: number, to: number) => {
      const per = gs.length > 1;
      gs.forEach((g, i) => { const s = per ? srcOf(upos!, from + i, from + i + 1) : srcOf(upos!, from, to); if (s) g.src = s; });
    };
    const res: J[] = [];
    let k = 0;
    for (const p of w.hy as number[]) {
      while (k < segs.length && !(segs[k].start >= 0 && segs[k].end > p)) { res.push(segs[k].node); k++; }
      const pre: J[] = [];
      const hy = nominal(f, hc);
      if (hy) { pre.push(hy); if (upos && p < upos.length) { const s = srcOf(upos, p, p + 1); if (s) { s[3] = 0; hy.src = s; } } }   // the break point
      const post: J[] = [], replace: J[] = [];
      if (k < segs.length && segs[k].start < p) {
        const s = segs[k];
        const left = cps(text.slice(s.start, p)), right = cps(text.slice(p, s.end));
        const side = (cs: number[]) => { if (cs.length > 1) { const l = ligatureFor(f, cs); if (l) return [l]; } return cs.map(c => nominal(f, c)); };
        const l = side(left), r = side(right);
        if (!l.every(Boolean) || !r.every(Boolean)) continue;
        if (upos) { place(l as J[], s.start, p); place(r as J[], p, s.end); }
        pre.unshift(...(l as J[])); post.push(...(r as J[]));
        replace.push(s.node); k++;
        if (k < segs.length && segs[k].node.type === 'kern') { replace.push(segs[k].node); k++; }
        stats.ligsplit++;
      } else if (res.length && res[res.length - 1].type === 'kern') {
        replace.push(res.pop()!);
      }
      res.push({ type: 'disc', subtype: 3, pre, post, replace });
      stats.hyphens++;
    }
    while (k < segs.length) res.push(segs[k++].node);
    return res;
  };

  const tfmHyph: TfmHyphContext = { glyph: (f, c) => tfmGlyph(fontOf(f), c), hyphenchar: (f) => fontOf(f).rec.hyphenchar ?? -1 };

  // LuaTeX's choice of words: every word, but not one that runs up to a
  // node it cannot be broken before (a box, rule, formula, discretionary or –
  // LuaTeX's own rule – an explicit kern). TeX82's: the engine's flag.
  const mayHyphenate = (list: J[], i: number): boolean => {
    const w = list[i];
    if (!w.hy) return false;
    if (!lua) return !!w.t82;
    // LuaTeX leaves the parts of a compound alone: no automatic points in a
    // word next to an explicit hyphen or dash (XeTeX's empty discretionary)
    const emptyDisc = (m: J | undefined) => m?.t === 'd' && !m.pre?.length && !m.post?.length && !m.rc;
    if (emptyDisc(list[i - 1]) || emptyDisc(list[i + 1])) return false;
    if (w.hr && w.s.slice(w.hr[0], w.hr[1]).includes('-')) return false;   // LaTeX gives - an \lccode
    if (!w.hr || w.hr[1] < w.s.length) return true;
    for (let j = i + 1; j <= list.length; j++) {
      const m = list[j];
      if (!m) return true;
      if (m.t === 'k' && (!m.sub || m.it)) continue;   // font kerns; an italic correction
      return m.t === 'g' || m.t === 'p' || m.t === 'w' || m.t === 'x' || m.t === 'W' || m.t === 'i' || m.t === 'M' || m.t === 'a' || m.t === 'lang';
    }
    return true;
  };

  // ── Source positions (RTX_SRCPOS) ─────────────────────────────────────────
  // A glyph's `src` is [file, line, column, length, via]: file an index into
  // source_files, line 1-based, column 0-based in code points, length the
  // source characters it stands for (a ligature's two, “ for ``), via 1 when
  // a macro made the character (the position is then the macro call's, and
  // the length its extent: \name and the arguments read from that line; 0
  // when not known).
  const fileIndex = new Map<number, number>();
  const sourceFiles: string[] = [];
  for (const r of recs) if (r.t === 'in' && !fileIndex.has(r.tag)) { fileIndex.set(r.tag, sourceFiles.length); sourceFiles.push(r.name); }
  const fileOf = (tag: number) => { if (!fileIndex.has(tag)) { fileIndex.set(tag, sourceFiles.length); sourceFiles.push(`#${tag}`); } return fileIndex.get(tag)!; };
  type UPos = [number, number, number, number, number] | null;   // tag, line, col, via, span
  const unitPositions = (w: J): UPos[] | null => {
    if (!w.src) return null;
    const out: UPos[] = [];
    const s: string = w.s;
    for (const [n, tag, line, col, via, span] of w.src as number[][]) {
      let cp = 0;
      for (let k = 0; k < n; k++) {
        const u = out.length;
        if (k > 0 && !(s.charCodeAt(u) >= 0xDC00 && s.charCodeAt(u) < 0xE000)) cp++;
        out.push(tag ? [tag, line, via ? col : col + cp, via, via ? span || 0 : span || 1] : null);   // tag 0: not known; a via span: the call's extent
      }
    }
    return out.length === s.length ? out : null;
  };
  const srcOf = (upos: UPos[], start: number, end: number): number[] | null => {
    const a = upos[start], b = upos[end - 1];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1] || a[3] !== b[3]) return a ? [fileOf(a[0]), a[1], a[2], a[4], a[3]] : null;
    return [fileOf(a[0]), a[1], a[2], a[3] ? a[4] : b[2] + b[4] - a[2], a[3]];
  };
  // a char node's or ligature's [tag, line, col, via, length?]: length 1 when absent (math
  // fields), a ligature's its components' span, 0 for a discretionary's hyphen
  const charSrc = (s: number[]) => (s[0] ? [fileOf(s[0]), s[1], s[2], s[3] ? (s[4] ?? 0) : (s[4] ?? 1), s[3]] : undefined);

  // ── Nodes ─────────────────────────────────────────────────────────────────
  let fnMark = new Map<number, J>();                // iid → the marker box
  const convertList = (list: J[], inH: boolean, top = false): J[] => {
    const out: J[] = [];
    let tfmRun: { start: number; end: number; at: number; points: number[] } | null = null;   // an 8-bit word with points
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (top && lua && n.hy && !tfmRun && (n.t === 'c' || n.t === 'L')) {
        const end = tfmRunEnd(list, i);
        if (tfmMayHyphenate(list, i, end)) tfmRun = { start: i, end, at: out.length, points: n.hy };
      }
      switch (n.t) {
        case 'c': { const g = tfmGlyph(fontOf(n.f), n.c); if (n.src) g.src = charSrc(n.src); out.push(g); break; }
        case 'L': { const g = tfmGlyph(fontOf(n.f), n.c); if (n.src) g.src = charSrc(n.src); out.push(g); break; }
        case 'w': out.push(...nativeWord(n, top && mayHyphenate(list, i))); break;
        case 'G': { const f = fontOf(n.f); const g = glyph(f, n.g, f.otf?.reverse.get(n.g)?.[0] ?? 0xF0000 + n.g); if (n.src) g.src = charSrc(n.src); out.push(g); break; }
        case 'h': case 'v': case 'u': out.push(convertBox(n)); break;
        case 'r': out.push({ type: 'rule', width: n.w, height: n.h, depth: n.d, color: color ?? undefined }); break;
        case 'g': {
          let subtype = n.sub ?? 0;
          if (!subtype && n.sp) subtype = 13;
          const o: J = { type: 'glue', width: n.w, stretch: n.st ?? 0, shrink: n.sh ?? 0,
                         stretch_order: order(n.sto), shrink_order: order(n.sho), subtype };
          if (n.l) o.leader = convertList([n.l], inH)[0];
          out.push(o);
          break;
        }
        case 'k': {
          const subtype = n.it ? 3 : n.sub === 2 ? 2 : n.sub ? 1 : 0;
          out.push({ type: 'kern', kern: n.w, subtype });
          break;
        }
        case 'mk': out.push({ type: 'margin_kern' }); break;
        case 'p': out.push({ type: 'penalty', penalty: n.v }); break;
        case 'm': if ((n.sub ?? 0) < 4) out.push({ type: 'math', subtype: n.sub & 1, surround: n.w ?? 0 }); break;
        case 'd': {
          const rep = list.slice(i + 1, i + 1 + (n.rc ?? 0));
          i += n.rc ?? 0;
          const pre = convertList(n.pre, true), post = convertList(n.post, true), replace = convertList(rep, true);
          out.push({ type: 'disc', subtype: !pre.length && !post.length && !replace.length ? 2 : 3, pre, post, replace });
          break;
        }
        case 'x': {
          special(n.s);
          const tr = transformSpecial(n.s);
          if (tr) out.push(tr);
          break;
        }
        case 'i': {
          out.push({ type: 'ins', footnote: n.iid });
          // the footnote's marker: the box just before the insertion
          for (let j = out.length - 2; j >= 0; j--) {
            const b = out[j];
            if (b.type === 'hlist') { if (n.iid) fnMark.set(n.iid, b); break; }
            if (b.type === 'glyph' || b.type === 'glue') break;
          }
          break;
        }
        case 'M': out.push({ type: 'mark' }); break;
        case 'pic': out.push({ type: 'picture', width: n.w, height: n.h, depth: n.d, file: n.path, page: n.page || 1 }); break;
        case 'a': case 'W': case 'lang': out.push({ type: 'whatsit' }); break;
        default: break;
      }
      if (tfmRun && i === tfmRun.end - 1) {
        out.push(...tfmDiscretionaries(list.slice(tfmRun.start, tfmRun.end), out.splice(tfmRun.at), tfmRun.points, tfmHyph));
        tfmRun = null;
      }
    }
    const folded = foldTransforms(out);
    return inH ? explicitHyphens(folded) : folded;
  };
  // An explicit hyphen may be broken after: TeX puts an empty discretionary
  // after it, LuaTeX makes the hyphen itself a discretionary.
  const explicitHyphens = (list: J[]): J[] => {
    const out: J[] = [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i], next = list[i + 1];
      const isHyphen = n.type === 'glyph' && (n.char === 45 || n.char === fonts.get(n.font)?.rec.hyphenchar);
      const emptyDisc = next?.type === 'disc' && !next.pre.length && !next.post.length && !next.replace.length;
      // LuaTeX: every hyphen character inside a word, verbatim included
      const inWord = n.gindex !== undefined && (next?.type === 'glyph' || next?.type === 'kern') && out.length > 0 && (out[out.length - 1].type === 'glyph' || out[out.length - 1].type === 'kern');
      if (isHyphen && (emptyDisc || inWord)) {
        out.push({ type: 'disc', subtype: 2, pre: [{ ...n }], post: [], replace: [n] });
        if (emptyDisc) i++;
        stats.explicitHyphens++;
        continue;
      }
      out.push(n);
    }
    return out;
  };
  const natural = (kids: J[]): { w: number; h: number; d: number } | null => {
    let w = 0, h = 0, d = 0;
    const one = (c: J): boolean => {
      if (c.type === 'glyph') { w += c.width; h = Math.max(h, c.height); d = Math.max(d, c.depth); }
      else if (c.type === 'hlist' || c.type === 'vlist' || c.type === 'picture') {
        w += c.width; h = Math.max(h, c.height - (c.shift ?? 0)); d = Math.max(d, c.depth + (c.shift ?? 0));
      } else if (c.type === 'rule') {
        if (c.width === RUNNING || c.height === RUNNING || c.depth === RUNNING) return false;
        w += c.width; h = Math.max(h, c.height); d = Math.max(d, c.depth);
      } else if (c.type === 'glue') w += c.width;
      else if (c.type === 'kern') w += c.kern;
      else if (c.type === 'math') w += c.surround ?? 0;
      else if (c.type === 'disc') { for (const r of c.replace) if (!one(r)) return false; }
      else if (c.type === 'transform') return false;
      return true;
    };
    for (const c of kids) if (!one(c)) return null;
    return { w, h, d };
  };
  const convertBox = (n: J): J => {
    const v = n.t === 'v';
    const children = convertList(n.c ?? [], !v);
    const box: J = {
      type: v ? 'vlist' : 'hlist', subtype: 0, width: n.w, height: n.h, depth: n.d, shift: n.sh ?? 0,
      glue_set: n.gs ?? 0, glue_sign: n.gsg ?? 0, glue_order: order(n.go), children,
    };
    // XeTeX measured native words with its own float extents; keep a
    // natural-size box consistent with the glyphs it holds (LuaTeX parity)
    if (!v && n.c) {
      const nat = natural(children);
      if (nat) {
        if (!box.glue_sign && Math.abs(nat.w - box.width) <= 4) box.width = nat.w;
        if (Math.abs(nat.h - box.height) <= 4) box.height = nat.h;
        if (Math.abs(nat.d - box.depth) <= 4) box.depth = nat.d;
      }
    }
    return box;
  };

  // ── Paragraphs ────────────────────────────────────────────────────────────
  const parRecs = new Map<number, J>();
  const brkRecs = new Map<number, J>();
  const dispRecs = new Map<number, J>();
  const samples = new Map<number, J[]>();
  for (const r of recs) {
    if (r.t === 'par') parRecs.set(r.id, r);
    else if (r.t === 'brk') brkRecs.set(r.id, r);
    else if (r.t === 'disp') dispRecs.set(r.id, r);
    else if (r.t === 'dsample') { if (!samples.has(r.id)) samples.set(r.id, []); samples.get(r.id)!.push(r); }
  }
  const paragraphs: J[] = [];
  const parIndex = new Map<number, number>();
  const paragraphOf = (id: number): J | null => {
    if (parIndex.has(id)) return paragraphs[parIndex.get(id)! - 1];
    const r = parRecs.get(id);
    if (!r) return null;
    const savedColor = color, savedStack = colorStack.slice();
    const nodes = convertList(r.n, true, true);
    if (r.nest > 1) { color = savedColor; colorStack.length = 0; colorStack.push(...savedStack); }
    if (nodes[0]?.type === 'hlist' && nodes[0].children.length === 0 && nodes[0].width === r.parindent) nodes[0].subtype = 3;
    // the band: \parshape's first line, or \hangindent's, or \hsize (TeX §848)
    let ind = 0, wd = r.hsize;
    if (r.parshape) { ind = r.parshape[0]; wd = r.parshape[1]; }
    else if (r.hangindent && (r.hangafter < 0)) { wd = r.hsize - Math.abs(r.hangindent); ind = r.hangindent > 0 ? r.hangindent : 0; }
    const ls = r.leftskip, rs = r.rightskip;
    const p: J = {
      index: paragraphs.length + 1,
      indent: ind + ls[0], width: wd - ls[0] - rs[0],
      band_indent: ind, band_width: wd,
      baselineskip: r.baselineskip[0], lineskip: r.lineskip[0], lineskiplimit: r.lineskiplimit,
      adjust_spacing: 0, protrude_chars: r.protrude,
      nodes,
    };
    const lsInf = ls[2] > 0, rsInf = rs[2] > 0;
    if (lsInf && rsInf) p.align = 'center'; else if (rsInf) p.align = 'left'; else if (lsInf) p.align = 'right';
    const b = brkRecs.get(id);
    // TeX's own breaks at the source width (not in LuaTeX's capture)
    if (b) p.tex_breaks = { lines: b.lines, demerits: b.demerits, pass: b.pass, at: b.b };
    p.source = { tag: r.tag, line: r.line, endline: r.endline };
    paragraphs.push(p);
    parIndex.set(id, p.index);
    return p;
  };
  // In the engine's order, as LuaTeX sees them: each paragraph when it is
  // broken, each contribution to the flow when it is contributed – which is
  // what the colour stack follows. Boxes of the flow are converted then.
  const hdr = recs.find(r => r.t === 'hdr') ?? { samples: [] };
  for (const r of recs) {
    if (r.t === 'par') paragraphOf(r.id);
    else if (r.t === 'flow') preconvert(r.n);
  }
  function preconvert(n: J): void {
    if (n.t === 'x') special(n.s);
    else if (n.t === 'h' && !(n.line && !n.c)) n._box = convertBox(n);
    else if (n.t === 'v') for (const c of n.c ?? []) preconvert(c);
    else if (n.t === 'r') n._color = color;
  }
  const visible = (nodes: J[]): boolean => nodes.some(n => n.type === 'glyph' || n.type === 'picture'
    || (n.type === 'rule' && n.width !== 0 && (n.height !== 0 || n.depth !== 0))
    || (n.children && visible(n.children)) || (n.replace && visible(n.replace)));

  // ── The flow walk (serializer.lua walk_flow) ──────────────────────────────
  const content: J[] = [];
  const streams: J[] = [];
  const endRec = recs.find(r => r.t === 'end') ?? {};
  const sourceWidth: number = endRec.textwidth ?? paragraphs.find(p => p)?.band_width ?? 0;
  let curBand = { indent: 0, width: sourceWidth };
  let curLeading: J = {};
  let lastBox: string | null = null;
  let lastDisplay: J | null = null;
  const seenPara = new Set<number>();
  type Pending = { sp: number; explicit: number; parts: J[] | null; aboveSkip?: number; interline?: number; blankSp?: number;
    bls?: { part: J; belowOf: J | null } };
  // Interline glue: TeX computed it from XeTeX's extents of the boxes around
  // it (FreeType's, a sp or so off the outline's); redo it with the extents
  // the boxes have here (LuaTeX parity; lines: the glyphs the engine names).
  let prevDepthDiff = 0;
  const boxArrives = (p: Pending, xh: number, xd: number, h: number, d: number) => {
    const corr = prevDepthDiff + (xh - h);
    if (p.bls && corr !== 0 && Math.abs(corr) <= 8) {
      p.sp += corr; if (p.interline !== undefined) p.interline += corr;
      p.bls.part.width += corr;
      if (p.bls.belowOf) p.bls.belowOf.display_interline_below += corr;
    }
    p.bls = undefined;
    prevDepthDiff = xd - d;
  };
  const reset = (p: Pending) => { p.sp = 0; p.explicit = 0; p.parts = null; };
  interface Ctx { out: J[]; lastKind: string | null }
  const placeGap = (ctx: Ctx, sp: number, explicit: number, parts: J[] | null) => {
    const afterDisplay = ctx.lastKind === 'display';
    const amount = afterDisplay ? sp : explicit;
    const glue = (parts ?? []).filter(g => afterDisplay || (g.type === 'glue' && (g.subtype === 0 || g.subtype === 3)));
    if (ctx.out.length > 0 && (amount !== 0 || glue.length)) ctx.out.push(glue.length ? { kind: 'vspace', amount, glue } : { kind: 'vspace', amount });
  };
  const notePart = (p: Pending, n: J) => {
    p.parts ??= [];
    if (n.t === 'g') {
      const g: J = { type: 'glue', subtype: n.sub ?? 0, width: n.w };
      if (n.st) { g.stretch = n.st; g.stretch_order = order(n.sto); }
      if (n.sh) { g.shrink = n.sh; g.shrink_order = order(n.sho); }
      p.parts.push(g);
    } else p.parts.push({ type: 'kern', kern: n.w, subtype: n.sub ? 1 : 0 });
  };
  // A numbered display: TeX82 packs formula, kern and number and shifts the
  // box; LuaTeX's box spans the display width. Same ink; LuaTeX's shape.
  const eqnoForm = (box: J, shift: number, band: { indent: number; width: number }): J => {
    const k = box.children;
    const shape = k.length === 3 && k[0].type === 'hlist' && k[1].type === 'kern' && k[2].type === 'hlist';
    if (!shape || band.width <= 0 || Math.abs(shift + box.width - (band.indent + band.width)) > 4) return box;
    const lead = band.width - (k[0].width + k[1].kern + k[2].width);
    const right = lead > 0;
    const children = right
      ? [{ type: 'kern', kern: lead, subtype: 0 }, { ...k[0], subtype: 6 }, k[1], { ...k[2], subtype: 7 }]
      : [{ ...k[0], subtype: 7 }, k[1], { ...k[2], subtype: 6 }];
    stats.eqno++;
    return { ...box, width: band.width, children };
  };
  const displayItem = (n: J, box: J, note: J | undefined, pending: Pending, band: { indent: number; width: number }): J => {
    const item: J = {
      kind: 'display',
      display_width: band.width > 0 ? band.width : n.w,
      display_indent: band.indent,
      display_shift: n.sh ?? 0,
      display_pre_size: note?.pre_size,
      display_above: note?.above[0],
      display_above_short: note?.above_short[0],
      display_below: note?.below[0],
      display_below_short: note?.below_short[0],
      display_used_above: pending.aboveSkip,
      display_interline_above: pending.interline,
      display_quad: note?.quad,
      display_baselineskip: note?.baselineskip[0],
      display_lineskip: note?.lineskip[0],
      display_lineskiplimit: note?.lineskiplimit,
      display_after_line: lastBox === 'line' && (!note || note.pre_size > -1073741823),
      box: eqnoForm({ ...box, subtype: note?.align ? 4 : 6, shift: undefined }, n.sh ?? 0, band),
    };
    if (item.box.width === band.width && item.display_shift !== band.indent) item.display_shift = band.indent;
    Object.defineProperty(item, '_id', { value: n.disp, enumerable: false });
    const row = rowOf.get(n.disp) ?? 0;
    rowOf.set(n.disp, row + 1);
    Object.defineProperty(item, '_row', { value: row, enumerable: false });
    // which display (and alignment row) this is: stable across widths, unlike
    // the item's position (a tag set on its own row adds items)
    item.display_id = n.disp; if (row) item.display_row = row;
    return item;
  };
  const displayItems: J[] = [];
  const rowOf = new Map<number, number>();         // an alignment's rows share its display id
  const walk = (list: J[], pending: Pending, ctx: Ctx) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.t === 'h' && n.line && !n.c) {
        const [pid, lineNo] = n.line;
        { const e = lineHD(n); boxArrives(pending, n.h, n.d, e.h, e.d); }
        const p = paragraphOf(pid);
        const vis = !!p && visible(p.nodes);
        if (p) {
          curBand = { indent: p.band_indent, width: p.band_width };
          curLeading = { bskip: p.baselineskip, lskip: p.lineskip, lskiplimit: p.lineskiplimit };
        }
        if (lineNo > 1 && lastBox === 'line' && seenPara.has(pid)) { reset(pending); pending.interline = undefined; continue; }
        lastBox = vis ? 'line' : 'blank';
        if (!vis) pending.blankSp = (pending.blankSp ?? 0) + pending.sp + n.h + n.d;
        else pending.blankSp = undefined;
        pending.interline = undefined;
        if (vis && !seenPara.has(pid)) {
          seenPara.add(pid);
          placeGap(ctx, pending.sp, pending.explicit, pending.parts);
          ctx.out.push({ kind: 'paragraph', para: p!.index });
          ctx.lastKind = 'paragraph';
        }
        reset(pending);
        continue;
      }
      switch (n.t) {
        case 'v': walk(n.c ?? [], pending, ctx); break;
        case 'h': case 'r': {
          if (n.t === 'h' && n.disp) {
            const box = n._box ?? convertBox(n);
            boxArrives(pending, n.h, n.d, box.height, box.depth);
            const gap = pending.sp + (lastBox === 'blank' ? pending.blankSp ?? 0 : 0);
            placeGap(ctx, gap, gap, pending.parts);
            reset(pending); pending.blankSp = undefined;
            const item = displayItem(n, box, dispRecs.get(n.disp), pending, curBand);
            ctx.out.push(item); displayItems.push(item);
            ctx.lastKind = 'display'; lastDisplay = item; lastBox = 'display';
            pending.aboveSkip = undefined; pending.interline = undefined;
            break;
          }
          // a box or rule outside any paragraph: a fixed display (emit_fixed)
          let box: J;
          if (n.t === 'r') {
            const w = n.w === RUNNING ? sourceWidth : n.w;
            if (!w || !((n.h ?? 0) || (n.d ?? 0))) break;
            box = { type: 'hlist', subtype: 2, width: w, height: n.h, depth: n.d, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0,
                    children: [{ type: 'rule', width: w, height: n.h, depth: n.d, color: n._color ?? undefined }] };
          } else {
            box = n._box ?? convertBox(n);
            if (!visible([box])) break;
          }
          if (n.t === 'r') { pending.bls = undefined; prevDepthDiff = 0; } else boxArrives(pending, n.h, n.d, box.height, box.depth);
          const gap = pending.sp + (lastBox === 'blank' ? pending.blankSp ?? 0 : 0);
          placeGap(ctx, gap, gap, pending.parts);
          reset(pending); pending.blankSp = undefined;
          const item: J = {
            kind: 'display', display_width: sourceWidth || box.width, display_indent: 0, display_shift: n.sh ?? 0,
            display_pre_size: -1073741823, display_above: 0, display_above_short: 0, display_below: 0,
            display_below_short: 0, display_used_above: 0, display_interline_above: pending.interline,
            display_baselineskip: curLeading.bskip, display_lineskip: curLeading.lskip,
            display_lineskiplimit: curLeading.lskiplimit, display_after_line: false,
            box: { type: 'hlist', subtype: 6, width: box.width, height: box.height, depth: box.depth, shift: 0, glue_set: 0, glue_sign: 0, glue_order: 0,
                   children: [{ ...box, shift: 0 }] },
          };
          ctx.out.push(item); ctx.lastKind = 'display'; lastDisplay = item; lastBox = 'display';
          pending.aboveSkip = undefined; pending.interline = undefined;
          stats.fixed++;
          break;
        }
        case 'i': {
          const saved = { curBand, lastBox, prevDepthDiff };
          const fnCtx: Ctx = { out: [], lastKind: null };
          walk(n.c ?? [], { sp: 0, explicit: 0, parts: null }, fnCtx);
          streams.push({ kind: 'footnote', content: fnCtx.out, attrs: [] });
          if (n.iid) footnoteStream.set(n.iid, streams.length);
          curBand = saved.curBand; lastBox = saved.lastBox; prevDepthDiff = saved.prevDepthDiff;
          break;
        }
        case 'g': {
          notePart(pending, n);
          const w = n.w ?? 0;
          pending.sp += w;
          const sub = n.sub ?? 0;
          if (sub === 4 || sub === 6) pending.aboveSkip = w;
          else if ((sub === 5 || sub === 7) && lastDisplay) lastDisplay.display_used_below = w;
          else if (sub === 1 || sub === 2) {
            pending.interline = w;
            let belowOf: J | null = null;
            if (lastBox === 'display' && lastDisplay && lastDisplay.display_interline_below === undefined) { lastDisplay.display_interline_below = w; belowOf = lastDisplay; }
            if (sub === 2) pending.bls = { part: pending.parts![pending.parts!.length - 1], belowOf };
          }
          if (sub === 0 || sub === 3) pending.explicit += w;
          break;
        }
        case 'k': notePart(pending, n); pending.sp += n.w; break;
        default: break;
      }
    }
  };
  const footnoteStream = new Map<number, number>();
  const flowPending: Pending = { sp: 0, explicit: 0, parts: null };
  const mainCtx: Ctx = { out: content, lastKind: null };
  walk(recs.filter(r => r.t === 'flow').map(r => r.n), flowPending, mainCtx);
  // marker glyphs → the footnote's stream
  for (const [iid, box] of fnMark) {
    const s = footnoteStream.get(iid);
    if (s === undefined) continue;
    const mark = (ns: J[]) => { for (const c of ns) { if (c.type === 'glyph') c.stream = s; if (c.children) mark(c.children); } };
    mark(box.children);
  }
  const strip = (nodes: J[]) => { for (const n of nodes) { if (n.type === 'ins') delete n.footnote; for (const k of ['children', 'pre', 'post', 'replace']) if (n[k]) strip(n[k]); } };
  for (const p of paragraphs) strip(p.nodes);

  // ── Route 1: the inputs of TeX's own placement, for primitive displays ─────
  const sameDisplay = (p: J[], a: J[]): boolean => {
    if (p.length !== a.length) return false;
    for (let i = 0; i < p.length; i++) {
      if (topologyError(p[i].box, a[i].box, 'box') || Math.abs(p[i].display_shift - a[i].display_shift) > 1) return false;
      const bad = walkParallel<J>([p[i].box, a[i].box], { node([x, y]) {
        for (const f of ['width', 'height', 'depth', 'kern', 'shift', 'glue_set'])
          if (Math.abs((x[f] ?? 0) - (y[f] ?? 0)) > (f === 'glue_set' ? 1e-6 : 1)) return 'bad';
      } });
      if (bad) return false;
    }
    return true;
  };
  // The number's box and the formula's, by subtype (7, 6), wherever they are:
  // a line of its own; TeX82's \leqno box, which does not span the band and
  // which eqnoForm therefore left as it was.
  const nameParts = (items: J[], place: J) => {
    const eqno = place.q !== 0, separate = eqno && place.e === 0;
    if (separate && items.length === 2) items[place.l ? 0 : 1].box.subtype = 7;
    else if (eqno && items.length === 1) {
      const k = items[0].box.children as J[];
      if (k.length === 3 && k[1].type === 'kern' && !k.some(c => c.subtype === 6)) { k[place.l ? 0 : 2].subtype = 7; k[place.l ? 2 : 0].subtype = 6; }
    }
  };
  {
    const byId = new Map<number, J[]>();
    for (const it of displayItems) { if (!byId.has(it._id)) byId.set(it._id, []); byId.get(it._id)!.push(it); }
    for (const [id, items] of byId) {
      const r = dispRecs.get(id);
      if (!r || r.align || !r.place || r.place.danger) continue;
      items[0].display_place = { mathquad: r.place.mathquad, hfuzz: r.place.hfuzz, overfullrule: r.place.overfullrule, leqno: r.place.l, eqno: r.place.q !== 0, separate: r.place.q !== 0 && r.place.e === 0 };
      nameParts(items, r.place);
      // Exact at every width when TeX's placement reproduces the engine's
      // re-typeset samples (a body that does not itself depend on the width)
      const pl = placementOf(items);
      const ss = (samples.get(id) ?? []).filter(s => s.delta !== 0);
      if (pl && ss.length) {
        let exact = true;
        for (const s of ss) {
          const pred = placeDisplay(pl, items[0].display_width + s.delta);
          const act: J[] = [];
          for (const n of s.items) if (n.t === 'h') act.push(displayItem(n, convertBox(n), s, { sp: 0, explicit: 0, parts: null }, { indent: items[0].display_indent, width: items[0].display_width + s.delta }));
          nameParts(act, r.place);
          if (!sameDisplay(pred, act)) { exact = false; break; }
        }
        items[0].display_place.exact = exact;
        if (exact) stats.route1++; else stats.route1no++;
      }
    }
  }

  // ── Display model from the engine's samples (one compilation) ─────────────
  if (inp.displayModel !== false) {
    for (const item of displayItems) {
      const ss = (samples.get(item._id) ?? []).slice().sort((a, b) => a.delta - b.delta);
      if (!ss.length) continue;
      stats.samples += ss.length;
      const at = (s: J): J | null => {
        // the sample's items: penalty, above skip, the box(es), penalty, below skip
        const pend: Pending = { sp: 0, explicit: 0, parts: null };
        let got: J | null = null, row = 0;
        for (const n of s.items) {
          if (n.t === 'g' && (n.sub === 4 || n.sub === 6)) pend.aboveSkip = n.w;
          if (n.t === 'h' && !got && row++ === item._row) {
            const saved = lastBox; lastBox = item.display_after_line ? 'line' : lastBox;
            got = displayItem(n, convertBox(n), s, pend, { indent: item.display_indent, width: item.display_width + s.delta });
            lastBox = saved;
            got.display_interline_above = item.display_interline_above;
            got.display_interline_below = item.display_interline_below;
            got.display_used_below = item.display_used_below;
          }
        }
        return got;
      };
      const w0 = sourceWidth;
      const doc = (it: J, w: number) => ({ source_width: w, content: [it], streams: [], paragraphs: [], fonts: new Map() }) as any;
      const byDelta = new Map<number, J>();
      for (const s of ss) { const it = at(s); if (it) byDelta.set(s.delta, it); }
      const req: number[] = (hdr.samples ?? []).filter((x: number) => x > 0 && byDelta.has(x));
      if (req.length < 2) continue;
      const [d1, d2] = req;
      const b = byDelta.get(d1)!, c = byDelta.get(d2)!;
      const t0 = topologyError(item.box, b.box, 'box') ?? topologyError(b.box, c.box, 'box');
      const aff = t0 ? t0 : affineError(item.box, b.box, c.box, w0, w0 + d1, w0 + d2, 'box');
      if (!aff) {
        attachModel(doc(item, w0), doc(b, w0 + d1), doc(c, w0 + d2));
        stats.modelled++;
      } else if (!topologyError(b.box, c.box, 'box')) {
        // set another way at W: a wide form from the first sample on the
        // wide law, from the switch the engine bisected for
        const wide = structuredClone(b);
        attachModel(doc(wide, w0 + d1), doc(b, w0 + d1), doc(c, w0 + d2));
        for (const k of ['display_wide', 'display_wide_from', 'display_wide_width']) delete wide[k];
        item.display_wide = wide;
        item.display_wide_width = w0 + d1;
        const fpWide = ss.find(s => s.delta === d1)?.fp;
        // the narrow form's own law, from the widest sample still set the narrow way
        const fp0 = ss.find(s => s.delta === 0)?.fp;
        const lo = ss.filter(s => s.delta > 0 && s.delta < d1 && s.fp === fp0).map(s => s.delta);
        if (lo.length) {
          const near = byDelta.get(Math.max(...lo));
          if (near && !topologyError(item.box, near.box, 'box')) attachModel(doc(item, w0), doc(structuredClone(item), w0), doc(near, w0 + Math.max(...lo)));
        }
        const switchAt = ss.filter(s => s.delta > 0 && s.delta < d1 && s.fp === fpWide).map(s => s.delta);
        item.display_wide_from = w0 + (switchAt.length ? Math.min(...switchAt) : d1);
        stats.wide++;
      } else stats.unmodelled++;
    }
  }

  // ── Protrusion codes of the characters used ───────────────────────────────
  for (const [fid, chars] of charsUsed) {
    const f = fonts.get(fid)!;
    if (!usedFonts[fid]) continue;
    // the hyphen character's codes too, typeset or not: the reader's breaker puts it at a discretionary
    // break (the engine records its metrics for every used font, patch 0008)
    const hc = f.rec.hyphenchar;
    if (hc > 0 && !chars.has(hc)) { const g = f.otf ? f.otf.cmap.get(hc) : hc; if (g !== undefined && f.metrics.has(g)) chars.set(hc, g); }
    const codes = [...chars].sort((a, b) => a[0] - b[0])
      .map(([c, g]) => ({ char: c, m: f.metrics.get(g) }))
      .filter(x => x.m && (x.m.lp || x.m.rp))
      .map(x => ({ char: x.char, ef: 1000, lp: x.m!.lp, rp: x.m!.rp }));
    if (codes.length) usedFonts[fid].codes = codes;
  }
  const clean = (v: any): any => JSON.parse(JSON.stringify(v));
  return clean({
    source_width: sourceWidth,
    fonts: usedFonts,
    paragraphs,
    content,
    streams,
    links: [], anchors: [], slots: [], marks: [], outline: [],
    source_files: sourceFiles.length ? sourceFiles : undefined,
    capture: { engine: 'tectonic-rtxc', stats, inputs: recs.filter(r => r.t === 'in').map(r => [r.tag, r.name]) },
  });
}
