// section focus, per pane. A quiet focus icon beside each sectioning
// heading (in the gutter, shown on hover like the + and the handle) narrows
// THAT pane to the section (its subsections included): the other blocks of the
// pane are hidden. The pane's breadcrumb bar (pane-bar.js) names the section and its focus icon
// shows the state and leaves it (the floating chip is gone). Focusing another heading switches; leaving focus shows the whole
// document again with the section's heading held at the same y. Display only:
// numbering, references and the outline stay document-wide.
//
//   const focus = createSectionFocus(host)
//     host: { outline(), doc(), pane(name) -> the Pane (panes/pane.ts: view.container (its .blocks), scroller (null: the
//             window), top(), keeper?) | null,
//             elementIn(name, id),
//             ids() -> the panes, get(name) / put(name, id): the state, kept in the layout (panes/layout.js) }
//   focus.set(pane, headingId | null) · focus.get(pane) · focus.apply(pane?) · focus.icon(el, id) (wires a gutter button)
//   the focused heading's gutter button shows pin-off (unfocus) and the label to leave; the others pin (focus)

import { bump } from '../app/page-state.ts';   // the container's signals
import { appScroll } from '../perf/anchor.js';

const FOCUS_LABEL = 'Focus this pane on the section', LEAVE_LABEL = 'Show the whole document in this pane';
/** a heading's gutter focus button: pin while its section is not the focus, pin-off (leave) while it is (data-on: app.css
 *  shows which of its two icons, gutter.js) */
function markIcon(el, on) {
  const btn = el.querySelector(':scope > .gutter .g-focus');
  if (!btn || (btn.dataset.on === '1') === on) return;
  btn.dataset.on = on ? '1' : '';
  const label = on ? LEAVE_LABEL : FOCUS_LABEL;
  btn.setAttribute('aria-label', label); btn.title = label;
}

export function createSectionFocus(host) {
  // the state is the layout's (each pane entry's focus); a host without one keeps it here
  const own = new Map();
  const get = (p) => (host.get ? host.get(p) : own.get(p) ?? null);
  const put = (p, id) => { if (host.put) host.put(p, id); else own.set(p, id); };
  const ids = () => host.ids();

  /** the outline entry of a heading and the ids of its section (to the next entry of its level or higher) */
  function section(headingId) {
    const items = host.outline();
    const k = items.findIndex((it) => it.id === headingId);
    if (k < 0) return null;
    const it = items[k];
    const blocks = host.doc()?.blocks ?? [];
    const from = blocks.findIndex((b) => b.id === headingId);
    const next = items.slice(k + 1).find((x) => x.level <= it.level);
    const to = next ? blocks.findIndex((b) => b.id === next.id) : blocks.length;
    return { item: it, ids: new Set(blocks.slice(from, to < 0 ? blocks.length : to).map((b) => b.id)) };
  }
  const isHeading = (id) => host.outline().some((it) => it.id === id && !it.special);

  function apply(pane) {
    for (const p of pane ? [pane] : ids()) {
      const P = host.pane(p);
      if (!P) continue;
      const s = get(p) ? section(get(p)) : null;
      if (get(p) && !s) put(p, null);                          // the heading is gone: the whole document again
      for (const el of P.view.container?.children ?? []) { el.classList.toggle('sf-out', !!s && !s.ids.has(el.dataset.id)); markIcon(el, !!s && el.dataset.id === get(p)); }
    }
  }

  /** focus pane `p` on the section of heading `id` (null: the whole document), its heading kept where it is */
  function set(p, id) {
    const P = host.pane(p);
    if (!P) { put(p, null); return; }
    if (id && !isHeading(id)) return;
    const keepId = id ?? get(p);
    const before = keepId ? host.elementIn(p, keepId)?.getBoundingClientRect().top : null;
    put(p, id);
    P.keeper?.moved?.();
    apply(p);
    bump(host.state.sectionFocus, { pane: p, id });          // the pane's bar; a signal (app/page-state.js)
    const el = keepId ? host.elementIn(p, keepId) : null;
    if (!el || before == null) return;
    // focusing: the heading goes to the top of the pane; leaving: it stays at its y
    const want = id ? P.top() + 8 : before;
    const d = el.getBoundingClientRect().top - want;
    if (Math.abs(d) >= 0.5) appScroll(P, { by: d }); else P.keeper?.moved?.();
  }

  /** wire a gutter's focus button for block `id` in pane `p` */
  function icon(btn, p, id) {
    btn.addEventListener('click', (e) => { e.stopPropagation(); set(p, get(p) === id ? null : id); });
  }

  return { set, get, apply, icon, section, isHeading, reset() { for (const p of ids()) put(p, null); apply(); } };
}
