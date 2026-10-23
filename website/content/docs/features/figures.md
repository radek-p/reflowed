---
title: Figures
linkTitle: Figures
weight: 40
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[Features]{Figures}
\bigskip
\noindent A figure is a block like any other: its picture, its caption and
its label, numbered with the rest of the document.

\section*{TikZ}
A TikZ picture is typeset by the same \TeX{} engine as the text, in your
browser, so its labels are in the document's fonts and its mathematics is
set as in the text around it. Edit its code as you edit a paragraph and the
picture is drawn again.

\section*{The figure editor}
For a diagram you would rather draw than describe, choose \textsf{Drawn
figure} when you add a block. The figure editor has rectangles, ellipses,
lines, arrows and polylines, and labels and text boxes in \LaTeX, typeset by
the engine. It has layers, colours for strokes, fills and text, and
alignment. A drawn figure is kept in the document as an SVG file, opened
again with \textsf{Edit figure}, and follows the theme when you read in a
dark one. When you export the document, each drawn figure is also written
as TikZ code, which the exported source inputs in its place.
{{< /latex >}}

{{< shot "shot-figure-editor" "The figure editor open on a drawing, with its tools along the side." "The figure editor." >}}
