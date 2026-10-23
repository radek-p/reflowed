// reference navigation in the typeset document.
//
//   installRefNav({ api, numberingState, root }) -> refnav
//     root the editor's container (app/editor-root.ts): its blocks, its state; one refnav per editor
//     api             { forPane(pane) -> that pane's document host (app/doc-host.js: refsState, numbering, nav, edit, blocks), bibpane() } (main.js: the workspace's)
//     numberingState  rtx:refs's numberingState (numbers for the card's copy)
//
// A reference (\ref, \eqref, \cref, \Cref, \autoref: brackets, name and number)
// is one unit (units.js), resolved by label through refsState():
//   click              edit, as for any glyph: the block's source opens with the
//                      caret in the reference's key (edit layout applies)
//   hover 300 ms, or   a card with the target typeset (card.js), its number,
//   keyboard focus     Go to, and the ⌘/Ctrl-click hint; Enter/Space opens it
//                      at once (focus on Go to), Esc closes it
//   ⌘/Ctrl-click       go to the target: scrolled into view, a short pulse
//   Back pill          after any jump; returns to where you were (a stack);
//                      also Alt+← and ⌘/Ctrl+[ outside a text field. It goes
//                      once you are back or have scrolled two screens away.
// External links (\url, \href) open in a new tab.
// A citation (\cite, \citep, \citet, \parencite, …: rtx-numbering's slot "rtxk:<keys>") is a unit too: its
// card shows each key's entry (refsState().bib: authors, title, venue, year, the DOI as a link) with "Show in
// References" (the References pane on those entries) and "Go to the reference list" (the bibliography block);
// ⌘/Ctrl-click goes to the reference list. Every go-to and Back go through editorAPI.nav() (nav/navigate.js):
// in the unit's own pane, leaving a section focus the target is outside of; Back focuses it again.
//
// The test surface: refnav.units(), refnav.jump(label), refnav.back(),
// refnav.history(), refnav.card(); events on document: 'refnav:card'
// {open, labels}, 'refnav:jumped' {label, blockId}, 'refnav:back'.
import { createCard, cardTitle } from './card.js';
import { scanRender, unitOf, unitsIn, unitRects, markUnit, markedUnit, REF_SLOT } from './units.js';
import { installStyle } from './style.js';
import { html, render, Button } from '../design/ui/index.js';
import { pushLayer } from '../design/ui/layers.js';
import { page, onChange } from '../app/page-state.ts';
import { reduced } from '../motion/reduced.ts';

const HOVER_MS = 300, CLOSE_MS = 250;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CMD_KIND = { ref: 'ref', eqref: 'ref', pageref: 'ref', Cref: 'Cref', cref: 'cref', autoref: 'autoref', Autoref: 'autoref' };

export function installRefNav({ api, numberingState, root } = {}) {
  installStyle();
  // the document's events this editor answers: in its container or its own card (a layer outside the container)
  const mine = (t) => t instanceof Node && (root.el.contains(t) || card.el.contains(t));
  /** the pane a unit is drawn in (a card's unit: the pane the card was opened from) */
  const paneOf = (u) => u?.els?.[0]?.closest?.('.blk[data-pane]')?.dataset.pane ?? null;
  // a pane may show another document: what a unit resolves against is its own pane's document (that pane's
  // document host, app/doc-host.js: api.forPane), the pane of the unit last met
  let scope = null;
  const use = (u) => { const p = paneOf(u); if (p) scope = p; return u; };
  const A = () => api.forPane?.(scope) ?? api;
  const st = () => { try { return A().refsState(); } catch { return null; } };
  const nav = () => A().nav?.() ?? null;
  /** the document's bibliography block (\bibliography, \printbibliography, a thebibliography) */
  const bibBlock = () => A().blocks?.().find((b) => b.kind === 'bibliography' || /\\(printbibliography|bibliography\s*\{)|\\begin\{thebibliography\}/.test(b.source)) ?? null;
  const entriesOf = (u) => { use(u); const bib = st()?.bib ?? {}; return u.labels.map((key) => ({ key, entry: bib[key] ?? null })); };

  // ── finding units: every rendered block, again after the viewer paints ─────
  const dirty = new Set();
  let raf = 0;
  const flush = () => {
    raf = 0;
    for (const r of dirty) if (r.isConnected) scanRender(r, { inCard: r.classList.contains('rn-body') });
    dirty.clear();
  };
  const markDirty = (r) => { if (!r) return; dirty.add(r); if (!raf) raf = requestAnimationFrame(flush); };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      markDirty(t?.closest?.('.blk-render, .rn-body'));
    }
  });
  const observe = () => {
    mo.observe(root.el, { childList: true, subtree: true });
    for (const r of root.$$('.blk-render')) markDirty(r);
  };
  observe();
  root.onDispose(() => { mo.disconnect(); cancelAnimationFrame(raf); });
  // the block's render in every pane
  // the container's signals (app/page-state.ts), the page's route
  root.onDispose(onChange(root.state.displayed, (d) => { for (const el of root.$$(`.blk[data-id="${CSS.escape(d?.id ?? '')}"] .blk-render`)) markDirty(el); }));
  root.onDispose(onChange(root.state.refreshed, () => { for (const r of root.$$('.blk-render')) markDirty(r); }));
  root.onDispose(onChange(page.route, () => { nav()?.clear(); pill.hide(); card.close(); }));

  // ── resolving ─────────────────────────────────────────────────────────────
  const targetsOf = (u) => {
    use(u);
    const s = st();
    return u.labels.map((label) => { const info = s?.labels?.[label] ?? null; return { label, info, blockId: info?.blockId ?? null }; });
  };
  const blockEl = (id) => root.$(`.blk[data-id="${CSS.escape(id)}"]`);

  /** Where the reference is in its block's source: the caret goes into its first key. */
  function caretOf(u) {
    use(u);
    const s = st();
    const src = A().blocks?.().find((b) => b.id === u.blockId)?.source ?? '';
    const uses = u.kind === 'cite' ? (s?.cites ?? []).filter((r) => r.blockId === u.blockId && r.keys.length === u.labels.length && r.keys.every((k) => u.labels.includes(k.trim())))
      : (s?.refs ?? []).filter((r) => r.blockId === u.blockId && (CMD_KIND[r.cmd] ?? 'ref') === u.kind
      && r.keys.length === u.labels.length && r.keys.every((k) => u.labels.includes(k.trim())));
    const r = uses[u.index] ?? uses[0];
    if (!r) return null;
    const brace = src.indexOf('{', r.offset);
    return brace >= 0 && brace < r.offset + r.length ? brace + 1 : r.offset;
  }

  // ── the card ──────────────────────────────────────────────────────────────
  let hot = null, openTimer = 0, closeTimer = 0, describer = null;
  const card = createCard({
    numberingState: () => A().numbering?.() ?? numberingState?.() ?? null,
    renderOf: (id) => root.$(`.blk[data-id="${CSS.escape(id)}"] .blk-render > .latex-block`),
    sourceOf: (id) => A().blocks?.().find((b) => b.id === id)?.source ?? '',   // the card's text without a typeset copy
    onGo: (label) => { const from = card.unit; card.close(); jump(label, { from }); },
    onAction: (id, u) => {
      if (id === 'show-refs') { card.close(); Promise.resolve(api.bibpane?.()?.reveal?.(u.labels)).then((ok) => { if (!ok) nav()?.say('The References pane could not show this entry.'); }); }
      else if (id === 'goto-list') { card.close(); gotoList(u); }
    },
    onClose: () => {
      if (describer) { describer.removeAttribute('aria-describedby'); describer.removeAttribute('aria-expanded'); describer = null; }
      if (hot && !hot.els[0].matches(':hover, :focus')) setHot(null);
      document.dispatchEvent(new CustomEvent('refnav:card', { detail: { open: false } }));
    },
  });
  // the unit under the pointer or focus: its glyphs coloured, and a live mark
  // over it (units.js markUnit: the viewer's own line bands and rects). Units
  // are compared by id: a rescan (after the mark's repaint) makes new objects.
  const same = (a, b) => !!a && !!b && a.id === b.id;
  const setHot = (u) => {
    if (same(u, hot) || (!u && !hot)) return;
    hot?.els.forEach((g) => g.classList.remove('rn-hot'));
    hot = u;
    hot?.els.forEach((g) => g.classList.add('rn-hot'));
    markUnit(hot);
  };
  async function openCard(u, { focus = false } = {}) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!u?.els[0]?.isConnected) return;
    const rects = unitRects(u);
    if (u.kind === 'cite') card.openCite(u, rects, { entries: entriesOf(u), focus, mac: MAC, hasList: !!bibBlock() });
    else await card.open(u, rects, { targets: targetsOf(u), focus, mac: MAC });
    if (!same(card.unit, u)) return;
    describer = u.els[0];
    describer.setAttribute('aria-describedby', 'rn-card');
    describer.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new CustomEvent('refnav:card', { detail: { open: true, labels: u.labels } }));
  }
  const closeSoon = () => { clearTimeout(openTimer); clearTimeout(closeTimer); if (card.isOpen()) closeTimer = setTimeout(() => card.close(), CLOSE_MS); };

  mo.observe(card.el, { childList: true, subtree: true });   // the card's typeset copy (its units)
  root.onDispose(() => { card.close(); card.el.remove(); });
  root.listen(root.doc, 'pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (!mine(e.target)) { if (hot && !hot.els[0].matches(':focus')) setHot(null); clearTimeout(openTimer); if (card.isOpen() && !card.el.contains(document.activeElement)) closeSoon(); return; }
    if (card.el.contains(e.target)) { clearTimeout(closeTimer); return; }
    const u = unitOf(e.target);
    if (u) {
      clearTimeout(closeTimer);
      if (!same(u, hot)) { setHot(u); clearTimeout(openTimer); if (!same(card.unit, u)) openTimer = setTimeout(() => openCard(u), card.isOpen() ? HOVER_MS / 2 : HOVER_MS); }
      return;
    }
    if (hot && !hot.els[0].matches(':focus')) setHot(null);
    clearTimeout(openTimer);
    if (card.isOpen() && !card.el.contains(document.activeElement)) closeSoon();
  }, true);
  root.listen(root.doc, 'focusin', (e) => {
    const u = mine(e.target) ? unitOf(e.target) : null;
    if (u) { setHot(u); clearTimeout(closeTimer); clearTimeout(openTimer); if (!same(card.unit, u)) openTimer = setTimeout(() => openCard(u), HOVER_MS); return; }
    if (card.el.contains(e.target)) { clearTimeout(closeTimer); return; }
    if (card.isOpen()) card.close();
  });

  // ── clicks and keys: before the viewer's and the app's own handlers ───────
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  root.listen(root.doc, 'click', (e) => {
    if (!mine(e.target)) return;
    const ext = e.target?.closest?.('[data-link-href]');
    if (ext && !ext.dataset.linkHref.startsWith('#') && ext.closest('.blk-render, .rn-body')) {
      stop(e);
      window.open(ext.dataset.linkHref, '_blank', 'noopener');
      return;
    }
    const u = unitOf(e.target);
    if (!u) return;
    stop(e);
    use(u);
    if (u.kind === 'cite' && (e.metaKey || e.ctrlKey || u.inCard)) { card.close(); gotoList(u); return; }
    const t = targetsOf(u).find((x) => x.blockId);
    if (e.metaKey || e.ctrlKey || u.inCard) { card.close(); if (t) jump(t.label, { from: u }); else nav()?.say(`No \\label{${u.labels[0] ?? ''}} in the document to go to.`); return; }
    card.close();
    const caret = caretOf(u);
    A().edit(u.blockId, caret ?? undefined);
  }, true);
  // the viewer marks a pressed link on pointerdown; keep a press on a unit from starting a text selection drag oddly
  // (Escape closes the card: the kit's one overlay layer, card.js)
  root.listen(root.doc, 'keydown', (e) => {
    if (!mine(e.target) && !root.takesKey(e)) return;
    const u = unitOf(e.target);
    if (u && (e.key === 'Enter' || e.key === ' ')) {
      stop(e);
      use(u);
      if (e.metaKey || e.ctrlKey) { if (u.kind === 'cite') { gotoList(u); return; } const t = targetsOf(u).find((x) => x.blockId); if (t) jump(t.label, { from: u }); else nav()?.say(`No \\label{${u.labels[0] ?? ''}} in the document to go to.`); return; }
      openCard(u, { focus: true });
      return;
    }
    // Back: Alt+← or ⌘/Ctrl+[ outside text fields, while there is somewhere to go back to
    const inField = e.target?.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]');
    if (!inField && stack.length && ((e.altKey && e.key === 'ArrowLeft') || ((e.metaKey || e.ctrlKey) && e.key === '['))) { stop(e); back(); }
  }, true);
  card.el.addEventListener('pointerleave', () => { if (!card.el.contains(document.activeElement)) closeSoon(); });
  card.el.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  card.el.addEventListener('focusout', (e) => { if (!card.el.contains(e.relatedTarget) && !same(unitOf(e.relatedTarget), card.unit)) closeSoon(); });
  root.listen(window, 'scroll', () => { if (card.isOpen() && !card.el.matches(':hover') && !card.el.contains(document.activeElement)) card.close(); }, { passive: true });

  // ── jumping and coming back: through the navigator (nav/navigate.js), in the unit's own pane ──────────────
  let landed = null;                       // where a go-to arrived: { pane, y } (two screens away from it, Back goes)
  const yOf = (p) => nav()?.scrollOf(p) ?? scrollY;

  function pulse(el) {
    if (!el) return;
    el.classList.remove('rn-pulse');
    void el.offsetWidth;
    el.classList.add('rn-pulse');
    const done = () => el.classList.remove('rn-pulse');
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1600);
  }
  const fromOf = (u) => (u ? { blockId: u.blockId, labels: u.labels, index: u.index, kind: u.kind } : null);
  const viewEl = (p, id) => root.$(`.blk[data-id="${CSS.escape(id)}"]${p ? `[data-pane="${CSS.escape(p)}"]` : ''}`) ?? blockEl(id);

  async function go(blockId, { from = null, anchor = null, event, detail }) {
    const N = nav();
    hook();
    const pane = paneOf(from) ?? undefined;
    if (!N) return false;
    const ok = await N.goTo(blockId, { pane, anchor, from: fromOf(from) });
    if (!ok) return false;
    const p = pane ?? N.history().slice(-1)[0]?.pane ?? null;
    landed = { pane: p, y: yOf(p) };
    const el = viewEl(p, blockId);
    pulse(el?.querySelector('.blk-main') ?? el);
    document.dispatchEvent(new CustomEvent(event, { detail }));
    return true;
  }
  async function jump(label, { from = null } = {}) {
    const info = st()?.labels?.[label];
    const id = info?.blockId;
    if (!id) { nav()?.say(`No \\label{${label}} in the document to go to.`); return false; }
    return go(id, { from, anchor: label, event: 'refnav:jumped', detail: { label, blockId: id } });
  }
  /** a citation's "Go to the reference list": the bibliography block, at its first key's entry when it has an anchor */
  async function gotoList(u) {
    const b = bibBlock();
    if (!b) { nav()?.say('This document has no reference list to go to.'); return false; }
    return go(b.id, { from: u, anchor: u?.labels?.[0] ? `cite.${u.labels[0]}` : null, event: 'refnav:jumped', detail: { label: null, keys: u?.labels ?? [], blockId: b.id, list: true } });
  }

  async function back() {
    const N = nav();
    hook();
    const e = N?.history().slice(-1)[0];
    if (!N || !e || !(await N.back())) return false;
    if (e.from) {
      const blk = viewEl(e.pane, e.from.blockId);
      const u = unitsIn(blk?.querySelector('.blk-render')).find((x) => x.index === e.from.index && x.kind === e.from.kind && x.labels.join() === e.from.labels.join());
      if (u) { u.els.forEach((g) => g.classList.add('rn-flash')); setTimeout(() => u.els.forEach((g) => g.classList.remove('rn-flash')), 1200); }
    }
    landed = N.history().length ? { pane: e.pane, y: yOf(e.pane) } : null;
    document.dispatchEvent(new CustomEvent('refnav:back', { detail: { scrollY: yOf(e.pane), pane: e.pane } }));
    return true;
  }

  // the Back pill: bottom centre, while the navigator has somewhere to go back to (any go-to: a reference, a
  // citation's list, the outline or find out of a section focus); it goes two screens away from where you landed
  // (Preact) the kit's pill button with the back icon; shown, then faded in a frame later (.rn-on), faded out before it hides
  const pill = (() => {
    const host = document.createElement('div');
    host.style.display = 'contents';
    document.body.append(host);
    let shown = false, on = false, hideT = 0;
    const draw = () => render(html`<${Button} size="lg" pill icon="back" class=${`rn-back${on ? ' rn-on' : ''}`} hidden=${!shown}
      title=${`Back to where you were (${MAC ? '⌘[' : 'Alt+←'})`} aria-label="Back to where you were" onClick=${() => back()}>Back<//>`, host);
    draw();
    const layer = pushLayer({ el: host.firstElementChild, kind: 'pill' });     // its place in the one stacking order
    root.onDispose(() => { clearTimeout(hideT); layer.remove(); render(null, host); host.remove(); });
    return {
      el: host.firstElementChild,
      show() { clearTimeout(hideT); shown = true; draw(); requestAnimationFrame(() => { on = true; draw(); }); },
      hide() { on = false; draw(); clearTimeout(hideT); hideT = setTimeout(() => { if (!on) { shown = false; draw(); } }, 250); },
    };
  })();
  // each document's editor has its own navigator, and the one in use is the unit's pane's (A()): the pill
  // follows that one, bound again whenever another is used (it was bound once, to the navigator there was at install
  // or at a route change: on the workbench page none, so a go-to never showed it)
  let unhook = null, hooked = null;
  const hook = () => {
    const N = nav();
    if (N === hooked) return;
    unhook?.(); unhook = null; hooked = N;
    if (!N) return;
    unhook = N.onChange((n) => (n ? pill.show() : pill.hide()));
    if (N.history().length) pill.show(); else pill.hide();
  };
  hook();
  root.onDispose(onChange(page.route, hook));
  root.onDispose(() => { unhook?.(); unhook = null; hooked = null; });
  root.listen(window, 'scroll', () => {
    if (!landed || !nav()?.history().length) return;
    if (Math.abs(yOf(landed.pane) - landed.y) > innerHeight * 2) { nav().clear(); landed = null; }
  }, { passive: true, capture: true });
  const stack = { get length() { return nav()?.history().length ?? 0; } };

  return {
    /** every unit found, for tests: { id, blockId, labels, kind, text, target, link } */
    units: () => root.$$('.blk-render').flatMap((r) => unitsIn(r)).map((u) => ({
      id: u.id, blockId: u.blockId, labels: u.labels, kind: u.kind, text: u.text, index: u.index, hadLink: u.hadLink,
      targets: targetsOf(u).map((t) => t.blockId), connected: u.els.every((g) => g.isConnected),
    })),
    rescan: () => { for (const r of root.$$('.blk-render')) scanRender(r); },
    /** a unit's glyph elements by its id (tests) */
    elements: (id) => root.$$('.blk-render').flatMap((r) => unitsIn(r)).find((u) => u.id === id)?.els ?? [],
    jump, back,
    history: () => nav()?.history() ?? [],
    /** the hovered/focused unit's rects (from its live mark) and the mark's id, for tests */
    hot: () => hot && { id: hot.id, labels: hot.labels, rects: unitRects(hot), mark: markedUnit()?.live ? markedUnit().id : null },
    card: () => ({ open: card.isOpen(), labels: card.unit?.labels ?? null, title: card.el.querySelector('.rn-title')?.textContent ?? '',
      text: card.el.querySelector('.rn-body')?.textContent ?? '' }),
    closeCard: () => card.close(),
    title: cardTitle,
    isRefSlot: (name) => REF_SLOT.test(name),
  };
}
