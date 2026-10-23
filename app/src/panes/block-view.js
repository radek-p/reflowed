// PANES: one block in one pane. Every pane makes its own, the same way: the shell (docview/block-shell.js:
// gutter, render, preview, source, errors, a feature's action button), the viewer view it shows (`mounted`), the per-view
// flags (a held height while the first result mounts), and — for a container — its head (bracket, fold:
// nesting/app.js attachView). The block's decor (panes/decor.js) is applied when it is made. A view is an
// edit surface too: a pane's editing session opens on that pane's view (edit/session.js: root, main, render,
// preview, source, errors).
//
//   const v = createBlockView({ id, pane, action, on })
//     on: { click(e, v), dblclick(e, v), focus(v), preview(e, v), add(e, v), focusIcon(e, v), action(v) (the block's action button), attachHandle(handle, v) }
//   v.id · v.pane · v.root · v.main · v.render · v.preview · v.source · v.errors · v.add · v.handle · v.mounted
//   v.dispose()   the viewer view destroyed, the Preact roots cleared, the element removed
import { mountBlockShell } from '../docview/block-shell.js';
import { besideRender } from '../edit/frame-click.js';

export function createBlockView({ id, pane, action = null, on }) {
  let v = null;
  const g = mountBlockShell({
    id, action,
    onAction: () => on.action?.(v),
    onAdd: (e) => on.add?.(e, v),
    onFocus: (e) => on.focusIcon?.(e, v),
  });
  v = {
    id, pane,
    root: g.root, main: g.main, render: g.render, preview: g.preview, source: g.source, errors: g.errors,
    gutter: g, add: g.add, handle: g.handle,
    mounted: null,                       // { ck, el, block }: the viewer view this pane shows
    held: false, keepHeld: false,        // the height kept while a first result mounts here
    bracket: null, fold: null,           // a container's head in this pane
    disposed: false,
    dispose,
  };
  g.root.dataset.pane = pane;
  const click = (e) => on.click?.(e, v), dbl = (e) => on.dblclick?.(e, v), foc = () => on.focus?.(v), prev = (e) => on.preview?.(e, v);
  g.render.addEventListener('click', click);
  // a click in the frame just beside the render (its padding, where a hanging full stop ends): as on the render
  const frame = (e) => { if (besideRender(g.render, g.root, g.main, e)) click(e); };
  g.root.addEventListener('click', frame);
  g.render.addEventListener('dblclick', dbl);
  g.render.addEventListener('focus', foc);
  g.preview.addEventListener('click', prev);
  const detach = on.attachHandle?.(g.handle, v) ?? null;

  function dispose() {
    if (v.disposed) return;
    v.disposed = true;
    detach?.();
    if (v.mounted) { try { v.mounted.block.destroy(); } catch { /* gone */ } v.mounted = null; }
    g.render.removeEventListener('click', click);
    g.root.removeEventListener('click', frame);
    g.render.removeEventListener('dblclick', dbl);
    g.render.removeEventListener('focus', foc);
    g.preview.removeEventListener('click', prev);
    v.bracket?.remove(); v.fold?.remove(); v.bracket = v.fold = null;
    g.destroy();
    g.root.remove();
  }
  return v;
}
