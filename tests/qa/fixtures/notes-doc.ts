// A document with its authors' note macros and commented-out text, for the notes suites (test-notes, test-w6). It
// replaces the former sample paper's preamble and blocks (its six todonotes macros, its commented-out code and
// text). Made up: two authors' roles, Editor and Referee, each with a margin and an inline macro, two more one-off
// macros; comments in typeset blocks that are code (commented-out \begin…, a \label), and text put away only in a comment
// block (the one note a comment makes).
//
//   PREAMBLE, BLOCKS, MACROS (the six macro names), COMMENT_RUNS (how many runs of % lines the blocks have)
export const MACROS = ['editor', 'referee', 'editorin', 'refereein', 'proofreader', 'typist'];

export const PREAMBLE = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage[colorinlistoftodos]{todonotes}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newcommand{\editor}[1]{\todo[color=blue!40]{Editor: #1}}
\newcommand{\referee}[1]{\todo[color=green!40]{Referee: #1}}
\newcommand{\editorin}[1]{\todo[inline,size=\normalsize,color=blue!40,caption={}]{Editor: #1}}
\newcommand{\refereein}[1]{\todo[inline,size=\normalsize,color=green!40,caption={}]{Referee: #1}}
\newcommand{\proofreader}[1]{\todo[color=orange!40]{Proofreader: #1}}
\newcommand{\typist}[1]{\todo[color=red!20]{Typist: #1}}
\newcommand{\set}[1]{\{#1\}}
\title{Notes in a Test Document (made up)}
\author{A. Author}
\date{}`;

export const BLOCKS: { kind: string; source: string }[] = [
  { kind: 'heading', source: '\\section{Introduction}\\label{sec:intro}' },
  { kind: 'paragraph', source: 'Blocks are the dense analogue of lines: they separate the text into pieces that typeset on their own, and a document of blocks reads like one written in a single file. This paragraph is long enough to break into several lines at the usual widths, so a note at its end sits in a line of its own.' },
  { kind: 'theorem', source: '\\begin{theorem}\\label{thm:main}\nEvery paragraph can be typeset on its own, with the definitions before it.\n\\end{theorem}' },
  { kind: 'proof', source: [
    '\\begin{proof}',
    'Take the paragraph and the definitions before it.',
    '% Observe that the order of the definitions does not matter here.',
    '% \\begin{lemma}\\label{lem:order}',
    '%   The order does not matter.',
    '% \\end{lemma}',
    'Typeset them together; the result is the paragraph as the whole document has it.',
    '% \\cref{lem:order} was used here',
    '\\end{proof}'].join('\n') },
  { kind: 'paragraph', source: 'A paragraph with a comment at the end of a line, % the rest of this line is a comment\nand more text on the next line.' },
  { kind: 'comment', source: '% A whole paragraph commented out.\n% It used to say something else.' },
  { kind: 'paragraph', source: 'The paragraph that stayed.' },
  { kind: 'paragraph', source: 'Code put away:\n% \\begin{figure}\\centering\\includegraphics{old}\\end{figure}\nand text after it.' },
  { kind: 'paragraph', source: 'Two comments in a row,\n% \\label{old:one}\n%\n% \\ref{old:two}, after an empty comment line\nthen text.' },
  { kind: 'paragraph', source: [
    'Comments of every kind, each between two lines of text.',
    '% \\editorin{Suggestion: say it once.}',
    'The first line of text.',
    '% Statements of the form \\eqref{eq:x} hold everywhere.',
    'The second line of text.',
    '% On the way, we introduce \\emph{blocks} and their widths.',
    'The third line of text.',
    '% Observe that $u \\leq v$ and $v \\leq w$ give $u \\leq w$ for all $u, v, w$.',
    'The fourth line of text.',
    '% In particular, for every category \\[ x \\circ \\mathrm{id} = x. \\]',
    'The last line of text.'].join('\n') },
];
/** runs of consecutive % lines (or a trailing % comment) in BLOCKS, as notes/scan.js commentGroups finds them */
export const COMMENT_RUNS_AT_LEAST = 9;
