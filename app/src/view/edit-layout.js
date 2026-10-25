// where a block's source goes while it is edited, beside or below its
// live result (or instead of it: 'replace', the old way).
//
//   decide(pref, blockEl) -> { mode: 'side'|'stacked'|'replace', preview, editor, shift, row, gap }
//   applyLayout(blockEl, layout)   sets data-edit-layout and the sizes (CSS in style.js)
//   clearLayout(blockEl)
//
// Side by side keeps the result where it was: same left edge, same width
// (so the same line breaks), the source in the space to its right. When that
// space is too small the row first moves left into the free margin (the
// result keeps its measure; it slides, it does not re-break), then the result
// narrows, down to PREVIEW_MIN. If even then the source would be narrower
// than EDITOR_MIN, it is stacked: the result stays exactly where it is and
// the source opens below it.
//
// Thresholds:
//   EDITOR_MIN 340 px   ~40 columns of 13.5 px monospace: a line of LaTeX
//                       (\begin{theorem}[Name]\label{thm:x}) without wrapping
//   EDITOR_IDEAL 480    ~58 columns, the typical source line; more is not used
//   EDITOR_MAX 720
//   PREVIEW_MIN max(300 px, 60 % of the reading measure): below that a
//                       paragraph re-breaks into something that no longer
//                       resembles what the author was looking at
//   GAP 20
export const EDITOR_MIN = 340, EDITOR_IDEAL = 480, EDITOR_MAX = 720, PREVIEW_ABS_MIN = 300, PREVIEW_FRAC = 0.6, GAP = 20;
const GUTTER = 44;            // app.css .gutter: left -44px (the + and the handle stay visible)
const MARK = 16;              // app.css .blk::after: the margin marks at right -14px

export function decide(pref, blockEl) {
  if (pref === 'replace' || !blockEl) return { mode: 'replace' };
  // the pane the block is in (split view: each its own scroller, main[data-pane]): the room is that pane's
  const pane = blockEl.closest('main[data-pane]');
  const blocks = blockEl.closest('.blocks');
  const split = !!pane?.closest('[data-part="view"].scrolls');   // the pane scrolls itself (split, or an embedded editor)
  const page = pane;
  const shell = split ? pane : page?.closest('[data-part="shell"]');
  if (!page || !blocks || !shell) return { mode: pref === 'stacked' ? 'stacked' : 'replace' };
  if (pref === 'stacked') return { mode: 'stacked' };
  const pad = split ? 4 : parseFloat(getComputedStyle(page).paddingLeft) || 0;
  const sr = split ? { left: shell.getBoundingClientRect().left, right: shell.getBoundingClientRect().left + shell.clientWidth } : shell.getBoundingClientRect(), cr = blocks.getBoundingClientRect();
  const colLeft = cr.left, colW = cr.width;
  const minLeft = Math.max(sr.left + pad, 0) + GUTTER, maxRight = Math.min(sr.right, document.documentElement.clientWidth) - pad - MARK;
  const avail = maxRight - minLeft;
  const previewMin = Math.max(PREVIEW_ABS_MIN, PREVIEW_FRAC * colW);
  // 1. the result as it is; the source in the room to its right (at most EDITOR_MAX)
  let preview = colW;
  let editor = Math.min(EDITOR_MAX, maxRight - (colLeft + colW) - GAP);
  if (editor < EDITOR_IDEAL) {
    // 2. slide left into the free margin, the result's measure kept
    editor = Math.min(EDITOR_MAX, Math.max(editor, avail - colW - GAP));
    // 3. narrow the result, down to previewMin, for an editor of EDITOR_MIN
    if (editor < EDITOR_MIN) { editor = EDITOR_MIN; preview = Math.min(colW, avail - GAP - editor); }
  }
  if (preview < previewMin || editor < EDITOR_MIN) return { mode: 'stacked', reason: `no room: result ${Math.round(preview)} px, source ${Math.round(editor)} px` };
  const row = preview + GAP + editor;
  const shift = Math.max(0, Math.min(colLeft - minLeft, colLeft + row - maxRight));
  return { mode: 'side', preview: Math.floor(preview), editor: Math.floor(editor), gap: GAP, row: Math.floor(row), shift: Math.round(shift) };
}

export function applyLayout(el, l) {
  el.dataset.editLayout = l.mode;
  if (l.mode === 'side') {
    el.style.setProperty('--edit-preview', `${l.preview}px`);
    el.style.setProperty('--edit-editor', `${l.editor}px`);
    el.style.setProperty('--edit-gap', `${l.gap}px`);
    el.style.setProperty('--edit-row', `${l.row}px`);
    el.style.setProperty('--edit-shift', `${l.shift}px`);
  } else for (const p of ['--edit-preview', '--edit-editor', '--edit-gap', '--edit-row', '--edit-shift']) el.style.removeProperty(p);
}

export function clearLayout(el) {
  if (!el) return;
  delete el.dataset.editLayout;
  applyLayout(el, { mode: 'replace' });
  delete el.dataset.editLayout;
  clearMirrors(el);
}

// ── the caret, mirrored in the live result ───────────────────────────────
// The caret, the selection and the caret's line mirrored in the preview, and a click mapped back to the source:
// edit/preview-marks.js (re-exported here for the modules and tests that import them from this one).
import { visibleBox } from '../../../workbench/src/viewport.ts';
export { markCaret, caretMap, offsetAt, warmMap, carryCaret, caretPlace, ligatureSpan, callEnd, definitions } from '../edit/preview-marks.js';

// ── sliding into and out of the layout (after motion.js's morph) ───────────
// FLIP: the result was at r0 before the layout changed; it is laid out at its
// new place now: it slides from r0 there (transform, 220 ms, ease-out). The
// morph's ghost (a static copy of the old rendering, at the old width and
// breaks) slides along while it fades, so the text is not seen re-breaking
// mid-flight; the source pane fades in from the right. Reduced motion: none.
export const SLIDE_MS = 220;
export function slide(u, r0, { entering = true } = {}) {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
  if (reduce || !r0 || !u.render.isConnected || u.render.hidden) return;
  const r1 = u.render.getBoundingClientRect();
  if (!r1.width) return;
  const dx = r0.left - r1.left, dy = r0.top - r1.top;
  const opts = { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
    u.render.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], opts);
    const ghost = u.main.querySelector(':scope > .morph-ghost');
    ghost?.animate([{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], { ...opts, fill: 'forwards' });
  }
  if (entering) pulse();
  if (entering && !u.source.hidden) {
    // stacked: the source opens as a popover (a quick, slightly springy scale and fade); side by side: from the right
    const stacked = u.root.dataset.editLayout === 'stacked';
    u.source.animate(stacked ? [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }],
      stacked ? { duration: 180, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' } : opts);
  }
}

/** both current lines (the source's, the result's) pulse once to a stronger tint and settle (a CSS animation) */
let pulseTimer = 0;
// el: where (the edited block: a class on the page's root would restyle every block during the open's motion)
export function pulse(el = document.documentElement) {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
  if (reduce) return;
  const root = el;
  root.classList.remove('rtx-line-pulse');
  // restarted on the next frame (no forced style flush in the open's task)
  requestAnimationFrame(() => {
    root.classList.add('rtx-line-pulse');
    clearTimeout(pulseTimer); pulseTimer = setTimeout(() => root.classList.remove('rtx-line-pulse'), 700);
  });
}

/** Stacked, with a result taller than the window: the popover floats over the result's lower part,
 *  so the mirrored caret is kept in the upper half (at about a third of the window) as it moves. */
// follow: false (the reader scrolled away since the last caret move): the float is decided, nothing scrolls
export function keepCaretInView(u, pane = null, { follow = true } = {}) {
  if (u.root.dataset.editLayout !== 'stacked') return;
  // pane: { top, bottom, origin, scrollBy(dy) (the keeper told) } of the pane it is in (the session gives it: the
  // window below the top bar while it is the only pane, origin 0); without one, the window
  const top = pane?.top ?? 56, bottom = pane?.bottom ?? visibleBox().bottom, origin = pane?.origin ?? pane?.top ?? 0, room = bottom - origin;
  floatIfLarge(u, room);
  if (!follow) return;
  const bar = u.render.querySelector('.rtx-caret-bar');
  if (!bar) return;
  const b = bar.getBoundingClientRect(), pop = u.source.getBoundingClientRect();
  // only when the popover floats over the result (a result taller than the window), or the caret is off
  // screen: a small block's popover sits below its result and nothing moves
  const floating = pop.top < u.render.getBoundingClientRect().bottom - 1;
  const off = b.top < top || b.bottom > bottom;
  if (!off && !(floating && (b.bottom > Math.min(origin + room / 2, pop.top - 8) || b.top < top))) return;
  let dy = b.top - (origin + room * 0.3);
  // a floating popover is pinned at the pane's bottom while the result runs on under it; scrolled further,
  // the result's end would rise above the popover's place and carry it up (it is sticky in the result's flow).
  // Following down, the page scrolls at most until the result's end meets the popover: it stays where it is, and
  // the caret, inside the result, is above it.
  if (floating && dy > 0) dy = Math.max(0, Math.min(dy, u.render.getBoundingClientRect().bottom - pop.top));
  if (Math.abs(dy) < 0.5) return;
  // on the reader's behalf (the pane's anchor keeper is told); not smooth: the caret must be visible at once
  if (pane) { pane.scrollBy(dy); return; }
  window.scrollBy({ top: dy, behavior: 'instant' });
}

/** Everything mirrored from the editor into the preview — the caret, the selection, the line band, the
 *  pulse, the popover's fades — removed: the one teardown, from every way out of editing (app.js
 *  editLayoutLeave: Esc, a press outside, another block, the document closed, a move). */
export function clearMirrors(el) {
  el?.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').forEach((m) => m.remove());
  el?.classList.remove('rtx-float', 'rtx-line-pulse');
  document.documentElement.classList.remove('rtx-line-pulse');
}

/** The popover's scroll-edge fades: a fade on the side where more source is hidden. */
export function updateFades(scroller) {
  if (!scroller) return;
  const { scrollTop, scrollHeight, clientHeight } = scroller;
  scroller.style.setProperty('--fade-top', scrollTop > 1 ? '14px' : '0px');
  scroller.style.setProperty('--fade-bottom', scrollTop + clientHeight < scrollHeight - 1 ? '14px' : '0px');
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('scroll', (e) => {
  const t = e.target;
  if (t instanceof Element && t.classList.contains('cm-scroller') && t.closest('.blk.editing .blk-source')) updateFades(t);
}, true);

/** Stacked: the popover floats (sticky over the result's lower part) only for a result taller than
 *  about half the window; a small block's popover sits under it in the flow. With hysteresis (on above
 *  55 %, off below 45 %), so a block near the threshold does not flip while typing. */
export function floatIfLarge(u, room = visibleBox().bottom) {
  const h = u.render.getBoundingClientRect().height, on = u.root.classList.contains('rtx-float');
  const want = on ? h > room * 0.45 : h > room * 0.55;
  if (want !== on) u.root.classList.toggle('rtx-float', want);
}
