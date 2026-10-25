// where a pane's block controls go, and how long they stay.
//
// the mode, by symmetry: the controls (the heading's focus icon, the +, the handle, a container's
// bracket and fold) need GUTTER px left of the text column. The column stays centred, so the pane must
// give the same on the right: 'wide' only when pane ≥ column + 2 · GUTTER; otherwise 'narrow': small
// equal margins and the controls in a floating bar over the text's top-left corner. Per pane (the single
// view's pane is the container's [data-part=view], split panes their <main data-pane>); the mode is the pane's data-ctl.
// Hysteresis: back to wide only HYST px past the boundary, so a pane resized across it does not flip.
//
// the hover zone: a block's controls show while the pointer is on the block, its controls, or the
// gutter band beside it (the gap included); leaving starts a GRACE ms delay before they hide, cut short
// when another block is entered (one block's controls at a time, no trails). The hot block is .g-hot.
// Aim: a pointer on its way to the hot block's controls may cross another block (in narrow mode the bar
// sits above the block, over the end of the one before): while it gets closer to the controls, the switch
// waits (at most GRACE ms), as a menu's submenu does.
//
//   controlsChanged(root) a host added or removed panes the view's observer does not see
//   installControls(root) -> off (app/editor-root.ts: the editor's container; once per container) · controlsMode(prev, paneWidth, column) (pure; test-w15-units)
export const GUTTER = 128, HYST = 24, GRACE = 300;

/** the mode for a pane `paneWidth` px wide around a column `column` px wide, given the mode it has */
export function controlsMode(prev, paneWidth, column) {
  const need = column + 2 * GUTTER + (prev === 'narrow' ? HYST : 0);
  return paneWidth >= need ? 'wide' : 'narrow';
}

const installed = new WeakSet();
// panes a host places deeper than the view's children (the workbench's tab hosts): it says when they come and go
const refreshers = new WeakMap();
/** panes were added or removed in container `root` (one not watched by its view's own observer) */
export function controlsChanged(root) { refreshers.get(root)?.(); }
export function installControls(root) {
  if (installed.has(root) || typeof document === 'undefined') return () => {};
  installed.add(root);
  const html = root.doc.documentElement;
  const view = () => root.part('view');
  const mains = (v) => v.querySelectorAll('main[data-pane]');
  /** the pane's column, px: its own --col (view/index.js: on its tab, or a mounted editor's shell; the page's default) */
  const columnPx = (p) => {
    const v = getComputedStyle(p).getPropertyValue('--col').trim();
    const n = parseFloat(v) || 704;
    return /rem$/.test(v) ? n * (parseFloat(getComputedStyle(html).fontSize) || 16) : n;
  };

  // ── the mode ──
  function update() {
    const v = view();
    if (!v) return;
    const split = v.classList.contains('scrolls');
    for (const p of mains(v)) {
      const w = split ? p.clientWidth : v.clientWidth;
      if (!w) continue;                                            // hidden (home): decided when shown
      const m = controlsMode(p.dataset.ctl, w, columnPx(p));
      if (p.dataset.ctl !== m) p.dataset.ctl = m;
    }
  }
  // decided in the ResizeObserver's turn: after layout, before paint (no frame in the old mode)
  const ro = new ResizeObserver(update);
  // a pane that goes is no longer observed (an observed element is kept alive: split view's pane B leaked)
  const seen = new Set();
  const watch = () => {
    const v = view();
    if (!v) return;
    ro.observe(v);
    for (const p of seen) if (!p.isConnected) { ro.unobserve(p); seen.delete(p); }
    mains(v).forEach((p) => { if (!seen.has(p)) { seen.add(p); ro.observe(p); } });
  };
  refreshers.set(root, () => { watch(); update(); });
  watch();
  const v0 = view();
  const mo = new MutationObserver(() => { watch(); update(); });
  if (v0) mo.observe(v0, { childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  const moCol = new MutationObserver(update);
  moCol.observe(html, { attributes: true, attributeFilter: ['style'] });   // the page's view options (the text size: Paper's column; view/index.js)
  update();

  // ── the hover zone ──
  let hot = null, timer = 0, last = null, lastOnHot = false, pending = null, aimTimer = 0;
  const unaim = () => { clearTimeout(aimTimer); aimTimer = 0; pending = null; };
  const show = (b) => {
    clearTimeout(timer); timer = 0;
    unaim();
    if (b === hot) return;
    hot?.classList.remove('g-hot');
    hot = b;
    hot?.classList.add('g-hot');
  };
  const release = () => {
    if (!hot || timer) return;
    timer = setTimeout(() => { timer = 0; hot?.classList.remove('g-hot'); hot = null; }, GRACE);
  };
  /** the block whose controls the point belongs to: the block under it, or the one beside a wide pane's gutter band */
  function blockAt(x, y, target) {
    const b = target instanceof Element ? target.closest('.blk') : null;
    if (b) return b.classList.contains('nest-head') ? null : b;   // a container's controls answer its bracket
    const v = view();
    if (!v || v.hidden) return null;
    const split = v.classList.contains('scrolls');
    for (const pane of mains(v)) {
      if (pane.dataset.ctl === 'narrow') continue;
      const list = pane.querySelector('.blocks');
      if (!list) continue;
      const r = list.getBoundingClientRect(), pr = (split ? pane : v).getBoundingClientRect();
      if (y < r.top || y > r.bottom || x >= r.left || x < r.left - GUTTER || x < pr.left || y < pr.top || y > pr.bottom) continue;
      const hit = document.elementFromPoint(r.left + 2, y);
      const blk = hit?.closest?.('.blk');
      return blk && list.contains(blk) && !blk.classList.contains('nest-head') ? blk : null;
    }
    return null;
  }
  /** is the pointer, from p0 to p1, getting closer to the hot block's controls (and near them)? */
  function aiming(p0, p1) {
    const g = hot?.isConnected ? hot.querySelector(':scope > .gutter') : null;
    const r = g?.getBoundingClientRect();
    if (!r?.width || getComputedStyle(g).opacity === '0') return false;
    const d = (p) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
    return d(p1) < d(p0) - 0.5 && d(p1) < 160;
  }
  root.listen(root.el, 'pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (root.has('dragging')) { show(null); return; }
    const p = { x: e.clientX, y: e.clientY }, p0 = last, wasOnHot = lastOnHot;
    last = p;
    const b = blockAt(p.x, p.y, e.target);
    lastOnHot = !!b && b === hot;
    if (lastOnHot) { show(b); return; }
    // aiming: only a pointer that was just on the hot block (or still aiming) and is near (a jump is not a path)
    if (hot && p0 && (wasOnHot || aimTimer) && Math.hypot(p.x - p0.x, p.y - p0.y) < 80 && aiming(p0, p)) {
      // on the way to the controls: decide when the pointer stops getting closer, or after the grace
      clearTimeout(timer); timer = 0;
      pending = b;
      if (!aimTimer) aimTimer = setTimeout(() => { aimTimer = 0; const q = pending; pending = null; if (q) show(q); else release(); }, GRACE);
      return;
    }
    if (b) show(b); else release();
  }, { passive: true });
  root.listen(root.el, 'pointerleave', release);
  const offScroll = root.onScroll(release);   // the page moved under the pointer
  const off = () => { ro.disconnect(); mo.disconnect(); moCol.disconnect(); offScroll(); clearTimeout(timer); unaim(); hot?.classList.remove('g-hot'); hot = null; installed.delete(root); refreshers.delete(root); };
  root.onDispose(off);
  return off;
}
