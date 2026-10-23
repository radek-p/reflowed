// Templates for "New document": small .tex files read through the importer,
// so a template's blocks are cut exactly as an imported paper's are.

import type { DocInit } from '../store/types.ts';
import { importFiles } from './import.ts';

export interface Template { id: string; label: string; hint: string; tex: string }

const PRE = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{hyperref}
\usepackage[capitalise]{cleveref}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem*{remark}{Remark}
`;

export const TEMPLATES: Template[] = [
  { id: 'blank', label: 'Blank', hint: 'An empty article', tex: String.raw`${PRE}
\title{Untitled}
\author{}
\date{}

\begin{document}

\maketitle

\end{document}
` },
  { id: 'article', label: 'Article', hint: 'Title, abstract, sections, a theorem and a proof', tex: String.raw`${PRE}
\title{A Short Article}
\author{Ada Author \and Bo Coauthor}
\date{}

\begin{document}

\maketitle

\begin{abstract}
One paragraph that says what the paper does.
\end{abstract}

\section{Introduction}\label{sec:intro}

State the problem and the result. \Cref{thm:main} is the main result.

\section{Results}

\begin{definition}
A number $n \in \mathbb{N}$ is \emph{even} if $n = 2k$ for some $k \in \mathbb{N}$.
\end{definition}

\begin{theorem}\label{thm:main}
The sum of two even numbers is even.
\end{theorem}

\begin{proof}
If $a = 2k$ and $b = 2l$ then $a + b = 2(k + l)$.
\end{proof}

\end{document}
` },
  { id: 'notes', label: 'Lecture notes', hint: 'A lesson: a section, a display, a theorem, a list', tex: String.raw`${PRE}
\title{Geometric series}
\author{}
\date{}

\begin{document}

\section{Geometric series}

A \emph{geometric series} is a sum in which every term is a fixed multiple of the one before: $a + ar + ar^2 + \dots$, with first term $a$ and ratio $r$.

The partial sums have a closed form. Multiply $S_n = \sum_{k=0}^{n-1} ar^k$ by $r$ and subtract; all but two terms cancel, and for $r \neq 1$
\begin{equation}
  S_n = a\,\frac{1 - r^n}{1 - r}.
\end{equation}

\begin{theorem}
Let $|r| < 1$. Then $\sum_{k=0}^{\infty} ar^k = \dfrac{a}{1-r}$.
\end{theorem}

\begin{proof}
Since $|r| < 1$, $r^n \to 0$, so $S_n \to a/(1-r)$ by the closed form above.
\end{proof}

A few things to remember:
\begin{itemize}
  \item the series diverges when $|r| \geq 1$ and $a \neq 0$;
  \item for $r = \tfrac12$ and $a = 1$ the sum is $2$.
\end{itemize}

\end{document}
` },
  { id: 'problems', label: 'Problem sheet', hint: 'Numbered exercises and their solutions', tex: String.raw`${PRE}
\title{Problem Sheet 1}
\author{}
\date{}

\begin{document}

\maketitle

\section*{Exercises}

\begin{enumerate}
  \item Show that $\sqrt{2}$ is irrational.
  \item Prove by induction that $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$ for every $n \geq 1$.
  \item Find all real $x$ with $x^2 - 5x + 6 = 0$.
\end{enumerate}

\section*{Solutions}

\begin{proof}[Solution to 3]
The polynomial factors as $(x - 2)(x - 3)$, so $x = 2$ or $x = 3$.
\end{proof}

\end{document}
` },
  { id: 'lipics', label: 'LIPIcs paper', hint: 'A conference paper in the LIPIcs class', tex: String.raw`\documentclass[a4paper,UKenglish,cleveref,autoref,thm-restate]{lipics-v2021}

\title{A Conference Paper}
\titlerunning{A Conference Paper}
\author{Ada Author}{University of Somewhere, Country}{ada@example.org}{}{}
\authorrunning{A. Author}
\Copyright{Ada Author}
\ccsdesc[500]{Theory of computation}
\keywords{one, two, three}

\begin{document}

\maketitle

\begin{abstract}
One paragraph that says what the paper does.
\end{abstract}

\section{Introduction}\label{sec:intro}

State the problem and the result: \cref{thm:main}.

\begin{theorem}\label{thm:main}
The sum of two even numbers is even.
\end{theorem}

\begin{proof}
If $a = 2k$ and $b = 2l$ then $a + b = 2(k + l)$.
\end{proof}

\end{document}
` },
];

export async function templateInit(id: string): Promise<DocInit> {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  const { init } = await importFiles([{ path: 'main.tex', data: new TextEncoder().encode(t.tex) }], { name: 'main.tex' });
  delete init.snapshotLabel;
  init.meta = { ...init.meta, importedFrom: undefined, tags: [] };
  if (t.id === 'blank') init.title = '';
  return init;
}
