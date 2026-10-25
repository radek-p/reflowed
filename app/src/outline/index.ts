// the sidebar's Outline as a Preact component (was app/panels.js drawOutline: the whole list rebuilt on every
// refresh). The rows are keyed, so a refresh (a compile landing, a number changing) changes only the rows that
// changed; the active row follows a signal.
//
// A registered view's content: <OutlinePanel ctx> draws the CURRENT document's outline
// (ctx.current: app/panel-host.ts) in whichever container hosts it, and acts through the document's commands:
//   a click          nav.scrollTo { id } (the app scrolls to the block, the anchor keeper holds it); the row active is
//                    the focused pane's section in view (host.lists.active, the crumbs' own): the jump's target until
//                    the reader scrolls
//   a drag (5 px)    block.moveSection { ids, to }: the section (its heading's block to the next heading of the same
//                    or a higher level), with a drop line between rows; special rows (Abstract, References) do not drag
//   the preamble     doc.settings (its entry above the sections, with its problems' count)
//                    on the same tab stops: its icon in the level-1 number column, its name at the level-1 tab
//   the pin (.ol-pin, on hover or focus): view.sectionFocus { id } (the focused pane on the section); on the focused
//                    section's row (.pinned) pin-off, which leaves it
//   Ctrl/Cmd+click, or the row's "Open … in a new tab" button (.ol-new, on hover or focus): ctx.openAt(doc, id), the
//                    section in a new tab, as the section menu's row action; only where the container can (openBeside)
// Classes (.outline, .ol-item.lvN, .ol-link, .ol-num, .ol-title, .ol-new, .active, .dragging, .ol-drop) are the ones
// app.css and the tests know. The list is the workbench kit's tab-stop list (workbench/src/kit/tabstops.ts; the section
// menu's too): one tab per level, the number right-aligned before it (a bullet, .wb-ts-bul, where none), the name after.
import { useRef } from 'preact/hooks';
import type { ReadonlySignal } from '@preact/signals';
import { html } from '../design/ui/core.js';
import { sectionBlocks, type OutlineItem } from '../doc/panels.ts';
import type { ViewContext } from '../design/ui/views.ts';
import type { PanelHost } from '../app/panel-host.ts';
import type { EditorRoot } from '../app/editor-root.ts';
import { kit } from '../../../workbench/src/index.ts';
import { Icon } from '../design/ui/icons.ts';

/** Keys: a block can hold more than one heading (their ids repeat): id + the n-th in that block. */
export function keyed(items: OutlineItem[]): { key: string; it: OutlineItem }[] {
  const seen = new Map<string, number>();
  return items.map((it) => { const n = seen.get(it.id) ?? 0; seen.set(it.id, n + 1); return { key: `${it.id}#${n}`, it }; });
}

type Drag = (e: PointerEvent, it: OutlineItem) => void;
const named = (it: OutlineItem): string => `${it.number ? `${it.number} ` : ''}${it.title}`;
/** a row's "Open … in a new tab" label (the section menu's too) */
export const newTabLabel = (it: OutlineItem): string => `Open ${named(it)} in a new tab`;
/** a row's pin: section focus on it, or (the focused one) leave it (the section menu's too) */
export const pinLabel = (it: OutlineItem, on: boolean): string => (on ? 'Leave focus mode' : `Focus on ${named(it)}`);
type Acts = { onNew: ((it: OutlineItem) => void) | null; onPin: (it: OutlineItem, on: boolean) => void };
function Row({ it, k, active, pinned, onJump, acts, onDrag }: { it: OutlineItem; k: number; active: boolean; pinned: boolean; onJump: (it: OutlineItem, e: MouseEvent) => void; acts: Acts; onDrag: Drag }) {
  const stop = (e: PointerEvent) => e.stopPropagation();     // (a press on a button is no drag)
  // its buttons: the pin (special rows have none: not a section to focus), then the new tab (Tab reaches them in that
  // order); they overlay the end of the name while shown (.wb-ts-acts, app.css)
  const btns = [
    it.special ? null : html`<${kit.IconButton} class="wb-row-btn ol-pin" icon=${pinned ? 'unfocus' : 'focus'} label=${pinLabel(it, pinned)} aria-pressed=${pinned ? 'true' : 'false'}
      onPointerDown=${stop} onClick=${() => acts.onPin(it, pinned)} />`,
    acts.onNew ? html`<${kit.IconButton} class="wb-row-btn ol-new" icon="newTab" label=${newTabLabel(it)} onPointerDown=${stop} onClick=${() => acts.onNew!(it)} />` : null,
  ].filter(Boolean);
  return html`<li class=${`ol-item wb-ts-sub lv${it.level}${it.special ? ' special' : ''}${active ? ' active' : ''}${pinned ? ' pinned' : ''}`} data-id=${it.id} data-k=${String(k)} data-ts-depth=${kit.tsDepth(it.level - 1)}
      style=${{ '--wb-ts-acts': String(btns.length) }} onPointerDown=${it.special ? undefined : (e: PointerEvent) => onDrag(e, it)}>
    <button class="ol-link wb-ts-sub wb-ts-main" title=${it.title} onClick=${(e: MouseEvent) => onJump(it, e)}>
      <${kit.TabMark} num=${it.number} class="ol-num" /><span class="ol-title wb-ts-name">${it.title}</span>
    </button>
    ${btns.length ? html`<span class="wb-ts-acts">${btns}</span>` : null}
  </li>`;
}

/** the preamble's entry, above the sections: not a section (no number, not dragged, not an .ol-item); on the
 *  list's tab stops: its icon in the level-1 number column, ending at the tab, its name from it */
function PreambleRow({ problems, open }: { problems: ReadonlySignal<number>; open: () => void }) {
  const n = problems.value;
  return html`<div class="ol-pre-row wb-ts-sub" data-ts-depth="0"><button type="button" class="ol-link ol-pre wb-ts-sub" onClick=${open}
      title=${n ? `Preamble: ${n} problem${n === 1 ? '' : 's'}` : 'Preamble: packages and macros every block shares'}>
    <span class="ol-pre-icon" aria-hidden="true"><${Icon.preamble} /></span><span class="ol-title wb-ts-name">Preamble</span>
    ${n ? html`<span class="ol-badge" aria-label=${`${n} problem${n === 1 ? '' : 's'}`}>${n}</span>` : null}
  </button></div>`;
}

function Outline({ items, active, pinned, onJump, acts, onDrag, pre }: {
  items: ReadonlySignal<OutlineItem[]>; active: ReadonlySignal<string | null>; pinned: () => string | null; onJump: (it: OutlineItem, e: MouseEvent) => void; acts: Acts;
  onDrag: (e: PointerEvent, it: OutlineItem, list: HTMLOListElement | null) => void; pre: { problems: ReadonlySignal<number>; open: () => void } | null;
}) {
  const list = items.value, act = active.value, pin = pinned(), ref = useRef<HTMLOListElement>(null);
  const head = pre ? html`<${PreambleRow} problems=${pre.problems} open=${pre.open} />` : null;
  if (!list.length) return html`${head}<p class="sb-empty">No sections yet. Headings (\\section…) appear here.</p>`;
  // one row active: the first item of the active block (a block with two headings marks its first)
  let activeKey: string | null = null;
  for (const { key, it } of keyed(list)) if (it.id === act) { activeKey = key; break; }
  // the preamble's row and the list: one grid (.wb-ts), so the two share the tab stops; the list a subgrid of it
  return html`<div class="ol-tabs wb-ts">${head}<ol ref=${ref} class="outline wb-ts-sub" aria-label="Outline">
    ${keyed(list).map(({ key, it }, k) => html`<${Row} key=${key} it=${it} k=${k} active=${key === activeKey} pinned=${!it.special && it.id === pin} onJump=${onJump} acts=${acts} onDrag=${(e: PointerEvent) => onDrag(e, it, ref.current)} />`)}
  </ol></div>`;
}

/** drag a section: the rows are gaps before each item and after the last; the drop moves the section's blocks */
function dragSection(e: PointerEvent, it: OutlineItem, list: HTMLOListElement | null, host: PanelHost, root: EditorRoot) {
  if (e.button !== 0 || !list) return;
  const li = e.currentTarget as HTMLElement;
  const items = host.lists.outline.peek();
  const start = { x: e.clientX, y: e.clientY };
  let active = false, target: number | null = null;
  const line = root.doc.body.appendChild(Object.assign(root.doc.createElement('div'), { className: 'ol-drop' }));   // this drag's
  const lis = [...list.querySelectorAll(':scope > .ol-item')];
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
    if (!active) { active = true; li.classList.add('dragging'); root.hold('dragging', li, true); }
    const rs = lis.map((x) => x.getBoundingClientRect());
    const gaps = rs.map((r) => r.top).concat([rs[rs.length - 1].bottom]);
    let best = 0;
    for (let k = 1; k < gaps.length; k++) if (Math.abs(gaps[k] - ev.clientY) < Math.abs(gaps[best] - ev.clientY)) best = k;
    target = best;
    const col = list.getBoundingClientRect();
    Object.assign(line.style, { display: 'block', top: `${gaps[best] + scrollY - 1}px`, left: `${col.left + scrollX}px`, width: `${col.width}px` });
  };
  // (a gesture's own window listeners: added on the press, removed when it ends)
  const up = (ev: PointerEvent) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    line.remove();
    li.classList.remove('dragging');
    root.hold('dragging', li, false);
    if (!active || target == null || ev.type === 'pointercancel') return;
    const blocks = host.blocks();
    const moving = sectionBlocks(blocks, items, it);
    const beforeId = target < items.length ? items[target].id : null;
    if (beforeId && moving.includes(beforeId) && beforeId !== moving[0]) return;       // into itself
    if (beforeId === moving[0]) return;
    const rest = blocks.filter((b) => !moving.includes(b.id));
    const to = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length;
    host.commands.call('block.moveSection', { ids: moving, to });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

/** the Outline view's content: the current document's outline (nothing while no document is open) */
export function OutlinePanel({ ctx }: { ctx: ViewContext<PanelHost, EditorRoot> }) {
  const host = ctx.current.value;
  if (!host) return null;
  const openAt = ctx.can.openBeside ? ctx.openAt : undefined;      // (the document read at the press: none yet at the first draw)
  const onNew = openAt ? (it: OutlineItem) => { if (host.docId) openAt(host.docId, it.id); } : null;
  const jump = (it: OutlineItem, e: MouseEvent) => {
    if ((e.ctrlKey || e.metaKey) && onNew) { onNew(it); return; }
    host.commands.call('nav.scrollTo', { id: it.id });
  };
  // the pin: section focus on the focused pane (view.sectionFocus); the row of the focused section leaves it. Its state
  // read when drawn, again on each change (root.state.sectionFocus)
  const onPin = (it: OutlineItem, on: boolean) => { host.commands.call('view.sectionFocus', { id: on ? null : it.id }); };
  const pinned = () => { void ctx.owner.state.sectionFocus.value; return host.focusedSection(); };
  const pre = host.preamble ? { problems: host.preamble.problems, open: () => { host.commands.call('doc.settings'); } } : null;
  return html`<${Outline} items=${host.lists.outline} active=${host.lists.active} pinned=${pinned} onJump=${jump} acts=${{ onNew, onPin }} pre=${pre}
    onDrag=${(e: PointerEvent, it: OutlineItem, list: HTMLOListElement | null) => dragSection(e, it, list, host, ctx.owner)} />`;
}
