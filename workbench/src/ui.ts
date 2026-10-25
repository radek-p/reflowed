// The workbench's components: groups placed absolutely from the layout's fractions (so a
// change of the tree's shape never remounts a group, and panels never leave the page), tab strips, separators,
// the tab drag (reorder, move, split by edge) and the tab context menu. The root carries the workbench's own overlay
// scrollbars (overlay-scrollbar.ts: its listeners, for every scroller inside it).
import { Component, type ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import { html } from './html.ts';
import * as M from './model.ts';
import { WorkbenchContext, TabContext, type Workbench, type BarSpec } from './workbench.ts';
import { Side, EdgeZones } from './sides.ts';
import { UiContext, newUiState } from './ui-state.ts';
import { groupStyle, separators, Separator, EPS } from './split.ts';
import { WindowBar } from './bar.ts';
import { TabStrip } from './strip.ts';
import { subtitleOf, switcherOf } from './tab/info.ts';
import { watchOverlayScrollbars } from './overlay-scrollbar.ts';
import type { Box, Group } from './model.ts';

// ── the workbench ──
/**
 * bar: { left?, right? } (functions returning vnodes): a window bar above the groups, as the editor's top bar. With one
 * tab the bar IS the tab bar: it carries the document's header (its crumbs) between the host's controls; with more,
 * the tabs appear in a row below it. sideStatus: () => vnode: a small status bar at the bottom of the LEFT column,
 * below its stacked groups (it hides with the column), as VS Code's status bar.
 */
/** The keymap's section menu and document switcher (Ctrl+K S, Ctrl+K D) on the focused group's active tab. */
function openTabMenuKind(wb: Workbench, kind: 'section' | 'document', tabId: string): boolean {
  const t = M.findTab(wb.layout.peek(), tabId), el = wb.root()?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabId)}"]`);
  if (!t || !el) return false;
  const it = kind === 'section' ? subtitleOf(wb, t) : switcherOf(wb, t);
  if (!it?.onSelect) return false;
  const a = el.querySelector(kind === 'section' ? '[data-sub]' : '[data-name]') ?? el;
  it.onSelect({ currentTarget: a, anchor: a, returnFocus: el.querySelector('[role="tab"]') });
  return true;
}
/** macOS (iPadOS Safari in desktop mode says Mac too) draws a rim over a window's outermost pixel: the root keeps a
 *  1 px edge in the page's colour there (css: --wb-edge-inset), so the gaps are measured from inside the rim */
const EDGE_RIM = typeof navigator !== 'undefined' && /mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '');
export type WorkbenchProps = { wb: Workbench; label?: string; bar?: BarSpec | null; sideStatus?: (() => ComponentChildren) | null; class?: string };
export function Workbench({ wb, label = 'Workbench', bar = null, sideStatus = null, class: cls = '' }: WorkbenchProps) {
  // the UI's own state (ui-state.ts), never fields on the store; the host's bar and status slot are its props
  const ui = useMemo(newUiState, []);
  ui.bar = bar; ui.sideStatus = sideStatus;
  const L = wb.layout.value;
  const B = M.boxes(L);
  const gs = M.groups(L);
  const root = useRef<HTMLDivElement>(null), park = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null), area = useRef<HTMLDivElement>(null);
  // the container attaches as its root element is placed (a ref: before any layout effect of its groups, which mount the
  // views), again when it gains or loses its window bar, and detaches when it goes
  const attachTo = useCallback((el: HTMLDivElement | null) => {
    root.current = el;
    if (el) wb.attach(el, { park: park.current, bar: !!bar, tabMenu: (kind, tabId) => openTabMenuKind(wb, kind, tabId) });
  }, [!!bar]);
  useLayoutEffect(() => () => wb.detach(root.current ?? undefined), []);
  useLayoutEffect(() => (root.current ? watchOverlayScrollbars(root.current) : undefined), []);     // the bars over its views
  useLayoutEffect(() => { wb.afterRender(); });
  const max = L.maximized;
  // (integrated) one tab in all: no strip; the view fills the area with its breadcrumbs as its header
  // with a window bar: one group's tabs may sit in it (inbar); without one: one tab is the one-document view (solo)
  const bg = bar ? M.barGroup(L) : null;     // the group spanning the top edge: its strip may sit in the bar (0 tabs too)
  const inbar = !!bg && wb.inbar.value;
  const solo = !bar && wb.solo.value;
  // which side columns are shown, as classes on the root (was a :has() on the root, which made every change
  // ); the same test as Side's (sides.ts)
  const SD = wb.sides.value, shown = (s: 'left' | 'right') => !SD[s].collapsed && M.sidePanels(SD[s]).length > 0;
  const track = (e: Event) => {
    if (e.type === 'pointerdown') ui.pressGroup = wb.layout.peek().active;
    const g = (e.target as Element).closest?.<HTMLElement>('[data-group]');
    if (g?.dataset.group && g.dataset.group !== wb.layout.peek().active && root.current!.contains(g)) wb.focusGroup(g.dataset.group, { focus: false });
  };
  return html`<${UiContext.Provider} value=${ui}><div ref=${attachTo} class=${`wb-root${max ? ' wb-root--max' : ''}${solo ? ' wb-root--solo' : ''}${EDGE_RIM ? ' wb-root--edge-rim' : ''}${shown('left') ? ' wb-root--left-shown' : ''}${shown('right') ? ' wb-root--right-shown' : ''}${bar ? ' wb-root--bar' : ''}${inbar ? ' wb-root--inbar' : ''}${gs.length > 1 ? ' wb-root--groups' : ''} ${cls}`} role="group" aria-label=${label}
      onKeyDown=${(e: KeyboardEvent) => wb.handleKey(e)} onKeyUp=${(e: KeyboardEvent) => wb.keyup(e)} onfocusin=${track} onPointerDownCapture=${track}>
    <${Side} wb=${wb} side="left" root=${root} />
    <div class="wb-main" ref=${main}>
    ${bar ? html`<${WindowBar} wb=${wb} bar=${bar} inbar=${inbar} />` : null}
    <div class="wb-groups" ref=${area}>
    ${gs.map((g, i) => html`<${GroupBox} key=${g.id} wb=${wb} g=${g} index=${i} box=${max === g.id ? { x: 0, y: 0, w: 1, h: 1 } : B.get(g.id)!}
      active=${L.active === g.id} off=${!!max && max !== g.id} isMax=${max === g.id} many=${gs.length > 1} solo=${solo || (inbar && g.id === bg?.id)} inbarGroup=${inbar && g.id === bg?.id} />`)}
    ${separators(L, B).map((s) => html`<${Separator} key=${s.key} wb=${wb} s=${s} root=${area} />`)}
    <${EdgeZones} wb=${wb} />
    </div>
    </div>
    <${Side} wb=${wb} side="right" root=${root} />
    <div class="wb-park" ref=${park} aria-hidden="true"></div>
    <div class="wb-sr" aria-live="polite">${wb.announcement.value}</div>
  </div><//>`;
}

// ── a group: strip + body (memoised on its node and box: structural sharing keeps untouched groups still) ──
type GroupProps = { wb: Workbench; g: Group; index: number; box: Box; active: boolean; off: boolean; isMax: boolean; many: boolean; solo: boolean; inbarGroup?: boolean };
class GroupBox extends Component<GroupProps> {
  override shouldComponentUpdate(p: GroupProps) {
    const q = this.props;
    return p.g !== q.g || p.index !== q.index || p.active !== q.active || p.off !== q.off || p.isMax !== q.isMax || p.many !== q.many || p.solo !== q.solo
      || p.box.x !== q.box.x || p.box.y !== q.box.y || p.box.w !== q.box.w || p.box.h !== q.box.h;
  }
  override render(p: GroupProps) { return html`<${GroupView} ...${p} />`; }
}
function GroupView({ wb, g, index, box, active, off, isMax, many, solo, inbarGroup = false }: GroupProps) {
  const panels = useRef<HTMLDivElement>(null), strip = useRef<HTMLDivElement>(null), wasSolo = useRef(solo);
  useLayoutEffect(() => { wb.syncPanels(g, panels.current!, !off, solo); }, [g, off, solo]);
  // the strip comes in with a short reveal when a second tab opens (not at load)
  useLayoutEffect(() => {
    if (wasSolo.current && !solo && strip.current) {
      const s = strip.current;
      s.classList.add('wb-strip--reveal');
      s.addEventListener('animationend', () => s.classList.remove('wb-strip--reveal'), { once: true });
    }
    wasSolo.current = solo;
  }, [solo]);
  useLayoutEffect(() => () => wb.parkPanels(panels.current!), []);
  const hint = wb.dnd.value;
  const zone = hint && hint.kind === 'body' && hint.group === g.id ? hint.side ?? 'center' : null;
  const homeOn = wb.homeIn.value.has(g.id);
  const cls = `wb-group${active ? ' wb-group--active' : ''}${homeOn ? ' wb-group--home' : ''}${inbarGroup ? ' wb-group--inbar' : ''}${off ? ' wb-group--off' : ''}${isMax ? ' wb-group--max' : ''}`;
  return html`<section class=${cls} id=${`wbg-${g.id}`} data-group=${g.id} data-left=${String(box.x < EPS)} data-top=${String(box.y < EPS)} data-right=${String(box.x + box.w > 1 - EPS)}
      style=${groupStyle(box)} inert=${off} aria-label=${`Group ${index + 1}`}>
    <${TabStrip} host="row" wb=${wb} g=${g} index=${index} isMax=${isMax} many=${many} hidden=${solo} stripRef=${strip} lead=${box.x < EPS && box.y < EPS} trail=${box.x + box.w > 1 - EPS && box.y < EPS} />
    <div class="wb-body" data-body=${g.id}>
      <div class="wb-panels" ref=${panels} inert=${homeOn && g.tabs.length > 0}></div>
      ${g.tabs.length ? (homeOn ? html`<${HomeBody} wb=${wb} g=${g} over=${g.active} />` : null) : html`<${HomeBody} wb=${wb} g=${g} />`}
      ${zone ? html`<div class="wb-zone" data-zone=${zone} style=${ZONES[zone]}></div>` : null}
    </div>
  </section>`;
}
// the zones start under the strip (the body runs under it: the strip is glass)
const T = 'var(--wb-top, 0px)';
const ZONES: Record<'center' | 'left' | 'right' | 'top' | 'bottom', Record<string, string>> = {
  center: { left: '4px', top: `calc(${T} + 4px)`, width: 'calc(100% - 8px)', height: `calc(100% - ${T} - 8px)` },
  left: { left: '4px', top: `calc(${T} + 4px)`, width: 'calc(50% - 6px)', height: `calc(100% - ${T} - 8px)` },
  right: { left: 'calc(50% + 2px)', top: `calc(${T} + 4px)`, width: 'calc(50% - 6px)', height: `calc(100% - ${T} - 8px)` },
  top: { left: '4px', top: `calc(${T} + 4px)`, width: 'calc(100% - 8px)', height: `calc((100% - ${T}) / 2 - 6px)` },
  bottom: { left: '4px', top: `calc(${T} + (100% - ${T}) / 2 + 2px)`, width: 'calc(100% - 8px)', height: `calc((100% - ${T}) / 2 - 6px)` },
};

/** The home panel: an empty group's content (only the root can be one), or shown over a group's active tab when its
 *  home toggle is pressed (`over`: that tab; a document opened here replaces it, or opens in a new tab; the panel closes). */
function HomeBody({ wb, g, over = null }: { wb: Workbench; g: Group; over?: string | null }) {
  const type = wb.viewType(wb.home);
  // over a tab T (the top bar's one tab): open replaces T; open beside adds a tab (the store's homeContext)
  const ctx = useMemo(() => wb.homeContext(g.id, over), [g.id, over]);
  if (!type) return html`<div class="wb-home" tabindex="-1"></div>`;
  return html`<div class=${`wb-home${over ? ' wb-home--over' : ''}`} data-home=${g.id} data-home-over=${over ? '' : undefined} tabindex="-1"><${WorkbenchContext.Provider} value=${wb}><${TabContext.Provider} value=${ctx}>
    <${type.Component} tab=${ctx.tab.value} ctx=${ctx} /><//><//></div>`;
}

// the parts other modules and hosts use, from where they live now
export { groupStyle, separators, Separator, type SplitTree, type SeparatorSpec, type BoxStyle } from './split.ts';
export { TabStrip, oneLine, fitTabs, FIT_IN, FIT_OUT } from './strip.ts';
export { WindowBar, barItems, MARK_IN } from './bar.ts';
export { tabHint, openTabMenu } from './tab/actions.ts';
export { RenameField } from './tab/parts.ts';
/** The menus: the control library (kit/menu.ts). openRowMenu: the old name of openSelect. */
export { openMenu, openSelect, openSelect as openRowMenu } from './kit/index.ts';
