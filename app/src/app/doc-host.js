// @ts-check
// A DOCUMENT'S HOST for page features: what notes and refnav may read of a document and do to
// it, from its DocSession (read) and its commands (write) — never the test surface (editorAPI, an editor's `api`).
// The workspace (app/workspace.js) makes one for the editor of a pane, of a node in a pane, or of the current document.
//
//   const h = docHost(editor, pane)     editor: createDocEditor's result; pane: the pane id acted in (null: its focused)
//   h.doc() · h.blocks() · h.block(id) · h.preamble() · h.refsState() · h.numbering() · h.nav() · h.backendId()
//   h.readOnly()                        the document cannot be edited here (app/read-only.js)
//   h.edit(id, caret?)                  the block's editor opened in that pane (command block.edit)
//   h.setSource(id, source)             one undo step (command block.setSource)
//   h.recompileAll()                    every block typeset again (command doc.recompileAll)
import { isReadOnly } from './read-only.js';

/** @param {any} editor @param {string | null} [pane] */
export function docHost(editor, pane = null) {
  const doc = () => editor?.doc ?? null;
  return {
    editor,
    pane,
    doc,
    blocks: () => doc()?.blocks ?? [],
    /** @param {string} id */
    block: (id) => doc()?.blocks?.find((/** @type {any} */ b) => b.id === id) ?? null,
    preamble: () => doc()?.preamble?.source ?? '',
    refsState: () => editor.session.refs.refsState(),
    numbering: () => editor.session.refs.numbering?.() ?? null,
    nav: () => editor.nav ?? null,
    backendId: () => editor.backendId?.() ?? null,
    readOnly: () => isReadOnly(doc()),
    /** @param {string} id @param {number | null} [caret] */
    edit: (id, caret = null) => editor.run('block.edit', { id, caret, pane }),
    /** @param {string} id @param {string} source */
    setSource: (id, source) => editor.run('block.setSource', { id, source }),
    recompileAll: () => editor.run('doc.recompileAll', {}),
  };
}
