// view options — column width, text size, colours, justification in one popover in the top bar (view/popover.ts),
// and the edit layout and block handles in the Settings panel (settings/panel.ts, which draws the popover's rows too),
//
//   const view = await installView()    app/services.ts, once the viewer and the companion are loaded
//     The options are the page's (a user preference, on <html> like the theme). view.attach(root) gives an editor
//     (its container: app/editor-root.ts) its View button (app/mount.ts); the first one attached is the shell the
//     column's width is measured in
//     The column (--col) is each pane's, on its tab (the workbench's panes); an editor with no such panes has the
//     page's (--col, --rtx-free) on its shell; <body> has only the blocks' zoom (--rtx-view-zoom)
//   view.settings / view.set(patch) / view.zoomBy(dir) / view.measure() / view.open() / view.close()
//   view.changed                                  a signal: bumped whenever the options are applied (the Settings panel
//                                                 draws its rows again)
//   view.editLayoutFor(blockEl) -> { mode, … }    app.js, entering a block (edit-layout.js)
//   view.colorMap                                 the name blocks carry as data-color-map (app.js mount)
//   view.livePreview()                            app.js: compile the block being edited as it is typed
import { applyTheme } from '../design/theme.ts';
import { loadSettings, saveSettings, stepZoom, resolveTheme, WIDTHS, SLIDER, PX_PER_PT, DEFAULTS } from './settings.js';
import { installStyle } from './style.js';
import { signal } from '@preact/signals';
import { createPopover } from './popover.ts';
import { mountViewButton } from './view-button.js';
import { installBlink } from './blink.js';
import { blockEls, relayout, sourceWidthPt } from './viewer-host.ts';
import { registerColourMap } from './colour-maps.ts';
import { createTextwidth } from './textwidth.js';
import { decide, applyLayout, clearLayout, markCaret, slide, caretMap, keepCaretInView, updateFades, offsetAt, floatIfLarge, clearMirrors, pulse, warmMap } from './edit-layout.js';
import { page, onChange } from '../app/page-state.ts';
import { activeRoot, editorRoots } from '../app/editor-root.ts';
import { reduced } from '../motion/reduced.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';

export const COLOR_MAP = 'editor';
// TeX's colours per theme (the viewer's colour maps: its README, Theming).
// Light has none: TeX's colours as they are, black on white. Dark, sepia and
// contrast remap default ink and xcolor's base colours that would not read
// on that page; tints (red!20 …) are mixed again against the page's colour.
export const EDITOR_COLOURS = {
  colors: {
    dark: { '#000000': '#e6e4df', '#ff0000': '#ff7b72', '#0000ff': '#79b8ff', '#00ff00': '#56d364', '#008000': '#56d364',
      '#ff00ff': '#f778ba', '#00ffff': '#56d4dd', '#800080': '#d2a8ff', '#ff8000': '#ffa657', '#bfbf00': '#d9c84a', '#4d4d4d': '#a8a6a1', '#404040': '#a8a6a1',
      // lipics-v2021: the section square (lipicsYellow) a deeper amber under the light number (≥ 4.5:1); its greys
      // lipicsGray (text), LineGray (bars), BulletGray, (LightGray, a fill, is a tint below: it follows the page)
      '#fcc712': '#805a00', '#4f4f54': '#a8a6a1', '#828085': '#6c6b70', '#99999c': '#8e8d91' },
    sepia: { '#000000': '#453a26', '#ff0000': '#b3261e', '#0000ff': '#155e97', '#00ff00': '#3d7a2e', '#ffff00': '#9a7b00',
      '#fcc712': '#e9b512', '#4f4f54': '#5d5038', '#828085': '#8c7c5c', '#99999c': '#8c7c5c' },
    contrast: { '#000000': '#000000', '#ff0000': '#b30000', '#0000ff': '#0000b3', '#00ff00': '#006400', '#ffff00': '#6b5d00', '#00ffff': '#006b6b', '#ff8000': '#a34700',
      '#fcc712': '#fcc712', '#4f4f54': '#000000', '#828085': '#3d3d3d', '#99999c': '#3d3d3d' },
  },
  tints: { '#ffcccc': ['#ff0000', 20], '#ccccff': ['#0000ff', 20], '#ccffcc': ['#00ff00', 20], '#ffffcc': ['#ffff00', 20], '#ffe6cc': ['#ff8000', 20],
    '#cccccc': ['#000000', 20], '#e6e6e6': ['#000000', 10], '#808080': ['#000000', 50],
    '#d9d9db': ['#000000', 15] },
};


export async function installView() {
  let editor = null;                              // the editor whose shell the column is measured in: the first attached
  let observed = null, ro = null;                 // the shell observed (fit and paper follow its width) and its observer
  installStyle();
  const { reading } = await import('reflowtex/companion');
  const root = document.documentElement;
  // the blocks' zoom (--rtx-view-zoom, the text size: every pane's) on <body>, not <html>: Chromium restyles every
  // element of the page for a change of a variable on the root, whatever resets it below; on <body> a change stops where
  // the variable is reset (view/style.js: svg). The column (--col, --rtx-free) is not the page's: it changes with the
  // panes' widths (a window resize, a splitter, a side column in 'paper' and 'fit'), and on <body> each change restyled
  // every element of the page that is in no pane (the side panels, the strips) at the end of every slide: it is written
  // where it is read, each pane's on its tab (writePanes), a mounted editor's on its shell (writeShells)
  const zoomOn = () => document.body ?? root;
  const s = loadSettings();
  const changed = signal(0);                      // bumped by apply(): the Settings panel draws its rows again

  // the viewer's colour maps: ours added to whatever the page has (view/colour-maps.ts)
  registerColourMap(COLOR_MAP, EDITOR_COLOURS);

  const shellWidth = () => {
    const shell = editor?.part('shell'), page = editor?.part('page');
    observe(shell);                                // the shell is the focused pane's: it moves with the focus
    const pad = page ? (parseFloat(getComputedStyle(page).paddingLeft) || 0) + (parseFloat(getComputedStyle(page).paddingRight) || 0) : 48;
    return Math.max(200, (shell?.clientWidth || document.documentElement.clientWidth) - (pad || 48));
  };
  const tw = createTextwidth();                // \textwidth: read from the viewer, remembered per document (textwidth.js)
  const findTextwidth = () => tw.read();
  let last = null;                             // the layout applied last
  /** the column in screen px and the zoom the blocks are drawn at */
  function layout(avail = shellWidth(), paneTextwidthPt = 0) {
    let col, eff = s.zoom, fitted = false, limited = false;
    if (s.width === 'paper') {
      const textwidthPt = paneTextwidthPt || tw.read() || tw.get();
      // the block's own width, px: the viewer lays out at clientWidth / 2 pt (an integer px), so
      // the smallest width that holds \textwidth (a quarter px more, so rounding cannot lose it)
      const own = textwidthPt ? Math.ceil(textwidthPt * PX_PER_PT) + 0.25 : 0;
      // \textwidth not known yet (no document current: a page still opening): the column as it is, else medium (no jump)
      if (!own) col = last?.col ?? WIDTHS.find((w) => w.name === 'medium').px * s.zoom;
      else {
        col = own * s.zoom;
        // narrower than \\textwidth: the column fits the window (lines re-broken at the text size chosen), never a
        // horizontal scroll; back to \\textwidth when there is room
        if (col > avail) { col = avail; fitted = true; }
      }
    } else if (s.width === 'fit') col = avail;
    else {
      col = s.width === 'custom' ? s.widthPx : (WIDTHS.find((w) => w.name === s.width)?.px ?? DEFAULTS.widthPx);
      if (col > avail) limited = true;
    }
    return { col, eff, fitted, limited };
  }
  // one column per pane: each pane's --col from its own width and, for Paper, its own document's \textwidth (the most
  // common source width of the blocks it shows), on its tab (the pane's parent: its <main> and, while it is the current
  // pane, the find bar read it; nothing below the column's box inherits it: app/wb/css.ts). The page had one column,
  // measured in the focused pane ([data-part] moves with the focus: app/doc-tabs.ts markParts): a narrow pane beside a
  // wide one narrowed both, and a click in the other pane changed them. (No --rtx-free on a pane: in the workbench the
  // displays' peek is fixed, app/wb/css.ts.) An editor with no such panes (app/mount.ts) has the page's column on its shell.
  const paneObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (s.width === 'fit' || s.width === 'paper') later(); }) : null;
  const observedPanes = new WeakSet();
  const paneKnown = new WeakMap();                 // pane -> its \textwidth (pt), once its blocks have one
  /** a pane not measured yet, or (Paper) one whose document's \textwidth is not known yet: measured when results land */
  const panesOwed = () => editorRoots().some((r) => r.$$('main.rtx-pane[data-pane]').some((el) => !observedPanes.has(el) || (s.width === 'paper' && !paneKnown.has(el))));
  function paneTextwidth(el) {
    const n = new Map();
    for (const b of el.querySelectorAll('.blk-render > .latex-block:not(.incoming)')) { const w = sourceWidthPt(b); if (w > 0) n.set(w, (n.get(w) ?? 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  }
  /** each pane's measure as the page's (its tab's panel, its padding): reads only, before apply()'s writes (rule 2) */
  function measurePanes() {
    return editorRoots().flatMap((r) => r.$$('main.rtx-pane[data-pane]')).map((el) => {
      if (!observedPanes.has(el)) { observedPanes.add(el); paneObserver?.observe(el); }
      const cs = getComputedStyle(el), pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = Math.max(200, (el.parentElement?.clientWidth || el.clientWidth) - (pad || 48));
      const pt = s.width === 'paper' ? paneTextwidth(el) : 0;
      if (pt) paneKnown.set(el, pt);
      return { el, avail, l: layout(avail, pt) };
    });
  }
  /** a variable written only when it changes (a write restyles what inherits it) */
  const setOn = (el, k, v) => { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); };
  function writePanes(rows) {
    for (const { el, l } of rows) setOn(el.parentElement ?? el, '--col', `${l.col}px`);
  }
  /** the page's column (l, measured in `avail` px) on the shell of each editor whose column is in no pane of its own: a
   *  mounted editor's (app/mount.ts: its page and split panes, its find bar read it); --rtx-free capped where the peek it
   *  feeds stops growing (100 px at the blocks' zoom), so a width change that leaves the peek alone leaves it alone too */
  function writeShells(rows, l, avail) {
    const tabs = new Set(rows.map((x) => x.el.parentElement));
    const free = `${Math.min(Math.max(0, Math.floor((avail + 48 - Math.min(l.col, avail)) / 2)), Math.ceil(100 * l.eff))}px`;
    for (const r of attached.keys()) {
      const shell = r.part('shell');
      if (!shell || tabs.has(shell)) continue;           // the workbench's: the focused pane's tab (its own column)
      setOn(shell, '--col', `${l.col}px`);
      setOn(shell, '--rtx-free', free);
    }
  }
  function apply({ animate = false } = {}) {
    // colours: the companion's reading state (class on <html>, data-theme, its key)
    const t = resolveTheme(s.theme);
    if (root.getAttribute('data-theme') !== t || reading.theme.peek() !== t) reading.setTheme(t);
    applyTheme(t);                               // its colours: the JSON theme's tokens on <html> (design/theme.ts)
    root.dataset.viewTheme = s.theme;
    // text size: the companion's zoom (--rtx-zoom, its key; it sends a resize)
    // (the companion reads its saved zoom at load but leaves the page to set it: so set it here too)
    if (Math.abs(reading.zoom.peek() - s.zoom) > 1e-6) reading.setZoom(s.zoom);
    else if (root.style.getPropertyValue('--rtx-zoom') !== String(s.zoom)) { root.style.setProperty('--rtx-zoom', String(s.zoom)); dispatchEvent(new Event('resize')); }
    const sw = shellWidth();                     // read once, before the writes: each read after one restyles the page
    const paneRows = measurePanes();
    const l = layout(sw);
    if (animate && !reduced() && last && Math.abs(last.col - l.col) > 1) {
      root.classList.add('rtx-width-anim');
      clearTimeout(apply.t);
      apply.t = setTimeout(() => root.classList.remove('rtx-width-anim'), 400);
    }
    setOn(zoomOn(), '--rtx-view-zoom', String(l.eff));
    // justification: the viewer's --latex-align, read at every layout; lay the blocks out again
    const { align, handles } = s;
    const alignWas = root.style.getPropertyValue('--latex-align') || 'justify';
    if (align === 'left') root.style.setProperty('--latex-align', 'left'); else root.style.removeProperty('--latex-align');
    if (alignWas !== align) relayoutAll();
    root.toggleAttribute('data-no-handles', !handles);    // a page-wide option: on <html>, as the theme
    writePanes(paneRows);
    writeShells(paneRows, l, sw);
    last = l;
    pop?.sync();
    changed.value++;
  }
  function relayoutAll() {
    // through panes/widths.js (set by main.js): the blocks in view first within a frame's budget, the rest
    // in idle time; before the editor is made, every block at once (none is shown yet)
    if (restyle) { restyle(); return; }
    for (const el of blockEls()) relayout(el);
  }

  // a width picked with its motion: the blocks keep their lines while the column eases, then those in view are
  // re-broken once (panes/widths.js, set by main.js); without it the viewer re-broke every block every frame
  let widthTransition = null, restyle = null;
  let onSettings = () => {};
  function set(patch, { animate = false } = {}) {
    Object.assign(s, patch);
    if (patch.width && patch.width !== 'custom' && patch.width !== 'paper' && patch.width !== 'fit') s.widthPx = WIDTHS.find((w) => w.name === patch.width)?.px ?? s.widthPx;
    saveSettings(s);
    const widthOnly = Object.keys(patch).every((k) => k === 'width' || k === 'widthPx');
    if (animate && widthOnly && widthTransition) widthTransition(() => apply({ animate }));
    else apply({ animate });
    onSettings();                                    // the editors' layout decided again (was view:changed)
  }
  function measure() {
    const blocks = editor?.part('page')?.querySelector('.blocks');
    const el = blocks?.querySelector('.blk-render > .latex-block:not(.incoming)');
    const columnPx = blocks?.getBoundingClientRect().width ?? 0;
    const l = last ?? layout();
    // the measure the viewer breaks for: the block element's own width / 2 px per pt
    const measurePt = el ? el.clientWidth / PX_PER_PT : columnPx / (PX_PER_PT * l.eff);
    return { columnPx, measurePt, zoom: s.zoom, effectiveZoom: l.eff, fitted: l.fitted, limited: l.limited, textwidthPt: tw.get() || findTextwidth() };
  }

  // System follows the OS as it changes
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (s.theme === 'system') apply(); }); } catch { /* old browser */ }
  // fit and paper follow the window and the sidebar; paper learns \textwidth from the first block typeset
  // moving: the editors whose widths are moving now (one flag was shared: one editor's ending cleared it
  // while another's went on); the change put off while any moves is applied when the last ends (owed was never read)
  let raf = 0;
  const movingIn = new Set();
  const later = () => { if (movingIn.size) return; if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };
  // while the panes' widths change (panes/widths.js: the blocks keep their lines meanwhile) the column's
  // variables wait (each change restyles and lays out the panes): applied when the motion is over, a frame before the
  // blocks are re-broken at the new width (widths.js end: two tasks, neither long)
  // each attached editor's (view.attach): its widths moving, its results shown
  const onWidths = (r, w) => {
    if (w?.moving) { movingIn.add(r); if (raf) { cancelAnimationFrame(raf); raf = 0; } return; }
    movingIn.delete(r);
    if (movingIn.size) return;                       // another editor's widths still move: applied when they end
    // at once: an instant change (reduced motion) is over before the shell's ResizeObserver reports it
    if (s.width === 'fit' || s.width === 'paper') apply(); else pop?.sync();
  };
  // the blocks being edited (one per pane): side by side or stacked, decided again for the new room
  let rafEdit = 0;
  const redecide = () => {
    if (rafEdit) return;
    rafEdit = requestAnimationFrame(() => {
      rafEdit = 0;
      for (const el of editorRoots().flatMap((r) => r.$$('.blocks > .blk.editing[data-edit-layout]'))) {
        if (el.dataset.editLayout !== 'replace' && s.editLayout !== 'replace') applyLayout(el, decide(s.editLayout, el));
      }
    });
  };
  addEventListener('resize', () => { redecide(); if (s.width === 'fit' || s.width === 'paper') later(); else pop?.sync(); });
  onSettings = redecide;

  // paper by default: until \textwidth is known, ask again once the viewer has laid the blocks out
  const onDisplayed = () => {
    if (s.width === 'paper' && !tw.get()) { later(); tw.whenKnown(() => { if (s.width === 'paper') later(); }); }
    else if (panesOwed()) later();                 // a new pane, or one whose document's \textwidth just became known
  };
  onChange(page.route, (r) => { tw.route(r?.name === 'doc' ? r.id : null); later(); });

  let pop = null;
  /** editor root -> { button, widths } (widths: its panes' width governor, panes/widths.js: the motion of a width
   *  picked, the restyle of the justification switch) */
  const attached = new Map();
  /** fit and paper follow the shell's width: observed (again when another element is the shell) */
  function observe(shell) {
    if (shell === observed) return;
    ro?.disconnect(); ro = null; observed = shell ?? null;
    if (shell && 'ResizeObserver' in window) { ro = new ResizeObserver(() => { if (s.width === 'fit' || s.width === 'paper') later(); }); ro.observe(shell); }
  }
  const measureIn = (x) => {
    editor = x;
    observe(x?.part('shell'));
    if (x) apply();
  };
  /** an editor's View button and its widths (its container: app/editor-root.ts) -> off
   *  @param {import('../app/editor-root.ts').EditorRoot} r
   *  @param {{ widths?: (() => { transition(change: () => unknown, o: { animate: boolean }): unknown, restyle(): unknown } | null) | null }} [o] */
  const attach = (r, { widths = null } = {}) => {
    if (!r || attached.has(r)) return () => {};
    const b = mountViewButton(r, { title: `View: width, text size, colours (${shortcutLabel('mod+alt+v')})`, onClick: (el) => pop.toggle(el) });   // on the kit: view-button.js
    const entry = { b, widths };
    attached.set(r, entry);
    const offs = [onChange(r.state.widths, (w) => onWidths(r, w)), onChange(r.state.displayed, onDisplayed)];
    if (!editor) measureIn(r);
    const off = () => {
      if (attached.get(r) !== entry) return;
      for (const o of offs) o();
      if (pop?.isOpen) pop.close();
      b.destroy(); attached.delete(r);
      if (movingIn.delete(r) && !movingIn.size) later();
      if (editor === r) measureIn(attached.keys().next().value ?? null);
    };
    r.onDispose(off);
    return off;
  };
  const here = () => attached.get(activeRoot()) ?? attached.values().next().value ?? null;
  const btnNow = () => here()?.b.el ?? null;
  // the width motion and the restyle: the editor worked in's panes (none attached: at once)
  widthTransition = (change) => { const w = here()?.widths?.(); return w ? w.transition(change, { animate: true }) : change(); };
  restyle = () => { const w = here()?.widths?.(); if (w) w.restyle(); else for (const el of blockEls()) relayout(el); };

  const view = {
    get settings() { return { ...s }; },
    set, measure,

    /** \textwidth from the preamble's warm (pt): the paper column from the first paint */
    textwidthHint(pt) { const was = tw.get(); tw.learn(pt); if (tw.get() !== was && s.width === 'paper') apply(); },
    zoomBy(dir) { set({ zoom: stepZoom(s.zoom, dir) }); },
    changed,
    open: () => pop.open(btnNow()), close: () => pop.close(), toggle: () => pop.toggle(btnNow()), get isOpen() { return pop.isOpen; },
    /** another editor's View button (its container: app/editor-root.ts) -> off */
    attach,
    colorMap: COLOR_MAP,
    /** app.js: is the block being edited compiled as it is typed? (not in 'replace') */
    livePreview: () => s.editLayout !== 'replace',
    previewDelay: 300,
    /** the layout for editing this block now (re-decided on resize) */
    editDecision: (el = editor?.$('.blocks .blk')) => decide(s.editLayout, el),
    editLayoutFor(el) { const d = decide(s.editLayout, el); applyLayout(el, d); return d; },
    clearEditLayout: clearLayout,
    markCaret, slide, caretMap, keepCaretInView, offsetAt,
    floatIfLarge, clearMirrors, pulse, warmMap,                       // the open decides the float before it places; the close drops the marks at once
    updateFades: (u) => updateFades(u?.source?.querySelector('.cm-scroller')),
    blink: installBlink(),
    /** tests */
    reset() { try { localStorage.removeItem('rtx-editor.view'); } catch { /* */ } Object.assign(s, DEFAULTS); set({}); },
    SLIDER,
  };
  pop = createPopover(view);

  // ⌥⌘= ⌥⌘− ⌥⌘0 (Ctrl+Alt on Windows/Linux): text size; ⌥⌘V: the popover. Not ⌘= / ⌘−:
  // browser zoom stays the reader's (it scales the chrome too, which low-vision readers rely on)
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.getModifierState?.('AltGraph')) return;
    const c = e.code;
    const dir = c === 'Equal' || c === 'NumpadAdd' ? 1 : c === 'Minus' || c === 'NumpadSubtract' ? -1 : c === 'Digit0' || c === 'Numpad0' ? 0 : null;
    if (dir != null) { e.preventDefault(); view.zoomBy(dir); return; }
    if (c === 'KeyV') { e.preventDefault(); view.toggle(); }
  });

  return view;
}
