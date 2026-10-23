// Pointer gestures: one pointer session (threshold, Escape cancels, window blur cancels),
// the ghost in the top layer, and the content drag (payload, preview, drop targets, spring-loading, auto-scroll).
// Pointer events, not HTML5 drag and drop: we own the preview, Escape, touch and the timing.
import type { ComponentChildren } from 'preact';
import { html, render } from './html.ts';
import { Icon, type IconName } from './kit/icons.ts';

const THRESHOLD = 4;

/**
 * Track a press from `e` (a pointerdown). After `threshold` px: onStart(e); then onMove(e) per move;
 * onDrop(e) on release; onCancel() on Escape, pointercancel or blur. A press released before the threshold
 * calls onClick?.(e). Returns { cancel }.
 */
/** The insertion bar's x in a scrolling row of tabs (the row's own coordinates, its scroll included): centred in the
 *  gap before tab `index` (after the last one past the end), kept inside the scroll box so the 2 px bar is drawn whole */
export function insertX(box: HTMLElement, tabs: readonly Element[], index: number): number {
  const br = box.getBoundingClientRect(), half = (parseFloat(getComputedStyle(box).columnGap) || 0) / 2;
  const edge = index < tabs.length ? tabs[index]!.getBoundingClientRect().left - half : tabs.length ? tabs.at(-1)!.getBoundingClientRect().right + half : br.left;
  return Math.max(1, Math.min(edge - br.left, box.clientWidth - 1)) + box.scrollLeft;
}

export type PointerHandlers = { threshold?: number; onStart?(e: PointerEvent): void; onMove?(e: PointerEvent): void; onDrop?(e: PointerEvent): void; onCancel?(): void; onClick?(e: PointerEvent): void; target?: Element | null };
export type PointerSession = { cancel(): void; readonly started: boolean };
/** The insertion index under x in a row of tabs: before the first whose middle is right of x, else at the end. */
export function insertIndex(tabs: readonly Element[], x: number): number {
  for (let i = 0; i < tabs.length; i++) { const r = tabs[i]!.getBoundingClientRect(); if (x < r.left + r.width / 2) return i; }
  return tabs.length;
}

export function pointerSession(e: PointerEvent, { threshold = THRESHOLD, onStart, onMove, onDrop, onCancel, onClick, target = e.target as Element | null }: PointerHandlers): PointerSession {
  const x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
  let started = false, done = false;
  try { target?.setPointerCapture?.(id); } catch { /* synthetic events */ }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return;
      started = true;
      onStart?.(ev);
    }
    ev.preventDefault();
    onMove?.(ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    end();
    if (started) onDrop?.(ev); else onClick?.(ev);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault(); ev.stopPropagation();
    cancel();
  };
  const cancel = () => { if (done) return; const s = started; end(); if (s) onCancel?.(); };
  const lost = (ev: PointerEvent) => { if (ev.pointerId === id) cancel(); };
  function end() {
    if (done) return;
    done = true;
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', lost, true);
    removeEventListener('keydown', key, true);
    removeEventListener('blur', cancel);
    try { target?.releasePointerCapture?.(id); } catch { /* gone */ }
  }
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', lost, true);
  addEventListener('keydown', key, true);
  addEventListener('blur', cancel);
  return { cancel, get started() { return started; } };
}

/** The drag image: a fixed box in the top layer (popover="manual": above modal dialogs and every z-index). */
/** The drag image: a fixed element following the pointer. */
export type Ghost = { el: HTMLDivElement; at(x: number, y: number): void; readonly pos: { x: number; y: number }; effect(e: DropEffect): void; remove(): void };
export function createGhost(content: Node | ComponentChildren, { dx = 12, dy = 8 }: { dx?: number; dy?: number } = {}): Ghost {
  const el = document.createElement('div');
  el.className = 'wb-ghost';
  el.setAttribute('aria-hidden', 'true');
  el.dataset.wbGhost = '';
  if (content instanceof Node) el.append(content); else if (content != null) render(content, el);
  el.setAttribute('popover', 'manual');
  document.body.append(el);
  try { el.showPopover(); } catch { el.removeAttribute('popover'); }
  let x = -9999, y = -9999;
  let w = 0, h = 0;
  // follows the pointer, kept inside the viewport (a preview is never cut off at an edge)
  const at = (cx: number, cy: number) => {
    if (!w) { w = el.offsetWidth; h = el.offsetHeight; }
    x = Math.max(0, Math.min(cx + dx, innerWidth - w)); y = Math.max(0, Math.min(cy + dy, innerHeight - h));
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  return {
    el,
    at,
    get pos() { return { x, y }; },
    effect(e: DropEffect) { el.classList.toggle('wb-ghost--none', e === 'none'); },
    remove() { try { el.hidePopover?.(); } catch { /* not shown */ } render(null, el); el.remove(); },
  };
}

/** An item's drag (a tab's and a side panel's alike): past the threshold a chip (its icon and label) follows the
 *  pointer and the page shows the drag cursor; `hint` says where a drop would go at each move (`show` it), the release
 *  drops there (`drop`, the hint or null), and Escape, a lost pointer or a blur `cancel`s; `onClick`: a press that never
 *  moved past the threshold. */
export function startItemDrag<H>(e: PointerEvent, { label, icon, start, hint, show, drop, cancel, onClick = null }: {
  label: string; icon: IconName; start(): void; hint(x: number, y: number): H | null; show(h: H | null): void;
  drop(h: H | null): void; cancel(): void; onClick?: (() => void) | null;
}): void {
  let ghost: Ghost | null = null;
  const end = () => { ghost?.remove(); endDragLook(); };
  pointerSession(e, {
    onClick: onClick ? () => onClick() : undefined,
    onStart(ev) {
      ghost = createGhost(ghostChip(label, icon));
      ghost.at(ev.clientX, ev.clientY);
      document.documentElement.classList.add('wb-dragging');
      start();
    },
    onMove(ev) { ghost!.at(ev.clientX, ev.clientY); show(hint(ev.clientX, ev.clientY)); },
    onDrop(ev) { const h = hint(ev.clientX, ev.clientY); end(); drop(h); },
    onCancel() { end(); cancel(); },
  });
}

// ── auto-scroll: the scrollable element under the pointer, near its edges ──
const EDGE = 48, MAX_STEP = 20;
function scroller(el: Element, stop: Element | null): { el: Element; x: boolean; y: boolean } | null {
  for (let n: Element | null = el; n && n !== stop?.parentElement; n = n.parentElement) {
    if (n.nodeType !== 1) continue;
    const s = getComputedStyle(n);
    const y = /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
    const x = /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1;
    if (x || y) return { el: n, x, y };
    if (n === stop) break;
  }
  return null;
}
function edgeSpeed(p: number, lo: number, hi: number): number {
  if (p < lo + EDGE) return -Math.ceil(MAX_STEP * Math.min(1, (lo + EDGE - p) / EDGE));
  if (p > hi - EDGE) return Math.ceil(MAX_STEP * Math.min(1, (p - (hi - EDGE)) / EDGE));
  return 0;
}

export type DropEffect = 'move' | 'copy' | 'link' | 'none';
/** What a drop target is told about the drag: the payload, the tab it came from, its label, the pointer. */
export type DragInfo = { payload: unknown; sourceTab: string | null; label?: string; point: { x: number; y: number } };
export type DropHandlers = {
  accepts?(info: DragInfo): boolean; over?(info: DragInfo, at: { x: number; y: number }): DropEffect | void;
  drop?(info: DragInfo, at: { x: number; y: number }): DropEffect | void; leave?(info: DragInfo): void;
};
export type DragResult = { dropped: boolean; effect: DropEffect; targetTab: string | null; cancelled?: boolean };
/** A content drag: what it carries, its label, an optional preview, and its end. */
export type DragSpec = { payload: unknown; label?: string; preview?(): Node | ComponentChildren; onEnd?(r: DragResult): void };
/** What the content drag needs from its workbench. */
export type ContentDragHost = {
  panelOf(el: Element): { el: Element; tabId: string; visible: boolean } | null;
  tabAt(el: Element): { el: Element; tabId: string; active: boolean } | null;
  activate(tabId: string): void; announce(text: string): void;
  emit(name: 'dragstart' | 'dragend', detail: DragInfo & Partial<DragResult>): void; springDelay(): number;
};
export type ContentDrag = {
  start(e: PointerEvent, spec: DragSpec, sourceTab?: string | null): PointerSession | null;
  dropTarget(el: Element, handlers: DropHandlers, tabId?: string | null): () => void;
  readonly active: DragInfo | null; readonly ghost: HTMLDivElement | null;
};
type Target = { handlers: DropHandlers; tabId: string | null; el: Element };
type Current = { spec: DragSpec; ghost: Ghost; target: Target | null; effect: DropEffect; spring: { tabId: string; el: Element; timer: ReturnType<typeof setTimeout> } | null;
  under: Element | null; raf: number; info: DragInfo };
/**
 * The content drag controller for one workbench. `wb` gives: panelOf(el) → { tabId, visible } | null,
 * tabAt(el) → { tabId, active } | null (a tab header), activate(tabId), announce(text).
 */
export function createContentDrag(wb: ContentDragHost): ContentDrag {
  const targets = new WeakMap<Element, Target>();      // element → { handlers, tabId }
  let current: Current | null = null;                 // the drag in progress

  function dropTarget(el: Element, handlers: DropHandlers, tabId: string | null = null) {
    targets.set(el, { handlers, tabId, el });
    return () => { if (targets.get(el)?.handlers === handlers) targets.delete(el); if (current?.target?.el === el) leave(); };
  }
  function leave() {
    const d = current;
    if (!d?.target) return;
    try { d.target.handlers.leave?.(d.info); } finally { d.target = null; d.effect = 'none'; d.ghost.effect('none'); }
  }
  /** The registered target at the point: the nearest ancestor of the topmost element, in a visible panel. */
  function hit(x: number, y: number): { t: Target | null; under: Element | null } {
    const els = document.elementsFromPoint(x, y);
    for (const top of els) {
      if (top.closest?.('[data-wb-ghost]')) continue;
      for (let n: Element | null = top; n; n = n.parentElement) {
        const t = targets.get(n);
        if (!t) continue;
        const p = wb.panelOf(n);
        if (p && !p.visible) continue;
        if (t.handlers.accepts && !t.handlers.accepts(current!.info)) continue;
        return { t, under: top };
      }
      return { t: null, under: top };
    }
    return { t: null, under: null };
  }
  function overAt(x: number, y: number) {
    const d = current!;
    d.info.point = { x, y };
    const { t, under } = hit(x, y);
    d.under = under;
    // spring-loading: a tab header that is not active, held for a moment
    const tab = under ? wb.tabAt(under) : null;
    if (tab && !tab.active) {
      if (d.spring?.tabId !== tab.tabId) {
        clearSpring();
        tab.el.setAttribute('data-spring', '');
        d.spring = { tabId: tab.tabId, el: tab.el, timer: setTimeout(() => { const s = d.spring; clearSpring(); if (current === d && s) { wb.activate(s.tabId); requestAnimationFrame(() => current === d && overAt(d.info.point.x, d.info.point.y)); } }, wb.springDelay()) };
      }
    } else clearSpring();
    if (d.target && d.target !== t) leave();
    if (t) {
      d.target = t;
      const e = t.handlers.over?.(d.info, { x, y }) || 'move';
      d.effect = e;
      d.ghost.effect(e);
    } else d.ghost.effect('none');
  }
  function clearSpring() {
    const s = current?.spring;
    if (!s) return;
    clearTimeout(s.timer);
    s.el.removeAttribute('data-spring');
    current!.spring = null;
  }
  function tick() {
    const d = current;
    if (!d) return;
    d.raf = requestAnimationFrame(tick);
    if (!d.under) return;
    const panel = wb.panelOf(d.under);
    if (!panel?.visible) return;
    const s = scroller(d.under, panel.el);
    if (!s) return;
    const r = s.el.getBoundingClientRect(), { x, y } = d.info.point;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    const vy = s.y ? edgeSpeed(y, r.top, r.bottom) : 0, vx = s.x ? edgeSpeed(x, r.left, r.right) : 0;
    if (!vx && !vy) return;
    const t0 = s.el.scrollTop, l0 = s.el.scrollLeft;
    s.el.scrollTop += vy; s.el.scrollLeft += vx;
    if (s.el.scrollTop !== t0 || s.el.scrollLeft !== l0) overAt(x, y);
  }

  /** Start a content drag from a pointerdown inside a view (the gesture begins after the threshold). */
  function start(e: PointerEvent, spec: DragSpec, sourceTab: string | null = null) {
    if (e.button != null && e.button !== 0) return null;
    const rect = (e.currentTarget as Element | null)?.getBoundingClientRect?.();
    const grab = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
    return pointerSession(e, {
      target: (e.currentTarget ?? e.target) as Element | null,
      onStart(ev) {
        const content = spec.preview ? spec.preview() : null;
        const ghost = createGhost(content ?? ghostChip(spec.label), content ? { dx: -Math.min(grab.x, 24), dy: -Math.min(grab.y, 12) } : {});
        current = { spec, ghost, target: null, effect: 'none', spring: null, under: null, raf: 0,
          info: { payload: spec.payload, sourceTab, label: spec.label, point: { x: ev.clientX, y: ev.clientY } } };
        document.documentElement.classList.add('wb-dragging');
        ghost.at(ev.clientX, ev.clientY);
        wb.announce(`Dragging ${spec.label ?? 'item'}`);
        wb.emit('dragstart', current.info);
        overAt(ev.clientX, ev.clientY);
        current.raf = requestAnimationFrame(tick);
      },
      onMove(ev) { current!.ghost.at(ev.clientX, ev.clientY); overAt(ev.clientX, ev.clientY); },
      onDrop(ev) {
        const d = current!;
        overAt(ev.clientX, ev.clientY);
        const t = d.target;
        let effect: DropEffect = d.effect, dropped = false;
        if (t && effect !== 'none') {
          effect = t.handlers.drop?.(d.info, { x: ev.clientX, y: ev.clientY }) || effect;
          dropped = effect !== 'none';
          d.target = null;
          try { t.handlers.leave?.(d.info); } catch { /* the drop redrew */ }
        }
        finish();
        wb.announce(dropped ? 'Dropped' : 'Cancelled');
        const result: DragResult = { dropped, effect: dropped ? effect : 'none', targetTab: dropped && t ? t.tabId : null };
        spec.onEnd?.(result);
        wb.emit('dragend', { ...d.info, ...result });
      },
      onCancel() {
        const d = current!;
        leave();
        finish();
        wb.announce('Cancelled');
        spec.onEnd?.({ dropped: false, effect: 'none', targetTab: null, cancelled: true });
        wb.emit('dragend', { ...d.info, dropped: false, cancelled: true });
      },
    });
  }
  function finish() {
    const d = current!;
    clearSpring();
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    endDragLook();
    current = null;
  }
  return { start, dropTarget, get active() { return current ? current.info : null; }, get ghost() { return current?.ghost.el ?? null; } };
}

/** The end of every drag (an item's and a content drag alike): the drag cursor goes; wb-dropped stays until the pointer
 *  moves again: WebKit keeps the captured tab hovered for a moment after the release, so a chip under the grab point
 *  would tint and fade (CSS keeps the chips off while either class is on). */
export function endDragLook(): void {
  const root = document.documentElement;
  if (!root.classList.replace('wb-dragging', 'wb-dropped')) return;
  addEventListener('pointermove', () => root.classList.remove('wb-dropped'), { once: true, capture: true });
}

/** The drag image's chip: an optional icon and the label. */
function ghostChip(label: string | undefined, icon: IconName | null = null): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'wb-ghost-chip';
  render(html`${icon ? html`<${Icon} name=${icon} />` : null}<span>${label ?? ''}</span>`, chip);
  return chip;
}
