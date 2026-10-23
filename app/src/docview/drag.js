// dragging a block by its handle, in either pane and between them (out of app.js dragging()).
//
// The block (a container with its paragraphs) is lifted and follows the pointer in the pane it was taken
// from; the drop line is drawn in the pane under the pointer, at a place computed from THAT pane's elements
// (nesting/app.js dragTargets: between blocks, inside a container where the pointer is indented). On drop,
// every row of every pane glides from where it was drawn to its new place, and nothing the
// drag set on an element survives it: the lifted rows' transform and transition are cleared whatever pane
// they are in (a row lifted in pane B was left translated, the glide only reset pane A's: "artifacts until
// a resize").
//
//   const drag = createBlockDrag(host)
//   host: { nest, leaveAll(), openMenu(handle, id), panes() -> the panes' ids, paneOf(el) -> pane | null,
//           box(pane) -> its .blocks, scroller(pane) -> element | null (the window), elementIn(pane, id) }
//   drag.attach(handle, id) -> detach() · drag.settled() (the last drop's glide)
// every pane's handles the same (a pane's view of the block: panes/block-view.js, its detach on dispose);
// the drop line is a kit layer (design/ui/overlays.js openLayer) for the drag's lifetime, its place set per move.
import * as dragMotion from '../nesting/drag-motion.js';
import { html } from '../design/ui/core.js';
import { openLayer } from '../design/ui/overlays.js';

export function createBlockDrag(host) {
  let glided = Promise.resolve();
  /** the drop line: a layer opened when a drag starts, closed when it ends */
  function openLine() {
    const layer = openLayer(() => html`<div id="drop-line" aria-hidden="true"></div>`);
    const el = layer.el.querySelector('#drop-line');
    el.style.display = 'none';
    return { el, close: () => layer.close() };
  }

  /** the pane under a point (its scroller's box; the one pane when not split) */
  function paneAt(x, y) {
    const ps = host.panes();
    if (ps.length === 1) return ps[0];
    for (const p of ps) {
      const sc = host.scroller(p);
      const r = (sc ?? host.box(p)).getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return p;
    }
    return null;
  }

  function attach(handle, id) {
    const down = (e) => {
      const from = host.paneOf(handle);                 // the pane whose view the handle is in
      if (e.button !== 0 || !from) return;
      e.preventDefault();
      host.leaveAll();
      const start = { x: e.clientX, y: e.clientY };
      const roots = host.nest.unit(id).map((x) => host.elementIn(from, x)).filter(Boolean);
      let active = false, target = null, lifted = null, lineLayer = null;
      const lineOf = () => (lineLayer ??= openLine()).el;
      const move = (ev) => {
        if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        if (!active) { active = true; for (const r of roots) r.classList.add('dragging'); host.root.hold('dragging', handle, true); lifted = dragMotion.lift(roots); }
        lifted.follow(ev.clientX - start.x, ev.clientY - start.y);      // the block follows the pointer, lifted
        const p = paneAt(ev.clientX, ev.clientY);
        const box = p && host.box(p);
        const line = lineOf();
        if (!box) { target = null; line.style.display = 'none'; return; }
        const col = box.getBoundingClientRect();
        const t = host.nest.pickTarget(host.nest.dragTargets(id, (x) => host.elementIn(p, x)), ev.clientX, ev.clientY, col.left);
        if (!t) return;
        target = { ...t, pane: p };
        const indent = t.indent ? 22 : 0;
        line.classList.toggle('nest-inside', !!t.indent);
        // client coordinates: the line is fixed, so it is right whichever element scrolls (the window, a pane)
        Object.assign(line.style, { position: 'fixed', display: 'block', top: `${t.y - 1}px`, left: `${col.left + indent}px`, width: `${col.width - indent}px` });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        lineLayer?.close(); lineLayer = null;
        for (const r of roots) r.classList.remove('dragging');
        host.root.hold('dragging', handle, false);
        if (!active) { host.openMenu(handle, id); return; }
        // every row of every pane glides from where it was drawn to its new place (FLIP), the dropped block too
        const panes = host.panes();
        const before = panes.map((p) => [p, dragMotion.snapshot(host.box(p))]);
        lifted?.clear();
        if (target) host.nest.drop(id, target);
        glided = Promise.all(before.map(([p, snap]) => (host.box(p) ? dragMotion.glide(host.box(p), snap) : Promise.resolve())));
        // whatever pane a lifted row is in now (or was: a dropped row may have left the other pane's list), it is drawn where it lays
        for (const r of roots) if (!r.parentElement || !panes.some((p) => host.box(p) === r.parentElement)) { r.style.transform = ''; r.style.transition = ''; }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    handle.addEventListener('pointerdown', down);
    return () => handle.removeEventListener('pointerdown', down);
  }

  return { attach, settled: () => glided };
}
