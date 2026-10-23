// the gap the page rebuilds between two separately compiled blocks
// (web/spacing.ts gapBetween, from src/spacing.ts's per-block data) against
// the gap TeX made when the same blocks were one document (the whole
// sequence as one block: the vspace item output.json has between them).
// Pass: every gap within 0.5 px (0.376 pt). The sample's blocks and the
// introduction (samples/intro).
//   node tests/spacing.test.ts        (GAPS=1: every gap compared, and why one is not)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { engine, fetchSync, local, TC , EXTRA } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';
import { spacingOf } from '../src/spacing.ts';
import { splitDocument } from '../src/split.ts';
import { defsContexts } from '../src/defs-context.ts';
import { gapBetween } from '../web/spacing.ts';
import { PREAMBLE, BLOCKS } from './sample.ts';
import { versionOf } from '../../samples/intro/variants.ts';   // a source with the intro's version markers, as the editor reads it

const TOL = 0.5 * 72.27 / 96;
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
const sty = readFileSync(TC + 'engine/api/tex/rtx-template.sty', 'utf8').replace('\\ProvidesPackage{rtx-template}', '\\ProvidesPackage{tectonic-capture}');
const e = await engine('async');

function run(preamble: string, blocks: string[], contexts: string[], label: string, bbl?: Uint8Array) {
  e.setExtraFiles({ ...EXTRA, ...(bbl ? { 'input.bbl': bbl } : {}) });
  e.reset(); e.addFile('input.tex', buildHost(preamble).main);
  if (!e.warm('input.tex').ok) throw new Error('warm failed');
  const each = blocks.map((b, i) => {
    e.runBlock(blockFile(b, contexts[i]).text);
    const c = capture(e, (n) => fetchSync(0, n));
    if (process.env.DBG && Number(process.env.DBG) === i) console.log("DBG", i, JSON.stringify(b.slice(0, 80)), JSON.stringify(spacingOf(c.stream, c.output)?.raw.above));
    return { items: c.output.content as any[], spacing: spacingOf(c.stream, c.output)! };
  });
  e.runBlock(blockFile(blocks.join('\n\n')).text);
  const wc = capture(e, (n) => fetchSync(0, n));
  const wout = wc.output;
  const whole = wout.content as any[];
  // which block a whole-document paragraph came from: its first source line
  const starts: number[] = [];
  let line = 1;
  for (const b of blocks) { starts.push(line); line += b.split('\n').length + 1; }
  const blockOfLine = (l: number) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= l) k++; return k; };
  // an item's block: the source line of its first glyph typed in the block (not made by a macro)
  const itemBlock = (j: number) => {
    const g = wc.sourcemap.items[`c${j}`];
    if (!g) return null;
    for (let q = 0; q + 4 < g.length; q += 5) if (g[q + 1] > 0 && !g[q + 4] && wc.sourcemap.files[g[q]]?.includes('rtx-block')) return blockOfLine(g[q + 1]);
    return null;
  };
  let compared = 0, bad = 0, worst = 0, cur = -1, skipped = 0;
  const misses: string[] = [];
  for (let j = 0; j < whole.length; j++) {
    const it = whole[j];
    if (it.kind !== 'paragraph') continue;
    const k = itemBlock(j);
    // a paragraph with no glyph typed in a block (an image line, a title made by macros): the next gap is not compared
    if (k == null) { if (process.env.GAPS) console.log(`  no block for item ${j}: ${JSON.stringify(wc.sourcemap.items[`c${j}`]?.slice(0, 10))}`); cur = -1; continue; }
    if (k === cur) continue;
    const prevBlock = cur;
    cur = k;
    if (prevBlock < 0) continue;
    if (k !== prevBlock + 1 || !each[prevBlock].items.length || each[k].items.find((x) => x.kind !== 'anchorpoint')?.kind !== 'paragraph') { if (process.env.GAPS) console.log(`  skip #${prevBlock}→${k}: ${each[k].items.slice(0, 3).map((x) => x.kind)}`); skipped++; continue; }
    // TeX's gap: every vspace item since the previous block's last box (an anchor point, \label's zero-size box,
    // stands between a heading's skip and the next paragraph: it is not a box of the text and does not end the gap)
    let q = j - 1, got = 0, anchors = 0, explicit = 0;
    for (; q >= 0 && (whole[q].kind === 'vspace' || whole[q].kind === 'anchorpoint'); q--) {
      if (whole[q].kind === 'anchorpoint') { anchors++; continue; }
      got += whole[q].amount / 65536;
      for (const n of whole[q].glue ?? []) if (!(n.type === 'glue' && (n.subtype === 1 || n.subtype === 2))) explicit += (n.width ?? 0) / 65536;
    }
    const prevKind = whole[q]?.kind;
    const g = gapBetween(each[prevBlock].spacing, each[k].spacing)!;
    // after a display the vspace holds the interline glue too, so the total is compared; but where anchor points stand
    // in the gap, TeX put interline glue before each of their boxes (the capture's, not LaTeX's: a \label is a \write
    // in LaTeX; template.tex \reflowtex@anchorbox, public reflowtex), so there the glue without the interline is compared
    const anchored = prevKind === 'display' && anchors > 0;
    if (anchored) got = explicit;
    const want = anchored ? g.totalPt - g.interlinePt : prevKind === 'display' ? g.totalPt : g.explicitPt;
    const d = Math.abs(got - want);
    worst = Math.max(worst, d);
    compared++;
    if (process.env.GAPS) console.log(`  gap #${prevBlock}→${k} ${prevKind}: TeX ${got.toFixed(3)} page ${want.toFixed(3)}  ${JSON.stringify(blocks[prevBlock].slice(0, 40))} → ${JSON.stringify(blocks[k].slice(0, 40))}`);
    if (d > TOL) { bad++; misses.push(`#${prevBlock}→${k}: TeX ${got.toFixed(3)} pt, page ${want.toFixed(3)} pt (${prevKind}; A.below ${JSON.stringify(each[prevBlock].spacing.raw.below)} B.above ${JSON.stringify(each[k].spacing.raw.above)})`); }
  }
  console.log(`  ${label}: ${compared} gaps compared, ${skipped} skipped (a block without paragraphs between, or starting with another item)`);
  check(`${label}: ${compared - bad}/${compared} gaps within 0.5 px (worst ${worst.toFixed(3)} pt)`, bad === 0 && compared > 0, misses.slice(0, 8).join('\n    '));
  return { compared, bad, worst };
}

run(PREAMBLE, Object.values(BLOCKS).concat([String.raw`\subsection{Details}`, 'Text after a subsection.', String.raw`\begin{proof}A proof.\end{proof}`, 'Closing words.']), [], 'sample');

// a source document split into blocks as the import does, each block with its definitions context and, after a
// block that is only a heading, LaTeX's @nobreak state (contextFor puts \\@afterheading there; a
// \\paragraph{..} followed by text in the same block is not only a heading)
const HEAD = /^\s*\\(?:section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}\s*(?:\\label\{[^}]*\}\s*)?$/;
function runSource(src: string, label: string, n = 0, bbl?: Uint8Array) {
  // the document's other files (figures, logos) where TeX looks for them
  for (const e of readdirSync(src, { recursive: true, withFileTypes: true }))
    if (e.isFile() && !/\.(tex|bbl)$/.test(e.name)) { const p = relative(src, join(e.parentPath, e.name)); local.set(p, readFileSync(join(src, p))); }
  const doc = splitDocument(versionOf(readFileSync(src + 'main.tex', 'utf8'), 'editor'), (p) => (existsSync(src + p) ? readFileSync(src + p, 'utf8') : null));
  const srcs = doc.blocks.map((b) => b.source);
  const ctx = defsContexts(srcs);
  const pick = srcs.map((s, i) => i).slice(0, n || undefined);
  const after = (k: number) => (k > 0 && HEAD.test(srcs[pick[k - 1]]) ? '\\makeatletter\\@afterheading\\makeatother' : '');
  run(doc.preamble, pick.map((i) => srcs[i]), pick.map((i, k) => [ctx[i], after(k)].filter(Boolean).join('\n')), `${label} (${pick.length} blocks)`, bbl);
}

// the introduction (samples/intro, the seed 'intro'): headings with \\label, a definition, a theorem with an
// equation, a proof, a list, a figure and a table, a bibliography (its refs.bbl)
const INTRO = TC + 'samples/intro/source/';
if (existsSync(INTRO + 'main.tex')) runSource(INTRO, 'intro', 0, existsSync(INTRO + 'refs.bbl') ? readFileSync(INTRO + 'refs.bbl') : undefined);
else check('intro: samples/intro/source/main.tex is in the checkout', false, 'the introduction document');

console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
