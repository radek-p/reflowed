// reference navigation in the typeset document.
//
//   installRefNav({ api, numberingState, root }) -> refnav
//     root the editor's container (app/editor-root.ts): its blocks, its state; one refnav per editor
//     api             { forPane(pane) -> that pane's document host (app/doc-host.js: refsState, numbering, nav, edit, blocks, readOnly), bibpane() } (main.js: the workspace's)
//     numberingState  rtx:refs's numberingState (numbers for the card's copy)
//
// A unit (units.js) is a reference (\ref, \eqref, \cref, \Cref, \autoref: brackets, name and number; resolved by
// label through refsState()), a citation (\cite, \citep, …: rtx-numbering's slot "rtxk:<keys>") or an external
// link (\url, \href). Every unit follows one rule (rule.ts clickAction), in every pane and every block kind:
//   click              edit, as for any glyph: the block's source opens with the caret in
//                      the unit (a reference's or citation's key, a link's address); in a
//                      read-only document the click shows the card instead
//   hover 300 ms, or   the unit's card (card.js); Enter/Space opens it at once (focus on
//   keyboard focus     its first button), Esc closes it
//   ⌘/Ctrl-click,      the unit's navigation: a reference goes to its target (scrolled into
//   ⌘/Ctrl+Enter       view, a short pulse), a citation to the reference list, a link opens
//                      its address in a new tab
//   in a card          a unit in a card's typeset copy follows its navigation on a click
// The cards: a reference's shows the target typeset, its number and Go to; a citation's each key's entry
// (refsState().bib: authors, title, venue, year, the DOI as a link) with "Show in References" (the References pane
// on those entries) and "Go to the reference list" (the bibliography block); a link's its address and "Open link"
// (a new tab, no opener; only web, mail, ftp and tel addresses, a relative one against the page: rule.ts
// openable). Each says what ⌘/Ctrl-click does, and that a click edits where it does. The card's own links and buttons are navigation: they stay clickable.
//   Back pill          after any go-to; returns to where you were (a stack);
//                      also Alt+← and ⌘/Ctrl+[ outside a text field. It goes
//                      once you are back or have scrolled two screens away.
// Every go-to and Back go through editorAPI.nav() (nav/navigate.js):
// in the unit's own pane, leaving a section focus the target is outside of; Back focuses it again.
//
// The test surface: refnav.units(), refnav.jump(label), refnav.back(),
// refnav.history(), refnav.card(); events on document: 'refnav:card'
// {open, labels}, 'refnav:jumped' {label, blockId}, 'refnav:back'.
import { createCard, cardTitle } from './card.js';
import { scanRender, unitOf, unitsIn, unitRects, markUnit, markedUnit, REF_SLOT } from './units.js';
import { installStyle } from './style.js';
import { clickAction, openable } from './rule.ts';
import { linkCaret } from '../tex/links.ts';
import { html, render, Button } from '../design/ui/index.js';
import { pushLayer } from '../design/ui/layers.js';
import { page, onChange } from '../app/page-state.ts';
import { reduced } from '../motion/reduced.ts';
import { isMacPlatform, shortcutLabel } from '../../../workbench/src/keys.ts';
import type { EditorRoot } from '../app/editor-root.ts';
import type { RefsState, BibEntry, LabelInfo } from '../refs/state.ts';
import type { NumberingState } from '../refs/numbering.ts';

/** a unit as units.js scanRender makes it */
export interface Unit {
  id: string; blockId: string | null; inCard: boolean; labels: string[]; href?: string; slot: string | null;
  kind: string; linkKey: string; els: Element[]; hadLink: boolean; index: number; text: string;
}
/** where a go-to came from (the navigator's history entry keeps it) */
interface From { blockId: string | null; labels: string[]; index: number; kind: string }
interface NavEntry { pane: string | null; from?: From | null }
/** the document's navigator (nav/navigate.js): the part refnav uses */
export interface RefnavNavigator {
  goTo(blockId: string, o: { pane?: string; anchor?: string | null; from?: From | null }): Promise<boolean>;
  back(): Promise<boolean>;
  history(): NavEntry[];
  clear(): void;
  onChange(fn: (n: number) => void): () => unknown;
  say(text: string): void;
  scrollOf(pane: string | null): number;
}
/** a document as refnav reads it and acts on it (app/doc-host.js docHost: a pane's document host) */
export interface RefnavDoc {
  refsState(): RefsState;
  numbering?(): NumberingState | null;
  nav?(): RefnavNavigator | null;
  blocks?(): { id: string; kind?: string; source: string }[];
  readOnly?(): boolean;
  edit(blockId: string | null, caret?: number): unknown;
}
/** the References pane (bibpane/index.js): the entries of a citation's keys shown there */
interface Bibpane { reveal?(keys: string[]): unknown }
/** the card (card.js createCard): the part refnav uses */
interface Card {
  el: HTMLElement; unit: Unit | null; kind: string;
  open(u: Unit, rects: unknown, o: object): Promise<void>; openCite(u: Unit, rects: unknown, o: object): void; openLink(u: Unit, rects: unknown, o: object): void;
  close(): void; isOpen(): boolean;
}
export interface RefnavApi extends Partial<RefnavDoc> {
  /** the document shown in pane p (null: the current one) */
  forPane?(pane: string | null): RefnavDoc | null;
  bibpane?(): Bibpane | null;
}

const HOVER_MS = 300, CLOSE_MS = 250;
const BACK_KEY = shortcutLabel(isMacPlatform() ? 'meta+[' : 'alt+arrowleft');   // the Back pill's title names the platform's usual one
const CMD_KIND: Record<string, string> = { ref: 'ref', eqref: 'ref', pageref: 'ref', Cref: 'Cref', cref: 'cref', autoref: 'autoref', Autoref: 'autoref' };

export function installRefNav({ api, numberingState, root }: { api: RefnavApi; numberingState?: (() => unknown) | null; root: EditorRoot }) {
  installStyle();
  // the document's events this editor answers: in its container or its own card (a layer outside the container)
  const mine = (t: EventTarget | null): t is Node => t instanceof Node && (root.el.contains(t) || card.el.contains(t));
  /** the pane a unit is drawn in (a card's unit: the pane the card was opened from) */
  const paneOf = (u: Unit | null | undefined): string | null => (u?.els?.[0]?.closest?.('.blk[data-pane]') as HTMLElement | null | undefined)?.dataset.pane ?? null;
  // a pane may show another document: what a unit resolves against is its own pane's document (that pane's
  // document host, app/doc-host.js: api.forPane), the pane of the unit last met
  let scope: string | null = null;
  const use = (u: Unit | null | undefined) => { const p = paneOf(u); if (p) scope = p; return u; };
  const A = (): RefnavApi => api.forPane?.(scope) ?? api;
  const st = (): RefsState | null => { try { return A().refsState!(); } catch { return null; } };
  const nav = (): RefnavNavigator | null => A().nav?.() ?? null;
  /** the document's bibliography block (\bibliography, \printbibliography, a thebibliography) */
  const bibBlock = () => A().blocks?.().find((b) => b.kind === 'bibliography' || /\\(printbibliography|bibliography\s*\{)|\\begin\{thebibliography\}/.test(b.source)) ?? null;
  const entriesOf = (u: Unit) => { use(u); const bib: Record<string, BibEntry> = st()?.bib ?? {}; return u.labels.map((key) => ({ key, entry: bib[key] ?? null })); };
  /** a click on unit u may edit its block: not in a card, not in a read-only document */
  const editable = (u: Unit) => { use(u); return !u.inCard && !A().readOnly?.(); };

  // ── finding units: every rendered block, again after the viewer paints ─────
  const dirty = new Set<Element>();
  let raf = 0;
  const flush = () => {
    raf = 0;
    for (const r of dirty) if (r.isConnected) scanRender(r, { inCard: r.classList.contains('rn-body') });
    dirty.clear();
  };
  const markDirty = (r: Element | null | undefined) => { if (!r) return; dirty.add(r); if (!raf) raf = requestAnimationFrame(flush); };
  /** the units under an event's target as they are now: its render scanned at once when the viewer repainted it
   *  since the last scan (a press in that frame meets units, never the viewer's own links) */
  const fresh = (t: EventTarget | null) => {
    const r = (t as Element | null)?.closest?.('.blk-render, .rn-body');
    if (!r || !dirty.has(r)) return;
    dirty.delete(r);
    scanRender(r, { inCard: r.classList.contains('rn-body') });
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target as Element : m.target.parentElement;
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
  const targetsOf = (u: Unit) => {
    use(u);
    const s = st();
    return u.labels.map((label) => { const info = s?.labels?.[label] ?? null; return { label, info: info as LabelInfo | null, blockId: info?.blockId ?? null }; });
  };
  const blockEl = (id: string) => root.$(`.blk[data-id="${CSS.escape(id)}"]`);

  /** Where the unit is in its block's source: the caret goes into its first key, or a link's address. */
  function caretOf(u: Unit): number | null {
    use(u);
    const s = st();
    const src = A().blocks?.().find((b) => b.id === u.blockId)?.source ?? '';
    if (u.kind === 'link') return linkCaret(src, u.href!, u.index);
    const uses = u.kind === 'cite' ? (s?.cites ?? []).filter((r) => r.blockId === u.blockId && r.keys.length === u.labels.length && r.keys.every((k) => u.labels.includes(k.trim())))
      : (s?.refs ?? []).filter((r) => r.blockId === u.blockId && (CMD_KIND[r.cmd] ?? 'ref') === u.kind
      && r.keys.length === u.labels.length && r.keys.every((k) => u.labels.includes(k.trim())));
    const r = uses[u.index] ?? uses[0];
    if (!r) return null;
    const brace = src.indexOf('{', r.offset);
    return brace >= 0 && brace < r.offset + r.length ? brace + 1 : r.offset;
  }

  // ── the card ──────────────────────────────────────────────────────────────
  let hot: Unit | null = null, openTimer = 0, closeTimer = 0, describer: Element | null = null;
  const card = createCard({
    numberingState: () => A().numbering?.() ?? numberingState?.() ?? null,
    renderOf: (id: string) => root.$(`.blk[data-id="${CSS.escape(id)}"] .blk-render > .latex-block`),
    sourceOf: (id: string) => A().blocks?.().find((b) => b.id === id)?.source ?? '',   // the card's text without a typeset copy
    onGo: (label: string) => { const from: Unit | null = card.unit; card.close(); jump(label, { from }); },
    onAction: (id: string, u: Unit) => {
      if (id === 'open-link') { card.close(); openLink(u); }
      else if (id === 'show-refs') { card.close(); Promise.resolve(api.bibpane?.()?.reveal?.(u.labels)).then((ok: unknown) => { if (!ok) nav()?.say('The References pane could not show this entry.'); }); }
      else if (id === 'goto-list') { card.close(); gotoList(u); }
    },
    onClose: () => {
      if (describer) { describer.removeAttribute('aria-describedby'); describer.removeAttribute('aria-expanded'); describer = null; }
      if (hot && !hot.els[0].matches(':hover, :focus')) setHot(null);
      document.dispatchEvent(new CustomEvent('refnav:card', { detail: { open: false } }));
    },
  }) as Card;
  // the unit under the pointer or focus: its glyphs coloured, and a live mark
  // over it (units.js markUnit: the viewer's own line bands and rects). Units
  // are compared by id: a rescan (after the mark's repaint) makes new objects.
  const same = (a: Unit | null | undefined, b: Unit | null | undefined) => !!a && !!b && a.id === b.id;
  const setHot = (u: Unit | null) => {
    if (same(u, hot) || (!u && !hot)) return;
    hot?.els.forEach((g) => g.classList.remove('rn-hot'));
    hot = u;
    hot?.els.forEach((g) => g.classList.add('rn-hot'));
    markUnit(hot);
  };
  async function openCard(u: Unit, { focus = false } = {}) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!u?.els[0]?.isConnected) return;
    const rects = unitRects(u);
    const edits = editable(u);
    if (u.kind === 'cite') card.openCite(u, rects, { entries: entriesOf(u), focus, hasList: !!bibBlock(), editable: edits });
    else if (u.kind === 'link') card.openLink(u, rects, { href: u.href, focus, editable: edits });
    else await card.open(u, rects, { targets: targetsOf(u), focus, editable: edits });
    if (!same(card.unit, u)) return;
    describer = u.els[0];
    describer.setAttribute('aria-describedby', 'rn-card');
    describer.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new CustomEvent('refnav:card', { detail: { open: true, labels: u.labels } }));
  }
  const closeSoon = () => { clearTimeout(openTimer); clearTimeout(closeTimer); if (card.isOpen()) closeTimer = setTimeout(() => card.close(), CLOSE_MS); };

  mo.observe(card.el, { childList: true, subtree: true });   // the card's typeset copy (its units)
  root.onDispose(() => { card.close(); card.el.remove(); });
  root.listen(root.doc, 'pointerover', (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (!mine(e.target)) { if (hot && !hot.els[0].matches(':focus')) setHot(null); clearTimeout(openTimer); if (card.isOpen() && !card.el.contains(document.activeElement)) closeSoon(); return; }
    if (card.el.contains(e.target)) { clearTimeout(closeTimer); return; }
    fresh(e.target);
    const u: Unit | null = unitOf(e.target);
    if (u) {
      clearTimeout(closeTimer);
      if (!same(u, hot)) { setHot(u); clearTimeout(openTimer); if (!same(card.unit, u)) openTimer = setTimeout(() => openCard(u), card.isOpen() ? HOVER_MS / 2 : HOVER_MS); }
      return;
    }
    if (hot && !hot.els[0].matches(':focus')) setHot(null);
    clearTimeout(openTimer);
    if (card.isOpen() && !card.el.contains(document.activeElement)) closeSoon();
  }, true);
  root.listen(root.doc, 'focusin', (e: FocusEvent) => {
    if (mine(e.target)) fresh(e.target);
    const u: Unit | null = mine(e.target) ? unitOf(e.target) : null;
    if (u) { setHot(u); clearTimeout(closeTimer); clearTimeout(openTimer); if (!same(card.unit, u)) openTimer = setTimeout(() => openCard(u), HOVER_MS); return; }
    if (card.el.contains(e.target as Node | null)) { clearTimeout(closeTimer); return; }
    if (card.isOpen()) card.close();
  });

  // ── clicks and keys: before the viewer's and the app's own handlers ───────
  const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  // one rule for every unit (rule.ts clickAction): edit, its card (a read-only document), or its navigation
  root.listen(root.doc, 'click', (e: MouseEvent) => {
    if (!mine(e.target)) return;
    fresh(e.target);
    const u: Unit | null = unitOf(e.target);
    if (!u) return;
    stop(e);
    clearTimeout(openTimer);                // the hover's or the press's focus card: the click decides now
    const act = clickAction({ mod: e.metaKey || e.ctrlKey, inCard: u.inCard, editable: editable(u) });
    if (act === 'go') { follow(u); return; }
    if (act === 'card') { if (!same(card.unit, u) || !card.isOpen()) openCard(u); return; }
    card.close();
    const caret = caretOf(u);
    A().edit!(u.blockId, caret ?? undefined);
  }, true);
  // the viewer marks a pressed link on pointerdown; keep a press on a unit from starting a text selection drag oddly
  // (Escape closes the card: the kit's one overlay layer, card.js)
  root.listen(root.doc, 'keydown', (e: KeyboardEvent) => {
    if (!mine(e.target) && !root.takesKey(e)) return;
    const u: Unit | null = unitOf(e.target);
    if (u && (e.key === 'Enter' || e.key === ' ')) {
      stop(e);
      use(u);
      if (e.metaKey || e.ctrlKey) { follow(u); return; }
      openCard(u, { focus: true });
      return;
    }
    // Back: Alt+← or ⌘/Ctrl+[ outside text fields, while there is somewhere to go back to
    const inField = (e.target as Element | null)?.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]');
    if (!inField && stack.length && ((e.altKey && e.key === 'ArrowLeft') || ((e.metaKey || e.ctrlKey) && e.key === '['))) { stop(e); back(); }
  }, true);
  card.el.addEventListener('pointerleave', () => { if (!card.el.contains(document.activeElement)) closeSoon(); });
  card.el.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  card.el.addEventListener('focusout', (e: FocusEvent) => { if (!card.el.contains(e.relatedTarget as Node | null) && !same(unitOf(e.relatedTarget), card.unit)) closeSoon(); });
  root.listen(window, 'scroll', () => { if (card.isOpen() && !card.el.matches(':hover') && !card.el.contains(document.activeElement)) card.close(); }, { passive: true });

  /** a unit's own navigation (⌘/Ctrl-click, a click in a card): a reference's target, a citation's list, a link's address */
  function follow(u: Unit) {
    use(u);
    card.close();
    if (u.kind === 'cite') return gotoList(u);
    if (u.kind === 'link') return openLink(u);
    const t = targetsOf(u).find((x) => x.blockId);
    if (t) return jump(t.label, { from: u });
    nav()?.say(`No \\label{${u.labels[0] ?? ''}} in the document to go to.`);
    return false;
  }
  /** a link's address in a new tab, without an opener; an address the editor does not open is said, not followed */
  function openLink(u: Unit) {
    const href = openable(u.href ?? '', document.baseURI);
    if (!href) { use(u); nav()?.say('The editor does not open this kind of address.'); return false; }
    window.open(href, '_blank', 'noopener');
    return true;
  }

  // ── jumping and coming back: through the navigator (nav/navigate.js), in the unit's own pane ──────────────
  let landed: { pane: string | null; y: number } | null = null;                       // where a go-to arrived: { pane, y } (two screens away from it, Back goes)
  const yOf = (p: string | null) => nav()?.scrollOf(p) ?? scrollY;

  function pulse(el: Element | null | undefined) {
    if (!el) return;
    el.classList.remove('rn-pulse');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('rn-pulse');
    const done = () => el.classList.remove('rn-pulse');
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1600);
  }
  const fromOf = (u: Unit | null): From | null => (u ? { blockId: u.blockId, labels: u.labels, index: u.index, kind: u.kind } : null);
  const viewEl = (p: string | null, id: string) => root.$(`.blk[data-id="${CSS.escape(id)}"]${p ? `[data-pane="${CSS.escape(p)}"]` : ''}`) ?? blockEl(id);

  async function go(blockId: string, { from = null, anchor = null, event, detail }: { from?: Unit | null; anchor?: string | null; event: string; detail: unknown }) {
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
  async function jump(label: string, { from = null }: { from?: Unit | null } = {}) {
    const info = st()?.labels?.[label];
    const id = info?.blockId;
    if (!id) { nav()?.say(`No \\label{${label}} in the document to go to.`); return false; }
    return go(id, { from, anchor: label, event: 'refnav:jumped', detail: { label, blockId: id } });
  }
  /** a citation's "Go to the reference list": the bibliography block, at its first key's entry when it has an anchor */
  async function gotoList(u: Unit) {
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
      const f = e.from;
      const blk = viewEl(e.pane, f.blockId!);
      const u = (unitsIn(blk?.querySelector('.blk-render')) as Unit[]).find((x) => x.index === f.index && x.kind === f.kind && x.labels.join() === f.labels.join());
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
      title=${`Back to where you were (${BACK_KEY})`} aria-label="Back to where you were" onClick=${() => back()}>Back<//>`, host);
    draw();
    const layer = pushLayer({ el: host.firstElementChild as HTMLElement, kind: 'pill' });     // its place in the one stacking order
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
  let unhook: (() => unknown) | null = null, hooked: RefnavNavigator | null = null;
  const hook = () => {
    const N = nav();
    if (N === hooked) return;
    unhook?.(); unhook = null; hooked = N;
    if (!N) return;
    unhook = N.onChange((n: number) => (n ? pill.show() : pill.hide()));
    if (N.history().length) pill.show(); else pill.hide();
  };
  hook();
  root.onDispose(onChange(page.route, hook));
  root.onDispose(() => { unhook?.(); unhook = null; hooked = null; });
  root.listen(window, 'scroll', () => {
    if (!landed || !nav()?.history().length) return;
    if (Math.abs(yOf(landed.pane) - landed.y) > innerHeight * 2) { nav()!.clear(); landed = null; }
  }, { passive: true, capture: true });
  const stack = { get length() { return nav()?.history().length ?? 0; } };

  return {
    /** every unit found, for tests: { id, blockId, labels, kind, text, index, hadLink, href, targets, connected } */
    units: () => root.$$('.blk-render').flatMap((r) => unitsIn(r) as Unit[]).map((u) => ({
      id: u.id, blockId: u.blockId, labels: u.labels, kind: u.kind, text: u.text, index: u.index, hadLink: u.hadLink, href: u.href ?? null,
      targets: targetsOf(u).map((t) => t.blockId), connected: u.els.every((g) => g.isConnected),
    })),
    rescan: () => { for (const r of root.$$('.blk-render')) scanRender(r); },
    /** a unit's glyph elements by its id (tests) */
    elements: (id: string) => root.$$('.blk-render').flatMap((r) => unitsIn(r) as Unit[]).find((u) => u.id === id)?.els ?? [],
    jump, back,
    history: () => nav()?.history() ?? [],
    /** the hovered/focused unit's rects (from its live mark) and the mark's id, for tests */
    hot: () => hot && { id: hot.id, labels: hot.labels, rects: unitRects(hot), mark: markedUnit()?.live ? markedUnit()!.id : null },
    card: () => ({ open: card.isOpen(), labels: card.unit?.labels ?? null, title: card.el.querySelector('.rn-title')?.textContent ?? '',
      text: card.el.querySelector('.rn-body')?.textContent ?? '' }),
    closeCard: () => card.close(),
    title: cardTitle,
    isRefSlot: (name: string) => REF_SLOT.test(name),
  };
}
