// The default embedded TeX set, as documents: what typical papers
// load, in tiers. scripts/record.ts compiles
// each document with the editor's own worker (TeX, capture, encoder) and
// records every bundle file it opens; scripts/build.ts packs the union and
// reports the size each tier adds.
//   tier 1: the classes and packages most papers load, symbol fonts with outlines
//   tier 2: the long tail, if the size allows
// A document is a preamble and blocks that USE what they load (a symbol font
// is opened when a glyph of it is typeset, not when the package is loaded).
export interface TierDoc { tier: 1 | 2; name: string; preamble: string; blocks: string[]; bbl?: string }
const r = String.raw;

const MATH = r`Let $x \leqslant y \geqslant z$, $A \coloneqq \{a\}$, $\mathbb{R}^n$, $\mathcal{C}$, $\mathfrak{g}$,
$\varepsilon \preccurlyeq \sqsubseteq \lesssim \varnothing \uplus \models$, $\operatorname{tw}(G)$, $\tfrac12$,
$\xrightarrow{f}$, $\boldsymbol{\alpha}+\mathbf{v}$, $\mathsf{NP}$, \textsc{Small Caps}, \emph{emph}, \textbf{bold \textit{it}}, \texttt{tt}.`;
const THM = r`\begin{theorem}\label{thm:a} For every graph $G$, $\sum_{v} \deg(v) = 2|E(G)|$. \end{theorem}
\begin{proof} Count. \end{proof}
\begin{lemma}\label{lem:b} See \cref{thm:a} and \Cref{lem:b}, \eqref{eq:x}. \end{lemma}`;
const EQ = r`\begin{equation}\label{eq:x} \int_0^1 f(x)\,dx \leq \left(\frac{a}{b}\right)^{2} \end{equation}
\begin{align} a &= b + c \\ &\leq d \end{align}`;
const LIST = r`\begin{enumerate}[label=(\roman*)] \item one \item two \end{enumerate}
\begin{itemize} \item a \item b \end{itemize}`;
const THMDEFS = r`\newtheorem{theorem}{Theorem}\newtheorem{lemma}[theorem]{Lemma}`;
const common = (cls: string) => r`\documentclass${cls}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{textcomp}
\usepackage{amsmath,amssymb,amsthm,amsfonts,mathtools}
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{xspace}
\usepackage[english]{babel}
\usepackage{microtype}
\usepackage{enumitem}
\usepackage{comment}
\usepackage{hyperref}
\usepackage{cleveref}
${THMDEFS}`;

export const TIERS: TierDoc[] = [
  // ── tier 1: classes ──────────────────────────────────────────────────────
  ...['[11pt]{article}', '[10pt]{article}', '[12pt]{article}', '[a4paper]{article}'].map((cls, i): TierDoc => ({
    tier: 1, name: `article ${cls}`, preamble: common(cls) + (i === 0 ? '\n\\usepackage[margin=1in]{geometry}' : i === 1 ? '\n\\usepackage{fullpage}' : ''),
    blocks: i === 0 ? [r`\section{Introduction}\label{sec:intro}`, MATH, THM, EQ, LIST, r`\paragraph{Para.} Text \url{https://example.org} \textcolor{blue}{blue} \footnote{A note.}`,
      r`\begin{abstract} An abstract. \end{abstract}`, r`\subsection{Sub} \subsubsection{Subsub} Text.`]
      : [r`\section{Intro}`, MATH, THM, r`{\small small \footnotesize fn \large large \Large L \huge h}`],
  })),
  ...['[11pt]{book}', '[12pt]{book}', '[10pt]{book}', '{report}'].map((cls): TierDoc => ({
    tier: 1, name: `book ${cls}`, preamble: common(cls), blocks: [r`\chapter{One}`, r`\section{Intro}`, MATH, THM],
  })),
  { tier: 1, name: 'amsart', preamble: r`\documentclass[11pt]{amsart}
\usepackage{amssymb,mathtools}
\usepackage{hyperref}
\usepackage{cleveref}
\newtheorem{theorem}{Theorem}[section]\newtheorem{lemma}[theorem]{Lemma}
\title{A title}\author{A. Author}\address{Somewhere}\email{a@b.c}\subjclass[2020]{05C75}\keywords{graphs}`,
    blocks: [r`\begin{abstract} Abstract. \end{abstract}`, r`\maketitle`, r`\section{Intro}`, MATH, THM, EQ] },
  { tier: 1, name: 'scrartcl', preamble: r`\documentclass[11pt]{scrartcl}
\usepackage[T1]{fontenc}\usepackage{lmodern}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{hyperref}\usepackage{cleveref}
${THMDEFS}`, blocks: [r`\section{Intro}`, r`\subsection{Sub} Text.`, MATH, THM] },
  { tier: 1, name: 'lipics-v2021', preamble: r`\documentclass[a4paper,UKenglish,cleveref,autoref,thm-restate]{lipics-v2021}
\bibliographystyle{plainurl}
\title{A Title}
\titlerunning{Title}
\author{Jane Open Access}{Dummy University, Germany}{jane@example.org}{https://orcid.org/0000-0002-1825-0097}{funding}
\authorrunning{J. Open Access}
\Copyright{Jane Open Access}
\ccsdesc[100]{Theory of computation~Graph algorithms}
\keywords{graphs, width}
\category{}
\relatedversion{}
\supplement{}
\funding{Funded.}
\acknowledgements{Thanks.}
\nolinenumbers
\hideLIPIcs
\EventEditors{John Q. Open and Joan R. Access}
\EventNoEds{2}
\EventLongTitle{ICALP 2026}
\EventShortTitle{ICALP 2026}
\EventAcronym{ICALP}
\EventYear{2026}
\EventDate{July 2026}
\EventLocation{Somewhere}
\EventLogo{}
\SeriesVolume{42}
\ArticleNo{23}`,
    blocks: [r`\maketitle`, r`\begin{abstract} An abstract. \end{abstract}`, r`\section{Introduction}\label{sec:i}`, MATH,
      r`\begin{theorem}\label{thm:a} A theorem. \end{theorem}\begin{proof} A proof. \end{proof}`,
      r`\begin{lemma} A lemma, \cref{thm:a}. \end{lemma}\begin{claim} A claim. \end{claim}\begin{claimproof} Easy. \end{claimproof}`,
      r`\begin{restatable}{theorem}{thmmain}\label{thm:m} Restated. \end{restatable} \thmmain*`, EQ, r`\begin{enumerate} \item one \end{enumerate}\begin{itemize} \item a \end{itemize}`,
      r`\begin{definition} A definition. \end{definition}\begin{observation} An observation. \end{observation}\begin{remark} A remark.\end{remark}`,
      r`\subsection{Sub} \subparagraph{Sp} Text \textsf{sans} \textbf{\textsf{bold sans}}.`] },
  { tier: 1, name: 'llncs', preamble: r`\documentclass[runningheads]{llncs}
\usepackage[T1]{fontenc}
\usepackage{amssymb}
\usepackage{graphicx}
\usepackage{hyperref}
\title{A Title}\author{A. Author\inst{1}}\institute{Somewhere \email{a@b.c}}`,
    blocks: [r`\maketitle`, r`\begin{abstract} Abstract. \keywords{graphs}\end{abstract}`, r`\section{Intro}`, r`\begin{theorem} A theorem. \end{theorem}\begin{proof} Proof. \qed\end{proof}`,
      r`\begin{lemma} $x \leq y$. \end{lemma}\begin{definition} Def. \end{definition}`] },
  // ── tier 1: packages ─────────────────────────────────────────────────────
  { tier: 1, name: 'theorems (thmtools, thm-restate)', preamble: r`\documentclass{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{thmtools,thm-restate}
\usepackage{hyperref,cleveref}
\declaretheorem[name=Theorem,numberwithin=section]{theorem}
\declaretheorem[name=Lemma,sibling=theorem]{lemma}
\declaretheorem[name=Remark,style=remark,numbered=no]{remark}
\declaretheorem[name=Claim,sibling=theorem]{claim}`,
    blocks: [r`\section{S}`, r`\begin{restatable}{theorem}{mainthm}\label{thm:main} Main. \end{restatable} \mainthm*`,
      r`\begin{lemma}[Name] L. \end{lemma}\begin{remark} R. \end{remark}\begin{claim} C, \cref{thm:main}. \end{claim}`] },
  // (this with thmtools + thm-restate + cleveref, and \declaretheorem[numberwithin=section]
  // before it, loops in TeX Live 2022 at \section, capture off too: TeX's, not the engine's)
  { tier: 1, name: 'aliascnt', preamble: r`\documentclass{article}
\usepackage{amsthm}
\usepackage{aliascnt}
\usepackage{hyperref}
\newtheorem{theorem}{Theorem}[section]
\newaliascnt{claim}{theorem}\newtheorem{claim}[claim]{Claim}\aliascntresetthe{claim}`,
    blocks: [r`\section{S}\begin{claim}\label{c:a} C.\end{claim} See \autoref{c:a}.`] },
  { tier: 1, name: 'tikz + libraries', preamble: r`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{arrows,arrows.meta,calc,positioning,shapes,shapes.geometric,shapes.misc,decorations.pathmorphing,decorations.pathreplacing,decorations.markings,patterns,fit,backgrounds,automata,matrix,trees,intersections,quotes,angles,through,shadows}`,
    blocks: [r`\begin{tikzpicture}[>=Stealth,node distance=1cm]
\node[circle,draw] (a) {$a$}; \node[rectangle,draw,right=of a] (b) {$b$};
\draw[->,thick] (a) -- (b); \draw[decorate,decoration={brace,amplitude=4pt}] (0,-1) -- (2,-1);
\draw[pattern=north east lines] (3,0) rectangle (4,1); \node[fit=(a)(b),draw,dashed] {};
\draw[decorate,decoration=snake] (0,-2) -- (3,-2); \path let \p1=(b) in node at (\x1,-3) {x};
\end{tikzpicture}`,
      r`\begin{tikzpicture}[shorten >=1pt,auto] \node[state,initial] (q0) {$q_0$}; \node[state,accepting,right=of q0] (q1) {$q_1$};
\path[->] (q0) edge node {a} (q1) (q1) edge[loop above] node {b} (); \matrix[matrix of nodes] at (4,0) {1 & 2\\ 3 & 4\\};
\begin{scope}[on background layer] \fill[blue!10] (-1,-1) rectangle (1,1); \end{scope} \end{tikzpicture}`,
      r`Inline \tikz \draw (0,0) circle (1ex); and \tikz[baseline] \node[draw,diamond] {d};`] },
  { tier: 1, name: 'floats and tables', preamble: r`\documentclass{article}
\usepackage{graphicx}
\usepackage{caption}
\usepackage{subcaption}
\usepackage{multirow}
\usepackage{array}
\usepackage{tabularx}
\usepackage{booktabs}
\usepackage{threeparttable}
\usepackage{rotating}
\usepackage{float}`,
    blocks: [r`\begin{table}[H]\centering\caption{A table}\label{tab:a}
\begin{threeparttable}\begin{tabular}{>{\bfseries}l c r}\toprule \multirow{2}{*}{A} & b\tnote{a} & c \\ & d & e \\ \midrule 1 & 2 & 3 \\ \bottomrule\end{tabular}
\begin{tablenotes}\item[a] A note.\end{tablenotes}\end{threeparttable}\end{table}`,
      r`\begin{figure}[h]\centering\begin{subfigure}{0.4\textwidth}\centering\rule{2cm}{1cm}\caption{Left}\end{subfigure}\hfill
\begin{subfigure}{0.4\textwidth}\centering\rule{2cm}{1cm}\caption{Right}\end{subfigure}\caption{Two}\end{figure}`,
      r`\noindent\begin{tabularx}{\linewidth}{lX}\hline a & a long cell that wraps around several words of text \\ \hline\end{tabularx}`,
      r`\begin{sideways}sideways\end{sideways} \rotatebox{90}{rot} \begin{sidewaystable}\centering x\end{sidewaystable}`] },
  { tier: 1, name: 'algorithm + algpseudocode', preamble: r`\documentclass{article}
\usepackage{amsmath}
\usepackage{algorithm}
\usepackage{algpseudocode}`,
    blocks: [r`\begin{algorithm}\caption{Euclid}\begin{algorithmic}[1]\Procedure{Euclid}{$a,b$}\State $r\gets a\bmod b$
\While{$r\not=0$}\State $a\gets b$\EndWhile\If{$a>0$}\State \Return $b$\Else \State x \EndIf\For{$i=1$ to $n$} \State y\EndFor\EndProcedure\end{algorithmic}\end{algorithm}`] },
  { tier: 1, name: 'algorithm2e', preamble: r`\documentclass{article}
\usepackage[ruled,vlined,linesnumbered]{algorithm2e}`,
    blocks: [r`\begin{algorithm}\caption{A}\KwIn{$G$}\KwOut{$H$}\While{not done}{\eIf{x}{a\;}{b\;}}\ForEach{$v$}{c\;}\Return{$H$}\;\end{algorithm}`] },
  { tier: 1, name: 'misc (soul, lineno, todonotes, listings, xstring, url, enumerate)', preamble: r`\documentclass{article}
\usepackage{soul}
\usepackage{lineno}
\usepackage{todonotes}
\usepackage{listings}
\usepackage{xstring}
\usepackage{url}
\usepackage{enumerate}
\usepackage{xcolor}
\usepackage{color}
\lstset{basicstyle=\ttfamily\small,language=C}`,
    blocks: [r`\hl{highlighted} \st{struck} \ul{underlined} \so{spaced} \todo{a note} \todo[inline]{inline note}`,
      r`\begin{lstlisting}
int main() { return 0; } // comment
\end{lstlisting}`, r`\lstinline|x = 1| \IfSubStr{abc}{b}{yes}{no} \url{https://x.org/a_b}`,
      r`\begin{enumerate}[(a)] \item one \item two \end{enumerate}`, r`\begin{linenumbers} Numbered lines. \end{linenumbers}`] },
  // ── tier 1: symbol fonts (with outlines) ─────────────────────────────────
  { tier: 1, name: 'symbol fonts', preamble: r`\documentclass{article}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage[mathscr]{eucal}
\usepackage{mathrsfs}
\usepackage{bbm}
\usepackage{dsfont}
\usepackage{stmaryrd}
\usepackage{latexsym}
\usepackage{pifont}
\usepackage{nicefrac}
\usepackage{braket}
\usepackage{cancel}
\usepackage{complexity}
\usepackage{bm}`,
    blocks: [r`$\leqslant \geqslant \lesssim \gtrsim \preccurlyeq \curlyeqprec \blacktriangleright \square \varnothing \nexists \mathbb{N}\mathbb{Z}\mathbb{Q}\mathbb{R}\mathbb{C}$`,
      r`$\mathfrak{A}\mathfrak{g}$ $\mathscr{A}\mathscr{L}$ $\mathcal{A}\mathcal{B}$ $\mathbbm{1}\mathbbm{R}$ $\mathds{1}\mathds{R}$ $\llbracket x \rrbracket \llparenthesis y \rrparenthesis \varoast \mapsfrom$`,
      r`$\Box \Diamond \leadsto \lhd \unlhd \mho \Join$ \ding{51} \ding{55} \ding{172} $\nicefrac{1}{2}$ $\Set{x | x > 0}$ $\braket{\phi|\psi}$ $\cancel{x} \bcancel{y}$ $\P \neq \NP$, \coNP, \PSPACE`,
      r`$\bm{\alpha} \bm{x} \boldsymbol{\beta}\boldsymbol{\Gamma} \bm{\leq} \boldsymbol{\sum}$ \textbf{$x^2_{\bm{i}}$} {\boldmath $\alpha+\mathcal{B}$}`,
      r`{\scriptsize $\leqslant \mathbb{R} \mathfrak{g}$} {\footnotesize $\mathscr{A} \llbracket$} {\small $\mathbb{N}$} {\large $\mathbb{Z}\mathfrak{A}$} $x_{\mathbb{R}_{\mathbb{N}}}$`] },
  // ── tier 2 ───────────────────────────────────────────────────────────────
  { tier: 2, name: 'tcolorbox, mdframed, framed', preamble: r`\documentclass{article}
\usepackage[most]{tcolorbox}
\usepackage{mdframed}
\usepackage{framed}
\definecolor{shadecolor}{gray}{0.9}`,
    blocks: [r`\begin{tcolorbox}[title=Box] A box. \end{tcolorbox}`, r`\begin{mdframed} Framed. \end{mdframed}`, r`\begin{framed} F. \end{framed}\begin{shaded} S. \end{shaded}`] },
  { tier: 2, name: 'layout (setspace, authblk, wrapfig, multicol, appendix, titlesec, paralist)', preamble: r`\documentclass{article}
\usepackage{setspace}
\usepackage{authblk}
\usepackage{wrapfig}
\usepackage{multicol}
\usepackage{appendix}
\usepackage{titlesec}
\usepackage{paralist}
\title{T}\author[1]{A}\affil[1]{U}`,
    blocks: [r`\maketitle`, r`\section{S} \begin{onehalfspace} Spaced. \end{onehalfspace}`, r`\begin{wrapfigure}{r}{2cm}\rule{1cm}{1cm}\end{wrapfigure} Text around.`,
      r`\begin{multicols}{2} One two three four five six seven. \end{multicols}`, r`\begin{compactitem}\item a\item b\end{compactitem} \begin{inparaenum}\item x \item y\end{inparaenum}`,
      r`\begin{appendices}\section{App} A.\end{appendices}`] },
  { tier: 2, name: 'text (ulem, verbatim, csquotes, xparse, etoolbox, makecell, colortbl, adjustbox, cite)', preamble: r`\documentclass{article}
\usepackage[normalem]{ulem}
\usepackage{verbatim}
\usepackage{csquotes}
\usepackage{xparse}
\usepackage{etoolbox}
\usepackage{makecell}
\usepackage[table]{xcolor}
\usepackage{colortbl}
\usepackage{adjustbox}
\usepackage{cite}
\NewDocumentCommand{\foo}{m}{[#1]}`,
    blocks: [r`\uline{u} \sout{s} \uwave{w} \enquote{quoted} \foo{x}`, r`\begin{verbatim}
verbatim text
\end{verbatim}`, r`\begin{tabular}{|c|}\rowcolor{gray!20}\makecell{a\\b}\\ \hline\end{tabular} \adjustbox{max width=2cm}{wide wide wide wide}`, r`\cite{a,b}`] },
  { tier: 2, name: 'pgfplots, tikz-cd', preamble: r`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.17}
\usepackage{tikz-cd}`,
    blocks: [r`\begin{tikzpicture}\begin{axis}[width=5cm]\addplot {x^2};\end{axis}\end{tikzpicture}`, r`\begin{tikzcd} A \arrow[r,"f"] \arrow[d] & B \arrow[d] \\ C \arrow[r] & D \end{tikzcd}`] },
  { tier: 2, name: 'natbib', preamble: r`\documentclass{article}
\usepackage[numbers]{natbib}
\bibliographystyle{plainnat}`,
    blocks: [r`\citet{a} \citep{b}`] },
  ...['alphabetic', 'numeric'].map((style): TierDoc => ({ tier: 2, name: `biblatex ${style}`, preamble: r`\documentclass{article}
\usepackage[style=${style}]{biblatex}`, blocks: [r`\cite{key}`, r`\printbibliography`] })),
];

/** Latin Modern in T1 (\usepackage{lmodern}+[T1]{fontenc}, and lipics-v2021): every design size's
 *  TFM (a few KB each: a size a recorded document did not use must still typeset, not stop
 *  with "ec-lmri7 not loadable"), and the outlines of the sizes footnotes, scripts and
 *  captions reach (the rest of the pfbs are recorded by the documents that use them). */
const LM_T1_TFM = ([['r', [5, 6, 7, 8, 9, 10, 12, 17]], ['ri', [7, 8, 9, 10, 12]], ['bx', [5, 6, 7, 8, 9, 10, 12]], ['bxi', [10]], ['ss', [8, 9, 10, 12, 17]],
  ['ssbx', [10]], ['sso', [8, 9, 10, 12, 17]], ['tt', [8, 9, 10, 12]], ['tti', [10]], ['csc', [10]], ['ro', [8, 9, 10, 12]], ['b', [10]]] as [string, number[]][])
  .flatMap(([f, sizes]) => sizes.map((n) => `ec-lm${f}${n}.tfm`));
const LM_PFB = ['lmri7', 'lmri8', 'lmss8', 'lmss9', 'lmss17', 'lmtt8', 'lmbx7', 'lmbx8', 'lmssbx10', 'lmcsc10'].map((f) => `${f}.pfb`);
/** Files a document cannot open but a user's workflow needs (bibtex styles, for export and bibtex runs). */
export const TIER_FILES: Record<1 | 2, string[]> = {
  // LaTeX's Unicode tables of the 8-bit encodings: rtx-tfm-unicode.sty reads them in every T1/OT1 document
  1: ['size10.clo', 'size11.clo', 'size12.clo', 'bk10.clo', 'bk11.clo', 'bk12.clo', 'plain.bst', 'plainurl.bst', 'alpha.bst', 'abbrv.bst', 't1enc.dfu', 'ot1enc.dfu', 'omsenc.dfu', 'ts1enc.dfu', 'ly1enc.dfu', 't2aenc.dfu', 'lgrenc.dfu', ...LM_T1_TFM, ...LM_PFB],
  2: ['plainnat.bst', 'abbrvnat.bst', 'unsrtnat.bst', 'alphaurl.bst'],
};
