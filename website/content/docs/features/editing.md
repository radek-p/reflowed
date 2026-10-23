---
title: Editing a block
linkTitle: Editing a block
weight: 10
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[Features]{Editing a block}
\bigskip
\noindent A document in ReflowEd is a list of blocks: a paragraph, a
heading, a theorem, a proof, a figure. You edit one block at a time, and
you see it typeset while you write.

\section*{Click to edit}
Click on a paragraph and its \LaTeX{} source opens below it, with the caret
at the place you clicked. As you type, the block is typeset again and the
result above the source follows. If the source stops compiling, the last
good result stays in place, dimmed, until you fix it; the note under it can
show what changed or put the source back as it was. Escape closes the
source and leaves the block selected.
{{< /latex >}}

{{< shot "shot-code-popover" "A paragraph of the document with its LaTeX source open below it." "The source of a block, open below its typeset text." >}}

{{< latex preamble="site" >}}
\section*{Adding, splitting and moving blocks}
Type a slash in an empty block, or use the \textsf{+} beside a block, to
add a new one: text, a section heading, a list, an equation, a figure, a
table, an abstract, a bibliography and more. The list filters as you type.

Command-Enter (Ctrl+Enter on Windows and Linux) splits a block at the
caret; Backspace at the start of a block merges it with the block above.
Each block has a handle in the margin: drag it to move the block, also into
another pane, or click it for the block's menu, with Duplicate, Move up,
Move down, Merge with the block above and Delete.

\section*{Undo}
There is one history per document, for typing and for changes to the
blocks alike, so Undo puts back a deleted or moved block as well as a word.
Press \textsf{?} for the list of keyboard shortcuts.
{{< /latex >}}
