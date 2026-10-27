// Compare a Tectonic capture's output.json with LuaTeX's for the same case.
//   node compare.ts tectonic.json luatex.json [--detail]
// Paragraphs and displays are paired in content-stream order. Per paragraph,
// the top-level node lists are aligned token by token (LCS), so one missing
// discretionary does not make the rest of the paragraph "differ"; the
// mismatches are then counted by class. Pure functions + a small CLI.

type J = Record<string, any>;

export interface Counts { glyph: number; glue: number; kern: number; penalty: number; disc: number; math: number; box: number; rule: number }
export interface ParaReport {
  t: Counts; l: Counts;
  textEqual: boolean; unbrokenWidthT: number; unbrokenWidthL: number;
  tokens: number; matched: number; mismatches: Record<string, number>;
  fields: string[];                       // paragraph fields that differ
  glyphWidthsEqual: number; glyphWidthsTotal: number;
  glueEqual: number; glueTotal: number;
}
export interface CaseReport {
  items: { t: string; l: string };
  unpaired: { t: number; l: number };
  paragraphs: ParaReport[];
  vspace: { t: number[]; l: number[] };
  displays: { t: number; l: number; boxEqual: number; fields: Record<string, number> };
  fonts: { t: number; l: number; unmatched: string[] };
  footnotes: { t: number; l: number };
}

const zero = (): Counts => ({ glyph: 0, glue: 0, kern: 0, penalty: 0, disc: 0, math: 0, box: 0, rule: 0 });
function count(nodes: J[], c = zero(), deep = true): Counts {
  for (const n of nodes ?? []) {
    if (n.type === 'glyph') c.glyph++;
    else if (n.type === 'glue') c.glue++;
    else if (n.type === 'kern') c.kern++;
    else if (n.type === 'penalty') c.penalty++;
    else if (n.type === 'disc') c.disc++;
    else if (n.type === 'math') c.math++;
    else if (n.type === 'rule') c.rule++;
    else if (n.type === 'hlist' || n.type === 'vlist') c.box++;
    if (deep && n.children) count(n.children, c, deep);
  }
  return c;
}
const add = (a: Counts, b: Counts) => { for (const k of Object.keys(a) as (keyof Counts)[]) a[k] += b[k]; return a; };

/** The paragraph as it reads unbroken: glyphs, discs contributing their replacement. */
function unbroken(nodes: J[], out: J[] = []): J[] {
  for (const n of nodes ?? []) {
    if (n.type === 'disc') unbroken(n.replace, out);
    else if (n.type === 'hlist' || n.type === 'vlist') { out.push(n); }
    else out.push(n);
  }
  return out;
}
const text = (nodes: J[]): string => {
  let s = '';
  const walk = (ns: J[]) => { for (const n of ns ?? []) {
    if (n.type === 'glyph') s += String.fromCodePoint(n.char >= 0 && n.char <= 0x10ffff ? n.char : 0xfffd);
    else if (n.type === 'disc') walk(n.replace);
    else if (n.children) walk(n.children);
    else if (n.type === 'glue' && (n.subtype === 13 || n.subtype === 14)) s += ' ';
  } };
  walk(nodes);
  return s;
};
const width = (nodes: J[]): number => nodes.reduce((w, n) =>
  w + (n.type === 'glyph' ? n.width : n.type === 'kern' ? n.kern : n.type === 'glue' ? n.width
    : n.type === 'hlist' || n.type === 'vlist' ? n.width : n.type === 'math' ? n.surround ?? 0 : 0), 0);

type FontMap = (tFont: number) => number | undefined;

function token(n: J, fm?: FontMap): string {
  switch (n.type) {
    case 'glyph': return `g:${n.char}`;
    case 'glue': return `G:${n.subtype}:${n.width}:${n.stretch}/${n.stretch_order}:${n.shrink}/${n.shrink_order}`;
    case 'kern': return `k:${n.kern}`;
    case 'penalty': return `p:${n.penalty}`;
    case 'disc': return `d:${(n.pre ?? []).map((x: J) => x.char).join(',')}|${(n.post ?? []).map((x: J) => x.char).join(',')}|${(n.replace ?? []).map((x: J) => x.char ?? x.type).join(',')}`;
    case 'math': return `m:${n.subtype}`;
    case 'rule': return `r:${n.width}:${n.height}:${n.depth}`;
    case 'hlist': case 'vlist': return `${n.type[0]}:${n.width}:${n.height}:${n.depth}`;
    default: return n.type;
  }
  void fm;
}
const cls = (tok: string) => tok.split(':')[0];
const CLASS: Record<string, string> = { g: 'glyph', G: 'glue', k: 'kern', p: 'penalty', d: 'disc', m: 'math', r: 'rule', h: 'hbox', v: 'vbox' };

/** LCS alignment of two token lists → matched pairs of indices. */
export function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

const FILTER = new Set(['ins', 'whatsit', 'mark', 'margin_kern']);
const flat = (nodes: J[]) => (nodes ?? []).filter(n => !FILTER.has(n.type));

function comparePara(t: J, l: J, fm: FontMap): ParaReport {
  const tn = flat(t.nodes), ln = flat(l.nodes);
  const ta = tn.map(n => token(n, fm)), la = ln.map(n => token(n, fm));
  const pairs = lcs(ta, la);
  const mismatches: Record<string, number> = {};
  const mt = new Set(pairs.map(p => p[0])), ml = new Set(pairs.map(p => p[1]));
  ta.forEach((x, i) => { if (!mt.has(i)) { const k = `only-T ${CLASS[cls(x)] ?? cls(x)}`; mismatches[k] = (mismatches[k] ?? 0) + 1; } });
  la.forEach((x, i) => { if (!ml.has(i)) { const k = `only-L ${CLASS[cls(x)] ?? cls(x)}`; mismatches[k] = (mismatches[k] ?? 0) + 1; } });
  // glyph widths and glue specs, compared where the unbroken glyph texts align
  const ug = (ns: J[]) => { const out: J[] = []; const w = (xs: J[]) => { for (const n of xs ?? []) {
    if (n.type === 'glyph') out.push(n); else if (n.type === 'disc') w(n.replace); else if (n.children) w(n.children); } }; w(ns); return out; };
  const tg = ug(t.nodes), lg = ug(l.nodes);
  const gp = lcs(tg.map(g => String(g.char)), lg.map(g => String(g.char)));
  let gwe = 0;
  for (const [i, j] of gp) if (tg[i].width === lg[j].width && tg[i].height === lg[j].height && tg[i].depth === lg[j].depth) gwe++;
  const tgl = tn.filter(n => n.type === 'glue'), lgl = ln.filter(n => n.type === 'glue');
  const glp = lcs(tgl.map(g => token(g)), lgl.map(g => token(g)));
  const fields: string[] = [];
  for (const k of ['indent', 'width', 'band_indent', 'band_width', 'baselineskip', 'lineskip', 'lineskiplimit', 'protrude_chars', 'align'])
    if ((t[k] ?? null) !== (l[k] ?? null)) fields.push(`${k} ${t[k]}≠${l[k]}`);
  return {
    t: count(t.nodes), l: count(l.nodes),
    textEqual: text(t.nodes) === text(l.nodes),
    unbrokenWidthT: width(unbroken(flat(t.nodes))), unbrokenWidthL: width(unbroken(flat(l.nodes))),
    tokens: Math.max(ta.length, la.length), matched: pairs.length, mismatches, fields,
    glyphWidthsEqual: gwe, glyphWidthsTotal: Math.max(tg.length, lg.length),
    glueEqual: glp.length, glueTotal: Math.max(tgl.length, lgl.length),
  };
}

export function compareOutputs(T: J, L: J): CaseReport {
  // a font by its file (a Tectonic capture's face, LuaTeX's file name: only a font loaded from one has it), else its TeX name
  const key = (f: J) => `${f.face?.file ?? f.filename ?? f.name}@${f.size_sp}`;
  const lByKey = new Map(Object.entries(L.fonts).map(([id, f]: [string, any]) => [key(f), Number(id)]));
  const unmatched = Object.values(T.fonts).map((f: any) => key(f)).filter(k => !lByKey.has(k));
  const fm: FontMap = (id) => lByKey.get(key(T.fonts[id] ?? {}));
  const kinds = (c: J[]) => c.map(i => i.kind[0]).join('');
  // Paragraphs are paired by aligning the two streams (LCS on a key made of
  // each paragraph's opening text), so that one item more or less on one
  // side does not shift every later pair.
  const itemKey = (J: J, it: J) => it.kind === 'paragraph'
    ? 'P' + text(J.paragraphs[it.para - 1].nodes).replace(/\s+/g, '').slice(0, 24) : it.kind[0];
  const ti = T.content.filter((i: J) => i.kind === 'paragraph' || i.kind === 'display');
  const li = L.content.filter((i: J) => i.kind === 'paragraph' || i.kind === 'display');
  const pairs = lcs(ti.map((i: J) => itemKey(T, i)), li.map((i: J) => itemKey(L, i)));
  // (text that differs in its first characters still pairs by position
  // between two paired neighbours)
  const all: [number, number][] = [];
  let pi = 0, pj = 0;
  for (const [i, j] of [...pairs, [ti.length, li.length] as [number, number]]) {
    if (i - pi === j - pj) for (let k = 0; k < i - pi; k++) if (ti[pi + k].kind === li[pj + k].kind) all.push([pi + k, pj + k]);
    if (i < ti.length) all.push([i, j]);
    pi = i + 1; pj = j + 1;
  }
  const paragraphs: ParaReport[] = [];
  for (const [i, j] of all) if (ti[i].kind === 'paragraph')
    paragraphs.push(comparePara(T.paragraphs[ti[i].para - 1], L.paragraphs[li[j].para - 1], fm));
  const unpaired = { t: ti.length - all.length, l: li.length - all.length };
  const vs = (c: J[]) => c.filter(i => i.kind === 'vspace').map(i => i.amount);
  const disp = (c: J[]) => c.filter(i => i.kind === 'display');
  const td = disp(T.content), ld = disp(L.content);
  const fields: Record<string, number> = {};
  let boxEqual = 0;
  for (let k = 0; k < Math.min(td.length, ld.length); k++) {
    const a = td[k], b = ld[k];
    if (a.box.width === b.box.width && a.box.height === b.box.height && a.box.depth === b.box.depth) boxEqual++;
    for (const f of Object.keys(b)) if (f.startsWith('display_') && a[f] !== b[f]) fields[f] = (fields[f] ?? 0) + 1;
  }
  return {
    items: { t: kinds(T.content), l: kinds(L.content) }, unpaired,
    paragraphs,
    vspace: { t: vs(T.content), l: vs(L.content) },
    displays: { t: td.length, l: ld.length, boxEqual, fields },
    fonts: { t: Object.keys(T.fonts).length, l: Object.keys(L.fonts).length, unmatched },
    footnotes: { t: (T.streams ?? []).filter((s: J) => s.kind === 'footnote').length, l: (L.streams ?? []).filter((s: J) => s.kind === 'footnote').length },
  };
}

export function summarize(name: string, r: CaseReport): string {
  const sum = (f: (p: ParaReport) => number) => r.paragraphs.reduce((a, p) => a + f(p), 0);
  const ct = r.paragraphs.reduce((a, p) => add(a, p.t), zero()), cl = r.paragraphs.reduce((a, p) => add(a, p.l), zero());
  const pct = (a: number, b: number) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');
  const vsEq = r.vspace.t.length === r.vspace.l.length && r.vspace.t.every((v, i) => v === r.vspace.l[i]);
  const mism: Record<string, number> = {};
  for (const p of r.paragraphs) for (const [k, v] of Object.entries(p.mismatches)) mism[k] = (mism[k] ?? 0) + v;
  return [
    `## ${name}`,
    r.items.t.length > 120 ? `stream: ${r.items.t.length} items T, ${r.items.l.length} L; unpaired paragraphs/displays T ${r.unpaired.t} L ${r.unpaired.l}`
      : `stream T ${r.items.t}  L ${r.items.l}${r.items.t === r.items.l ? '  (same)' : '  (DIFFERENT)'}`,
    `paragraphs ${r.paragraphs.length}; text equal ${r.paragraphs.filter(p => p.textEqual).length}/${r.paragraphs.length}; ` +
      `unbroken width equal ${r.paragraphs.filter(p => p.unbrokenWidthT === p.unbrokenWidthL).length}/${r.paragraphs.length}`,
    `counts T/L: glyph ${ct.glyph}/${cl.glyph} glue ${ct.glue}/${cl.glue} kern ${ct.kern}/${cl.kern} penalty ${ct.penalty}/${cl.penalty} ` +
      `disc ${ct.disc}/${cl.disc} math ${ct.math}/${cl.math} box ${ct.box}/${cl.box} rule ${ct.rule}/${cl.rule}`,
    `top-level tokens aligned ${pct(sum(p => p.matched), sum(p => p.tokens))}; glue specs equal ${pct(sum(p => p.glueEqual), sum(p => p.glueTotal))}; ` +
      `glyph metrics equal ${pct(sum(p => p.glyphWidthsEqual), sum(p => p.glyphWidthsTotal))}`,
    `mismatch classes: ${Object.entries(mism).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `paragraph fields differing: ${[...new Set(r.paragraphs.flatMap(p => p.fields))].join('; ') || 'none'}`,
    `vspace T [${r.vspace.t.join(', ')}]  L [${r.vspace.l.join(', ')}]${vsEq ? '  (same)' : ''}`,
    `displays T ${r.displays.t} L ${r.displays.l}; box dims equal ${r.displays.boxEqual}; fields differing: ${Object.entries(r.displays.fields).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}`,
    `fonts T ${r.fonts.t} L ${r.fonts.l}; unmatched: ${r.fonts.unmatched.join(', ') || 'none'}; footnotes T ${r.footnotes.t} L ${r.footnotes.l}`,
  ].join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('compare.ts')) {
  const { readFileSync } = await import('node:fs');
  const [tp, lp, ...flags] = process.argv.slice(2);
  const T = JSON.parse(readFileSync(tp, 'utf8')), L = JSON.parse(readFileSync(lp, 'utf8'));
  const r = compareOutputs(T, L);
  console.log(summarize(flags.find(f => !f.startsWith('--')) ?? tp, r));
  if (flags.includes('--detail')) r.paragraphs.forEach((p, i) => console.log(`  para ${i + 1}:`, JSON.stringify({ ...p, t: undefined, l: undefined })));
}
