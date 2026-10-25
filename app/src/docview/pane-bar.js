// the breadcrumb bar of a pane — Documents / the paper's title / the section in view.
// One bar per pane: in the single view it sits in the top bar (where "Documents / title" was); in split
// view each pane has its own above it (out of the text: a grid row, nothing overlaps the column).
//   - Documents: home.
//   - The title (chrome/doc-header.js): the name and a chevron open a menu of other documents to open, a
//     the bar keeps its state per pane so that it can).
//   - The section: the section in view in this pane, following the scroll; a menu of its neighbours
//     (parent, siblings, children) to jump to (in a focused pane: to focus on). Beside it, the focus
//     icon narrows this pane to the section (docview/focus.js), pressed while focused; this replaces
//     the floating chip.
//
//   const bars = createPaneBars(host)
//     host: { title: signal, onTitle(text), outline() -> items, elementIn(pane, id), paneTop(pane),
//             scroller(pane) -> Element | null (the window), focus: { get(p), set(p, id) }, jump(pane, id),
//             docs() -> Promise<[{ id, title }]>, docId(), openDoc(id, pane), home(), topbarSlot() -> Element,
//             panes() -> the layout's pane ids }
// host.draw false: no bar drawn, the section in view of each pane followed (panes/pane-state.js section)
//   bars.layout(split)   the top bar's bar (one pane) or a bar per pane (split)
//   bars.update()        the section in view again (after a jump, an outline change)
//   bars.jumped(p, id, arrived?)  a jump to block id's heading in pane p: its section stands as the one in view until
//                        the reader scrolls (docview/in-view.ts: the rule, for the crumbs and the Outline alike)
//   bars.current(p)      the outline item shown for pane p (tests)
//   neighbours(items, k) (pure; test-w15-units): the menu's entries around item k
import { signal } from '@preact/signals';
import { html, render } from '../design/ui/core.js';
import { IconButton } from '../design/ui/controls.js';
import { Icon } from '../design/ui/icons.ts';
import { DocHeader } from '../chrome/doc-header.js';   // the switcher and the rename pencil
import { openMenu, item } from '../chrome/menu.js';
import { onChange } from '../app/page-state.ts';
import { appScroll } from '../perf/anchor.js';
import { sectionInView } from './in-view.ts';

const nameOf = (it) => `${it.number ? `${it.number} ` : ''}${it.title || 'Untitled section'}`;

/** the outline entries around entry k: its parent, its siblings (it among them), its children */
export function neighbours(items, k) {
  const it = items[k];
  if (!it) return { parent: null, siblings: [], children: [] };
  let p = -1;
  for (let i = k - 1; i >= 0; i--) if (items[i].level < it.level) { p = i; break; }
  const end = (i) => { for (let j = i + 1; j < items.length; j++) if (items[j].level <= items[i].level) return j; return items.length; };
  const from = p + 1, to = p >= 0 ? end(p) : items.length;
  const siblings = items.slice(from, to).filter((x) => x.level === it.level);
  const children = items.slice(k + 1, end(k)).filter((x) => x.level === it.level + 1);
  return { parent: p >= 0 ? items[p] : null, siblings, children };
}

export function createPaneBars(host) {
  // a bar per pane of the layout (its state made when first needed)
  const panes = {};
  const stateOf = (p) => (panes[p] ??= makeState(p));
  if (host.draw !== false) stateOf('a');
  let split = false, raf = 0, menu = null;

  function makeState(p) { return { p, el: null, current: signal(null), focused: signal(null), unscroll: null, target: null }; }

  // ── the section in view ── (the rule: docview/in-view.ts; measured here)
  function inView(s) {
    const p = s.p, items = host.outline();
    // a heading in the top band of the pane is the section you read; at the end of the scroll, the last one shown
    const sc = host.scroller(p) ?? document.scrollingElement;
    const atEnd = !!sc && sc.scrollTop > 0 && sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2;
    const end = (host.scroller(p)?.getBoundingClientRect().bottom ?? innerHeight) - 48;
    const tops = items.map((it) => { const el = host.elementIn(p, it.id); return el && el.offsetParent !== null ? el.getBoundingClientRect().top : null; });
    const t = s.target, k = t ? items.findIndex((it) => it.id === t.id) : -1;
    const at = sectionInView({ tops, line: host.paneTop(p) + 64, atEnd, end, target: k >= 0 ? { k, top: t.top } : null });
    if (t && t.top != null && at !== k) s.target = null;          // the reader scrolled: the jump's target is over
    return items[at] ?? null;
  }
  /** pane p jumped to the heading of block `id` (the Outline, a section menu): that section is the one in view until
   *  the reader scrolls; `arrived` settles when the jump has */
  function jumped(p, id, arrived = Promise.resolve()) {
    const s = stateOf(p), t = { id, top: null };
    s.target = t;
    soon();
    const land = () => { if (s.target !== t) return; const el = host.elementIn(p, id); if (el) t.top = el.getBoundingClientRect().top; else s.target = null; soon(); };
    arrived.then(land, land);
  }
  function update() {
    raf = 0;
    for (const s of Object.values(panes)) {
      if (!s.el && !s.tracked) continue;
      const cur = inView(s);
      if (cur?.id !== s.current.peek()?.id || cur?.number !== s.current.peek()?.number || cur?.title !== s.current.peek()?.title) s.current.value = cur;
      // the section in view is the pane's state too (panes/pane-state.js section): crumbs' data
      const sec = host.sectionOf?.(s.p);
      if (sec && sec.peek() !== s.current.peek()) sec.value = s.current.peek();
      const f = host.focus.get(s.p) ?? null;
      if (f !== s.focused.peek()) s.focused.value = f;
    }
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(update); };

  // ── menus ──
  function closeMenu() { if (menu) { const m = menu; menu = null; m.close(); } }
  // Escape and a press outside: the kit's one overlay layer (chrome/menu.js openMenu); a press on the
  // menu's button is its toggle (toggleMenu below)
  function toggleMenu(anchor, items, cls) {
    if (menu) { const was = menu.anchor; closeMenu(); if (was === anchor) return; }
    menu = openMenu({ anchor, cls: `block-menu pb-menu ${cls}`, items, focus: true, onClosed: (m) => { if (menu === m) menu = null; anchor.setAttribute('aria-expanded', 'false'); } });
    menu.anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
  }
  function sectionMenu(p, anchor) {
    const items = host.outline(), cur = panes[p].current.peek();
    const k = items.findIndex((x) => x.id === cur?.id && x.title === cur?.title);
    if (k < 0) return;
    const n = neighbours(items, k);
    const go = (it) => () => {
      if (host.focus.get(p)) host.focus.set(p, it.special ? null : it.id);
      else host.jump(p, it.id);
      soon();
    };
    const out = [];
    if (n.parent) out.push(item(`↑ ${nameOf(n.parent)}`, `up:${n.parent.id}`, go(n.parent)));
    for (const s of n.siblings) {
      out.push(item(`${s === items[k] ? '• ' : ''}${nameOf(s)}`, `sib:${s.id}:${s.title}`, go(s), { disabled: s === items[k] }));
      if (s === items[k]) for (const c of n.children) out.push(item(`    ${nameOf(c)}`, `child:${c.id}:${c.title}`, go(c)));
    }
    toggleMenu(anchor, out, 'pb-sections');
  }
  async function docsMenu(anchor, p) {
    let list = [];
    try { list = (await host.docs()).filter((d) => d.id !== host.docId()); } catch { list = []; }
    const out = list.slice(0, 12).map((d) => item(d.title || 'Untitled', `doc:${d.id}`, () => host.openDoc(d.id, p)));
    out.push(item('All documents…', 'home', () => host.home()));
    toggleMenu(anchor, out, 'pb-docs-menu');
  }

  // ── the bar ──
  function Bar({ s }) {
    const cur = s.current.value, focused = s.focused.value;
    const isA = s.p === 'a';
    const canFocus = cur && !cur.special;
    return html`<nav class="crumbs pane-bar" data-pane=${s.p} aria-label=${split ? `Pane ${isA ? 'A' : 'B'}: where you are` : 'Where you are'}>
      <a href="#/" class="crumb-home">Documents</a><span class="crumb-sep" aria-hidden="true">/</span>
      <${DocHeader} title=${host.title} onTitle=${(t) => host.onTitle(t)} openDocs=${(anchor) => docsMenu(anchor, s.p)} primary=${isA} ids=${host.ids} />
      ${cur ? html`<span class="crumb-sep" aria-hidden="true">/</span>
        <button type="button" class="pb-section" aria-haspopup="menu" aria-expanded="false" title=${`${nameOf(cur)}: sections around it`}
          onClick=${(e) => sectionMenu(s.p, e.currentTarget)}>
          <span class="pb-section-name">${nameOf(cur)}</span><${Icon.chevronDown} size=${14} />
        </button>
        ${canFocus || focused ? html`<${IconButton} class="pb-focus" size="sm" quiet icon=${focused ? 'unfocus' : 'focus'} pressed=${!!focused}
          label=${focused ? 'Show the whole document in this pane' : 'Focus this pane on the section'}
          onClick=${() => { host.focus.set(s.p, focused ? null : cur.id); soon(); }} />` : null}` : null}
    </nav>`;
  }

  /** no bar drawn (the workbench's tabs show the crumbs): the section in view followed all the same */
  function track(s) {
    if (s.tracked) return;
    unmount(s);
    s.tracked = true;
    const sc = host.scroller(s.p) ?? window;
    sc.addEventListener('scroll', soon, { passive: true });
    s.unscroll = () => { sc.removeEventListener('scroll', soon); s.tracked = false; };
  }
  function mount(s, hostEl) {
    if (s.el === hostEl) return;
    unmount(s);
    s.el = hostEl;
    render(html`<${Bar} s=${s} />`, hostEl);
    const sc = host.scroller(s.p) ?? window;
    sc.addEventListener('scroll', soon, { passive: true });
    // a press in a pane's bar focuses that pane (the outline, find act there), as one in the pane does
    const press = () => host.focusPane?.(s.p);
    hostEl.addEventListener('pointerdown', press, true);
    s.unscroll = () => { sc.removeEventListener('scroll', soon); hostEl.removeEventListener('pointerdown', press, true); };
  }
  function unmount(s) {
    if (s.tracked) { s.unscroll?.(); s.unscroll = null; return; }
    if (!s.el) return;
    s.unscroll?.(); s.unscroll = null;
    render(null, s.el);
    if (s.el.classList.contains('pane-bar-host')) s.el.remove();
    s.el = null;
  }
  function layout(on) {
    split = on;
    closeMenu();
    const view = host.view();
    for (const s of Object.values(panes)) unmount(s);
    if (host.draw === false) for (const p of host.panes?.() ?? []) track(stateOf(p));
    else if (!on) mount(stateOf('a'), host.topbarSlot());
    else {
      for (const p of host.panes?.() ?? ['a', 'b']) {
        const el = document.createElement('div');
        el.className = 'pane-bar-host';
        el.dataset.pane = p;
        view?.append(el);
        mount(stateOf(p), el);
      }
    }
    soon();
  }
  // the page listeners, owned: dispose() removes them
  const listeners = [[window, 'resize', soon]];
  for (const [t, n, f, o] of listeners) t.addEventListener(n, f, o);
  // a result shown, a refresh, a section focus: the page's signals (app/page-state.js)
  const offs = [onChange(host.state.displayed, soon), onChange(host.state.refreshed, soon), onChange(host.state.sectionFocus, soon)];
  function dispose() {
    closeMenu();
    for (const [t, n, f, o] of listeners) t.removeEventListener(n, f, o);
    for (const off of offs) off();
    for (const s of Object.values(panes)) unmount(s);
    cancelAnimationFrame(raf); raf = 0;
  }

  return { layout, update: soon, jumped, current: (p) => panes[p]?.current.peek() ?? null, closeMenu, dispose };
}

/** The app's side of the bars, in one place (app.js keeps a two-line hook): the panes (panes/index.js), section
 *  focus, the title from the top bar's model, the documents from the store, navigation through the router. */
// one set of bars per document editor, for ITS panes (a pane showing another document has that editor's bar);
// `title`/`onTitle`: the document's title (default: the top bar's); `split`: the bars start per pane (a guest's)
export function wirePaneBars({ sectionOf = null, root, panes, layout, sectionFocus, topbar, outline, store, docId, scrollToBlock, router, nav = null, title = null, onTitle = null, split = false, draw = true }) {
  const P = (p) => panes.get(p);
  const paneEl = (p) => P(p)?.scroller ?? null;
  const paneTop = (p) => P(p)?.top() ?? root.inset();
  const bars = createPaneBars({
    title: title ?? topbar.model.title, onTitle: (t) => (onTitle ? onTitle(t) : topbar.on.title?.(t)),
    outline, elementIn: (p, id) => panes.viewOf(p, id)?.root ?? null, paneTop, scroller: paneEl, view: () => root.part('view'), state: root.state, ids: (n) => root.id(n), sectionOf,
    panes: () => layout.ids().filter((p) => panes.get(p)),
    focusPane: (p) => { if (panes.isSplit) layout.focus(p); },
    focus: { get: (p) => sectionFocus.get(p), set: (p, id) => sectionFocus.set(p, id) },
    jump(p, id) {
      nav?.leaveFocusFor(p, id, { history: true });          // outside the section focus: leave it first
      const sc = paneEl(p);
      if (!sc) { scrollToBlock(id, p); return; }
      const el = panes.viewOf(p, id)?.root;
      if (!el) return;
      appScroll(P(p), { by: el.getBoundingClientRect().top - paneTop(p) - 8 });   // the keeper told
      bars.jumped(p, id);                                     // (scrollToBlock tells the bars itself: nav/reveal.js jumped)
    },
    docs: async () => ((await store?.listDocs?.({ limit: 20 })) ?? []).map((d) => ({ id: d.id, title: d.title })),
    docId, openDoc: (id, p) => router.openDoc(id, { pane: p }), home: () => router.home(),
    topbarSlot: () => topbar.slot('crumbs'),
    draw,
  });
  bars.layout(split);
  return bars;
}
