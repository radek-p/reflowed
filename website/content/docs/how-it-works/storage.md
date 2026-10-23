---
title: Storage and the release
linkTitle: Storage and the release
weight: 30
latexTitle: true
---

{{< latex preamble="site" >}}
\pagetitle[How it works]{Storage and the release}
\bigskip
\noindent ReflowEd has no server of its own. The editor is a set of static
files, your documents stay in your browser, and the \TeX{} packages are
static files too.

\section*{In the browser}
Documents are kept in IndexedDB, the browser's database, on your device,
and the editor asks the browser to keep that database. Each block is a
record of its own. Blocks are ordered by fractional keys: a block put
between two others gets a key between theirs, so inserting or moving a
block changes that block's record alone. Beside the blocks are the
document's files and images, a log of its changes, its versions and the
cache of typeset results. Where IndexedDB cannot be opened, as in some
private windows, the documents are kept in memory instead.

\section*{The release}
A release is a directory of static files that any web server can serve,
from any directory: its paths are relative, and nothing depends on the
types the server gives its files. Its \texttt{index.html} holds a small
loader. Every other file is named by a hash of its contents, so the browser
can keep it for good and a new release never meets an old copy. The loader
first fetches, in one request, what the window needs; the engine follows
while the editor starts, in three files: the engine itself, the \LaTeX{}
format and the \TeX{} files the editor carries. Documents whose results are
in the cache are shown before the engine is ready.

The release carries the \TeX{} files that common documents need. Other
packages come from a \TeX{} Live 2022 tree beside it, in
\texttt{texlive/2022/}, laid out as \TeX{} Live installs it, with its file
index, \texttt{ls-R}. When a document needs a file the editor lacks, the
worker finds it in the index and fetches it. Fetched files are kept in the
browser's storage, so a document needs the tree only the first time it is
opened.

The same build also gives a single HTML file, which opens from disk with no
network. It carries the same \TeX{} files, but has no tree beside it.

\section*{The window}
The window is a workbench of tabs and panes, as in a code editor. Its layout
is a tree: groups side by side or one above the other, each group with a
row of tabs, each tab a view with its own state. The layout is plain data,
saved as a preference and restored when you reload. A document can be open
in two panes at once, beside itself or beside another document, and all the
panes of one document share one editor and one undo history. The side
panels, left and right, hold the Outline, Problems, TODOs, References and
Files. The workbench is a module of its own that knows nothing about
documents: the editor registers its views with it.
{{< /latex >}}
