// Source-position coverage of the default documents through the editor
// engine (Node): every block compiled from the warm preamble with the capture,
// every glyph of the result classed by what its `src` says:
//   right   an exact position, and the source there is the glyph's character
//           (the span spells the glyph: letters, digits, ligatures, text
//           punctuation; a hyphenation point's hyphen at its break) – in the
//           block, the preamble (a macro's body) or the .bbl
//   wrong   an exact position whose source is another character
//   unchecked an exact position on a glyph whose text is not known (symbols)
//   other   an exact position in a file whose text we do not have (a package)
//   context an exact position in the definitions context compiled before the block
//           (refs.contextFor; glyphs typeset from it are not the block's text)
//   via     a macro made the glyph: the position of the call
//   none    no position
// (blocks compiled with the definitions context the app gives them, refs.contextFor)
// broken down by font kind (TFM / native) and by mode (text: paragraph glyphs
// outside inline maths; math: inline maths; display: display items and boxes).
//
//   node scripts/position-coverage.ts [--seeds=intro.json] [--blocks=N] [--list=K]
//   → build/position-coverage.json, a table on stdout; exit 0 (it measures)
import { readFileSync, writeFileSync } from 'node:fs';
import { engine, local, TC, EXTRA, fetchSync, ENGINE } from '../tests/node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
const { contextFor } = await import('../../app/src/refs/context.ts');
import { walk } from '../build/engine-api-src/rtx/shared/tree.ts';

type J = Record<string, any>;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SEEDS = (arg('seeds') ?? 'intro.json').split(',');
const MAX = Number(arg('blocks') ?? 1e9);
const LIST = Number(arg('list') ?? 8);

const CLASSES = ['right', 'wrong', 'unchecked', 'other', 'context', 'via', 'none'] as const;
type Cls = (typeof CLASSES)[number];
type Counts = Record<Cls, number>;
const zero = (): Counts => ({ right: 0, wrong: 0, unchecked: 0, other: 0, context: 0, via: 0, none: 0 });
const add = (m: Map<string, Counts>, k: string, c: Cls) => { if (!m.has(k)) m.set(k, zero()); m.get(k)![c]++; };
const total = (c: Counts) => CLASSES.reduce((s, k) => s + c[k], 0);
const exact = (c: Counts) => c.right + c.wrong + c.unchecked;
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');

// the text a glyph shows, for the check: TFM codes of T1/OT1 text fonts are
// ASCII for letters and digits; ligatures by their usual slots
const T1_LIGS: Record<number, string> = { 0x1b: 'ff', 0x1c: 'fi', 0x1d: 'fl', 0x1e: 'ffi', 0x1f: 'ffl' };
const OT1_LIGS: Record<number, string> = { 0x0b: 'ff', 0x0c: 'fi', 0x0d: 'fl', 0x0e: 'ffi', 0x0f: 'ffl' };
const UNI_LIGS: Record<number, string> = { 0xfb00: 'ff', 0xfb01: 'fi', 0xfb02: 'fl', 0xfb03: 'ffi', 0xfb04: 'ffl' };
// (symbol fonts, whose codes are not ASCII, are not checked)
const SYMBOL_FONT = /^(cmsy|cmbsy|cmex|lmsy|lmex|msam|msbm|rsfs|stmary|eu[frsx]|lasy|wasy|txsy|txex|pxsy|pxex|bbm|dsrom|lmmi.*sy|segment)/i;
// text mode: T1 is ASCII from 0x21 to 0x7E and Latin-1 in the upper half (but
// for Œ, ß, œ, ÿ…), its dashes and quotes ligatures; OT1 letters and digits;
// maths: letters and digits only (other codes are symbols)
const T1_TEXT: Record<number, string> = { ...T1_LIGS, 0x15: '--', 0x16: '---', 0x10: '``', 0x11: "''" };
const glyphText = (g: J, native: boolean, t1: boolean, fontName = '', math = false): string | null => {
  const c = g.char as number;
  if (!native && SYMBOL_FONT.test(fontName)) return null;
  const alnum = (ch: string) => (/^[\p{L}\p{N}]$/u.test(ch) ? ch : null);
  if (native) return UNI_LIGS[c] ?? (math ? alnum(String.fromCodePoint(c)) : c > 0x20 ? String.fromCodePoint(c) : null);
  if (math) return c >= 0x20 && c < 128 ? alnum(String.fromCharCode(c)) : null;
  if (t1) return T1_TEXT[c] ?? (c > 0x20 && c < 0x7f ? String.fromCharCode(c) : c >= 0xc0 && ![0xd7, 0xdf, 0xf7, 0xff].includes(c) ? String.fromCharCode(c) : null);
  return OT1_LIGS[c] ?? (c < 128 ? alnum(String.fromCharCode(c)) : null);
};

const report: J = { date: new Date().toISOString(), seeds: {} };
for (const name of SEEDS) {
  const init = JSON.parse(readFileSync(TC + 'build/seed/' + name, 'utf8')).init;
  local.clear();
  for (const a of init.assets ?? []) local.set(a.name, Buffer.from(a.base64, 'base64'));
  for (const f of (await import('node:fs')).readdirSync(ENGINE + 'tex')) if (!f.endsWith('.sty')) local.set(f, readFileSync(ENGINE + 'tex/' + f));
  const e = await engine('async');
  e.setExtraFiles({ ...EXTRA, ...(init.bib?.kind === 'bbl' ? { 'input.bbl': init.bib.source } : {}) });
  const hostMain = buildHost(init.preamble).main;
  e.reset(); e.addFile('input.tex', hostMain);
  const w = e.warm('input.tex');
  if (!w.ok) { console.log(`${name}: the preamble does not warm`); continue; }
  // the definitions context as the app makes it (refs.contextFor over the blocks without containers)
  const plain = init.blocks.filter((b: J) => !b.attrs?.container).map((b: J) => ({ id: b.id, kind: b.kind, source: b.source }));
  const ctxOf = new Map<string, string>(plain.map((b: J, k: number) => [b.id, contextFor(plain, k) ?? '']));
  const byFont = new Map<string, Counts>(), byMode = new Map<string, Counts>(), byKind = new Map<string, Counts>();
  const all = zero();
  const blocks: J[] = [];
  const wrongs: string[] = [];
  const otherWhy = new Map<string, number>();
  let engineMs = 0;
  for (const [i, b] of init.blocks.entries()) {
    if (blocks.length >= MAX) break;
    if (b.attrs?.container || !b.source.trim() || ['macros', 'comment'].includes(b.kind)) continue;
    const f = blockFile(b.source, ctxOf.get(b.id) ?? '');
    const r = e.runBlock(f.text);
    engineMs += r.restoreMs + r.runMs;
    if (r.status > 1) { blocks.push({ i, id: b.id, kind: b.kind, status: r.status }); continue; }
    let out: J;
    try { out = capture(e, (n) => fetchSync(0, n)).output; } catch { blocks.push({ i, id: b.id, kind: b.kind, status: 'capture' }); continue; }
    const files: string[] = out.source_files ?? [];
    // the files whose text we have: the block's, the host (the preamble: a macro's body), the .bbl
    const texts = new Map<string, string[]>([['rtx-block.tex', f.text.split('\n')], ['input.tex', hostMain.split('\n')]]);
    if (init.bib?.kind === 'bbl') texts.set('input.bbl', String(init.bib.source).split('\n'));
    const fonts: J[] = out.fonts ?? [];
    const bc = zero();
    const visit = (nodes: J[], display: boolean) => {
      let inMath = false;
      walk(nodes, (n: J) => {
        if (n.type === 'math') { inMath = n.subtype === 0; return; }
        if (n.type !== 'glyph') return;
        const font = fonts[n.font] ?? {};
        const native = n.gindex !== undefined || /\.(otf|ttf|ttc)/i.test(font.filename ?? '') || /^\[|:/.test(font.name ?? '');
        const t1 = /^(ec-|t1|ec[a-z]|cs-|lm.*-t1)/i.test(font.name ?? '') || /^ec/.test(font.name ?? '');
        const mode = display ? 'display' : inMath ? 'math' : 'text';
        let c: Cls;
        const s = n.src as number[] | undefined;
        if (!s) c = 'none';
        else if (s[4]) c = 'via';
        else if (files[s[0]] === 'rtx-block.tex' && s[1] < f.firstLine) c = 'context';
        else if (!texts.has(files[s[0]])) {
          c = 'other';
          otherWhy.set(files[s[0]], (otherWhy.get(files[s[0]]) ?? 0) + 1);
        }
        else if (s[3] === 0 && (n.char === 45 || n.char === 0x7f || n.char === 0x2010)) c = 'right';   // a hyphenation point's hyphen: placed at the break
        else {
          if (files[s[0]] !== 'rtx-block.tex') otherWhy.set(files[s[0]], (otherWhy.get(files[s[0]]) ?? 0) + 1);
          const lines = texts.get(files[s[0]])!;
          const want = glyphText(n, native, t1, font.name ?? '', mode !== 'text' || /^(cm|lm|rm-lm)mi|^cmbx?mi|^lmmi/.test(font.name ?? ''));   // a maths font: maths codes
          if (want == null) c = 'unchecked';
          else {
            const cps = [...(lines[s[1] - 1] ?? '')];
            const got = cps.slice(s[2], s[2] + Math.max(1, s[3])).join('');
            // a letter written as a control sequence's argument (\'e) spans more than the letter
            // tex-text mapping in native fonts: “ for ``, – for --
            const typed: Record<string, string> = { '\u201c': '``', '\u201d': "''", '\u2013': '--', '\u2014': '---', '\u2018': '`', '\u2019': "'" };
            c = got === want || got === typed[want] || (got.length > want.length && got.includes(want)) ? 'right' : 'wrong';
            if (c === 'wrong' && wrongs.length < 40) wrongs.push(`${name} #${i} l${s[1] - f.firstLine + 1}:${s[2]}+${s[3]} glyph "${want}" source "${got}"`);
          }
        }
        all[c]++; bc[c]++;
        add(byFont, `${native ? 'native' : 'tfm'} ${(font.name ?? '?').replace(/:.*/, '').slice(0, 28)}`, c);
        add(byMode, mode, c);
        add(byKind, `${native ? 'native' : 'tfm'} ${mode}`, c);
      });
    };
    const paras: J[] = out.paragraphs ?? [];
    const items: J[] = [...(out.content ?? []), ...(out.streams ?? []).flatMap((st: J) => st.content ?? [])];
    for (const it of items) {
      if (it.kind === 'paragraph') {
        const p = paras[it.para - 1];
        visit(out.slotParas?.find((sp: J) => sp.para === p)?.orig ?? p?.nodes ?? [], false);
      } else if (it.box) visit([it.box], true);
    }
    blocks.push({ i, id: b.id, kind: b.kind, status: r.status, first: b.source.split('\n')[0].slice(0, 60), ...bc });
  }
  const table = (m: Map<string, Counts>) => [...m.entries()].sort((a, b) => total(b[1]) - total(a[1]))
    .map(([k, c]) => ({ k, glyphs: total(c), ...Object.fromEntries(CLASSES.map((x) => [x, pct(c[x], total(c))])), 'wrong n': c.wrong }));
  const worst = blocks.filter((b) => b.right !== undefined && total(b as any) > 20)
    .map((b) => ({ ...b, share: (b as any).right / Math.max(1, total(b as any) - (b as any).context) })).sort((a, b) => a.share - b.share);
  const res = { blocks: blocks.length, engineMs: Math.round(engineMs), glyphs: total(all), exact: pct(exact(all), total(all)), ...all,
    byKind: table(byKind), byFont: table(byFont), byMode: table(byMode),
    worst: worst.slice(0, LIST).map((b) => ({ i: b.i, id: b.id, first: b.first, glyphs: total(b as any), right: pct(b.right, total(b as any)), wrong: b.wrong, unchecked: b.unchecked, other: b.other, context: b.context, via: b.via, none: b.none })),
    otherWhy: Object.fromEntries(otherWhy), wrongs, perBlock: blocks };
  report.seeds[name] = res;
  console.log(`\n== ${name}: ${res.blocks} blocks, ${res.glyphs} glyphs (${CLASSES.map((x) => `${x} ${pct(all[x], total(all))}`).join(', ')}; wrong ${all.wrong} glyphs); engine ${res.engineMs} ms`);
  console.table(res.byKind);
  console.log('other positions:', JSON.stringify(res.otherWhy));
  console.table(res.byFont.slice(0, 14));
  console.log('lowest share right (of the block\'s own glyphs):'); console.table(res.worst);
  if (wrongs.length) console.log('wrong positions (first ones):\n  ' + wrongs.slice(0, 15).join('\n  '));
}
writeFileSync(ENGINE + 'build/position-coverage.json', JSON.stringify(report, null, 1));
