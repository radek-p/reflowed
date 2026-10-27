// (Libertine's ft, tt, Th: private-use code points in the font's cmap) reads
// as nothing in the viewer (its accessible layer and copy drop private-use
// characters), so "after" became "aer". XeTeX shaped the word from its
// characters, and the capture's native-word records keep HarfBuzz's clusters
// (glyph k covers characters cl[k]..cl[k+1]): the characters each glyph
// stands for are known.
//
// The public viewer has no field for a glyph's text other than its code
// point (a glyph `text` field, like PDF's ActualText, would carry it).
// Until it has, such a ligature is set as its letters: the nominal glyph of
// each character, and a kern before the last one that makes the group
// exactly as wide as the ligature was, so every line breaks and every word
// sits where TeX put it; only the ligature's ink is the letters' ink. The
// letters carry the ligature's source position, one character each.
// Ligatures with a Unicode code point (ﬁ ﬂ ﬀ ﬃ ﬄ: U+FB00–FB06) are kept:
// the viewer reads them as their letters already.
import { readOtf, type Otf } from '../../build/engine-api-src/fonts.ts';

type J = Record<string, any>;
const isPrivate = (cp: number) => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;

/** Font id → glyph id → the characters it stood for in this run's native words (one meaning only). */
export function clusterTexts(stream: string): Map<number, Map<number, string>> {
  const out = new Map<number, Map<number, string>>();
  const ambiguous = new Set<string>();
  const word = (w: J) => {
    const cl = w.cl as number[] | undefined, gi = w.gi as number[] | undefined, s = w.s as string | undefined;
    if (!cl || !gi || typeof s !== 'string' || cl.length !== gi.length) return;
    for (let k = 0; k < gi.length; k++) {
      if (k > 0 && cl[k - 1] === cl[k]) continue;                 // a later glyph of a cluster: the first carries the text
      let next = s.length;
      for (let j = k + 1; j < gi.length; j++) if (cl[j] !== cl[k]) { next = cl[j] > cl[k] ? cl[j] : next; break; }
      const text = s.slice(cl[k], next);
      if ([...text].length < 2) continue;
      // one glyph for the whole cluster only (a cluster of several glyphs is not a ligature)
      if (k + 1 < gi.length && cl[k + 1] === cl[k]) continue;
      const key = `${w.f}:${gi[k]}`;
      if (ambiguous.has(key)) continue;
      let m = out.get(w.f);
      if (!m) { m = new Map(); out.set(w.f, m); }
      const had = m.get(gi[k]);
      if (had !== undefined && had !== text) { m.delete(gi[k]); ambiguous.add(key); continue; }
      m.set(gi[k], text);
    }
  };
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    const o = x as J;
    if (o.t === 'w') word(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  if (!stream.includes('"cl":')) return out;
  for (const line of stream.split('\n')) {
    if (!line.includes('"t":"w"')) continue;
    try { walk(JSON.parse(line)); } catch { /* a line the converter read; skip */ }
  }
  return out;
}

const otfCache = new Map<string, Otf | null>();
function otfOf(filename: string, readFile: (n: string) => Uint8Array | null): Otf | null {
  if (otfCache.has(filename)) return otfCache.get(filename)!;
  let otf: Otf | null = null;
  try { const b = readFile(filename); if (b) otf = readOtf(b); } catch { otf = null; }
  otfCache.set(filename, otf);
  return otf;
}

export interface LigatureStats { split: number; kept: number; texts: Record<string, number> }

/** Set every private-use ligature of `output` as its letters. Mutates `output`. */
export function splitPrivateLigatures(output: J, stream: string, readFile: (n: string) => Uint8Array | null): LigatureStats {
  const stats: LigatureStats = { split: 0, kept: 0, texts: {} };
  const texts = clusterTexts(stream);
  if (!texts.size) return stats;
  const fonts: Record<string, J> = output.fonts instanceof Map ? Object.fromEntries(output.fonts) : (output.fonts ?? {});
  const letters = (g: J, text: string): J[] | null => {
    const info = fonts[String(g.font)];
    if (info?.face?.kind !== 'opentype') return null;      // (convert.ts CapturedFace: only an OpenType font has a file)
    const otf = otfOf(info.face.file, readFile);
    if (!otf) return null;
    const size = info.size_sp as number, r = (u: number) => Math.round(u * size / otf.unitsPerEm);
    const cps = [...text].map((c) => c.codePointAt(0)!);
    const gs: J[] = [];
    for (const cp of cps) {
      const gid = otf.cmap.get(cp);
      if (gid === undefined) return null;
      const b = otf.bounds(gid);
      const n: J = { type: 'glyph', char: cp, gindex: gid, font: g.font, width: r(otf.advance(gid)),
        height: b ? Math.max(0, r(b.yMax)) : 0, depth: b ? Math.max(0, r(-b.yMin)) : 0 };
      for (const k of Object.keys(g)) if (!(k in n) && k !== 'src') n[k] = g[k];     // colour, link, slot, stream, mark, attributes
      gs.push(n);
    }
    // source positions: one character each when the ligature's covers exactly its characters
    const s = g.src as number[] | undefined;
    if (s) gs.forEach((n, i) => { n.src = s[4] === 0 && s[3] === cps.length ? [s[0], s[1], s[2] + i, 1, 0] : [...s]; });
    const total = gs.reduce((a, n) => a + n.width, 0);
    const fix = (g.width ?? 0) - total;
    const out: J[] = [];
    gs.forEach((n, i) => { if (i === gs.length - 1 && fix !== 0) out.push({ type: 'kern', kern: fix, subtype: 0 }); out.push(n); });
    return out;
  };
  const visit = (list: J[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'glyph' && typeof n.char === 'number' && isPrivate(n.char) && n.gindex != null) {
        const text = texts.get(n.font)?.get(n.gindex);
        if (text) {
          const rep = letters(n, text);
          if (rep) { list.splice(i, 1, ...rep); i += rep.length - 1; stats.split++; stats.texts[text] = (stats.texts[text] ?? 0) + 1; continue; }
          stats.kept++;
        }
      }
      for (const k of ['children', 'pre', 'post', 'replace', 'nodes']) if (Array.isArray(n[k])) visit(n[k]);
      if (n.leader) visit([n.leader]);
      if (n.box) visit([n.box]);
      if (n.display_wide) visit([n.display_wide]);
    }
  };
  for (const p of output.paragraphs ?? []) visit(p.nodes);
  visit(output.content);
  for (const s of output.streams ?? []) visit(s.content);
  if (output.pictures) visit(output.pictures);
  return stats;
}
