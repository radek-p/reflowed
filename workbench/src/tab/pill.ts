// THE tab shell (TabPill): one of several tabs in a strip. The empty role=tab laid over the pill
// (the Tab stop, the name "document, section"), the parts (tab/parts.ts) as its visible content, and what being one
// of several tabs takes: activation, the press gates (data-nochip, CHIP_ARM, NAME_WAIT, the unfocused group, home),
// the drag, the context menu, the ×, pin and preview.
import { html } from '../html.ts';
import { Icon } from '../kit/icons.ts';
import { closeMenus } from '../kit/index.ts';
import { useUi, type Form } from '../ui-state.ts';
import { tabInfo, subtitleOf, switcherOf } from './info.ts';
import { startTabDrag, openTabMenu } from './actions.ts';
import { statusOf, StatusLayer, RenameField, ChipLine, DirtyDot } from './parts.ts';
import type { Workbench } from '../workbench.ts';
import type { Group, Tab } from '../model.ts';
import type { ChipEvent } from '../types.ts';

/** A double-click on the name renames the tab (as F2 and the menu). The switcher on the name of the focused active tab
 *  opens NAME_WAIT ms after the press, so a double-click never flashes it (a menu shown and closed again); 250 ms is
 *  shorter than any system's double-click interval but holds most double-clicks; a later second click still renames
 *  and closes the menu. Only the name waits: the section, the tabs and everything else respond at once. */
const NAME_WAIT = 250;
/** After the press that activates a tab its chips stay off (data-nochip) until the pointer moves this far from the press
 *  point, presses again or leaves the tab: the pointer is still on the name or section and must not light it at once. */
const CHIP_ARM = 5;
/** A tab's pill element and the point of the press that activated it (CHIP_ARM). */
type PressEl = HTMLElement & { _pressAt?: { x: number; y: number } | null };
function rearm(el: PressEl) { delete el.dataset.nochip; el._pressAt = null; }
/** The pending switcher of the latest press on a name (one at a time: a second press, a rename cancels it). */
let cancelName = (): void => {};
export function TabPill({ wb, t, g, selected, shared, form = null, compact = false }: { wb: Workbench; t: Tab; g: Group; selected: boolean; shared: boolean; form?: Form | null; compact?: boolean }) {
  const { label, icon } = tabInfo(wb, t), ui = useUi();
  const st = statusOf(wb, t);
  const dragging = wb.dnd.value?.tabId === t.id;
  const editing = wb.renaming.value === t.id;
  // every tab names its document and its own view's section, from the tab's state (no scanning): on two lines, or on
  // one ("Document › Section"; always in the top bar)
  const two = !compact && form === 'two';
  const sub = subtitleOf(wb, t);
  const name = sub?.label ? `${label}, ${sub.label}` : label;
  const sw = switcherOf(wb, t);       // the document switcher: the name's dropdown
  // an icon only for the few kinds that are not documents (home, lists, settings …: they stand out); a document tab
  // has none; when there is no room for 3 characters and "…" of its name, it shows the icon (never initials)
  const type = wb.viewType(t.view), showIcon = type?.tabIcon !== false;
  const down = (e: PointerEvent) => {
    const target = e.target as Element;
    if (e.button === 1) { e.preventDefault(); return; }
    if (e.button !== 0 || target.closest('.wb-tab-close')) return;
    e.preventDefault();
    // a press on the section line of the ACTIVE tab opens its menu (a pointer target inside the one tab element;
    // the keyboard has ↓ and the keymap's Ctrl+K S / Ctrl+K D)
    // a press there that does not move opens the menu; one that moves past the threshold drags the tab, as from
    // anywhere else on it
    // the same for the name: on the active tab it is the document switcher (a dropdown, like the section)
    // … only in the focused group: the first press on the active tab of another group focuses that group (and the
    // tab), as a press on an inactive tab activates it; a second press opens the menu (the group as rendered: the
    // root's capture handler has focused it already by now: it notes which group was focused before the press)
    // … and not while home shows there (its tabs look unfocused: css .wb-strip--home): the press closes home (activate)
    const groupOn = (ui.pressGroup ?? wb.layout.peek().active) === g.id && !wb.homeIn.peek().has(g.id); const el = e.currentTarget as PressEl, here = selected && groupOn, onSub = here && sub?.onSelect && target.closest('[data-sub]');
    const onName = here && sw && !onSub && target.closest('[data-name]');
    // this press activates: no chip now, nor until the pointer moves CHIP_ARM px from here, presses again, or leaves
    if (!here) { el.dataset.nochip = ''; el._pressAt = { x: e.clientX, y: e.clientY }; } else rearm(el);
    if (!onSub && !onName) { wb.activate(t.id, { focus: 'content' }); wb.flushFocusSoon(); }
    const open = onSub ? () => { const a = el.querySelector('[data-sub]') ?? el; sub!.onSelect!({ currentTarget: a, anchor: a }); }
      : onName ? () => { cancelName(); cancelName = wb.later(NAME_WAIT, () => { if (!el.isConnected) return; const a = el.querySelector('[data-name]') ?? el; sw!.onSelect({ currentTarget: a, anchor: a }); }); } : null;
    startTabDrag(e, wb, t, label, icon, open);
  };
  const chipMove = (e: PointerEvent) => { const el = e.currentTarget as PressEl, p = el._pressAt; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CHIP_ARM) rearm(el); };
  const aux = (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); wb.close(t.id); } };
  const closeClick = (e: Event) => { e.stopPropagation(); if (t.pinned) wb.pin(t.id, false); else { wb.close(t.id); wb.flushFocusSoon(); } };
  // the active tab's controls (its document chip, section chip and ×) are role=button siblings of the role=tab element,
  // never inside it: Enter or Space does what a click does, ↓ opens a chip's dropdown (a menu button);
  // Escape in the dropdown brings the focus back to the chip
  const chipKey = (act: (e: KeyboardEvent) => void, down = false) => (e: KeyboardEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !(e.key === 'Enter' || e.key === ' ' || (down && e.key === 'ArrowDown'))) return;
    e.preventDefault(); e.stopPropagation(); act(e);
  };
  const openChip = (it: { onSelect?(e: ChipEvent): void }) => (e: Event) => { const a = e.currentTarget as Element; it.onSelect?.({ currentTarget: a, anchor: a, returnFocus: a }); };
  const control = (on: unknown, name: string, act: ((e: Event) => void) | null | undefined | false, down: boolean) => (on ? { role: 'button', tabindex: '0', 'aria-label': name, 'aria-haspopup': down ? 'grid' : undefined, onKeyDown: chipKey(act || (() => {}), down) } : { 'aria-hidden': 'true' });
  const nameAttrs = control(selected && sw, `Switch document: ${label}`, sw && openChip(sw), true);
  const secAttrs = control(selected && sub?.onSelect, `Go to ${(sub?.kind ?? 'Section').toLowerCase()}: ${sub?.label}`, sub?.onSelect && openChip(sub), true);
  const closeAttrs = control(selected, `${t.pinned ? 'Unpin' : 'Close'} ${label}`, closeClick, false);
  const cls = `wb-tab${st.layer ? ' wb-tab--status' : ''}${st.unsaved ? ' wb-tab--st-slot' : ''}${selected ? ' wb-tab--on' : ''}${sub?.label ? ' wb-tab--sec' : ''}${t.preview ? ' wb-tab--preview' : ''}${t.pinned ? ' wb-tab--pinned' : ''}${dragging ? ' wb-tab--dragging' : ''}`;
  // the pill is a plain wrapper: its first child is THE tab (role=tab, empty, laid over the pill: the Tab stop, the
  // keyboard's ring, the name "document, section"), then the visible parts, hidden from the accessibility tree except
  // the active tab's controls, which follow the tab in DOM order
  const tip = [sub?.label ? `${label}\n${sub.title ?? sub.label}` : label, ...(st.tips ?? [])].join('\n');
  // the name stays "document, section": the status is its description, so a screen reader does not read the whole
  // name again whenever a run starts or ends
  const said = t.pinned ? `${name}, pinned` : name, status = st.words?.length ? st.words.join(', ') : undefined;
  return html`<div class=${cls} data-tab=${t.id} title=${tip}
      onPointerDown=${down} onPointerLeave=${(e: PointerEvent) => rearm(e.currentTarget as PressEl)} onPointerMove=${chipMove} onAuxClick=${aux} onDblClick=${(e: MouseEvent) => { if (t.preview) { wb.keep(t.id); return; } if ((e.target as Element).closest('[data-name], .wb-tab-label') && wb.canRename(t.id)) { cancelName(); closeMenus(); wb.activate(t.id); wb.rename(t.id); } }}
      onContextMenu=${(e: MouseEvent) => { e.preventDefault(); openTabMenu(wb, t.id, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }); }}>
    <div class="wb-tab-tab" role="tab" id=${`${t.id}-tab`} aria-selected=${selected ? 'true' : 'false'} aria-controls=${`${t.id}-panel`} tabindex="0"
      aria-label=${said} aria-description=${status} aria-haspopup=${sub?.onSelect || sw ? 'grid' : undefined} aria-keyshortcuts=${sub?.onSelect ? 'ArrowDown' : undefined}></div>
    ${showIcon ? html`<span class="wb-tab-icon" aria-hidden="true"><${Icon} name=${icon} /></span>` : null}
    ${showIcon ? null : html`<span class="wb-tab-tinyicon" aria-hidden="true"><${Icon} name=${icon} /></span>`}
    <${ChipLine} two=${two} shared=${shared} label=${label} sub=${sub} switcher=${!!sw} nameAttrs=${nameAttrs} secAttrs=${secAttrs} />
    ${editing ? html`<${RenameField} wb=${wb} tabId=${t.id} value=${label} />` : null}
    <span class="wb-tab-close" data-close=${t.id} title=${t.pinned ? 'Unpin' : 'Close'} onClick=${closeClick}
      onPointerDown=${(e: PointerEvent) => e.stopPropagation()} ...${closeAttrs}><${Icon} name=${t.pinned ? 'pin' : 'close'} />${st.unsaved ? html`<${DirtyDot} />` : null}</span>
    ${st.layer ? html`<${StatusLayer} s=${st.layer} />` : null}
  </div>`;
}
