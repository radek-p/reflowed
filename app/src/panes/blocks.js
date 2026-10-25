// PANES (out of app.js): what each block shows, in every pane. A block's STATE is the document's
// (app.js ui: Map id -> state): its kind and state, the result it shows (mounted: { ck, key }), its decor
// (panes/decor.js), the live-preview fields edit/ keeps on it. Its VIEWS are the panes' (panes/block-view.js,
// one per pane). display(id) works out what the block shows once and paints every view no editor is on (an
// editing session paints its own surface: edit/session.js show()); mount(id, r, key) delivers a result to every
// view: the first pane's view is mounted from the result, the others are views of it (the viewer's
// host.mount(el, { of, view })), and all swap in one task, so the panes never show two different results of a
// block. A pane opened later gets views of what is shown (deliver / ensureViews).
//
//   const blocks = createBlocks(host)
//   host: { blocks() (the document's, in order), ui, panes, edits, nest, view() (ctx.view), perf, counters, cache, blockById, kindOf, viewKey, viewResult,
//           ck, pass?(fn) (fn reads every block's key: doc/derived.js pass), recalled(id), markerOf(b), blockAction(b) (app/feature.ts),
//           changed(), changedLater(), userBlock(id), compileSoon(),
//           showErrors(box, problems, id), on: BlockView handlers (panes/block-view.js) }
//   blocks.state(b) -> the block's state (made once) · blocks.makeView(paneId, id) -> BlockView · blocks.dispose(u)
//   blocks.redisplay(which?) every block of the document, in order, or those which(b) is true for (the one
//   traversal; it was seven loops, each with its own skip; one pass over the keys) · blocks.stale(b) it shows another
//   key than it would show now (a context moved: a definition or a reference elsewhere changed), or a result came for its key since
//   (a block still waiting for its result is not stale: displaying it again changes nothing)
//   blocks.display(id) · blocks.mount(id, r, key) -> Promise · blocks.ensureViews(id) · blocks.applySpacing(id)
//   blocks.visible (Set of block ids near the viewport in any pane) · blocks.unmountAll(u)
//   blocks.lazy (a pane opened makes its views of off-screen blocks lazily: panes/lazy-views.js)
import { signal } from '@preact/signals';
import { morph } from '../app/motion.js';
import { carryDisplayScroll } from '../view/display-scroll.js';
import { createDecor } from './decor.js';
import { createBlockView } from './block-view.js';
import { createLazyViews } from './lazy-views.js';
import { bump } from '../app/page-state.ts';
import { previewOf, showPreview } from './paint.ts';
import { gapBetween } from '../../../engine/web/spacing.ts';
import { PX_PER_PT } from '../view/settings.js';

/** what two neighbouring blocks put between their renders themselves: .blk's 1 px and .blk-render's 4 px padding, below
 *  the one and above the other (app.css; it was taken as 8, the renders' only) */
const OWN_PAD = 10;
let seq = 0;                         // viewer view names: unique (an old view and its successor overlap while it lays out)

export function createBlocks(host) {
  // (the host's panes and edits are made after this: read when used)
  const { ui, nest } = host;
  const P = () => host.panes, E = () => host.edits;
  const views = (id) => P().viewsOf(id);
  const viewer = () => window.reflowtex.host;

  // ── near the viewport, in any pane (the compile queue sends those first) ──
  const visible = new Set();
  const seen = new Map();            // block id -> panes it is near the viewport in
  const io = new IntersectionObserver((entries) => {
    let more = false;
    for (const e of entries) {
      const id = e.target.dataset.id, p = e.target.dataset.pane;
      let s = seen.get(id);
      if (e.isIntersecting) { if (!s) seen.set(id, s = new Set()); s.add(p); if (!visible.has(id)) { visible.add(id); more = true; } }
      else if (s) { s.delete(p); if (!s.size) { seen.delete(id); visible.delete(id); } }
    }
    if (more) host.compileSoon();
  }, { rootMargin: '600px 0px' });

  /** the block's state: made once per block (its decor reaches every view, those made later too) */
  function state(b) {
    let u = ui.get(b.id);
    if (u) return u;
    const decor = createDecor(() => views(b.id).map((v) => v.root));
    u = {
      id: b.id, state: '', token: 0, mounted: null, mounting: null, shown: null, action: signal(null), decor,
      cls: decor.cls, data: decor.data, style: decor.style,
      get views() { return views(b.id); },
    };
    ui.set(b.id, u);
    return u;
  }

  /** a pane's view of block `id`: the shell, the decor, a container's head, watched for the viewport */
  function makeView(paneId, id) {
    const u = ui.get(id);
    const v = createBlockView({ id, pane: paneId, action: u?.action ?? null, on: host.on });
    u?.decor.applyTo(v.root);
    host.viewState?.(paneId, id, v.root);              // what is this pane's own (its selection): panes/pane-state.js
    io.observe(v.root);
    const dispose = v.dispose;
    v.dispose = () => { io.unobserve(v.root); nest.unwatch?.(v.root); const s = seen.get(id); if (s) { s.delete(paneId); if (!s.size) { seen.delete(id); visible.delete(id); } } dispose(); };
    return v;
  }

  /** the block is gone: its editors, and its views in every pane */
  function dispose(u) {
    E().dropBlock(u.id);
    for (const p of P().list()) { const v = p.views.get(u.id); if (v) { v.dispose(); p.views.delete(u.id); } }
    u.mounted = null;
  }

  // ── what a block shows ──
  function display(id) {
    host.counters.displays = (host.counters.displays ?? 0) + 1;
    for (const v of views(id)) v.keepHeld = false;
    displayBlock(id);
    for (const v of views(id)) if (v.held && !v.keepHeld) releaseHeight(v);     // only a first mount in flight keeps it
  }

  function displayBlock(id) {
    const b = host.blockById(id), u = ui.get(id);
    if (!b || !u) return;
    const V = host.view();
    u.data('kind', b.kind || host.kindOf(b.source));
    // the views an editing session is on are its own (edit/session.js show()); the others are painted here
    const free = [];
    for (const v of views(id)) {
      const own = E().surfaceSession(v.root);
      // a view whose popover is fading out (motion/popover.js closeMotion): its layout goes with the teardown
      const leaving = v.root.classList.contains('rtx-leaving');
      // a view no longer edited, however editing ended (a move, a rebuild): its mirrored caret and layout go
      if (!own && !leaving && (v.root.dataset.editLayout || v.render.querySelector('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band'))) V?.clearEditLayout?.(v.root);
      v.root.classList.toggle('editing', !!own || leaving);
      if (!own && !leaving) free.push(v);
    }
    u.shown = null;
    if (E().isEditing(id)) {
      // the block's live preview (edit/live.js) is delivered to every view; each editor shows it on its surface
      const st = E().live.display(id, b, u);
      for (const s of E().sessionsOf(id)) s.show(st);
      if (st) {
        // the other panes show the live result as it lands
        for (const v of free) { v.source.hidden = true; if (v.mounted) { v.render.hidden = false; v.preview.hidden = true; } host.showErrors(v.errors, [], id); }
        return;
      }
      if (!free.length) return;
    }
    for (const v of free) v.source.hidden = true;
    const key = host.viewKey(b), result = host.viewResult(b);
    u.shown = { key, r: result };                      // what it shows now (stale: a key or a result since)
    if (nest.display(b, u, free)) { unmountViews(u, free); u.data('marker', null); return; }      // a container: its head in each pane
    const a = host.blockAction(b);                     // a feature's button on the block: drawn again when it changes
    if ((a?.id ?? null) !== (u.action.peek()?.id ?? null)) u.action.value = a;
    const empty = !b.source.trim();
    const marker = empty ? null : host.markerOf(b);
    if (marker) {
      unmountViews(u, free);
      u.state = 'marker'; u.data('state', 'marker');
      u.data('marker', marker);
      for (const v of free) {
        host.showErrors(v.errors, [], id);
        showPreview(v, previewOf(marker, b.source, { marker: true }));
      }
      return;
    }
    u.data('marker', null);
    const r = empty ? null : result;
    u.data('recall', host.recalled(id) ? '' : null);
    const state = empty ? 'empty' : !r ? 'pending' : r.status === 'ok' && !r.nodelist ? 'source' : r.status;
    if (u.state === 'pending' && state !== 'pending') for (const v of free) landed(v);     // the side line fades out
    u.state = state;
    u.data('state', state);
    for (const v of free) host.showErrors(v.errors, r?.status === 'error' ? r.errors : [], id);
    if (empty) {
      unmountViews(u, free);
      for (const v of free) showPreview(v, previewOf('empty', ''));
      return;
    }
    if (state === 'ok') {
      // the source preview gives way to a render the viewer has not filled yet: each view keeps its
      // height until its mount lands (swap), so many results landing together never collapse a pane (the
      // browser then clamps the scroll and an outline jump loses its place)
      for (const v of free) {
        // a view a newly opened pane makes lazily: reserved at its block's height in the first pane, no read here
        if (!v.mounted && !v.held && !v.preview.hidden && !lazy.defer(v)) holdHeight(v);
        v.keepHeld = !v.mounted && v.held;
        v.preview.hidden = true;
        v.render.hidden = false;
        v.render.classList.remove('stale');
      }
      if (u.mounted?.ck !== key && u.mounting !== key) mount(id, r, key);     // (a mount of it on its way: not again)
      else ensureViews(id);
      return;
    }
    for (const v of free) {
      if (v.mounted && state !== 'source') {
        v.render.hidden = false;
        v.preview.hidden = true;
        v.render.classList.add('stale');
      } else {
        if (state === 'source') unmountView(v);
        showPreview(v, previewOf(state, b.source));
      }
    }
    if (state === 'source' && !views(id).some((v) => v.mounted)) u.mounted = null;
  }

  function landed(v) {
    // (restarting the fade needs a style flush; one landing, the usual case, has none to restart: no forced layout per block)
    if (v.root.classList.contains('landed')) { v.root.classList.remove('landed'); void v.root.offsetWidth; }
    v.root.classList.add('landed');
    setTimeout(() => v.root.classList.remove('landed'), 400);
  }

  /** keep a view's drawn height while its first typeset result mounts; released by the mount (or any other display). */
  function holdHeight(v) {
    const hgt = v.root.getBoundingClientRect().height;
    if (hgt > 0) { v.root.style.minHeight = `${hgt}px`; v.held = true; }
  }
  function releaseHeight(v) {
    v.root.classList.remove('rtx-lazy');          // a lazily made view: shown, no longer skipped
    if (!v.held) return;
    v.held = false;
    v.root.style.minHeight = '';
  }

  function unmountView(v) {
    if (!v.mounted) return;
    try { v.mounted.block.destroy(); } catch { /* gone */ }
    v.mounted.el.remove();
    v.mounted = null;
  }
  function unmountViews(u, list) {
    for (const v of list) unmountView(v);
    if (!views(u.id).some((v) => v.mounted)) u.mounted = null;
  }

  const newBlockEl = (v) => {
    const el = document.createElement('div');
    el.className = 'latex-block';
    const cm = host.view()?.colorMap;
    if (cm) el.dataset.colorMap = cm;                      // TeX's colours per theme
    if (v.mounted) el.classList.add('incoming');
    v.render.append(el);
    return el;
  };
  const displayed = (id) => bump(host.state.displayed, { id });   // the container's signal (app/page-state.ts)
  /** is the view on screen in its pane (a height change there is animated; elsewhere it lands at once, the keeper holds) */
  function onScreen(v) {
    const p = P().get(v.pane);
    // the pane's own box, as the keeper sees it: a window pane's starts below the top bar (a block under the
    // bar was counted on screen and morphed while the keeper held the text below the bar)
    const box = p ? p.box() : { top: 0, bottom: innerHeight };
    const r = v.root.getBoundingClientRect();
    return r.bottom > box.top && r.top < box.bottom;
  }

  /** a new result for block `id`: every view gets it; all swap in one task */
  async function mount(id, r, key) {
    const u = ui.get(id);
    if (!u) return;
    const token = ++u.token;
    const vs = views(id);
    if (!vs.length) return;
    u.mounting = key;
    const editing = E().isEditing(id);
    const els = vs.map(newBlockEl);
    els[0].dataset.nodelistB64 = r.nodelist;
    let first, rest;
    try {
      first = await viewer().mount(els[0], fitOpts(vs[0]));
      if (editing) { try { first.setDisplayFade?.(false); } catch { /* an older viewer */ } }   // shown whole while edited
    } catch (e) {
      console.warn('mount failed', e);
      for (const el of els) el.remove();
      if (token === u.token) {
        u.mounting = null;
        for (const v of vs) releaseHeight(v);
        host.cache.set(key, { ...r, status: 'error', errors: [{ severity: 'error', message: `the viewer could not show this block: ${e.message}`, line: null }] });
        display(id);
      }
      displayed(id);
      return;
    }
    // the other panes: views of it (one source: the viewer lays each out at its pane's width)
    rest = await Promise.all(els.slice(1).map((el, k) => viewer().mount(el, { of: first, view: `${vs[k + 1].pane}-${++seq}`, ...(editing ? { displayFade: false } : {}), ...fitOpts(vs[k + 1]) })
      .catch((e) => { console.warn('view failed', e.message); return null; })));
    const made = [first, ...rest];
    if (token !== u.token || !ui.has(id)) {
      made.forEach((m, k) => { try { m?.destroy(); } catch { /* */ } els[k].remove(); });
      displayed(id);
      return;
    }
    const swaps = vs.map((v, k) => ({ v, el: els[k], block: made[k] }));
    const sync = new Set();
    for (const s of swaps) {
      if (!s.block) s.v.failed = key;                                   // (a view that could not be made: not waited for)
      if (s.v.disposed || !s.block) { try { s.block?.destroy(); } catch { /* */ } s.el.remove(); continue; }   // its pane closed meanwhile
      const swap = () => {
        const v = s.v;
        if (v.mounted) carryDisplayScroll(v.mounted.el, s.el);           // a panned display stays where it was
        unmountView(v);
        s.el.classList.remove('incoming');
        v.mounted = { ck: key, el: s.el, block: s.block };
        releaseHeight(v);                                                // its own height from here on
        // a live result of a block being edited: shown in every pane (the source stand-in goes where no editor is)
        if (editing) { v.render.hidden = false; if (!E().surfaceSession(v.root)) v.preview.hidden = true; }
      };
      // no height animation out of view: the final height at once (the pane's anchor holds)
      if (s.v.mounted && !editing && !s.v.render.hidden && (host.perf.disabled || onScreen(s.v))) morph(s.v.main, swap);
      else { swap(); sync.add(s.v.pane); }
    }
    u.mounted = { ck: key, key: r.key };
    u.mounting = null;
    if (editing) E().swapped(id);                                      // a stacked popover keeps its place; carets marked
    for (const p of sync) P().get(p)?.keeper?.sync?.();               // held at once
    applySpacing(id);
    host.counters.mounts++;
    if (host.userBlock(id)) host.changed(); else host.changedLater();
    ensureViews(id);                                                     // a pane opened while it was on its way
    displayed(id);
  }

  /** views that do not show the block's result yet (a pane opened, a view made again): views of a view that does */
  function ensureViews(id) {
    const u = ui.get(id);
    if (!u?.mounted) return;
    const ck = u.mounted.ck;
    const vs = views(id);
    const src = vs.find((v) => v.mounted?.ck === ck);
    if (!src) return;
    for (const v of vs) if (v.mounted?.ck !== ck && v.pending !== ck && v.failed !== ck && !lazy.defer(v)) viewOf(u, v, src.mounted.block, ck);
  }
  /** a view whose block is edited with its displays fitted to the pane (edit/fit.js) is mounted fitted: the
   *  display scroll carried over is then the fitted box's, not a column box's shifted by the fit a moment later */
  function fitOpts(v) { return v?.root?.classList.contains('rtx-fit') ? { displayFit: 'natural' } : {}; }
  async function viewOf(u, v, of, ck) {
    const token = (v.viewToken = (v.viewToken ?? 0) + 1);
    v.pending = ck;
    const el = newBlockEl(v);
    let block;
    try { block = await viewer().mount(el, { of, view: `${v.pane}-${++seq}`, ...(E().isEditing(u.id) ? { displayFade: false } : {}), ...fitOpts(v) }); }
    catch (e) { console.warn('view failed', e.message); el.remove(); if (token === v.viewToken) { v.pending = null; v.failed = ck; } displayed(u.id); return; }
    if (token !== v.viewToken || v.disposed || u.mounted?.ck !== ck || v.mounted?.ck === ck) { try { block.destroy(); } catch { /* */ } el.remove(); if (token === v.viewToken) v.pending = null; return; }
    if (v.mounted) carryDisplayScroll(v.mounted.el, el);
    unmountView(v);
    el.classList.remove('incoming');
    v.mounted = { ck, el, block };
    v.pending = null;
    releaseHeight(v);
    P().get(v.pane)?.keeper?.sync?.();
    if (E().isEditing(u.id)) E().swapped(u.id);                     // an editor on this view marks its caret in it
    displayed(u.id);
  }

  // V5: the gap above a block from the engine's spacing data, when both neighbours have it: engine/web/spacing.ts
  // gapBetween, TeX's list rebuilt (\addvspace and \addpenalty made again on the previous block's tail, then the
  // baselineskip rule; engine-node's spacing check holds it to TeX's own gaps). Without data the CSS rules in app.css
  // apply. Block decor: the same in every pane.
  function applySpacing(id) {
    const list = host.blocks();
    const i = list.findIndex((b) => b.id === id);
    // containers have no spacing of their own: a first paragraph's gap is to the block before its
    // container, and it goes above the container's head
    const nextTypeset = (k) => { let j = k + 1; while (list[j] && nest.isContainer(list[j])) j++; return j; };
    for (const k of [i, nextTypeset(i)]) {
      const b = list[k], prev = nest.spacingPrev(k);
      if (!b || nest.isContainer(b)) continue;
      const t = ui.get(nest.spacingTarget(k).id);
      if (!t) continue;
      // a block being typed in has no result for its current source until its live compile lands: the spacing
      // of the result it shows (the gap fell back to the CSS one for those frames: the block jumped 9.6 px and back)
      const spacingOf = (x) => host.cache.get(host.ck(x))?.spacing ?? host.cache.get(ui.get(x.id)?.mounted?.ck)?.spacing;
      const sa = spacingOf(b), sb = prev && spacingOf(prev);
      if (!sa || !sb) { t.style('margin-top', null); t.data('tex', null); continue; }
      const gap = gapBetween(sb, sa).totalPt;
      // at the blocks' scale: the viewer's 2 px/pt times the zoom the block elements are drawn at (view/style.js; it was
      // 96/72.27 px/pt, two thirds of it: every gap between blocks drawn a third too small), minus the two blocks' own
      // padding (OWN_PAD); may be negative: a gap smaller than that is TeX's too
      t.style('margin-top', `calc(${(gap * PX_PER_PT).toFixed(2)}px * var(--rtx-view-zoom, var(--rtx-zoom, 1)) - ${OWN_PAD}px)`);
      t.data('tex', '1');
    }
  }

  const lazy = createLazyViews({ ensure: (id) => ensureViews(id) });

  function redisplay(which = null) {
    const all = () => { for (const b of host.blocks()) if (!which || which(b)) display(b.id); };
    if (host.pass) host.pass(all); else all();
  }
  // what display would show now differs from what it showed: another key, or a result come (or gone) for it; a block
  // edited: its views show the live preview, so the key it has mounted
  function stale(b) {
    const u = ui.get(b.id);
    if (!u) return true;
    const key = host.viewKey(b);
    if (u.shown && !E().isEditing(b.id)) return u.shown.key !== key || u.shown.r !== host.viewResult(b);
    return !u.mounted || u.mounted.ck !== key;
  }

  return {
    state, makeView, dispose, display, redisplay, stale, mount, ensureViews, applySpacing, visible, lazy,
    unmountAll: (u) => unmountViews(u, views(u.id)),
    /** a view still to show the block's result (whenIdle waits for it) */
    lags: (u) => !!u?.mounted && views(u.id).some((v) => v.mounted?.ck !== u.mounted.ck && v.failed !== u.mounted.ck),
    /** (tests) the block's views: pane -> whether it shows the block's result */
    shows: (id) => Object.fromEntries(views(id).map((v) => [v.pane, !!v.mounted && v.mounted.ck === ui.get(id)?.mounted?.ck])),
    /** the viewer block of a block's result in pane `p` (else any view): refs, figures, the caret */
    blockIn: (id, p = null) => { const vs = views(id); return (vs.find((v) => v.pane === p && v.mounted) ?? vs.find((v) => v.mounted))?.mounted?.block ?? null; },
    destroy() { io.disconnect(); lazy.dispose(); },
  };
}
