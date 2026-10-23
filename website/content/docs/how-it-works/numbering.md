---
title: Numbers across blocks
linkTitle: Numbers across blocks
weight: 20
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[How it works]{Numbers across blocks}
\bigskip
\noindent In \LaTeX, the number of a section or an equation comes from
counters that run through the whole document, and a \verb|\ref| needs a
second run. ReflowEd typesets each block on its own, so it works the
numbers out separately, from the order of the blocks, and fills them in
without typesetting anything.

\section*{The context of a block}
Some of what earlier blocks do shows in later ones. Before a block is
typeset, ReflowEd puts a short context in front of its source: the
definitions made in earlier blocks (a \verb|\newcommand| between two
paragraphs, say), whether \verb|\appendix| came before it, and whether it
follows a heading, in which case its first paragraph is not indented. The
block with the bibliography also gets the keys that are cited. Counter
values are not part of the context. As the context is part of the block's
cache key, moving a block typesets it again only when its context changes.

\section*{Filling in the numbers}
The \TeX{} side marks where each number and each reference goes in a
typeset block. After every change, ReflowEd counts the sections, theorems,
equations and figures over the blocks in order, and the viewer puts the
text in the marked places. The format is read from the number as \TeX{}
printed it, so letters after \verb|\appendix| apply from there on, and a
\verb|\setcounter| takes effect at the start of its block. A reference shows
its target's number; \verb|\cref| and \verb|\autoref| add the name, as in
``Lemma 3.2''. When a block moves, the numbers after it change straight
away.

\href{../../features/references/}{References and citations} describes what
this looks like in the editor.
{{< /latex >}}
