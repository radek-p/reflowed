// PANES: one pane — a view of a document: its <main> (the first pane's is the container's [data-part=page],
// any other one is made with the divider before it: docview/split-chrome.js), its DocumentView (the block list, in
// order), its BlockViews (one per block: panes/block-view.js), its scroller (the window while it is the only pane of
// a window-scrolled editor, its <main> otherwise) and its anchor keeper (perf/anchor.js: the reader's place holds
// while blocks typeset). Every listener and observer it adds is its own and goes with dispose().
//
//   const p = createPane({ id, el, docView, keeper, owned, inset })
//     el: the pane's <main>; docView: its DocumentView; keeper: its anchor keeper | null; owned: { destroy() } | null
//     inset(): where a window-scrolled pane's text starts (the editor's top bar's bottom: app/editor-root.ts)
//   p.id · p.el · p.view · p.keeper · p.views (Map block id -> BlockView)
//   p.scroller (null: the window) · p.setScroller(el | null) · p.box() -> { top, bottom } · p.scrollBy(dy[, { hold }]) · p.range() · p.moving()
//   --pane-h (CSS, on el): the box's height, kept current: its size observed, and in the layout phase of every
//     change of the window's visible part (workbench/src/viewport.ts onVisible: an on-screen keyboard, a resize), so the
//     editing popover's cap is half of what the reader sees before anything is kept in view
//   p.contains(node) · p.viewOf(id) · p.sync(blocks, make(id) -> BlockView) · p.onFocus(fn) · p.onDispose(fn) · p.dispose()
import type { BlockView, DocView, Keeper, Owned, Pane } from './types.ts';
import { appScroll } from '../perf/anchor.js';
import { onVisible, visibleBox } from '../../../workbench/src/viewport.ts';

/** a window-scrolled pane's box starts this far below the top bar (the reading line: 56 px under a 44 px bar) */
export const READ_MARGIN = 12;

export interface PaneOptions {
  id: string;
  el: HTMLElement;
  docView: DocView;
  keeper?: Keeper | null;
  owned?: Owned | null;
  inset: () => number;
}

export function createPane({ id, el, docView, keeper = null, owned = null, inset }: PaneOptions): Pane {
  // the scroller's top that its content scrolls under (a glass tab strip over it): its scroll-padding-top, read
  // when its size changes (paneH), so box() and top() start below it
  // when it is read: once a frame at most (the strip's form can change it with no change of the pane's size)
  let scroller: HTMLElement | null = null, underNow = 0, underRead = false, focusFn: ((id: string) => void) | null = null, disposed = false;
  const onGone: (() => void)[] = [];
  const views = new Map<string, BlockView>();
  el.dataset.pane = id;
  // the pane the reader works in: a press or a focus inside it (the outline, find, selection act there)
  const onFocus = () => focusFn?.(id);
  el.addEventListener('pointerdown', onFocus, true);
  el.addEventListener('focusin', onFocus);

  const p: Pane = {
    id, el, view: docView, keeper, views,
    opening: null,
    get scroller() { return scroller; },
    setScroller(s) { scroller = s ?? null; keeper?.setScroller?.(scroller); paneH(); },
    /** the part of the window the pane shows its blocks in (the only pane of a window-scrolled editor: below the top bar) */
    box() {
      if (!scroller) return { top: inset() + READ_MARGIN, bottom: visibleBox().bottom };
      const r = scroller.getBoundingClientRect();
      return { top: r.top + under(), bottom: r.top + scroller.clientHeight };
    },
    /** the y below which the pane's text starts (the top bar's bottom, or the pane's top) */
    top() { return scroller ? scroller.getBoundingClientRect().top + under() : inset(); },
    /** how far the pane can scroll now: { min (up, <= 0), max (down, >= 0) } */
    range() {
      const sc = scroller ?? el.ownerDocument.scrollingElement ?? el.ownerDocument.documentElement;
      const y = scroller ? scroller.scrollTop : scrollY, h = scroller ? scroller.clientHeight : innerHeight;
      return { min: -y, max: Math.max(0, sc.scrollHeight - h - y) };
    },
    /** what moves when the pane's blocks move: its blocks (and the heads over them), its "Add a block" */
    moving() { return [...(docView.container?.children ?? []), ...el.querySelectorAll(':scope > .add-end-host')]; },
    // a scroll the app makes on the reader's behalf: perf/anchor.js appScroll tells the keeper (its callers
    // told it by hand; two did not, and it took their scroll for the reader's own)
    scrollBy(dy, o) { appScroll({ scroller, keeper }, { by: dy, hold: !!o?.hold }); },
    contains: (node) => !!node && el.contains(node),
    viewOf: (bid) => views.get(bid) ?? null,
    /** the pane's views of `blocks` (made for new ones, disposed for gone ones), placed in order */
    sync(blocks, make) {
      const want = new Set(blocks.map((b) => b.id));
      for (const [bid, v] of views) if (!want.has(bid)) { v.dispose(); views.delete(bid); }
      for (const b of blocks) if (!views.has(b.id)) views.set(b.id, make(b.id));
      docView.sync(blocks, (bid) => views.get(bid)?.root ?? null);
    },
    onFocus(fn) { focusFn = fn; },
    /** something made for this pane that goes with it */
    onDispose(fn) { onGone.push(fn); },
    dispose() {
      if (disposed) return;
      disposed = true;
      offVisible();
      ro?.disconnect();
      el.removeEventListener('pointerdown', onFocus, true);
      el.removeEventListener('focusin', onFocus);
      keeper?.stop?.();
      for (const v of views.values()) v.dispose();
      views.clear();
      for (const fn of onGone.splice(0)) { try { fn(); } catch (e) { console.error('pane dispose:', e); } }
      if (owned) { docView.destroy(); owned.destroy(); }
      focusFn = null;
    },
    get disposed() { return disposed; },
  };
  // --pane-h on the pane: the height of the box it shows its blocks in (the editing popover is capped at half of it)
  function under(): number {
    if (!scroller) return 0;
    if (!underRead) { underRead = true; underNow = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0; requestAnimationFrame(() => { underRead = false; }); }
    return underNow;
  }
  function paneH() { underRead = false; const b = p.box(); el.style.setProperty('--pane-h', `${Math.max(0, Math.round(b.bottom - b.top))}px`); }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(paneH) : null;
  ro?.observe(el);
  const offVisible = onVisible(paneH);
  paneH();
  return p;
}
