// The sidebars: tool-window panels (Outline, Problems, Files, References …) in a LEFT and a RIGHT
// column, apart from the document groups (VS Code's primary and secondary sidebars). A column holds a vertical stack
// of panel groups, as many as the user makes: the document groups' split tree with column splits only, placed, split
// and resized by the same code (ui.js groupStyle, separators, Separator); each group has its tabs (labels, icons when
// narrow) above its active panel. A panel dropped on a group's strip moves into it (an insertion bar), on its upper or
// lower half becomes a new group above or below it; an empty group collapses. Hiding a column is the ReflowEd app's
// mechanism (sidebar-chrome.js and the top bar): a hide button in the column, a show button where the strip
// begins (or ends, for the right), Ctrl/⌘ \ (and Shift for the right); hidden means fully gone (no rail). The
// slide is a transform; the groups are laid out once, at its start (hiding) or its end (showing), between
// resizestart and resizeend (no reflow per frame).
// NARROW WINDOWS (phones): at most OVERLAY_MAX_W px wide (a width rule, any narrow window, no
// user-agent test) a shown column FLOATS over the main area (an overlay with a scrim): the documents keep their full
// width and their lines when it opens or closes (no resizestart/resizeend: nothing to lay out). It closes on a tap on
// the scrim, Escape, or its toggle. Its panels and tabs are as in a wide window. sideOverlay: that width rule, live;
// hosts start with the columns closed while it holds (app/src/wb/host.ts).
// A column's width: the user's (its edge dragged), else its default (model.ts sideWidth: a share of the width within px
// bounds its panels' types give, the whole width as an overlay; else SIDE_SIZE); a double-click on the edge goes back to
// the default. A panel whose type has panel.onClose is closable:
// a close button on its tab and Close in its menu call it.
import { useLayoutEffect, useRef, type MutableRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { html } from './html.ts';
import { Icon } from './kit/icons.ts';
import * as M from './model.ts';
import { insertX, insertIndex, startItemDrag } from './drag.ts';
import { openMenu, IconButton, btnClass, type MenuAnchor } from './kit/index.ts';
import { groupStyle, separators, Separator, splitterDrag, splitterKey, type SplitTree } from './split.ts';
import type { Workbench } from './workbench.ts';
import { useUi } from './ui-state.ts';
import type { PanelHint, ViewType } from './types.ts';
import type { Box, Layout, PanelGroup, SideName } from './model.ts';
import type { IconName } from './kit/icons.ts';
import { reducedMotion } from './motion.ts';

import { rove } from './ui-keys.ts';
import { oneLine } from './strip.ts';

const NAME: Record<SideName, string> = { left: 'Left', right: 'Right' };
export const SIDE_MIN = M.SIDE_MIN;
/** the widest window whose side columns float over the main area (css.ts uses the same number) */
export const OVERLAY_MAX_W = 640;
const OVERLAY_Q = `(max-width: ${OVERLAY_MAX_W}px)`;
const mq = typeof matchMedia === 'function' ? matchMedia(OVERLAY_Q) : null;
/** true while the window is narrow enough for the columns to float (live) */
export const sideOverlay = signal(!!mq?.matches);
mq?.addEventListener?.('change', (e) => { sideOverlay.value = e.matches; });
/** an overlay column's widest share of the window, as in css.ts */
const OVERLAY_SHARE = 0.85;
/** A column's stack for the shared Separator: its tree, its groups' attribute, a panel group's least height. */
const stackOf = (side: SideName): SplitTree<PanelGroup> => ({ of: (L: Layout) => M.sides(L)[side].root, attr: 'data-pgroup', min: 80 });
const sideMax = (root: Element | null) => Math.max(SIDE_MIN, Math.round((root?.getBoundingClientRect().width ?? 1200) * 0.45));
const widthOf = (wb: Workbench, sd: M.Column) => M.sideWidth(sd, (id) => wb.viewType(id)?.panel?.width);

function info(wb: Workbench, id: string): { label: string; icon: IconName; badge: ReturnType<NonNullable<ViewType['badge']>> | null; close: (() => void) | null } {
  const t = wb.viewType(id), onClose = t?.panel?.onClose;
  return { badge: t?.badge?.() ?? null, close: onClose ? () => onClose() : null, label: t ? (t.title?.(wb.layout.peek().panelState?.[id] ?? {}) ?? t.label ?? id) : `${id} (not available)`, icon: t ? (typeof t.icon === 'function' ? t.icon({}) : t.icon) ?? 'list' : 'missing' };
}

/** The show button of a hidden column (the app's sidebar toggle): null while the column is shown or empty. */
/** always: the window bar's toggle (shown whether the column is open or not, pressed when open), as the IDEs' title bars. */
export function SideToggle({ wb, side, always = false, slot = false }: { wb: Workbench; side: SideName; always?: boolean; slot?: boolean }) {
  const sd = wb.sides.value[side];
  if (!M.sidePanels(sd).length) return null;
  // (slot) the top bar's: always there, its slot shrinking to nothing while the column is open (unseen, inert)
  if (slot) {
    const open = !sd.collapsed, keys = wb.shortcut('toggleSide', side);
    return html`<span class=${`wb-bar-slot wb-bar-slot--${side}`} data-open=${String(open)} inert=${open} aria-hidden=${open ? 'true' : undefined}>
      <${IconButton} class=${`wb-side-toggle wb-side-toggle--${side}`} data-action=${`show-${side}`} data-toggle=${open ? undefined : side} icon=${side === 'left' ? 'sidebarLeft' : 'sidebarRight'}
        label=${`Show ${side} panel`} tip=${`Show ${side} panel${keys ? ` (${keys})` : ''}`} tabindex=${open ? -1 : undefined} onClick=${() => wb.toggleSide(side)} /></span>`;
  }
  if (!always && !sd.collapsed) return null;
  const keys = wb.shortcut('toggleSide', side), verb = sd.collapsed ? 'Show' : 'Hide';
  return html`<${IconButton} class=${`wb-side-toggle wb-side-toggle--${side}`} data-action=${`${sd.collapsed ? 'show' : 'hide'}-${side}`} icon=${side === 'left' ? 'sidebarLeft' : 'sidebarRight'}
    label=${`${verb} ${side} panel`} tip=${`${verb} ${side} panel${keys ? ` (${keys})` : ''}`} aria-pressed=${always ? String(!sd.collapsed) : undefined} data-toggle=${side}
    onClick=${() => wb.toggleSide(side)} />`;
}

const SLIDE_MS = 220;      // a column opening or closing: its room, the main area's edge and the bar's move together

export function Side({ wb, side, root }: { wb: Workbench; side: SideName; root: MutableRef<HTMLDivElement | null> }) {
  const ui = useUi();
  const sd = wb.sides.value[side];
  wb.layout.value;      // re-render on layout changes (panel state may change titles)
  const width = widthOf(wb, sd);
  const floats = sideOverlay.value;
  const aside = useRef<HTMLElement>(null), was = useRef(sd.collapsed), anim = useRef<Animation | null>(null), stop = useRef<(() => void) | null>(null);
  // the slide (hide: the groups take the room at once, the column slides out over them; show: it slides in over
  // them, and they give the room back at its end): one layout of the groups, never one per frame
  useLayoutEffect(() => {
    const el = aside.current;
    if (!el || was.current === sd.collapsed) { was.current = sd.collapsed; return; }
    was.current = sd.collapsed;
    stop.current?.();          // a slide under way ends here, with its resizeend (the motions nest: a lost one held them for good)
    // the column's ROOM animates (its width, in the flow): the main area's edge and the top bar in it move with it,
    // continuously; the column's content keeps its width and slides (clipped at the column's edge). The documents
    // keep their lines during the motion (the hosts pin on resizestart) and are laid out at the end.
    const hiding = sd.collapsed;
    // (an overlay: its width over the main area, which keeps its own: no resizestart / resizeend, nothing to lay out)
    const areaW = el.parentElement?.getBoundingClientRect().width ?? 1200;
    const W = Math.min(M.sidePx(width, areaW, floats), areaW * (floats ? (width.share != null ? 1 : OVERLAY_SHARE) : 0.45));
    el.classList.add('wb-side--sliding');
    el.style.setProperty('--wb-slide-w', `${W}px`);
    if (!floats) wb.emit('resizestart', { side, how: hiding ? 'hide' : 'show' });
    const reduced = reducedMotion();
    const a = el.animate(hiding ? [{ width: `${W}px` }, { width: '0px' }] : [{ width: '0px' }, { width: `${W}px` }],
      { duration: reduced || wb.booting ? 0 : SLIDE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    anim.current = a;
    let over = false;
    const done = () => { if (over) return; over = true; if (stop.current === done) stop.current = null; if (anim.current === a) anim.current = null; a.cancel(); el.classList.remove('wb-side--sliding'); el.style.removeProperty('--wb-slide-w'); if (!floats) wb.emit('resizeend', { side, how: hiding ? 'hide' : 'show' }); };
    stop.current = done;
    a.finished.then(done, done);
  }, [sd.collapsed]);
  // an open overlay: Escape closes it (unless something inside took the key: a menu, a field's own Escape)
  const floating = floats && !sd.collapsed && M.sidePanels(sd).length > 0;
  useLayoutEffect(() => {
    if (!floating) return undefined;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); wb.toggleSide(side); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [floating]);
  const area = useRef<HTMLDivElement>(null);
  const tree = useRef<SplitTree<PanelGroup> | null>(null);
  tree.current ??= stackOf(side);
  if (!M.sidePanels(sd).length) return null;
  const T = { root: sd.root }, B = M.boxes(T);
  const style = { '--wb-side-w': M.sideCss(width, floats) };
  // the scrim of an open overlay: a tap on it closes the column and does nothing else (closed on its click, so the tap's
  // click cannot land on what the scrim covered)
  const scrim = floating ? html`<div class=${`wb-side-scrim wb-side-scrim--${side}`} data-scrim=${side} aria-hidden="true"
    onPointerDown=${(e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); }} onClick=${(e: MouseEvent) => { e.stopPropagation(); wb.toggleSide(side); }} />` : null;
  return html`${scrim}<aside ref=${aside} class=${`wb-side wb-side--${side}${sd.collapsed ? ' wb-side--hidden' : ''}${floats ? ' wb-side--overlay' : ''}${floats && width.share != null ? ' wb-side--full' : ''}`} data-side=${side} style=${style}
      aria-label=${`${NAME[side]} sidebar`} inert=${sd.collapsed} aria-hidden=${sd.collapsed ? 'true' : undefined}>
    <div class="wb-side-groups" ref=${area}>
      ${M.sideGroups(sd).map((g) => html`<${Pane} key=${g.id} wb=${wb} side=${side} g=${g} box=${B.get(g.id)!} collapsed=${sd.collapsed} />`)}
      ${separators(T, B).map((x) => html`<${Separator} key=${x.key} wb=${wb} s=${x} root=${area} tree=${tree.current} label=${`Resize the ${side} sidebar’s groups`} />`)}
    </div>
    ${side === 'left' && ui.sideStatus ? html`<div class="wb-side-status" role="group" aria-label="Status">${ui.sideStatus()}</div>` : null}
    <${SideSeparator} wb=${wb} side=${side} width=${width} root=${root} aside=${aside} />
  </aside>`;
}

/** A strip's panel tabs share its width evenly (1/n, the document tab strip's one-line rule: strip.ts oneLine) while each
 *  gets its minimum: its label's width (the widest label: an even split holds them all), else as icons, each at least the
 *  kit's icon-button box (--wb-btn-h); below that they keep it and the strip scrolls. The labels are measured each time
 *  (laid out at their own widths, no paint between), with the one-line rule's band against flicker. */
function fitTabs(el: HTMLElement) {
  const tabs = [...el.querySelectorAll<HTMLElement>('[data-ptab]')], n = tabs.length;
  if (!n) return;
  const labelled = !el.hasAttribute('data-compact');
  el.removeAttribute('data-compact');
  el.setAttribute('data-measure', '');
  const need = Math.ceil(Math.max(...tabs.map((t) => t.getBoundingClientRect().width)));
  el.removeAttribute('data-measure');
  el.style.setProperty('--wb-tab-min', `${need}px`);
  if (oneLine(el, el.clientWidth, n, parseFloat(getComputedStyle(el).columnGap) || 0, labelled)) return;
  el.style.removeProperty('--wb-tab-min');
  el.setAttribute('data-compact', '');
}

function HideButton({ wb, side }: { wb: Workbench; side: SideName }) {
  // a chevron toward the panel's outer edge (‹ for the left panel, › for the right); the bar's open button keeps the sidebar icon
  const keys = wb.shortcut('toggleSide', side);
  return html`<${IconButton} class=${`wb-side-hide wb-side-hide--${side}`} data-action="collapse" data-toggle=${side} icon=${side === 'left' ? 'chevronLeft' : 'chevronRight'}
    label=${`Hide ${side} panel`} tip=${`Hide ${side} panel${keys ? ` (${keys})` : ''}`} onClick=${() => wb.toggleSide(side)} />`;
}

/** One group of panels in a column, placed as a document group is (its snapped box): its tabs above, its panels
 *  below; while a panel is dragged, the insertion bar in its strip or the half of its body it would take. */
function Pane({ wb, side, g, box, collapsed }: { wb: Workbench; side: SideName; g: PanelGroup; box: Box; collapsed: boolean }) {
  const panels = useRef<HTMLDivElement>(null), pane = useRef<HTMLElement>(null);
  // the tabs with their labels when they fit, else as icons (with their names as labels): measured with the labels first, on
  // every draw (a label, a badge, a tab came or went) and when the column's width changes
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { fitTabs(strip.current!); });
  useLayoutEffect(() => { const el = strip.current!, ro = new ResizeObserver(() => fitTabs(el)); ro.observe(el); return () => ro.disconnect(); }, []);
  useLayoutEffect(() => { wb.syncSide(side, g.id, panels.current!); }, [g, collapsed]);
  useLayoutEffect(() => () => wb.parkPanels(panels.current!), []);
  const d = wb.pdnd.value, hint = d && 'side' in d ? d : null;
  const here = hint?.side === side && hint.group === g.id;
  const bar = here && hint.index != null ? hint.x : null;
  const zone = here && hint.index == null ? hint.where ?? null : null;
  const first = box.y < M.EPS;
  const key = (e: KeyboardEvent) => {
    const ids = g.panels, i = ids.indexOf((e.target as Element).closest?.<HTMLElement>('[data-ptab]')?.dataset.ptab ?? '');
    if (i < 0) return;
    const to = rove(ids, i, e);
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); openPanelMenu(wb, ids[i]!, (e.target as Element).closest('[data-ptab]')!); return; }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wb.showPanel(ids[i]!, { focus: true }); return; }
    if (to) {
      e.preventDefault();
      wb.showPanel(to);
      const t = to;
      requestAnimationFrame(() => pane.current?.querySelector<HTMLElement>(`[data-ptab="${CSS.escape(t)}"]`)?.focus({ preventScroll: true }));
    }
  };
  return html`<section ref=${pane} class="wb-side-pane" id=${`wbg-${g.id}`} data-pgroup=${g.id} data-top=${String(first)} style=${groupStyle(box)}>
    <div class="wb-side-strip">
      ${first && side === 'right' ? html`<${HideButton} wb=${wb} side=${side} />` : null}
      <div ref=${strip} class="wb-ptabs" role="tablist" aria-label=${`${NAME[side]} sidebar, panels`} onKeyDown=${key}>
        ${g.panels.map((id) => { const p = info(wb, id), on = id === g.active; return html`<div key=${id} role="tab" class=${`${btnClass()} wb-ptab`} id=${`side-${id}-tab`}
          data-ptab=${id} aria-selected=${on ? 'true' : 'false'} aria-controls=${`side-${id}-panel`} tabindex="0" title=${p.label} aria-label=${p.label}
          onPointerDown=${(e: PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); wb.showPanel(id); startPanelDrag(e, wb, id, p); }}
          onContextMenu=${(e: MouseEvent) => { e.preventDefault(); openPanelMenu(wb, id, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }); }}>
          <span class="wb-ptab-icon"><${Icon} name=${p.icon} /></span><span class="wb-ptab-label">${p.label}</span>${p.badge?.n ? html`<span class="wb-ptab-badge" data-tone=${p.badge.tone ?? undefined} title=${p.badge.title || undefined}>${String(p.badge.n)}</span>` : null}${p.close ? html`<${IconButton} class="wb-ptab-close" data-action="close-panel" icon="close" label=${`Close ${p.label}`} tabindex="-1"
            onPointerDown=${(e: PointerEvent) => e.stopPropagation()} onClick=${(e: MouseEvent) => { e.stopPropagation(); p.close!(); }} />` : null}</div>`; })}
        ${bar != null ? html`<div class="wb-insert" style=${{ left: `${bar}px` }}></div>` : null}
      </div>
      ${first && side === 'left' ? html`<${HideButton} wb=${wb} side=${side} />` : null}
    </div>
    <div class="wb-side-body" data-pbody=${g.id}><div class="wb-panels" ref=${panels}></div>
      ${zone ? html`<div class="wb-zone" data-zone=${`side-${zone}`} style=${PZONES[zone]}></div>` : null}</div>
  </section>`;
}
// a panel group's body halves (the document groups' top and bottom zones; no side-by-side panel groups)
const PZONES: Record<'top' | 'bottom', Record<string, string>> = {
  top: { left: '4px', top: '4px', width: 'calc(100% - 8px)', height: 'calc(50% - 6px)' },
  bottom: { left: '4px', top: 'calc(50% + 2px)', width: 'calc(100% - 8px)', height: 'calc(50% - 6px)' },
};

/** During a panel drag: at the edge of the main area of a hidden or empty column, a top and a bottom zone (a new group
 *  at the column's top or bottom). */
export function EdgeZones({ wb }: { wb: Workbench }) {
  const pd = wb.pdnd.value;
  if (!pd) return null;
  const d: Partial<PanelHint> = pd;
  // only for a column that is hidden or empty: an open column is its own target
  const S = wb.sides.peek();
  const closed = M.SIDEBARS.filter((s) => S[s].collapsed || !M.sidePanels(S[s]).length);
  return html`${closed.map((s) => html`<div key=${s} class=${`wb-edge wb-edge--${s}`}>
    ${['top', 'bottom'].map((h) => html`<div key=${h} class=${`wb-edge-half${d.side === s && d.edge && d.where === h ? ' is-over' : ''}`} data-edge=${s} data-edge-half=${h}>
      <span>${`${s} ${h}`}</span></div>`)}</div>`)}`;
}

// ── the panel drag: the window splits in halves: left of its middle is the left column, right of it the right one
//    (over a column: that column). Over a group's tabs: into that group, at an index (the insertion bar). Elsewhere the
//    pointer's height picks the column's group, and the upper or lower half of its body: a new group above or below it
//    (the half previewed in that group, wherever the pointer is across). A hidden or empty column shows its edge zone:
//    a new group at the column's top or bottom. Every zone is offered: a drop that changes nothing is a no-op. ──
export function panelHint(wb: Workbench, id: string, x: number, y: number): PanelHint | null {
  const L = wb.layout.peek(), root = wb.root();
  if (!root) return null;
  const R = root.getBoundingClientRect();
  if (x < R.left || x > R.right || y < R.top || y > R.bottom) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-wb-ghost]')) continue;
    const strip = el.closest('.wb-ptabs');
    if (strip && root.contains(strip)) {
      const side = strip.closest<HTMLElement>('[data-side]')!.dataset.side as SideName, group = strip.closest<HTMLElement>('[data-pgroup]')!.dataset.pgroup!;
      const tabs = [...strip.querySelectorAll('[data-ptab]')];
      const index = insertIndex(tabs, x);
      return { id, side, group, index, x: insertX(strip as HTMLElement, tabs, index) };
    }
    break;
  }
  const over = document.elementsFromPoint(x, y).find((e) => !e.closest('[data-wb-ghost]'))?.closest?.<HTMLElement>('aside[data-side]');
  const side: SideName = over && root.contains(over) ? over.dataset.side as SideName : x < R.left + R.width / 2 ? 'left' : 'right';
  const sd = M.sides(L)[side];
  if (sd.collapsed || !M.sidePanels(sd).length) return { id, side, group: null, index: null, where: y < R.top + R.height / 2 ? 'top' : 'bottom', edge: true };
  const bodies = [...root.querySelectorAll<HTMLElement>(`aside[data-side="${side}"] [data-pbody]`)].map((b) => ({ group: b.dataset.pbody!, r: b.getBoundingClientRect() }));
  const b = bodies.find((x) => y < x.r.bottom) ?? bodies.at(-1);
  if (!b) return null;
  return { id, side, group: b.group, index: null, where: y < b.r.top + b.r.height / 2 ? 'top' : 'bottom' };
}
function startPanelDrag(e: PointerEvent, wb: Workbench, id: string, p: { label: string; icon: IconName }): void {
  startItemDrag<PanelHint>(e, { label: p.label, icon: p.icon,
    start() { wb.pdnd.value = { id }; wb.announce(`Moving panel ${p.label}`); wb.emit('paneldragstart', { id }); },
    hint: (x, y) => panelHint(wb, id, x, y),
    show(h) { if (JSON.stringify(wb.pdnd.peek()) !== JSON.stringify(h ?? { id })) wb.pdnd.value = h ?? { id }; },
    drop(h) { wb.pdnd.value = null; if (h) wb.dropPanel(id, h); wb.emit('paneldragend', { id, dropped: !!h, hint: h }); },
    cancel() { wb.pdnd.value = null; wb.emit('paneldragend', { id, dropped: false, cancelled: true }); },
  });
}

export function openPanelMenu(wb: Workbench, id: string, anchor: MenuAnchor) {
  const L = wb.layout.peek(), d = M.dockOf(L, id);
  if (!d) return null;
  const other = d.side === 'left' ? 'right' : 'left';
  const alone = M.sideGroups(M.sides(L)[d.side]).find((g) => g.id === d.group)!.panels.length === 1;
  const onClose = wb.viewType(id)?.panel?.onClose;
  return openMenu(anchor, [
    ...(onClose ? [{ id: 'close-panel', label: 'Close', onSelect: () => onClose() }, { separator: true as const }] : []),
    { id: `move-${other}`, label: `Move to the ${other} side`, onSelect: () => wb.movePanel(id, other) },
    { id: 'split-down', label: 'Move to a new group below', disabled: alone, onSelect: () => wb.splitPanel(id, d.side, d.group, 'bottom') },
    { separator: true },
    { id: 'hide-side', label: `Hide the ${d.side} sidebar`, shortcut: wb.shortcut('toggleSide', d.side), onSelect: () => wb.collapseSide(d.side, true) },
  ], { label: 'Panel actions' });
}

// ── the column's resize handle (its inner edge): pointer, keyboard, double-click resets (to its default width) ──
function SideSeparator({ wb, side, width, root, aside }: { wb: Workbench; side: SideName; width: M.SideWidth; root: MutableRef<HTMLDivElement | null>; aside: MutableRef<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const dirSign = side === 'left' ? 1 : -1;
  const clamp = (v: number) => Math.max(SIDE_MIN, Math.min(sideMax(root.current), v));
  const begin = (how: string) => wb.emit('resizestart', { side, how });
  const finish = (how: string) => wb.emit('resizeend', { side, how, size: M.sidePx(widthOf(wb, M.sides(wb.layout.peek())[side]), root.current?.getBoundingClientRect().width ?? 1200) });
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const w0 = aside.current!.getBoundingClientRect().width, set = (px: number) => aside.current!.style.setProperty('--wb-side-w', `${px}px`);
    let w = w0;
    splitterDrag(e, ref.current!, root.current!, 'row', {
      start: () => begin('pointer'),
      move: (dx) => { w = clamp(w0 + dirSign * dx); },
      paint: () => set(w),
      drop: () => { wb.resizeSide(side, w); set(Math.round(w)); finish('pointer'); },
      cancel: () => { aside.current!.style.setProperty('--wb-side-w', M.sideCss(width)); finish('pointer'); },
    });
  };
  const key = (e: KeyboardEvent) => {
    const k = splitterKey(e, 'row'), cur = aside.current!.getBoundingClientRect().width;
    if (k === 'reset') { e.preventDefault(); e.stopPropagation(); reset(); return; }
    const v = k == null ? null : k === 'start' ? SIDE_MIN : k === 'end' ? sideMax(root.current) : cur + dirSign * k;
    if (v == null) return;
    e.preventDefault(); e.stopPropagation();
    begin('keyboard'); wb.resizeSide(side, clamp(v)); finish('keyboard');
  };
  const reset = () => { begin('reset'); wb.resetSide(side); finish('reset'); };
  const max = sideMax(root.current);
  return html`<div ref=${ref} class=${`wb-sep wb-side-sep wb-side-sep--${side}`} role="separator" tabindex="0" aria-orientation="vertical"
    aria-label=${`Resize the ${side} sidebar`} aria-valuenow=${Math.min(M.sidePx(width, root.current?.getBoundingClientRect().width ?? 1200), max)} aria-valuemin=${SIDE_MIN} aria-valuemax=${max}
    onPointerDown=${down} onKeyDown=${key} onDblClick=${reset}></div>`;
}
