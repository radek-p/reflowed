// The built-in example document, and a plain .tex round trip for the io
// stub. The document itself
// is the store's (contracts.d.ts: Doc, Block), kinds are in kinds.js.
import { guessKind } from '../doc/kinds.js';
import { commentStart } from '../tex/lex.ts';
export { guessKind };

export const DEFAULT_PREAMBLE = String.raw`\usepackage{amsmath,amssymb,amsthm}
\usepackage{reflowtex}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}`;

// ── .tex round trip (the io stub) ────────────────────────────────────────────

const MARK = '%% ---- block';
const MARK_RE = /^%% ---- block: ([\w*-]+) ----[ \t]*$/;
const DEFAULT_CLASS = '\\documentclass{article} % blocks: default class';

export function toTex(doc) {
  const out = [`% ${doc.title || 'Untitled'}`, '% Written by the Reflow TeX editor: each block follows a', `% "${MARK}: <kind> ----" line; the editor reads the blocks back from them.`];
  const pre = typeof doc.preamble === 'string' ? doc.preamble : doc.preamble.source;
  if (!/^[ \t]*\\documentclass\b/m.test(pre)) out.push(DEFAULT_CLASS);
  out.push(pre.replace(/\s+$/, ''), '', '\\begin{document}', '');
  for (const b of doc.blocks) out.push(`${MARK}: ${b.kind || guessKind(b.source)} ----`, b.source.replace(/\s+$/, ''), '');
  out.push('\\end{document}', '');
  return out.join('\n');
}

/** .tex → { title, preamble, blocks: [{ kind, source }] }: blocks from the
 *  markers, or else the body cut at blank lines outside environments. */
export function parseTex(tex, title = '') {
  const b = /^[ \t]*\\begin\{document\}[^\n]*\n?/m.exec(tex);
  const e = /^[ \t]*\\end\{document\}/m.exec(tex);
  let preamble = '', body = tex;
  if (b) {
    preamble = tex.slice(0, b.index);
    body = tex.slice(b.index + b[0].length, e && e.index > b.index ? e.index : undefined);
    const m = /^% (.*)\n/.exec(preamble);
    const ours = /Written by the Reflow TeX (block )?editor/.test(preamble.split('\n').slice(0, 3).join('\n'));
    if (m && !title && ours) title = m[1];
    preamble = preamble.split('\n').filter((l, i) => !(l === DEFAULT_CLASS || (ours && i < 3 && /^% /.test(l)))).join('\n').trim();
  }
  const lines = body.split('\n');
  const blocks = [];
  if (lines.some((l) => MARK_RE.test(l))) {
    let cur = { kind: null, lines: [] };
    const flush = () => { const s = cur.lines.join('\n').trim(); if (s) blocks.push({ kind: cur.kind || guessKind(s), source: s }); };
    for (const l of lines) {
      const m = MARK_RE.exec(l);
      if (m) { flush(); cur = { kind: m[1], lines: [] }; } else cur.lines.push(l);
    }
    flush();
  } else {
    for (const s of cutBlocks(body)) blocks.push({ kind: guessKind(s), source: s });
  }
  return { title, preamble, blocks };
}

/** Cut LaTeX at blank lines outside environments and display maths. */
export function cutBlocks(body) {
  const out = [];
  let depth = 0, cur = [];
  const flush = () => { const s = cur.join('\n').trim(); if (s) out.push(s); cur = []; };
  for (const l of body.split('\n')) {
    const code = l.slice(0, commentStart(l));
    if (!l.trim() && depth === 0) { flush(); continue; }
    cur.push(l);
    depth += (code.match(/\\begin\{/g) || []).length - (code.match(/\\end\{/g) || []).length;
    depth += (code.match(/\\\[/g) || []).length - (code.match(/\\\]/g) || []).length;
    if (depth < 0) depth = 0;
  }
  flush();
  return out;
}
