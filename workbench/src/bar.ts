// The window bar: the host's controls at its ends, the host's mark, and the bar group's strip while its
// tabs fit; the tabs moving between the bar and their row.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html } from './html.ts';
import * as M from './model.ts';
import { SideToggle, sideOverlay } from './sides.ts';
import { TabStrip, oneLine } from './strip.ts';
import { measurer } from './measure.ts';
import type { Workbench, BarSpec } from './workbench.ts';
import { reducedMotion } from './motion.ts';

/** The window bar: the host's controls at its ends (the sidebar toggles where they are hidden). Between them the free
 *  room (.wb-bar-fill): the host's mark (bar.mark: { icon, text }, a decoration), then the bar group's strip when it is
 *  in the bar. The room after the mandatory items (the toggles, bar.left, the right controls, the gaps) goes to the
 *  OPTIONAL items in one ordered list (BAR_OPTIONAL), each in while it fits, with a band: the tabs (n × --wb-tab-min and
 *  the gaps, with home), then the mark's icon, then its text. So narrowing drops the text first, then the icon, and
 *  only then do the tabs move down to their own strip.
 *  A NARROW WINDOW (sides.ts OVERLAY_MAX_W, the width rule of the floating columns): one
 *  row of chrome. The bar group's strip is always in the bar and takes all the free room: its active tab alone (the
 *  document's name and section, its menus), the other tabs behind a count after it (strip.ts single); the mark gets no
 *  room (the app's mark is on Home). */
const BAR_OPTIONAL = ['tabs', 'icon', 'text'] as const;
export type BarOn = { tabs: boolean; icon: boolean; text: boolean };
export const MARK_IN = 8;      // a mark part comes back from its width + this (it goes below its width): the band
/** The bar's optional items that fit `room`: for each in order, in while the room left takes its need (the band:
 *  coming in needs the item's band more). needs: { tabs: (left, now) => bool | null (no strip for the bar), icon, text: px }. */
export function barItems(room: number, needs: { tabs(left: number, now: boolean): { on: boolean; used: number } | null; icon: number; text: number }, now: BarOn): BarOn {
  const on: BarOn = { tabs: false, icon: false, text: false };
  let left = room;
  for (const k of BAR_OPTIONAL) {
    if (k === 'tabs') { const r = needs.tabs(left, now.tabs); on.tabs = r?.on ?? false; if (r && on.tabs) left -= r.used; continue; }
    const need = needs[k];
    on[k] = need > 0 && left - need >= (now[k] ? 0 : MARK_IN);
    if (on[k]) left -= need;
  }
  return on;
}
export function WindowBar({ wb, bar, inbar }: { wb: Workbench; bar: BarSpec; inbar: boolean }) {
  const ref = useRef<HTMLDivElement>(null), stripRef = useRef<HTMLDivElement>(null);
  const L = wb.layout.value;
  const g = M.barGroup(L);
  const mark = wb.barMark.value;
  // One group whose tabs fit: its tab bar IS in the top bar, filling the room between home and the right controls
  // (the one gap before them), each tab 1/n of it: the widths follow the bar and the count, never the text.
  // In while every tab gets the minimum (oneLine: n × --wb-tab-min + the gaps, with the band); else (too many, too
  // narrow, a second group) the tabs are a row below. Re-decided on resizes (a ResizeObserver on the bar: the
  // window, the columns) and on tab changes; never on the text (a longer name or section truncates in its tab).
  // One observer for the bar's life: the bar and its free room (the fill: its width follows the host's items too);
  // the decision again when the bar group or its tab count changes
  const decided = useRef(''), checkRef = useRef<(force?: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.closest<HTMLElement>('.wb-root');
    const check = (force = false) => {
      const Lnow = wb.layout.peek(), gg = M.barGroup(Lnow);
      // the free room: from the filler's start (after the mandatory leading items) to the right controls less the gap;
      // the tabs' share of it less the group's home toggle (not a tab: not in 1/n)
      const br = el.getBoundingClientRect(), lead = el.querySelector('.wb-bar-fill')?.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(el).getPropertyValue('--wb-gap')) || 0;
      const homeW = (el.querySelector('.wb-strip--inbar .wb-home-btn')?.getBoundingClientRect().width ?? parseFloat(getComputedStyle(el).getPropertyValue('--wb-btn-h'))) + gap;
      const rightEl = [...el.querySelectorAll('.wb-bar-right > *, .wb-bar > .wb-bar-slot--right')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
      const rightL = rightEl.length ? Math.min(...rightEl.map((r) => r.left)) : br.right - parseFloat(getComputedStyle(el).paddingRight);
      const free = rightL - gap - (lead?.left ?? br.left);
      // the mark's parts: their own widths (each with its trailing gap), measured while out too (a clipped part)
      const partW = (k: string) => el.querySelector(`.wb-mark-part[data-part="${k}"] > .wb-mark-in`)?.getBoundingClientRect().width ?? 0;
      // the icon's need: its width and gap, and its inset (css: one inset from the bar's left, top and bottom; after the show button: none)
      const lead0 = el.querySelector(':scope > .wb-bar-slot--left[data-open="false"]') ? 0 : Math.max(0, (br.height - (parseFloat(getComputedStyle(el).getPropertyValue('--wb-mark-icon')) || 0)) / 2 - gap);
      const icon = partW('icon') + lead0, text = partW('text');
      const key = `${gg?.id}|${free}|${gg?.tabs.length}|${icon}|${text}|${sideOverlay.peek()}`;
      if (!force && key === decided.current) return;
      decided.current = key;
      const n = gg?.tabs.length ?? 0;
      const narrow = sideOverlay.peek();
      const tabs = (left: number, now: boolean) => {
        if (!gg) return null;
        if (narrow) return { on: true, used: left };   // one row: the active tab takes the room (strip.ts single)
        if (!n) return { on: true, used: homeW };     // no tabs: the strip (home alone) always fits
        const tabRoom = left - homeW, ok = oneLine(el, tabRoom, n, gap, now);
        return { on: ok, used: homeW + n * (parseFloat(getComputedStyle(el).getPropertyValue('--wb-tab-min')) || 0) + (n - 1) * gap };
      };
      const mk = wb.barMark.peek();
      const on = barItems(free, { tabs, icon, text }, { tabs: wb.inbar.peek(), ...mk });
      if (on.icon !== mk.icon || on.text !== mk.text) wb.barMark.value = { icon: on.icon, text: on.text };
      if (on.tabs !== wb.inbar.peek()) moveTabs(wb, on.tabs, root);
    };
    // the UI font's x-height (per em): the mark's text is scaled to it (css --wb-ui-ex), its apparent size the tabs'
    const ex = () => { const cs = getComputedStyle(el), m = measurer(); m.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
      el.style.setProperty('--wb-ui-ex', String(+(m.measureText('x').actualBoundingBoxAscent / 100).toFixed(4))); };
    checkRef.current = check;
    ex();
    check();
    let live = true;
    document.fonts?.ready.then(() => { if (live) { ex(); check(); } });     // the mark's text measured in its font
    // the decision changes the bar's contents: in the next frame, not inside the observer's delivery (no RO loop)
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => check()); });
    ro.observe(el);
    const fill = el.querySelector('.wb-bar-fill');
    if (fill) ro.observe(fill);
    return () => { live = false; ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  const narrow = sideOverlay.value;
  useLayoutEffect(() => { checkRef.current(); }, [g?.id, g?.tabs.length, inbar, mark.icon, mark.text, narrow]);
  return html`<div class="wb-bar" data-bar ref=${ref} aria-label=${bar.label ?? undefined}>
    <${SideToggle} wb=${wb} side="left" slot=${true} />
    ${bar.left ? bar.left() : null}
    <div class="wb-bar-fill">${bar.mark ? html`<${BarMark} wb=${wb} mark=${bar.mark} on=${mark} />` : null}${inbar && g ? html`<${TabStrip} host="bar" wb=${wb} g=${g} index=${0} isMax=${false} many=${false} hidden=${false} stripRef=${stripRef} single=${narrow} />` : null}</div>
    <div class="wb-bar-right">${bar.right ? bar.right() : null}</div>
    <${SideToggle} wb=${wb} side="right" slot=${true} />
  </div>`;
}
/** The host's mark in the bar: its parts (icon, text) each in a clipped box that is its content's width while in and
 *  0 while out (the content keeps its width: measurable); a change animates the box's width and the content's opacity,
 *  so what follows (the strip) moves continuously. Decoration: aria-hidden, not interactive. */
function BarMark({ wb, mark, on }: { wb: Workbench; mark: NonNullable<BarSpec['mark']>; on: { icon: boolean; text: boolean } }) {
  const ref = useRef<HTMLDivElement>(null), was = useRef(on);
  useLayoutEffect(() => {
    const prev = was.current; was.current = on;
    if (prev === on || wb.booting || !ref.current || reducedMotion()) return;
    const opts = { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
    for (const k of ['icon', 'text'] as const) {
      if (prev[k] === on[k]) continue;
      const part = ref.current.querySelector(`[data-part="${k}"]`), w = part?.firstElementChild?.getBoundingClientRect().width ?? 0;
      if (!part) continue;
      const a = [{ width: '0px', opacity: 0 }, { width: `${w}px`, opacity: 1 }];
      part.animate(on[k] ? a : a.reverse(), opts);
      wb.emit('barmark', { part: k, on: on[k] });
    }
  }, [on]);
  return html`<div class="wb-bar-mark" ref=${ref} aria-hidden="true">${(['icon', 'text'] as const).map((k) => { const part = mark[k]; return part ? html`<span key=${k} class="wb-mark-part" data-part=${k} data-on=${String(!!on[k])}><span class=${`wb-mark-in wb-mark-in--${k}`}>${part()}</span></span>` : null; })}</div>`;
}
/** The tab bar moves between the top bar and its row: FLIP of every tab (transform, opacity), the row's glass growing,
 *  the views sliding with their inset; the focus stays on its tab. */
function moveTabs(wb: Workbench, on: boolean, root: HTMLElement | null = wb.root()): void {
  // the first layout (a mount, a restore) is placed as it is: no move from a layout nobody saw
  if (!root || wb.booting) { wb.inbar.value = on; wb.emit('tabsplace', { inbar: on }); wb.emit('tabsplaced', { inbar: on }); return; }
  const before = new Map([...root.querySelectorAll<HTMLElement>('[data-tab]')].map((t) => [t.dataset.tab, t.getBoundingClientRect()]));
  // the focus stays on its tab, or on the same control of it (the tab is drawn anew in the other host)
  const fa = (root.getRootNode() as Document | ShadowRoot).activeElement, focused = fa?.closest?.<HTMLElement>('[data-tab]')?.dataset.tab ?? null;
  const part = fa && ['[data-name]', '[data-sub]', '.wb-tab-close'].find((p) => fa.matches(p)) || '> [role="tab"]';
  const views = new Map([...root.querySelectorAll('.wb-groups .wb-panel:not(.wb-panel--hidden) .wb-view')].map((v) => [v.closest<HTMLElement>('.wb-panel')!.dataset.panel, v.getBoundingClientRect().top + parseFloat(getComputedStyle(v).paddingTop)]));
  wb.inbar.value = on;
  wb.emit('tabsplace', { inbar: on });
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    if (focused) root.querySelector<HTMLElement>(`[data-tab="${CSS.escape(focused)}"] ${part}`)?.focus({ preventScroll: true });
    if (reducedMotion()) return;
    const opts = { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
    const anims: Animation[] = [];
    for (const t of root.querySelectorAll<HTMLElement>('[data-tab]')) {
      const from = before.get(t.dataset.tab); if (!from) continue;
      const to = t.getBoundingClientRect();
      anims.push(t.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], opts));
    }
    const strip = root.querySelector('.wb-groups .wb-strip:not([hidden])');
    if (on === false && strip) anims.push(strip.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, pseudoElement: '::before' }));
    for (const v of root.querySelectorAll('.wb-groups .wb-panel:not(.wb-panel--hidden) .wb-view')) {     // the documents' views only: the side panels never move
      const was = views.get(v.closest<HTMLElement>('.wb-panel')!.dataset.panel); if (was == null) continue;
      const now = v.getBoundingClientRect().top + parseFloat(getComputedStyle(v).paddingTop);
      if (Math.abs(was - now) > 0.5) anims.push(v.animate([{ transform: `translateY(${was - now}px)` }, { transform: 'none' }], opts));
    }
    root.classList.add('wb-moving');
    Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => { root.classList.remove('wb-moving'); wb.emit('tabsplaced', { inbar: on }); });
  });
}
