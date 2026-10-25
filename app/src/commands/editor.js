// @ts-check
// The document editor's commands: every intent its menus, keys and editorAPI share, as
// data (commands/registry.js). Each runs against the context the editor gives (app/app.js commandContext):
//
//   c.S                    the DocSession (doc/session.js): c.S.doc, c.S.ops, c.S.history, c.S.model
//   c.selected()           the keyboard-selected block's id | null; c.select(id, o)
//   c.focusedPane()        the focused pane's id
//   c.enterEdit(id, event, caret, line, range, pane)
//   c.page                 the page's actions: find(), toggleFocus(on?), toggleSidebar(), shortcuts(), settings(open, line),
//                          versions(), resetSeed(), importTex(), exportTex(), exportZip(o), exportPdf(), toggleSplit(),
//                          focusSection(id | null, pane?) (section focus: docview/focus.js), gotoDefinition(k), can: { versions, resetSeed, importTex, exportZip, exportPdf, plainTitle }
//
// The rows of the shortcuts dialog are the commands with `keys` and `help`, in the order defined here (the order of
// the table app.js kept by hand before). A key with a modifier is written as the workbench writes its own
// (workbench/src/keys.ts shortcutLabel: ⇧⌘Z on macOS, Ctrl+Shift+Z elsewhere).
import { shortcutLabel } from '../../../workbench/src/keys.ts';

/** the focused block editor's selection wrapped in `open` … `close` (one typing step: the document's history);
 *  false when no block editor has the focus (the key goes on) */
function wrapSelection(view, open, close) {
  if (!view?.hasFocus) return false;
  const r = view.state.selection.main, text = view.state.sliceDoc(r.from, r.to);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: `${open}${text}${close}` }, selection: { anchor: r.from + open.length, head: r.from + open.length + text.length }, userEvent: 'input.type' });
  return true;
}
/** @param {import('../../../workbench/src/keys.ts').Platform} [platform] whose keys the labels name (default: the page's) */
export function editorCommands(platform) {
  /** @param {string} k */
  const key = (k) => shortcutLabel(k, platform);
  const at = (c, id) => c.S.model.indexOf(id);
  const last = (c) => c.S.doc.blocks.length - 1;
  return [
    // ── the rows of the shortcuts dialog, in its order ──
    { id: 'select.down', label: 'Select the block below', keys: '↑ ↓ or j k', help: 'Select the block above / below',
      run: (c, { from }) => c.selectStep(from, 1) },
    { id: 'block.edit', label: 'Edit source', key: 'edit', shortcut: key('enter'), keys: key('enter'), help: 'Edit the selected block',
      run: (c, { id, caret = null, pane = null }) => c.enterEdit(id, null, caret, null, null, pane) },
    { id: 'editor.leave', label: 'Leave the editor', keys: 'Esc', help: 'Leave the editor (the block stays selected)',
      run: (c, { session, id }) => { session.leave(); c.select(id, { scroll: false }); return true; } },   // the block was in view: nothing scrolls on a close
    { id: 'block.moveUp', label: 'Move up', key: 'up', shortcut: key('alt+arrowup'), keys: `${key('alt+arrowup')} ${key('alt+arrowdown')}`, help: 'Move the block', edits: true,
      // no `when`: a key at the edge still asks (nesting may move a paragraph out of its container); the menu disables it
      run: (c, { id }) => c.S.ops.moveBlock(id, at(c, id) - 1) },
    { id: 'block.split', label: 'Split the block at the caret', keys: key('mod+enter'), help: 'Split the block at the caret', edits: true,
      run: (c, { id, offset, edit = false, pane = null }) => c.S.ops.splitBlock(id, offset, { edit, pane }) },
    { id: 'block.merge', label: 'Merge with the block above', key: 'merge', keys: '⌫ at the start', help: 'Merge with the block above', edits: true,
      when: (c, { id }) => at(c, id) > 0, run: (c, { id, edit = false, pane = null }) => c.S.ops.mergeBlock(id, { edit, pane }) },
    { id: 'block.insertBelow', label: 'New block below', keys: key('shift+enter'), help: 'New block below', edits: true,
      run: (c, { id, kind = 'paragraph', source = '', caret = null, pane = null, edit = true }) => {
        const k = at(c, id) + 1;
        const nb = c.S.ops.insertBlock(k, kind, source, c.parentAt(k));
        if (edit) c.enterEdit(nb.id, null, caret, null, null, pane);
        return nb.id;
      } },
    { id: 'block.kinds', label: 'Block types', keys: '/', help: 'Block types (in an empty block, or with a block selected)', edits: true,
      run: (c, { id, pane = null }) => c.slashBelow(id, pane) },
    { id: 'block.duplicate', label: 'Duplicate', key: 'duplicate', shortcut: key('mod+d'), keys: key('mod+d'), help: 'Duplicate', edits: true,
      run: (c, { id }) => c.S.ops.duplicateBlock(id) },
    { id: 'block.delete', label: 'Delete', key: 'delete', shortcut: '⌫', keys: '⌫ / Del', help: 'Delete the selected block', edits: true,
      run: (c, { id, quiet = false }) => c.S.ops.removeBlock(id, { quiet }) },
    { id: 'doc.undo', label: 'Undo', keys: `${key('mod+z')}  ${key('mod+shift+z')}`, help: 'Undo / redo block changes', edits: true,
      run: (c) => !!c.S.history.undo() },
    { id: 'find.open', label: 'Find and replace', key: 'find', shortcut: key('mod+f'), keys: key('mod+f'), help: 'Find and replace',
      run: (c) => c.page.find() },
    { id: 'view.focusMode', label: 'Focus mode', key: 'focus', shortcut: key('mod+shift+f'), keys: key('mod+shift+f'), help: 'Focus mode',
      run: (c, input) => c.page.toggleFocus(input?.on) },
    // (section focus) pane `pane` (the focused one) narrowed to heading `id`'s section; id null: the whole document
    { id: 'view.sectionFocus', label: 'Focus on a section', run: (c, input) => c.page.focusSection(input?.id ?? null, input?.pane) },
    { id: 'view.sidebar', label: 'Sidebar', keys: key('mod+\\'), help: 'Sidebar', run: (c) => c.page.toggleSidebar() },
    // Ctrl/⌘B in a block's source: \textbf{…} around the selection (elsewhere the key shows or hides the sidebar)
    { id: 'editor.bold', label: 'Bold', keys: key('mod+b'), help: 'Bold, in a block\'s source (elsewhere: the sidebar)', edits: true,
      run: (c) => wrapSelection(c.editing?.()?.editor?.view, '\\textbf{', '}') },
    { id: 'nav.definition', label: 'Go to the definition', keys: `F12 or ${key('mod')}-click`, help: 'Go to the label or bibliography entry',
      run: (c, { target }) => c.page.gotoDefinition(target) },
    // ── no row of their own ──
    { id: 'select.up', label: 'Select the block above', run: (c, { from }) => c.selectStep(from, -1) },
    { id: 'select.first', label: 'Select the first block', run: (c) => c.selectIndex(0) },
    { id: 'select.last', label: 'Select the last block', run: (c) => c.selectIndex(last(c)) },
    { id: 'block.moveDown', label: 'Move down', key: 'down', shortcut: key('alt+arrowdown'), edits: true,
      run: (c, { id }) => c.S.ops.moveBlock(id, at(c, id) + 1) },
    { id: 'doc.redo', label: 'Redo', edits: true, run: (c) => !!c.S.history.redo() },
    // what editorAPI's mutating calls do (tests: via 'test'), each one undo step but setPreamble's
    { id: 'block.insert', label: 'Insert a block', edits: true, run: (c, { index, kind = 'paragraph', source = '' }) => c.S.ops.insertBlock(index, kind, source).id },
    { id: 'block.move', label: 'Move a block', edits: true, run: (c, { id, to }) => c.S.ops.moveBlock(id, to) },
    // what the side panels do (a panel acts through commands)
    { id: 'block.moveSection', label: 'Move a section', edits: true, run: (c, { ids, to }) => c.S.ops.moveBlocks(ids, to) },
    { id: 'nav.scrollTo', label: 'Go to a block', run: (c, { id, pane = null, quiet = false }) => c.page.scrollTo(id, pane, { quiet }) },
    { id: 'nav.reveal', label: 'Show a place in a block', run: (c, { id, range = null, edit }) => c.page.reveal(id, range, edit === undefined ? undefined : { edit }) },
    { id: 'note.open', label: 'Open a note', run: (c, { todo }) => c.page.openNote(todo) },
    { id: 'block.setSource', label: 'Set a block\'s source', edits: true, run: (c, { id, source }) => c.S.ops.setSource(id, source) },
    { id: 'doc.recompileAll', label: 'Typeset every block again', run: (c) => c.page.recompileAll() },   // notes: a setting changed what blocks compile to
    { id: 'doc.setPreamble', label: 'Set the preamble', edits: true, run: (c, { source }) => c.page.setPreamble(source) },
    { id: 'block.append', label: 'Add a block', edits: true,
      run: (c, { pane = null }) => { const nb = c.S.ops.insertBlock(c.S.doc.blocks.length, 'paragraph', ''); c.enterEdit(nb.id, null, null, null, null, pane); return nb.id; } },
    { id: 'view.shortcuts', label: 'Keyboard shortcuts', key: 'keys', shortcut: '?', run: (c) => c.page.shortcuts() },
    { id: 'view.split', label: 'Split view', run: (c) => c.page.toggleSplit() },
    { id: 'doc.settings', label: 'Document settings', key: 'settings', run: (c, { line = null } = {}) => c.page.settings(true, line) },
    { id: 'doc.versions', label: 'Versions…', key: 'versions', when: (c) => c.page.can.versions(), run: (c) => c.page.versions() },
    { id: 'doc.resetSeed', label: 'Reset to original', key: 'reset-seed', destructive: true, when: (c) => c.page.can.resetSeed(), run: (c) => c.page.resetSeed() },
    { id: 'doc.importTex', label: 'Import .tex…', key: 'import-tex', destructive: true, when: (c) => c.page.can.importTex(), run: (c) => c.page.importTex() },
    { id: 'doc.exportTex', label: 'Export .tex', key: 'export-tex', run: (c) => c.page.exportTex() },
    { id: 'doc.exportZip', label: 'Export .zip', key: 'export-zip', when: (c) => c.page.can.exportZip(), run: (c) => c.page.exportZip() },
    { id: 'doc.exportZipPlain', label: 'Export .zip, plain title commands', key: 'export-zip-plain', when: (c) => c.page.can.exportZip(), run: (c) => c.page.exportZip({ plainTitle: true }) },
    { id: 'doc.exportPdf', label: 'Export PDF', key: 'export-pdf', when: (c) => c.page.can.exportPdf(), run: (c) => c.page.exportPdf() },
  ];
}
