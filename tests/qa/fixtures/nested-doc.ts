// A document with long environments for the nesting suites (test-nested-seed): multi-paragraph proofs, a theorem
// and an abstract of several paragraphs, which the importer nests (a container block with one block per
// paragraph). Made-up mathematics in plain words (categories).
//
//   NESTED_TEX (a whole .tex), N_CONTAINERS, N_PROOFS
export const N_CONTAINERS = 5, N_PROOFS = 3;
export const NESTED_TEX = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\title{Long Environments (a made-up test document)}
\author{A. Author}
\date{}
\begin{document}
\maketitle

\begin{abstract}
This document has long environments: proofs of several paragraphs, and a theorem whose statement is two paragraphs long. Each paragraph is a block of its own inside its environment.

The mathematics is about categories and is meant to be read, but nothing in it is new.
\end{abstract}

\section{Categories}\label{sec:cat}

A category has objects and arrows; every arrow has a source and a target, arrows compose when the target of one is the source of the next, composition is associative, and every object has an identity arrow.

\begin{lemma}\label{lem:id}
In a category, the identity arrow of each object is unique.
\end{lemma}

\begin{proof}
Let $e$ and $e'$ be two identity arrows on the same object $a$. Composing them in one order gives $e$, because $e'$ is an identity; composing them in the other order gives $e'$, because $e$ is one.

Both composites are the same arrow, $e \circ e'$, so $e = e'$. Nothing beyond the two identity laws was used.
\end{proof}

\begin{theorem}\label{thm:iso}
Let $f\colon a \to b$ be an arrow with an inverse $g$, so that $g \circ f$ and $f \circ g$ are identities. Then the inverse is unique.

Moreover, $f$ composed with any arrow out of $b$ is a bijection between the arrows out of $b$ and the arrows out of $a$ to the same target.
\end{theorem}

\begin{proof}
Suppose $g$ and $h$ are both inverses of $f$. Then $g = g \circ \mathrm{id}_b = g \circ (f \circ h) = (g \circ f) \circ h = \mathrm{id}_a \circ h = h$, using associativity once.

For the second part, composing with $f$ sends an arrow $k$ out of $b$ to $k \circ f$, and composing with $g$ sends an arrow $m$ out of $a$ to $m \circ g$. The two maps are inverse to each other, since $k \circ f \circ g = k$ and $m \circ g \circ f = m$.

Hence composing with $f$ is a bijection, as claimed in Theorem~\ref{thm:iso}.
\end{proof}

\section{Functors}\label{sec:fun}

A functor between two categories sends objects to objects and arrows to arrows, keeping sources, targets, identities and composites.

\begin{proof}[Proof that a functor keeps isomorphisms]
Let $F$ be a functor and $f$ an isomorphism with inverse $g$. Then $F g \circ F f = F(g \circ f) = F(\mathrm{id}) = \mathrm{id}$, and in the same way $F f \circ F g$ is an identity.

So $F f$ has the inverse $F g$. This is the whole proof; the same argument shows that a functor keeps split monomorphisms and split epimorphisms.

A functor need not reflect isomorphisms: an arrow that is not invertible may still be sent to one that is, for instance by the functor to the category with one object and one arrow.
\end{proof}

\end{document}
`;
