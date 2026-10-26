---
title: From source to screen
linkTitle: From source to screen
weight: 10
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[How it works]{From source to screen}
\bigskip
\noindent A ReflowEd document is a list of blocks: a paragraph, a heading, a
theorem, a figure. Each block is typeset on its own by a \TeX{} engine that
runs in your browser, and drawn by the Reflow\TeX{} viewer, which breaks
its lines for the width of the window. This page follows a block from its
source to the screen.

\section*{A document of blocks}
When a \texttt{.tex} file is imported, its body is cut into blocks. A blank
line ends a paragraph. A heading, a theorem-like environment, a proof, a
figure or a table starts a block of its own, while displays and lists inside
a paragraph stay in it. Every character of the file lands in a block, in the
space between two blocks or after the last one, so an export writes the file
back as it was, apart from your edits. The importer follows \verb|\input|
and \verb|\include|, and each block keeps the name of the file it came from.

\section*{The engine}
The engine is XeTeX, as built by the Tectonic project, compiled to run in
the browser. It runs in a worker, apart from the page, so typing does not
wait for it. It reads the preamble once and stops just after
\verb|\begin{document}|; a copy of its memory at that point is kept, and
every block starts from that copy, so a block costs only its own
typesetting. Errors and warnings are reported on the block's own lines.

The engine is patched so that it makes no pages. Where \TeX{} would break a
paragraph into lines, the engine records the paragraph's list of boxes, glue
and penalties instead. The worker encodes these lists in the format the
Reflow\TeX{} viewer reads and sends them to the page, with the fonts the
block uses; a font is sent again only when a block needs a glyph it did not
have yet. To export a PDF, the engine compiles the whole document in one
run.

\section*{The cache}
Each result is kept under a key made from the engine's build, the preamble,
and the block's source with its context (\href{../numbering/}{the next
page} explains the context). A block is typeset again only when one of
these changes, so reopening a document or undoing an edit takes the result
from the cache. Results are kept in memory and in the browser's storage.
The blocks on screen are typeset first, the rest after them in document
order. The documents that come with the editor bring their results with
them, so opening one typesets nothing.
{{< /latex >}}

{{< pipeline-diagram >}}

{{< latex preamble="site" >}}
\section*{Drawing}
The page draws each block with the viewer of
\href{https://radek-p.github.io/reflowtex/}{Reflow\TeX}, which also sets
the pages of this site. It breaks each paragraph into lines for the width it
is given, with the Knuth--Plass algorithm and \TeX's hyphenation, and draws
the lines as SVG. When a pane becomes narrower or wider, the lines are
broken again and nothing is typeset. Reflow\TeX's
\href{https://radek-p.github.io/reflowtex/docs/project/accuracy/}{Accuracy}
page says how closely the browser follows \TeX.
{{< /latex >}}
