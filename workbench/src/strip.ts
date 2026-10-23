// THE tab strip: one implementation (the tabs, drag, keyboard, menus, fit, truncation, colours) for both
// hosts, the top bar's slot and a group's row; the one- or two-line form (decided per strip row, with hysteresis).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { html } from './html.ts';
import * as M from './model.ts';
import { Button, IconButton, openSelect } from './kit/index.ts';
import { SideToggle } from './sides.ts';
import { useUi, type Form, type StripEntry } from './ui-state.ts';
import { textWidth } from './measure.ts';
import { TabPill } from './tab/pill.ts';
import { tabInfo, subtitleOf } from './tab/info.ts';
import { openTabMenu } from './tab/actions.ts';
import type { Workbench } from './workbench.ts';
import type { Group } from './model.ts';
import { reducedMotion } from './motion.ts';
import { rove } from './ui-keys.ts';

// ── the strip ──
/** THE tab strip: one implementation (the tabs, drag, keyboard, menus, fit, truncation, colours) for both hosts, the
 *  top bar's slot (host="bar": the compact one-line form, the bar's size tokens) and a group's row (host="row").
 *  single (the bar in a narrow window, bar.ts): the active tab alone, with all the room; the others behind a count
 *  after it (the group's tabs as a Select: a row activates its tab). */
export type TabStripProps = { wb: Workbench; g: Group; index: number; isMax: boolean; many: boolean; hidden: boolean; stripRef: RefObject<HTMLDivElement>; lead?: boolean; trail?: boolean; host?: 'bar' | 'row'; single?: boolean };
export function TabStrip({ wb, g, index, hidden, stripRef, lead, trail, host = 'row', single = false }: TabStripProps) {
  const inbar = host === 'bar', ui = useUi();
  const tabs = useRef<HTMLDivElement>(null);
  const form = useHybridForm(wb, g, tabs, !inbar);      // in the top bar: always the compact one-line form
  useLayoutEffect(() => {
    const s = tabs.current, t = s?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!s || !t || s.scrollWidth - s.clientWidth <= 1) { if (s) s.scrollLeft = 0; return; }     // no real overflow (a sub-pixel one at 1/n): never scroll
    if (t.offsetLeft < s.scrollLeft) s.scrollLeft = t.offsetLeft;
    else if (t.offsetLeft + t.offsetWidth > s.scrollLeft + s.clientWidth) s.scrollLeft = t.offsetLeft + t.offsetWidth - s.clientWidth;
  }, [g.active, g.tabs.length]);
  // narrowing (every form, both hosts): truncate first; the icon only below 3 characters and "…" of the name. One
  // observer for the strip's life over its tabs (re-observed when the tabs change); the fit again when a label,
  // the active tab (its × shows) or the form changes
  const fitRo = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (tabs.current) fitTabs(tabs.current); });
    fitRo.current = ro;
    return () => { ro.disconnect(); fitRo.current = null; };
  }, []);
  const ids = g.tabs.map((t) => t.id).join();
  useLayoutEffect(() => {
    const s = tabs.current, ro = fitRo.current;
    if (!s || !ro) return;
    ro.disconnect();
    for (const e of s.querySelectorAll('[data-tab]')) ro.observe(e);
  }, [ids]);
  const labels = g.tabs.map((t) => `${tabInfo(wb, t).label}\u0000${subtitleOf(wb, t)?.label ?? ''}\u0000${t.pinned ? 1 : 0}`).join('\u0001');
  useLayoutEffect(() => { if (tabs.current) fitTabs(tabs.current); }, [ids, labels, g.active, form, inbar]);
  // the tabs move, they never jump (both hosts): a tab opened, closed or dropped elsewhere in the strip, the others
  // go to their new places and widths. Each tab's box is read on the store's 'change' (before the render), then:
  //   - opened or closed: the widths animate from the old to the new (a new tab grows from 0 and fades in; the gap a
  //     closed tab leaves closes on its neighbour's margin): the flex lays the tabs out from those, so their places
  //     follow continuously, a few frames of layout in one small box;
  //   - reordered: transform only (FLIP), the widths are the same.
  // Not on the first layout (a mount, a restore), not when the tabs change hosts (moveTabs moves them), not under
  // reduced motion.
  const boxes = useRef<{ inbar: boolean; gap: number; order: string[]; rects: Map<string, DOMRect> } | null>(null);
  useLayoutEffect(() => wb.on('change', () => {
    const s = tabs.current;
    boxes.current = s && s.getBoundingClientRect().width > 0 ? { inbar: wb.inbar.peek(), gap: parseFloat(getComputedStyle(s).columnGap) || 0,
      order: [...s.querySelectorAll<HTMLElement>('[data-tab]')].map((e) => e.dataset.tab!), rects: new Map([...s.querySelectorAll<HTMLElement>('[data-tab]')].map((e) => [e.dataset.tab!, e.getBoundingClientRect()])) } : null;
  }) as () => void, []);
  const lastIds = useRef(ids);
  useLayoutEffect(() => {
    const was = boxes.current, prevIds = lastIds.current, s = tabs.current;
    lastIds.current = ids; boxes.current = null;
    if (!was || prevIds === ids || !s || hidden || wb.booting || was.inbar !== wb.inbar.peek() || s.getBoundingClientRect().width === 0
      || single || reducedMotion()) return;     // (single: one tab drawn, with all the room: nothing to divide)
    const opts = { duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
    const els = [...s.querySelectorAll<HTMLElement>('[data-tab]')], now = els.map((e) => e.dataset.tab!);
    const added = now.filter((id) => !was.rects.has(id)), removed = was.order.filter((id) => !now.includes(id));
    if (!added.length && !removed.length) {
      // reordered: FLIP by transform
      for (const e of els) { const from = was.rects.get(e.dataset.tab!), to = e.getBoundingClientRect(); if (from && Math.abs(from.left - to.left) > 0.5) e.animate([{ transform: `translateX(${from.left - to.left}px)` }, { transform: 'none' }], opts); }
      wb.emit('tabsmove', { group: g.id, how: 'reorder' });
      return;
    }
    const fix = { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' };     // widths held out of the flex (every engine animates width)
    for (const e of els) {
      const id = e.dataset.tab!, from = was.rects.get(id), to = e.getBoundingClientRect().width;
      if (!from) { e.animate([{ ...fix, width: '0px', opacity: 0, marginRight: `${-was.gap}px` }, { ...fix, width: `${to}px`, opacity: 1, marginRight: '0px' }], opts); continue; }
      if (Math.abs(from.width - to) > 0.5) e.animate([{ ...fix, width: `${from.width}px` }, { ...fix, width: `${to}px` }], opts);
    }
    // a closed tab's room closes on the tab after it (or, the last one, on the tab before it)
    for (const id of removed) {
      const r = was.rects.get(id)!, i = was.order.indexOf(id);
      const next = was.order.slice(i + 1).find((x) => now.includes(x)), prev = [...was.order.slice(0, i)].reverse().find((x) => now.includes(x));
      const room = `${r.width + was.gap}px`;
      if (next) s.querySelector(`[data-tab="${CSS.escape(next)}"]`)?.animate([{ marginLeft: room }, { marginLeft: '0px' }], opts);
      else if (prev) s.querySelector(`[data-tab="${CSS.escape(prev)}"]`)?.animate([{ marginRight: room }, { marginRight: '0px' }], opts);
    }
    wb.emit('tabsmove', { group: g.id, how: added.length ? 'open' : 'close' });
    if (inbar) wb.emit('tabsdivide', { group: g.id });
  }, [ids]);
  const hint = wb.dnd.value;
  const bar = hint && hint.kind === 'strip' && hint.group === g.id ? hint.x : null;
  const key = (e: KeyboardEvent) => {
    const ids = g.tabs.map((t) => t.id), target = e.target as HTMLElement;
    const i = ids.indexOf(target.closest?.<HTMLElement>('[data-tab]')?.dataset.tab ?? '');
    if (i < 0) return;
    const id = ids[i]!;     // (a chord's second key never comes here: the keymap takes it first, workbench.js pendingKey)
    if (target.getAttribute('role') !== 'tab') {     // the active tab's controls: their own keys (Tab: chipKey); the tab menu from any
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); openTabMenu(wb, id, target); }
      return;
    }
    const to = rove(ids, i, e);
    if (to) { e.preventDefault(); wb.activate(to, { focus: 'tab' }); return; }
    if (e.key === 'Delete') { e.preventDefault(); wb.close(id); wb.flushFocusSoon(); return; }
    else if (e.key === 'F2' && wb.canRename(id)) { e.preventDefault(); wb.rename(id); return; }
    else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); openTabMenu(wb, id, target); return; }
    else if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); wb.activate(id, { focus: 'content' }); return; }
    else if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // the tab's popup (aria-haspopup="grid"): ↓ opens its section menu, as a combobox opens its list (the keymap's
      // chord too: Ctrl+K S / ⌘K S; Alt+↓ is gone, macOS keeps Option+↓)
      const t = g.tabs[i]!, sub = subtitleOf(wb, t), el = target, open = sub?.onSelect;
      if (open) { e.preventDefault(); if (id !== g.active) wb.activate(id); requestAnimationFrame(() => { const a = wb.root()?.querySelector(`[data-tab="${CSS.escape(id)}"] [data-sub]`) ?? el; open.call(sub, { currentTarget: a, anchor: a, returnFocus: el }); }); }
      return;
    }
  };
  const wheel = (e: WheelEvent) => {
    const s = tabs.current;
    if (!s) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && s.scrollWidth > s.clientWidth) { s.scrollLeft += e.deltaY; e.preventDefault(); }
  };
  const dbl = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-tab], button')) wb.toggleHome(g.id, true); };
  // a document open in several tabs of this group: its name is shared, so it steps back and the sections lead
  const titles = new Map<string, number>();
  for (const t of g.tabs) { const l = tabInfo(wb, t).label; titles.set(l, (titles.get(l) ?? 0) + 1); }
  // the focused group's strip: its active tab's dropdowns (and their chips) live there only. Read here, not in each
  // Tab: a Tab subscribed to the layout re-rendered under an open rename field and lost its edit
  const focusedG = wb.layout.value.active === g.id;
  const drawn = single ? g.tabs.filter((t) => t.id === g.active) : g.tabs;
  const others = (e: MouseEvent) => {
    const btn = e.currentTarget as HTMLElement;
    openSelect(btn, g.tabs.map((t) => { const sub = subtitleOf(wb, t)?.label; return { id: t.id, label: sub ? `${tabInfo(wb, t).label} › ${sub}` : tabInfo(wb, t).label, active: t.id === g.active, onSelect: () => wb.activate(t.id, { focus: 'content' }) }; }),
      { label: 'Tabs', returnFocus: btn });
  };
  return html`<div class=${`wb-strip${inbar ? ' wb-strip--inbar' : ''}${focusedG ? ' wb-strip--focused' : ''}${wb.isHome(g.id) ? ' wb-strip--home' : ''}`} data-strip-group=${g.id} data-host=${inbar ? 'bar' : 'row'} ref=${stripRef} hidden=${hidden} onDblClick=${dbl}>
    ${lead && !ui.bar ? html`<${SideToggle} wb=${wb} side="left" />` : null}
    ${/* home: the group's own toggle, the first stop, outside the scrolling tabs (pinned at the leading edge) */ ''}<${IconButton} class="wb-home-btn" data-action="home" icon="home" label="Home"
      aria-pressed=${String(wb.isHome(g.id))} aria-controls=${`wbg-${g.id}`} tip=${`Home${wb.shortcut('home') ? ` (${wb.shortcut('home')})` : ''}`}
      onClick=${() => wb.toggleHome(g.id)} />
    <div class="wb-tabs" data-form=${form ?? undefined} role="tablist" aria-label=${`Group ${index + 1}`} aria-orientation="horizontal" ref=${tabs} onKeyDown=${key} onWheel=${wheel}>
      ${drawn.map((t) => html`<${TabPill} key=${t.id} wb=${wb} t=${t} g=${g} selected=${t.id === g.active} shared=${(titles.get(tabInfo(wb, t).label) ?? 0) > 1} form=${form} compact=${inbar} />`)}
      ${bar != null ? html`<div class="wb-insert" style=${{ left: `${bar}px` }}></div>` : null}
    </div>
    ${single && g.tabs.length > 1 ? html`<${Button} class="wb-tabs-count" data-action="tabs" aria-haspopup="grid" aria-label=${`${g.tabs.length} tabs: show all`} tip=${`${g.tabs.length} tabs`} onClick=${others}>${g.tabs.length}<//>` : null}
    <div class="wb-strip-actions">${trail && !ui.bar ? html`<${SideToggle} wb=${wb} side="right" />` : null}</div>
  </div>`;
}

// ── the header (d, the only one): the tabs share the strip (each 1/n); one line ("Document › Section") while every
//    tab gets the minimum, else two lines for all of them; decided per group, with hysteresis; the switch is a FLIP
//    of the texts (the strip and the tabs keep their boxes) ──
/** One line (or the top bar) while every tab gets the minimum: n × --wb-tab-min + (n − 1) gaps within `room` (the
 *  room for tabs: after home and the leading items, before the trailing ones). Never the text: a longer name or
 *  section truncates inside its tab. The band (per tab): out when a tab's share falls below the minimum + FIT_OUT,
 *  back in from the minimum + FIT_IN; `now`: the form now (true = one line, in the bar). */
export function oneLine(el: Element, room: number, n: number, gap: number, now: boolean): boolean {
  const min = parseFloat(getComputedStyle(el).getPropertyValue('--wb-tab-min')) || 0;
  const per = (room - gap * (n - 1)) / n;
  return per - min >= (now ? FIT_OUT : FIT_IN);
}
export const FIT_OUT = 0;     // one line → two (or the top bar → its row) when a tab's share falls below the minimum
export const FIT_IN = 8;      // two lines → one (or the row → the top bar) from the minimum + this
/** Per tab: the name's minimum (--wb-name-min: its first 3 characters and "…", measured in its font: one line keeps
 *  it while the name and the section share the shrinking), the one-line section's minimum and floor (--wb-sec-min,
 *  --wb-sec-floor: css.ts, the section yields first), and "tiny" when the text box (the × counted as shown:
 *  hovering never changes the state) is narrower than that: the icon instead. Tiny happens in two lines (one line
 *  gives every tab --wb-tab-min); 4 px of hysteresis. */
export function fitTabs(strip: Element): void {
  for (const tab of strip.querySelectorAll<HTMLElement>('[data-tab]')) {
    const box = tab.querySelector('.wb-tab-text, .wb-tab-line') ?? tab.querySelector('.wb-tab-label'), lab = tab.querySelector('.wb-tab-label');
    if (!box || !lab) continue;
    const x = tab.querySelector('.wb-tab-close'), xs = x && getComputedStyle(x);
    const xRoom = xs?.display === 'none' ? parseFloat(xs.width) + parseFloat(xs.marginLeft) + parseFloat(xs.marginRight) + (parseFloat(getComputedStyle(tab).columnGap) || 0) : 0;
    const min = Math.ceil(textWidth(`${(lab.textContent ?? '').trim().slice(0, 3)}…`, getComputedStyle(lab).font)), was = tab.dataset.fit === 'tiny';
    const tiny = box.getBoundingClientRect().width - xRoom < min + (was ? 4 : 0);
    tab.style.setProperty('--wb-name-min', `${min + 1}px`);
    const sec = tab.querySelector('.wb-tab-line > .wb-tab-sec');
    if (sec) {
      // one line: the section's minimum (its number, its first 3 characters and "…") and floor (its number and "…")
      const cs = getComputedStyle(sec), font = cs.font, num = sec.querySelector('.wb-tab-num')?.textContent?.trim() ?? '';
      const numW = num ? textWidth(num, font) + (parseFloat(cs.columnGap) || 0) : 0, text = (sec.querySelector('.wb-tab-sec-text')?.textContent ?? '').trim();
      const sMin = Math.ceil(numW + textWidth(`${text.slice(0, 3)}…`, font));
      tab.style.setProperty('--wb-sec-min', `${sMin + 1}px`);
      tab.style.setProperty('--wb-sec-floor', `${(num ? Math.ceil(numW + textWidth('…', font)) : sMin) + 1}px`);
    }
    if (tiny !== was) { if (tiny) tab.dataset.fit = 'tiny'; else delete tab.dataset.fit; }
  }
}
type HybEntry = StripEntry;
function useHybridForm(wb: Workbench, g: Group, tabsRef: RefObject<HTMLElement>, on: boolean): Form | null {
  const ui = useUi();
  const [form, setForm] = useState<Form>('one');
  const formRef = useRef<Form>(form), flip = useRef<{ id: string; name?: DOMRect; sec?: DOMRect; chev?: DOMRect }[] | null>(null), flipStrip = useRef<{ h?: number; views: [Element, number][] } | null>(null);
  formRef.current = form;
  // this group's own wish, from its form now (the hysteresis)
  const own = (): Form | null => {
    const box = tabsRef.current;
    if (!on || !box || !g.tabs.length || !box.clientWidth) return null;
    const cs = getComputedStyle(box);
    return oneLine(box, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), g.tabs.length, parseFloat(cs.columnGap) || 0, formRef.current === 'one') ? 'one' : 'two';
  };
  const apply = (next: Form) => {
    const box = tabsRef.current;
    if (!box || next === formRef.current) return;
    // the texts' places now, to move them from there (FLIP) once the other form is drawn
    const grp = box.closest('.wb-group'), strip = box.closest('.wb-strip');
    flipStrip.current = { h: strip?.getBoundingClientRect().height, views: [...(grp?.querySelectorAll('.wb-panel:not(.wb-panel--hidden) .wb-view') ?? [])].map((v): [Element, number] => [v, v.getBoundingClientRect().top + parseFloat(getComputedStyle(v).paddingTop)]) };
    flip.current = [...box.querySelectorAll<HTMLElement>('[data-tab]')].map((t) => ({ id: t.dataset.tab!, name: t.querySelector('.wb-tab-label')?.getBoundingClientRect(), sec: t.querySelector('.wb-tab-sub-label, .wb-tab-sec')?.getBoundingClientRect(), chev: t.querySelector('.wb-tab-chev')?.getBoundingClientRect() }));
    if (wb.booting) { flip.current = null; flipStrip.current = null; }     // the first layout: placed, not animated
    formRef.current = next;
    setForm(next);
    wb.emit('tabform', { group: g.id, form: next });
  };
  // a strip row: the groups whose strips share a top edge (±1 px) and touch side by side (through a splitter) take
  // one form, the tallest any of them needs (each with the hysteresis): their strips line up at one height, and
  // they switch together (in one render, one animation). Groups stacked above one another decide on their own. The
  // row comes from the layout's boxes (model.ts stripRow), among the strips drawn now (a hidden strip has no width)
  const decide = () => {
    const box = tabsRef.current, area = box?.closest('.wb-groups');
    if (!on || !box || !area) return;
    const reg = ui.strips;
    const shown = new Set([...reg].filter(([, m]) => (m.box()?.clientWidth ?? 0) > 0).map(([id]) => id));
    const members = M.stripRow(wb.layout.peek(), g.id, area.clientWidth, area.clientHeight, shown).map((id) => reg.get(id)!);
    if (!members.length) return;
    const wishes = members.map((m) => m.own());
    if (wishes.every((w) => w == null)) return;
    const row = wishes.includes('two') ? 'two' : 'one';
    for (const m of members) m.apply(row);
  };
  const entry = useRef<HybEntry>({ own, apply, box: () => tabsRef.current });
  entry.current = { own, apply, box: () => tabsRef.current };
  useLayoutEffect(() => {
    if (!on) return;
    const reg = ui.strips, e: StripEntry = { own: () => entry.current.own(), apply: (f) => entry.current.apply(f), box: () => entry.current.box() };
    reg.set(g.id, e);
    return () => { if (reg.get(g.id) === e) reg.delete(g.id); };
  }, [on, g.id]);
  const latest = useRef(decide);
  latest.current = decide;      // the observer calls the current one (its tabs, not those of the first render)
  // on the tab count (the group's own room is the observer's); a row's other groups decide for it on theirs (not on
  // every render, which read every strip's box each time)
  useLayoutEffect(() => { decide(); }, [on, g.tabs.length]);
  useLayoutEffect(() => {
    if (!on || !tabsRef.current) return;
    // the group's width: a window resize, a splitter drag, a side column opening or closing (once a frame, at most)
    let raf = 0;      // a form switch changes the strip's height: decided in the next frame (no RO loop)
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => latest.current()); });
    ro.observe(tabsRef.current);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [on]);
  useLayoutEffect(() => {
    // the group's form drives its strip's height (one line: the top bar's; two lines: taller)
    const grp0 = tabsRef.current?.closest<HTMLElement>('.wb-group');
    if (grp0) grp0.dataset.form = on ? form : '';
    const f = flip.current, box = tabsRef.current, fs0 = flipStrip.current;
    if (!f || !box) return;
    flip.current = null; flipStrip.current = null;
    if (reducedMotion()) return;
    const opts = { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
    // the strip's height and the views below it move together (the views by transform: no reflow per frame)
    const strip = box.closest('.wb-strip'), h1 = strip?.getBoundingClientRect().height ?? 0;
    if (strip && fs0?.h && Math.abs(fs0.h - h1) > 0.5) strip.animate([{ height: `${fs0.h}px` }, { height: `${h1}px` }], opts);
    for (const [v, was] of fs0?.views ?? []) { const now = v.getBoundingClientRect().top + parseFloat(getComputedStyle(v).paddingTop); if (Math.abs(was - now) > 0.5) v.animate([{ transform: `translateY(${was - now}px)` }, { transform: 'none' }], opts); }
    for (const o of f) {
      const t = box.querySelector(`[data-tab="${CSS.escape(o.id)}"]`);
      if (!t) continue;
      for (const [sel, from] of [['.wb-tab-label', o.name], ['.wb-tab-sub-label, .wb-tab-sec', o.sec], ['.wb-tab-chev', o.chev]] as const) {
        const el = t.querySelector(sel); if (!el || !from) continue;
        const to = el.getBoundingClientRect();
        el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      }
    }
  }, [form]);
  return on ? form : null;
}
