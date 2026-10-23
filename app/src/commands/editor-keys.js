// @ts-check
// The block editor's own keys: what edit/session.js asks for when CodeMirror does not
// handle a key itself, mapped to commands (commands/editor.js) and moves between blocks. One per document editor.
//
//   const editorKey = createEditorKeys({ command, doc, indexOf, blockById, enterEdit, openSlashMenu, focusEditor })
//   editorKey(session, name) -> true when handled   names: escape, shift-enter, mod-enter, backspace-empty,
//                                                   backspace-start, up-top, down-bottom, alt-up, alt-down, slash-empty
/** @param {{ command: (id: string, input: any, via: string) => any, doc: () => any, indexOf: (id: string) => number, blockById: (id: string) => any,
 *   enterEdit: (...a: any[]) => any, openSlashMenu: (anchor: any, onPick: (t: any) => void, onCancel?: () => void) => void, focusEditor: (pane: string) => void }} o */
export function createEditorKeys({ command, doc, indexOf, blockById, enterEdit, openSlashMenu, focusEditor }) {
  return function editorKey(s, name) {
    const id = s.id, pane = s.pane, ed = s.editor;
    if (!id || !ed) return false;
    const i = indexOf(id), blocks = doc().blocks;
    const here = (bid, caret = null) => enterEdit(bid, null, caret, null, null, pane);
    const key = (cid, input) => command(cid, input, 'key');
    switch (name) {
      // ⌘Z in an editor: the document's history, after this key (the editor may close)
      case 'undo': queueMicrotask(() => key('doc.undo', {})); return true;
      case 'redo': queueMicrotask(() => key('doc.redo', {})); return true;
      case 'escape': return key('editor.leave', { session: s, id });
      case 'shift-enter': key('block.insertBelow', { id, pane }); return true;
      case 'mod-enter': key('block.split', { id, offset: ed.caret, edit: true, pane }); return true;
      case 'backspace-empty': {
        if (blocks.length <= 1) return false;
        const prev = blocks[i - 1] ?? blocks[i + 1];
        s.drop();
        key('block.delete', { id, quiet: true });
        here(prev.id);
        return true;
      }
      case 'backspace-start': { if (i === 0) return false; key('block.merge', { id, edit: true, pane }); return true; }
      case 'up-top': if (i > 0) { here(blocks[i - 1].id); return true; } return false;
      case 'down-bottom': if (i < blocks.length - 1) { here(blocks[i + 1].id, 0); return true; } return false;
      case 'alt-up':
      case 'alt-down': { const c = ed.caret; key(name === 'alt-up' ? 'block.moveUp' : 'block.moveDown', { id }); here(id, c); focusEditor(pane); return true; }
      case 'slash-empty': {
        openSlashMenu(s.surface.source, (t) => {
          const b = blockById(id);
          b.kind = t.kind;
          ed.view.dispatch({ changes: { from: 0, to: ed.view.state.doc.length, insert: t.source } });   // a typing step
          ed.focus(false);
          ed.view.dispatch({ selection: { anchor: t.caret >= 0 ? t.caret : t.source.length } });
        }, () => { ed.view.dispatch(ed.view.state.replaceSelection('/')); ed.focus(false); });
        return true;
      }
    }
    return false;
  };
}
