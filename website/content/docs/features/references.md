---
title: References and citations
linkTitle: References and citations
weight: 30
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[Features]{References and citations}
\bigskip
\noindent Numbers of sections, theorems, equations and figures are worked
out for the whole document as you edit, without compiling it as a whole, so
every block shows the right number and every reference the right target.

\section*{The reference card}
Hover over a \verb|\ref|, \verb|\eqref|, \verb|\cref| or \verb|\autoref|, or
reach it with the keyboard, and a card shows what it points to: the target
block, typeset, with its number. \textsf{Go to} takes you there, and
\textsf{Back} returns you to where you were. A reference to a label that does
not exist shows as ``??'', and its card says so.
{{< /latex >}}

{{< shot "shot-reference-card" "A cross-reference in the text with a card above it showing the theorem it points to." "The card of a cross-reference." >}}

{{< latex preamble="site" >}}
\section*{Citations and the References panel}
Hovering over a \verb|\cite| shows its entry: the authors, the title, where
and when it appeared, and a link when it has a DOI or a web address. The References panel lists the
document's entries, with a search field and filters for the cited, the not
cited and the citations with no entry. \textsf{Cite} puts a \verb|\cite| at
the caret, and you can also drag an entry into the text.

New entries can be pasted as Bib\TeX, or found by a DOI or an arXiv
identifier; a \texttt{.bib} file can be dropped on the panel, and the panel
can export the entries as \texttt{references.bib}. A bibliography can come
from a \texttt{.bib} file, from a \texttt{.bbl} file made by Bib\TeX{} or
Biber, or from a \texttt{thebibliography} block in the document.
{{< /latex >}}
