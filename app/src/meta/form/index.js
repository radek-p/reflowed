// the title form, opened from the title block (app.js: one call). The host is the app's hook:
//   doc(), readOnly(), apply(label, preamble)   one undoable preamble edit (perform)
//   preview(preamble, blockId) → BlockResult    the title block compiled with that preamble's data
//   mount(el, result, box) → viewer block        the viewer's mount into box
//   editSource(blockId)                          the block's LaTeX editor instead
//   focusBlock(blockId)                          where focus goes back
// createMetaForm(host) → { open(blockId) → bool (false: not a form document), isOpen(), close(apply) }
import { registerView, openView } from '../../design/ui/views.js';
import { readMeta } from '../model.ts';
import { readPlain } from '../import.ts';
import { className } from '../edit.ts';
import { TitleForm } from './sheet.js';

// a registered view: its content (TitleForm) apart from its container (the kit's Sheet, by default)
registerView({ id: 'title-form', title: 'Title and authors', slot: 'sheet', Component: TitleForm });

export function createMetaForm(host) {
  let layer = null;
  function open(blockId) {
    const doc = host.doc();
    if (!doc || host.readOnly() || layer) return false;
    const pre = doc.preamble.source;
    const cls = className(pre) || doc.settings?.class || 'article';
    if (!readMeta(pre).cmd && !readPlain(pre, cls)) return false;
    layer = openView('title-form', { host, pre0: pre, cls, blockId,
      done: (next) => {
        layer?.close(); layer = null;
        const cur = host.doc()?.preamble.source;
        if (next != null && cur != null && next !== cur) host.apply('Edit title and authors', next);
        host.focusBlock?.(blockId);
        document.dispatchEvent(new CustomEvent('editor:meta-closed', { detail: { applied: next != null && next !== cur } }));
      } });
    document.dispatchEvent(new CustomEvent('editor:meta-opened', { detail: { blockId } }));
    return true;
  }
  return {
    open,
    isOpen: () => !!layer,
    /** (tests) close as Done (apply) or Cancel */
    close(apply = true) { layer?.el.querySelector(apply ? '.mf-done' : '.mf-cancel')?.click(); },
  };
}
