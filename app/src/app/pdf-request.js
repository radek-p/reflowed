// What the PDF export compiles: the document as one file, nested containers joined back into their
// environments (nesting flattenForExport). The app's Export PDF and the tests build it the same way.
//   pdfRequest(doc, flatten) -> { preamble, blocks: [{ id, source, kind }], title, files }
// files: the names of the document's files (its assets). All of them go to the engine, whatever the sources name: a
// figure placed through a macro of the document's own (\shot{figures/a}) is named by no \includegraphics.
export const pdfRequest = (doc, flatten) => ({
  preamble: doc.preamble.source,
  blocks: flatten(doc.blocks).map((b) => ({ id: b.id, source: b.source, kind: b.kind })),
  title: doc.title,
  files: (doc.assets ?? []).map((a) => a.name),
});
