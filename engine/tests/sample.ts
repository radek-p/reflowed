// The engine's tests and scripts/record-docs.ts use it.
// The sample document the measurements and tests use: a preamble and blocks
// of the kinds an editor has (paragraph, heading, display, theorem, list).

export const PREAMBLE = String.raw`\documentclass{article}
\usepackage{amsmath,amsthm}
\newtheorem{theorem}{Theorem}[section]
\newcommand{\R}{\mathbb{R}}`;

export const BLOCKS: Record<string, string> = {
  paragraph: String.raw`The quick brown fox jumps over the lazy dog while the
reader, patient as ever, waits for the paragraph to end. Typesetting is the
craft of arranging type so that the text is easy to read; \TeX{} breaks
paragraphs into lines by minimising a total badness over all the lines at
once, which is why its paragraphs look even. Here is some inline math,
$f(x) = \int_0^x e^{-t^2}\,dt$, and a set $\{x \in \R : x^2 < 2\}$.`,
  heading: String.raw`\section{Introduction}`,
  display: String.raw`Consider the Basel problem:
\begin{equation}
  \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}.
\end{equation}`,
  theorem: String.raw`\begin{theorem}
Every bounded monotone sequence of real numbers $(a_n)$ converges in $\R$.
\end{theorem}`,
  list: String.raw`\begin{itemize}
\item first item, with $a^2+b^2=c^2$;
\item second item;
\item third item.
\end{itemize}`,
};

/** Isolation probes: block A changes global and local state, block B reports what it sees. */
export const LEAK_A = String.raw`\gdef\LeakG{1}\def\LeakL{1}\newcommand\LeakN{1}%
\setcounter{section}{7}\addtocounter{equation}{3}\global\parindent=50pt
\itshape Text A.`;
export const LEAK_B = String.raw`\makeatletter
\typeout{ISO: G=\ifdefined\LeakG yes\else no\fi, L=\ifdefined\LeakL yes\else no\fi,
N=\ifdefined\LeakN yes\else no\fi, sec=\arabic{section}, eq=\arabic{equation},
parindent=\the\parindent, shape=\f@shape}\makeatother
Text B.`;

/** Blocks with errors, each followed in the tests by a good block. */
export const ERRORS: Record<string, string> = {
  undefined: String.raw`Text \undefinedcontrolsequence{} more.`,
  unclosedEnv: String.raw`\begin{itemize}\item open`,
  extraBrace: String.raw`Text } more.`,
  runawayArg: String.raw`\textbf{never closed`,
};
