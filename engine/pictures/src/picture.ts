// A captured TikZ picture as SVG, from the XDV page tectonic-capture.sty
// ships for it. pgf's dvisvgm driver (pgfsys-dvisvgm.def) has written the
// drawing as raw SVG specials; this does what dvisvgm does with them, for
// the few specials pgf uses, and draws the rest of the page – the labels
// (glyphs of OpenType and Type 1 fonts), rules – as dvisvgm --no-fonts would:
// glyphs as <path> definitions placed with <use>, in bp, y down.
//
// The result is a complete <svg> document in the shape dvisvgm writes for
// LuaTeX's pictures (single-quoted attributes, #rrggbb colours, a viewBox
// from 0 0 at the picture's top-left corner, scaled to its TeX width), so the
// public encoder's rewritePictureSvg (ids prefixed, colours themed) and the
// viewer take it unchanged.
import { readPicturePages, picturePageIndexes, type PicFont, type PicPage } from './xdv-pages.ts';
import { otfOutlines, parseType1, type1Glyph, readEncodingVector, type Cmd, type OtfOutlines, type Type1 } from './outlines.ts';
import { readTfm, type Tfm } from '../../api/src/fonts.ts';   // was capture/src/fonts.ts, the same file

export { picturePageIndexes };

export interface PictureInputs {
  xdv: Uint8Array;
  readFile: (name: string) => Uint8Array | null;
}

/** sp → bp (dvisvgm's unit: PostScript points) */
const BP = 72 / 72.27 / 65536;
export const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

interface GlyphFont {
  key: string;
  /** the outline of a glyph (native: glyph id; TFM: character code), font units, y up */
  outline(k: number): Cmd[] | null;
  scale: number;                // font units → bp at the font's size
  slant: number; extend: number;
}

export class Pictures {
  readonly warnings: string[] = [];
  readonly stats = { pictures: 0, glyphs: 0, rules: 0, missingGlyphs: 0, unknownSpecials: 0 };
  private pages: Map<number, PicPage> | null = null;
  private fonts: Map<number, PicFont> = new Map();
  private glyphFonts = new Map<number, GlyphFont | null>();
  private tfms = new Map<string, Tfm | null>();
  private map: Map<string, { file: string; enc: string | null; slant: number; extend: number }> | null = null;

  private inp: PictureInputs;
  constructor(inp: PictureInputs) { this.inp = inp; }

  private warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }

  private tfm(name: string): Tfm | null {
    if (!this.tfms.has(name)) {
      const b = this.inp.readFile(`${name}.tfm`);
      this.tfms.set(name, b ? readTfm(b) : null);
    }
    return this.tfms.get(name)!;
  }

  private load() {
    if (this.pages) return;
    const r = readPicturePages(this.inp.xdv, (f, code) => {
      const t = f.kind === 'tfm' ? this.tfm(f.name) : null;
      const c = t?.scaled(f.size).get(code);
      if (!c) { this.warn(`no TFM width for ${f.name} char ${code}`); return 0; }
      return c.width;
    });
    this.pages = r.pages; this.fonts = r.fonts;
  }

  /** pdftex.map: TFM name → Type 1 file, encoding and effects */
  private fontMap(name: string) {
    if (!this.map) {
      this.map = new Map();
      const b = this.inp.readFile('pdftex.map');
      if (b) {
        for (const line of new TextDecoder('latin1').decode(b).split(/\r?\n/)) {
          const t = line.trim();
          if (!t || '%#*;'.includes(t[0])) continue;
          const words = t.match(/"[^"]*"|\S+/g) ?? [];
          const files = words.slice(1).filter(w => w.startsWith('<')).map(w => w.replace(/^[<[]+/, ''));
          const file = files.find(w => /\.pf[ab]$/i.test(w));
          const enc = files.find(w => w.endsWith('.enc')) ?? null;
          const effects = words.find(w => w.startsWith('"')) ?? '';
          const sl = /(-?[\d.]+)\s+SlantFont/.exec(effects), ex = /(-?[\d.]+)\s+ExtendFont/.exec(effects);
          if (file && !this.map.has(words[0])) this.map.set(words[0], { file, enc, slant: sl ? +sl[1] : 0, extend: ex ? +ex[1] : 1 });
        }
      }
    }
    return this.map.get(name) ?? null;
  }

  private glyphFont(num: number): GlyphFont | null {
    if (this.glyphFonts.has(num)) return this.glyphFonts.get(num)!;
    const f = this.fonts.get(num);
    let gf: GlyphFont | null = null;
    try { gf = f ? this.openFont(f) : null; } catch (e) { this.warn(`font ${f?.name}: ${(e as Error).message}`); }
    if (!gf && f) this.warn(`no outlines for font ${f.name}`);
    this.glyphFonts.set(num, gf);
    return gf;
  }

  private openFont(f: PicFont): GlyphFont | null {
    const sizeBp = f.size * BP;
    if (f.kind === 'native') {
      const base = f.name.replace(/^.*\//, '').replace(/^\[|\]$/g, '');
      const data = this.inp.readFile(base) ?? this.inp.readFile(`${base}.otf`) ?? this.inp.readFile(`${base}.ttf`);
      if (!data) return null;
      const o: OtfOutlines = otfOutlines(data, f.index ?? 0);
      if (f.embolden) this.warn(`font ${f.name}: embolden ignored`);
      return { key: `${f.num}`, outline: g => o.glyph(g), scale: sizeBp / o.upem, slant: f.slant ?? 0, extend: f.extend ?? 1 };
    }
    // a TFM font: its Type 1 outlines, by its own name or through the map
    let file = `${f.name}.pfb`, enc: string[] | null = null, slant = 0, extend = 1;
    let data = this.inp.readFile(file);
    if (!data) {
      const m = this.fontMap(f.name);
      if (!m) return null;
      file = m.file; slant = m.slant; extend = m.extend;
      data = this.inp.readFile(file);
      if (m.enc) { const e = this.inp.readFile(m.enc); if (e) enc = readEncodingVector(new TextDecoder('latin1').decode(e)); }
    }
    if (!data) return null;
    const t1: Type1 = parseType1(data);
    const vec = enc ?? t1.encoding;
    return { key: `${f.num}`, outline: c => type1Glyph(t1, vec[c] ?? '.notdef'), scale: sizeBp * t1.fontMatrix[0], slant, extend };
  }

  /** Picture `id` as an SVG document; width/height/depth in sp (the box TeX
   *  made of it, as the placeholder in the flow has it). */
  svg(id: number, width: number, height: number, depth: number): string | null {
    this.load();
    const page = this.pages!.get(id);
    if (!page) { this.warn(`picture ${id}: no page in the XDV`); return null; }
    this.stats.pictures++;
    const defs: string[] = [];
    const defined = new Set<string>();
    let body = '';
    const colors: (string | null)[] = [];
    let color: string | null = null;
    const sets = new Map<string, { body: string; defs: string; put: boolean }>();
    let inSet: { body: string; defs: string; put: boolean } | null = null;
    const expand = (s: string, h: number, v: number) => s.replace(/\{\?(\w+)\}/g, (all, k: string) => {
      if (k === 'x') return fmt(h * BP);
      if (k === 'y') return fmt(v * BP);
      if (k === 'nl') return '\n';
      if (k === 'color') return color ?? '#000000';
      this.warn(`dvisvgm placeholder {?${k}} not supported`);
      return all;
    });
    const fill = () => (color ? ` fill='${color}'` : '');
    const glyph = (gf: GlyphFont, k: number, x: number, y: number) => {
      const id = `g${gf.key}-${k}`;
      if (!defined.has(id)) {
        defined.add(id);
        const cmds = gf.outline(k);
        if (!cmds) { this.stats.missingGlyphs++; this.warn(`glyph ${k} missing in font ${gf.key}`); }
        defs.push(`<path id='${id}' d='${pathData(cmds ?? [], gf)}'/>`);
      }
      body += `<use x='${fmt(x * BP)}' y='${fmt(y * BP)}' xlink:href='#${id}'${fill()}/>`;
      this.stats.glyphs++;
    };
    for (const op of page.ops) {
      switch (op.t) {
        case 'char': { const gf = this.glyphFont(op.font); if (gf) glyph(gf, op.code, op.h, op.v); break; }
        case 'glyphs': {
          const gf = this.glyphFont(op.font);
          if (gf) for (const g of op.glyphs) glyph(gf, g.gid, op.h + g.x, op.v + g.y);
          break;
        }
        case 'rule':
          body += `<rect x='${fmt(op.h * BP)}' y='${fmt((op.v - op.height) * BP)}' width='${fmt(op.width * BP)}' height='${fmt(op.height * BP)}'${fill()}/>`;
          this.stats.rules++;
          break;
        case 'special': {
          const t = op.text;
          let m: RegExpExecArray | null;
          if ((m = /^dvisvgm:raw(?:\s([\s\S]*))?$/.exec(t))) { if (inSet) inSet.body += m[1] ?? ''; else body += expand(m[1] ?? '', op.h, op.v); }
          else if ((m = /^dvisvgm:rawdef(?:\s([\s\S]*))?$/.exec(t))) { if (inSet) inSet.defs += m[1] ?? ''; else defs.push(expand(m[1] ?? '', op.h, op.v)); }
          else if ((m = /^dvisvgm:rawset\s+(\S+)/.exec(t))) { inSet = { body: '', defs: '', put: false }; sets.set(m[1], inSet); }
          else if (/^dvisvgm:endrawset/.test(t)) inSet = null;
          else if ((m = /^dvisvgm:rawput\s+(\S+)/.exec(t))) {
            const s = sets.get(m[1]);
            if (!s) { this.warn(`dvisvgm:rawput of an unknown fragment ${m[1]}`); break; }
            if (s.body) body += expand(s.body, op.h, op.v);
            if (s.defs && !s.put) defs.push(expand(s.defs, op.h, op.v));
            s.put = true;
          }
          else if (/^dvisvgm:bbox\b/.test(t) || /^pdf:pagesize\b/.test(t)) { /* sizes: the box's own are used */ }
          else if ((m = /^color push\s+(.*)$/.exec(t))) { colors.push(color); color = parseColor(m[1]); }
          else if (/^color pop\b/.test(t)) color = colors.length ? colors.pop()! : null;
          else if ((m = /^color\s+(?!push|pop)(.*)$/.exec(t))) color = parseColor(m[1]);
          else { this.stats.unknownSpecials++; this.warn(`picture special not understood: ${t.slice(0, 60)}`); }
          break;
        }
      }
    }
    const w = width * BP, h = (height + depth) * BP;
    const inner = normalizeMarkup(body, s => this.warn(s));
    const defsXml = defs.length ? `<defs>${normalizeMarkup(defs.join(''), s => this.warn(s))}</defs>` : '';
    return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${fmt(w)}pt' height='${fmt(h)}pt' viewBox='0 0 ${fmt(w)} ${fmt(h)}'>${defsXml}${inner}</svg>`;
  }
}

function pathData(cmds: Cmd[], gf: GlyphFont): string {
  const s = gf.scale;
  const X = (x: number, y: number) => fmt((x * gf.extend + y * gf.slant) * s);
  const Y = (y: number) => fmt(-y * s);
  let d = '';
  for (const c of cmds) {
    switch (c[0]) {
      case 'M': d += `M${X(c[1], c[2])} ${Y(c[2])}`; break;
      case 'L': d += `L${X(c[1], c[2])} ${Y(c[2])}`; break;
      case 'Q': d += `Q${X(c[1], c[2])} ${Y(c[2])} ${X(c[3], c[4])} ${Y(c[4])}`; break;
      case 'C': d += `C${X(c[1], c[2])} ${Y(c[2])} ${X(c[3], c[4])} ${Y(c[4])} ${X(c[5], c[6])} ${Y(c[6])}`; break;
      case 'Z': d += 'Z'; break;
    }
  }
  return d;
}

/** A color special's value (xcolor's and pgf's forms) as #rrggbb; black is
 *  null: dvisvgm adds no fill to black glyphs, and pgf relies on it (its
 *  \special{color push gray 0} "makes dvisvgm not add anything to text"). */
export function parseColor(s: string): string | null {
  const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  let m: RegExpExecArray | null;
  let c: string | null = null;
  if ((m = /^\s*rgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s))) c = '#' + hex(+m[1]) + hex(+m[2]) + hex(+m[3]);
  else if ((m = /^\s*gray\s+([\d.]+)/.exec(s))) { const g = hex(+m[1]); c = '#' + g + g + g; }
  else if ((m = /^\s*cmyk\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s))) {
    const k = +m[4]; const ch = (v: number) => hex(1 - Math.min(1, v + k));
    c = '#' + ch(+m[1]) + ch(+m[2]) + ch(+m[3]);
  } else if ((m = /^\s*hsb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s))) {
    const [hh, ss, bb] = [+m[1], +m[2], +m[3]];
    const i = Math.floor(hh * 6) % 6, f = hh * 6 - Math.floor(hh * 6);
    const p = bb * (1 - ss), q = bb * (1 - f * ss), t = bb * (1 - (1 - f) * ss);
    const [r, g, b] = [[bb, t, p], [q, bb, p], [p, bb, t], [p, q, bb], [t, p, bb], [bb, p, q]][i];
    c = '#' + hex(r) + hex(g) + hex(b);
  }
  return c === '#000000' ? null : c;
}

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The raw fragments pgf wrote, as dvisvgm's XML parser would re-serialise
 *  them: attributes single-quoted with their whitespace collapsed, text
 *  between elements that is only whitespace dropped, elements left open at
 *  the end closed (and a stray end tag dropped), comments removed. */
export function normalizeMarkup(s: string, warn: (s: string) => void = () => {}): string {
  let out = '';
  const open: string[] = [];
  let last = 0;
  const text = (t: string) => { if (t.trim()) warn(`picture: text outside any element kept: ${t.trim().slice(0, 40)}`); if (t.trim()) out += t.replace(/\s+/g, ' ').replace(/&(?![#\w]+;)/g, '&amp;').replace(/</g, '&lt;'); };
  for (const m of s.matchAll(TAG_RE)) {
    text(s.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const [, close, name, attrs, selfClose] = m;
    if (close) {
      const k = open.lastIndexOf(name);
      if (k < 0) { warn(`picture: stray </${name}> dropped`); continue; }
      while (open.length > k) out += `</${open.pop()}>`;
      continue;
    }
    let a = '';
    for (const am of attrs.matchAll(ATTR_RE)) {
      const v = (am[2] ?? am[3]).replace(/\s+/g, ' ').trim().replace(/&(?![#\w]+;)/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;');
      a += ` ${am[1]}='${v}'`;
    }
    if (selfClose) out += `<${name}${a}/>`;
    else { out += `<${name}${a}>`; open.push(name); }
  }
  text(s.slice(last));
  if (open.length) warn(`picture: ${open.length} element(s) left open, closed`);
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
