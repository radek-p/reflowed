// The documents scripts/record.ts records the working set with, and the pack's
// minification proof (scripts/minify-pack.ts) compiles twice: the default
// documents (the intro, the example), figure labels, TikZ, the engine's samples, the block templates, font
// switches, then the tier documents of engine/scripts/tiers.ts.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defsContexts } from '../engine/src/defs-context.ts';
import { PREAMBLE, BLOCKS } from '../engine/tests/sample.ts';
import { TIERS } from '../engine/scripts/tiers.ts';

const EDITOR = fileURLToPath(new URL('../', import.meta.url));   // ends in /
const r = String.raw;
export type Doc = { tier?: number | 'base'; name: string; preamble: string; bbl?: string; blocks: { source: string; context?: string }[]; assets?: { name: string; mime: string; b64: string }[]; pdf?: boolean };

export async function recordDocs(): Promise<Doc[]> {
  const docs: Doc[] = [];

  // the default documents, from their seed files (scripts/seed.ts): their own classes, fonts and figures are
  // document assets
  const seedDoc = (file: string, name: string) => {
    const p = EDITOR + 'build/seed/' + file;
    if (!existsSync(p)) { console.log(`${file}: not there (scripts/seed.ts), not recorded`); return; }
    const ex = JSON.parse(readFileSync(p, 'utf8')).init;
    const srcs: string[] = ex.blocks.map((b: { source: string }) => b.source);
    const exCtx = defsContexts(srcs);
    docs.push({ name, preamble: ex.preamble?.source ?? ex.preamble, bbl: ex.bib?.kind === 'bbl' ? ex.bib.source : undefined, pdf: true,
      blocks: ex.blocks.filter((b: { kind: string; source: string }) => b.source.trim() && !/^\\begin\{[a-z*]+\}\s*$/.test(b.source))
        .map((b: { source: string }) => ({ source: b.source, context: exCtx[srcs.indexOf(b.source)] })),
      assets: (ex.assets ?? []).map((a: { name: string; mime: string; base64: string }) => ({ name: a.name, mime: a.mime, b64: a.base64 })) });
  };
  seedDoc('intro.json', 'intro');
  seedDoc('example.json', 'example (paper2)');
  docs.push({ name: 'figure labels', preamble: r`\documentclass{article}
  \usepackage{amsmath,amssymb,mathrsfs}
  \usepackage{tikz}`, blocks: [
    { source: r`$\mathscr{C}$ and $K_{t,t}$, $\mathcal{P}$-flip`, context: '\\noindent' },
    { source: r`\begin{minipage}{96bp}\small A label in a minipage with \emph{emphasis} and $x^2$.\end{minipage}`, context: '\\noindent' },
    { source: r`\begin{tikzpicture}[>=stealth]\draw[->,thick] (0,0) -- (2,1) node[right] {$\mathscr{U}$};\fill[blue!30] (0,0) circle (2pt); \node[draw,rounded corners] at (1,-1) {\textsf{label}};\draw[dashed] (0,-2) rectangle (3,-1.5);\end{tikzpicture}`, context: '\\noindent' },
  ] });
  // TikZ in a small document
  docs.push({ name: 'tikz', preamble: r`\documentclass{article}
  \usepackage{amsmath,amssymb}
  \usepackage{tikz}
  \usetikzlibrary{arrows.meta,calc,positioning,shapes}`, blocks: [
    { source: r`\begin{tikzpicture}[>=Stealth] \draw[->] (0,0) -- (2,1) node[right] {$f(x)$}; \fill[blue!20] (0,0) circle (3pt); \node[draw, rounded corners] at (1,-1) {box}; \end{tikzpicture}` },
    { source: r`Inline \tikz \draw (0,0) circle (1ex); picture.` },
  ] });
  // the engine's sample blocks, and the block model's templates and starter
  docs.push({ name: 'sample', preamble: PREAMBLE, blocks: Object.values(BLOCKS).map((source) => ({ source })) });
  try {
    const { starterDocument, TYPES, DEFAULT_PREAMBLE } = await import(pathToFileURL(EDITOR + 'scripts/blocks-model.js').href);   // the block model (templates, starter)
    const s = starterDocument();
    docs.push({ name: 'blocks-ui starter', preamble: s.preamble, blocks: s.blocks.map((b: { source: string }) => ({ source: b.source })) });
    docs.push({ name: 'blocks-ui templates', preamble: DEFAULT_PREAMBLE, blocks: TYPES.map((t: { type: string; source: string }) => ({ source: t.source.replace(/\{\}|\n  \n|\\item \n/, (m: string) => (m === '{}' ? '{Title}' : m.startsWith('\\item') ? '\\item x\n' : /equation|align/.test(t.type) ? '\n  x = 1\n' : '\n  $x$ text\n')) })) });
  } catch (e) { console.log('blocks-ui model:', (e as Error).message); }
  docs.push({ name: 'fonts', preamble: r`\documentclass{article}
  \usepackage{amsmath,amssymb}`, blocks: [
    { source: r`\textrm{roman} \textit{italic} \textbf{bold} \textbf{\textit{bold italic}} \textsl{slanted} \textsc{Small Caps} \textsf{sans \textbf{bold} \textit{it}} \texttt{typewriter \textbf{bold}} \emph{emph}` },
    { source: r`{\tiny tiny} {\scriptsize scriptsize} {\footnotesize footnotesize} {\small small} {\large large} {\Large Large} {\LARGE LARGE} {\huge huge} {\Huge Huge}` },
    { source: r`Footnote\footnote{A note with $x^2$.} $\alpha\beta\Gamma \in \mathbb{R}^n$, $\mathbf{v}$, $\sqrt[3]{x}$, $\left(\frac{a}{b}\right)$, $\overbrace{a+b}^{n}$.` },
  ] });

  // the default embedded set, tier by tier (engine/scripts/tiers.ts), after the documents above (tier 'base')
  for (const d of docs) d.tier = 'base';
  for (const t of TIERS) docs.push({ tier: t.tier, name: `tier ${t.tier}: ${t.name}`, preamble: t.preamble, bbl: t.bbl, blocks: t.blocks.map((source) => ({ source })) });
  return docs;
}
