// A tab's actions as one of several tabs (the tab shell's: tab/pill.ts and the strip): its drag (reorder, move, split by
// edge) with the drop hint, and its context menu.
import type { IconName } from '../kit/icons.ts';
import * as M from '../model.ts';
import { insertX, insertIndex, startItemDrag } from '../drag.ts';
import { openMenu, type MenuAnchor, type MenuEntry } from '../kit/index.ts';
import type { Workbench } from '../workbench.ts';
import type { Tab } from '../model.ts';
import type { TabDnd, TabHint } from '../types.ts';

// ── the tab drag: reorder, move, split by edge ──
/** Where a tab dropped at (x, y) would go: { tabId, group, kind: 'strip', index, x } | { …, kind: 'body', side } | null. */
export function tabHint(wb: Workbench, tabId: string, x: number, y: number): TabHint | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest('[data-wb-ghost]')) continue;
    const root = el.closest('.wb-root');
    if (!root || root !== wb.root()) return null;
    const strip = el.closest<HTMLElement>('.wb-strip');
    if (strip) {
      const gid = strip.dataset.stripGroup!;      // the group's row or the top bar's slot: the same strip
      const box = strip.querySelector<HTMLElement>('.wb-tabs')!;
      const tabs = [...box.querySelectorAll('[data-tab]')];
      const index = insertIndex(tabs, x);
      return { tabId, group: gid, kind: 'strip', index, x: insertX(box, tabs, index) };
    }
    const body = el.closest<HTMLElement>('.wb-body');
    if (body) {
      const gid = body.dataset.body!;
      // the zones start under the group's strip (the body runs under its glass); --wb-top is a calc(), so the strip's box
      const b0 = body.getBoundingClientRect(), st = body.parentElement?.querySelector(':scope > .wb-strip:not([hidden])')?.getBoundingClientRect();
      const top = st && st.height ? Math.max(0, st.bottom - b0.top) : 0;
      const r = { left: b0.left, width: b0.width, top: b0.top + top, height: b0.height - top };
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
      let side: (typeof M.SIDES)[number] | null = null, best = 0.25;
      for (const k of M.SIDES) if (d[k] < best) { best = d[k]; side = k; }
      return { tabId, group: gid, kind: 'body', side };
    }
    return null;
  }
  return null;
}
export function startTabDrag(e: PointerEvent, wb: Workbench, t: Tab, label: string, icon: IconName, onClick: (() => void) | null = null): void {
  startItemDrag<TabHint>(e, { label, icon, onClick,
    start() { wb.dnd.value = { tabId: t.id, kind: null }; wb.announce(`Moving tab ${label}`); wb.emit('tabdragstart', { tabId: t.id }); },
    hint: (x, y) => tabHint(wb, t.id, x, y),
    show(h) { if (!same(wb.dnd.peek(), h)) wb.dnd.value = h ?? { tabId: t.id, kind: null }; },
    drop(h) {
      wb.dnd.value = null;
      if (h) wb.dropTab(t.id, h);     // commits only a change, activates and focuses the tab (workbench.ts dropTab)
      wb.emit('tabdragend', { tabId: t.id, dropped: !!h, hint: h });
    },
    cancel() { wb.dnd.value = null; wb.emit('tabdragend', { tabId: t.id, dropped: false, cancelled: true }); },
  });
}
const same = (a: TabDnd | null, b: TabHint | null) => (a?.kind ?? null) === (b?.kind ?? null) && a?.group === b?.group && a?.index === b?.index && a?.side === b?.side && a?.x === b?.x;

// ── the tab context menu (the kit's Menu on the kit's overlay layer) ──
export function openTabMenu(wb: Workbench, tabId: string, anchor: MenuAnchor) {
  const L = wb.layout.peek();
  const g = M.groupOf(L, tabId), t = M.findTab(L, tabId);
  if (!g || !t) return null;
  const done = (f: () => void) => () => { f(); wb.flushFocusSoon(); };
  const i = g.tabs.indexOf(t), many = M.groups(L).length > 1;
  const items: MenuEntry[] = [
    ...(wb.canRename(tabId) ? [{ id: 'rename', label: 'Rename…', shortcut: 'F2', onSelect: () => wb.rename(tabId) }] : []),
    { id: 'close', label: 'Close', shortcut: wb.shortcut('close'), onSelect: done(() => wb.close(tabId)) },
    { id: 'close-others', label: 'Close others', disabled: g.tabs.every((x) => x === t || x.pinned), onSelect: done(() => wb.closeOthers(tabId)) },
    { id: 'close-right', label: 'Close to the right', disabled: g.tabs.slice(i + 1).every((x) => x.pinned), onSelect: done(() => wb.closeRight(tabId)) },
    { separator: true },
    // no Pin item: it cluttered the menu (useful only with very many documents); wb.pin and its key stay
    ...(t.preview ? [{ id: 'keep', label: 'Keep open', onSelect: done(() => wb.keep(tabId)) }] : []),
    { id: 'split-right', label: 'Split right', shortcut: wb.shortcut('splitRight'), onSelect: done(() => wb.split(tabId, 'right', g.id)) },
    { id: 'split-down', label: 'Split down', shortcut: wb.shortcut('splitDown'), onSelect: done(() => wb.split(tabId, 'bottom', g.id)) },
    ...(many ? [{ id: 'maximize', label: L.maximized ? 'Restore group' : 'Maximise group', shortcut: wb.shortcut('maximize'), onSelect: done(() => wb.toggleMaximize(g.id)) }] : []),
    { separator: true },
    { id: 'reopen', label: 'Reopen closed tab', shortcut: wb.shortcut('reopen'), disabled: !wb.closedCount, onSelect: done(() => wb.reopen()) },
  ];
  return openMenu(anchor, items, { label: 'Tab actions' });
}
