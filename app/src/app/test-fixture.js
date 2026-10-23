// The tests' fixture document (?seed=sample, #/doc/sample): a small made-up
// tests (tests/test-w3.ts, test-w6.ts), which check its labels, theorem
// kinds, citations and TODO macros. It is not an example and is never seeded
// by default: the built-in example is an optional document (seed/example.json).
import { guessKind } from '../doc/kinds.js';

/** Title, abstract, sections with labels and references, theorem kinds, a
 *  TikZ figure, a table, todos, an appendix and a bibliography. Compiles on
 *  the v1 worker (no cleveref, biblatex or todonotes there: \todo is a no-op
 *  macro). */
export function testFixtureDocument() {
  const preamble = String.raw`\usepackage{amsmath,amssymb,amsthm}
\usepackage{reflowtex}
\usepackage{tikz}
\usepackage{booktabs}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{claim}[theorem]{Claim}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem*{remark}{Remark}

% todonotes is not in the v1 engine's files: notes are data for the TODO panel
\newcommand{\todo}[2][]{}
\newcommand{\editor}[1]{\todo[color=blue!40]{Editor: #1}}
\newcommand{\referee}[1]{\todo[color=green!40]{Referee: #1}}

\newcommand{\N}{\mathbb{N}}
\newcommand{\Hom}{\operatorname{Hom}}

\title{Editor Test Fixture (not a paper)}
\author{Test Author}
\date{}`;
  const blocks = [
    String.raw`\maketitle`,
    String.raw`\begin{abstract}
A \emph{natural transformation} compares two functors between the same categories, one object at a time. We show that for a locally small category every element of a presheaf at an object is exactly one natural transformation into the presheaf, and that this correspondence is itself natural.
\end{abstract}`,
    String.raw`\section{Introduction}\label{sec:intro}`,
    String.raw`Functors are the structure-preserving maps between categories. They send objects to objects and arrows to arrows, and they underlie adjunctions~\cite{Obj23} and representable presheaves~\cite{MO25}. Our main result, Theorem~\ref{thm:main}, says that a category sits inside its presheaves with nothing lost on the way.\editor{say why size matters}`,
    String.raw`The proof goes through the category of elements, which sits between a presheaf and the category it is defined on (Section~\ref{sec:prelims}). We also list a few examples; see Table~\ref{tab:examples}.`,
    String.raw`\section{Preliminaries}\label{sec:prelims}`,
    String.raw`All categories are locally small. For a category $\mathcal{C}$ and objects $a, b$ we write $\Hom_{\mathcal{C}}(a,b)$ for the set of arrows from $a$ to $b$, and $\mathrm{id}_a$ for the identity on $a$.`,
    String.raw`\begin{definition}[Natural transformation]\label{def:nat}
Let $F, G\colon \mathcal{C} \to \mathcal{D}$ be functors. A \emph{natural transformation} $\alpha\colon F \Rightarrow G$ gives for every object $c$ of $\mathcal{C}$ an arrow $\alpha_c\colon Fc \to Gc$ of $\mathcal{D}$, such that every arrow of $\mathcal{C}$ makes the square of Figure~\ref{fig:square} commute.
\end{definition}`,
    String.raw`A family of arrows $\alpha_c$ is natural when for every arrow $f\colon c \to c'$
\begin{equation}\label{eq:nat}
  G f \circ \alpha_c = \alpha_{c'} \circ F f.
\end{equation}`,
    String.raw`\begin{figure}[t]
  \centering
  \begin{tikzpicture}[scale=0.9]
    \node (a) at (0,1.6) {$Fc$}; \node (b) at (2.6,1.6) {$Fc'$};
    \node (c) at (0,0) {$Gc$}; \node (d) at (2.6,0) {$Gc'$};
    \draw[->] (a) -- node[above] {$Ff$} (b);
    \draw[->] (a) -- node[left] {$\alpha_c$} (c);
    \draw[->] (b) -- node[right] {$\alpha_{c'}$} (d);
    \draw[->] (c) -- node[below] {$Gf$} (d);
  \end{tikzpicture}
  \caption{The naturality square: the two paths from $Fc$ to $Gc'$ are equal.}
  \label{fig:square}
\end{figure}`,
    String.raw`\section{Functors and natural transformations}\label{sec:main}`,
    String.raw`\begin{lemma}\label{lem:yoneda}
Let $\mathcal{C}$ be a locally small category, $P\colon \mathcal{C}^{\mathrm{op}} \to \mathbf{Set}$ a functor and $a$ an object of $\mathcal{C}$. Sending a natural transformation $\alpha$ to $\alpha_a(\mathrm{id}_a)$ is a bijection
\[ \mathrm{Nat}(\Hom_{\mathcal{C}}(-,a), P) \cong P(a). \]
\end{lemma}`,
    String.raw`\begin{proof}
Given $x \in P(a)$, put $\alpha_b(f) = P(f)(x)$ for every arrow $f\colon b \to a$. Naturality of $\alpha$ is the functoriality of $P$, and $\alpha_a(\mathrm{id}_a) = x$. Conversely, a natural $\alpha$ is fixed by $\alpha_a(\mathrm{id}_a)$, since by \eqref{eq:nat} each $\alpha_b(f)$ is $P(f)$ applied to it.\referee{check the naturality square}
\end{proof}`,
    String.raw`\begin{theorem}[Main]\label{thm:main}
For a locally small category $\mathcal{C}$, the Yoneda embedding of $\mathcal{C}$ into its category of presheaves is full and faithful.
\end{theorem}`,
    String.raw`\begin{proof}
Faithfulness is the easy half~\cite{Obj23}. For fullness, apply Lemma~\ref{lem:yoneda} to a representable presheaf, as in~\cite{Arr09}, and read the bijection through Figure~\ref{fig:square}.
\end{proof}`,
    String.raw`\begin{table}[t]
  \centering
  \begin{tabular}{lcc}
    \toprule
    category & objects & arrows \\
    \midrule
    sets & sets & functions \\
    groups & groups & homomorphisms \\
    spaces & spaces & continuous maps \\
    \bottomrule
  \end{tabular}
  \caption{Some categories, with their objects and their arrows.}
  \label{tab:examples}
\end{table}`,
    String.raw`\begin{remark}
The bijection in Lemma~\ref{lem:yoneda} is not an equality: already for a group seen as a category with one object, the two sides are different sets of the same size.
\end{remark}`,
    String.raw`\appendix`,
    String.raw`\section{Omitted proofs}\label{app:proofs}`,
    String.raw`\begin{claim}\label{cl:iso}
In a locally small category $\mathcal{C}$, an arrow $f\colon a \to b$ is an isomorphism if and only if composing with $f$ is a bijection from $\Hom_{\mathcal{C}}(c,a)$ to $\Hom_{\mathcal{C}}(c,b)$ for every object $c$.
\end{claim}`,
    String.raw`\begin{thebibliography}{Obj23}
\bibitem[MO25]{MO25} A test reference (not a real publication). 2025.
\bibitem[Obj23]{Obj23} A test reference (not a real publication). 2023.
\bibitem[Arr09]{Arr09} A test reference (not a real publication). 2009.
\end{thebibliography}`,
  ];
  return { title: 'Editor test fixture (not a paper)', preamble, bib: { kind: 'none', source: '' },
    meta: { authors: ['Test Author'], tags: ['sample'] },
    blocks: blocks.map((source) => ({ source, kind: guessKind(source), file: 'main.tex' })) };
}
