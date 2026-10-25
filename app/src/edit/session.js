// One pane's editing session, the "editing popover".
//
// A session edits one block at a time, on a SURFACE in its pane: that pane's view of the block (panes/block-view.js:
// every pane has its own, equal; the live results are delivered to all of them). A session owns what is its own:
// its CodeMirror (caret, selection, undo history), the source panel and the error note (Preact,
// edit/panel.js), the edit layout of its surface (side by side / stacked / replace: view/edit-layout.js),
// the caret and selection mirrored in its surface's render. What belongs to the block is shared: its
// source (one truth: each editor's change is applied to the others' as a remote change, outside their
// undo), its live preview (edit/live.js) and its results. No module state: createEditing makes one
// session per pane and keeps it on the pane's DocumentView.
//
//   const s = createSession(core, pane)    pane 'a' | 'b'
//   s.enter(id, { event, caret, line, range, surface }) · s.leave({ animate }) · s.drop() (its block is gone)
//   s.id · s.editor · s.surface · s.mode · s.show(state) · s.caretSoon() · s.applyRemote(changes) · s.marks()
//   s.keepInView()   the window's visible part changed (an on-screen keyboard): the code caret kept in view
import { signal } from '@preact/signals';
import { screenCTM } from '../view/screen-ctm.ts';
import { morph } from '../app/motion.js';
import { sourcePositionFor } from '../app/source-position.js';
import { renderSourcePanel, renderErrorsPanel, clearPanel } from './panel.js';
import { remoteChange } from '../app/editor-entry.js';
import { openMotion, closeMotion } from '../motion/popover.js';
import { besideRender } from './frame-click.js';
import { fitOn, fitOff } from './fit.js';
import { POP_SHADOW } from '../motion/place.js';
import { previewOf } from '../panes/paint.ts';
import { shownBlock } from '../view/shown.ts';
import { visibleBox } from '../../../workbench/src/viewport.ts';

export function createSession(core, pane) {
  const s = {
    pane,
    id: null,
    editor: null,
    surface: null,
    mode: null,                       // the surface's edit layout: 'side' | 'stacked' | null (replace)
    startSource: null,
    note: signal(null),               // the live error note (panel.js LiveNote), or null
    rows: signal([]),                 // a first compile failing with nothing shown yet: plain rows
    layout: signal(null),
    raf: 0,
    follow: false,                    // the page follows the caret: after a caret move made here, until the reader scrolls (edit/follow.js)
    report: (p) => (s.id ? core.problemReport(s.id, p) : ''), open: (p) => { if (s.id) core.openProblem(s.id, p); },
    enter, leave, drop, show, caretSoon, previewClick, applyRemote, marks, reposition, refit, keepInView,
  };
  const V = () => core.view;          // ctx.view: the edit layout, the caret marks, the slide
  const ui = (id) => core.ui.get(id);

  /** Open block `id` here. o.surface: where (the core decided: this pane's view of the block). */
  function enter(id, o) {
    const b = core.blockById(id), u = ui(id), sf = o.surface;
    if (!b || !u || !sf) return false;
    s.closing?.finish();                              // a close fading out here ends now (its editor goes)
    // stacked (the layout): one motion, its final place decided before anything shows
    const d0 = V()?.editDecision?.(sf.root) ?? null;
    const MP = d0?.mode === 'stacked' ? core.motionPane?.(pane) : null;
    if (o.still) return enterStill(id, b, u, sf, o);
    if (MP) return enterStacked(id, b, u, sf, o, MP);
    if (s.id) {
      // the block above another's editor closes at once and the page is put back where it was (the new one
      // stays under the pointer); below, the old one closes with its motion
      if (core.indexOf(s.id) < core.indexOf(id)) {
        const y0 = sf.root.getBoundingClientRect().top;
        leave({ animate: false });
        const dy = sf.root.getBoundingClientRect().top - y0;
        if (Math.abs(dy) > 0.5) core.scrollBy(pane, dy);
      } else leave();
    }
    const { click, pos } = clickPosition(id, b, u, sf, o);
    const shows = core.shows(sf, u);
    s.id = id;
    s.surface = sf;
    s.follow = true;                                  // opened by the reader: its caret is followed until they scroll
    s.startSource = b.source;
    core.opened(s);                                   // the registry: the block is edited (live state, active session, select)
    const d = V() ? V().editLayoutFor(sf.root) : { mode: 'replace' };
    s.mode = d.mode === 'replace' ? null : d.mode;
    s.layout.value = s.mode;
    sf.root.classList.add('editing');
    const r0 = s.mode && shows && !sf.render.hidden ? sf.render.getBoundingClientRect() : null;   // nothing to slide without a render
    const live = !!s.mode;
    morph(sf.main, () => mount(id, b, sf, pos, o), {
      after: () => {
        if (!s.editor || s.id !== id) return;
        const view = s.editor.view;
        const head = view.state.selection.main.head;
        const box = core.paneBox(pane);
        if (pos && click && !live) {
          const c = view.coordsAtPos(head);
          if (c) { const dy = (c.top + c.bottom) / 2 - click.y; if (Math.abs(dy) > 2) core.scrollBy(pane, dy); }
        } else {
          // entered from the keyboard, a panel or find: bring the caret into view
          const c = view.coordsAtPos(head);
          if (!c || c.top < box.top + 14 || c.bottom > box.bottom - 30) s.editor.reveal(head);
          // and again once the open animation is over: while the block grows, the browser's scroll
          // anchoring (an anchor below it) can carry it up past the top bar
          requestAnimationFrame(() => {
            const again = () => {
              if (s.id !== id || !s.editor || !s.follow) return;      // the reader scrolled away meanwhile
              // the whole block when it fits between the top bar and the bottom, else the caret
              const bx = core.paneBox(pane), r = sf.root.getBoundingClientRect(), room = bx.bottom - bx.top;
              if (r.height < room - 54 && (r.top < bx.top || r.bottom > bx.bottom - POP_SHADOW)) { core.scrollBy(pane, r.top < bx.top ? r.top - bx.top - 8 : r.bottom - bx.bottom + POP_SHADOW); }
              const h2 = s.editor.view.state.selection.main.head, c2 = s.editor.view.coordsAtPos(h2);
              if (!c2 || c2.top < bx.top + 14 || c2.bottom > bx.bottom - 30) s.editor.reveal(h2);
            };
            Promise.all(sf.main.getAnimations({ subtree: true }).map((a) => a.finished)).then(again, again);
          });
        }
      },
    });
    if (r0) V()?.slide?.(sf, r0, { entering: true });     // the result slides to its place
    holdPopover(sf);
    return true;
  }

  /** clicked: where in the source (null: not a click on this render) */
  function clickPosition(id, b, u, sf, o) {
    const ev = o.event;
    const click = ev && 'clientX' in ev ? { x: ev.clientX, y: ev.clientY, target: ev.target } : null;
    if (!click || o.caret != null || o.line != null || !core.shows(sf, u)) return { click, pos: null };
    // the text editor's hit rule on the render of this very source (view/edit-layout.js offsetAt); else the fuzzy ways
    const hit = u.mounted.ck === core.viewKey(b) ? V()?.offsetAt?.(sf.render, core.cache.get(u.mounted.ck), b.source, b.source, click.x, click.y) : null;
    const pos = hit != null ? { offset: hit, method: 'boundary', glyph: '' } : sourcePositionFor({ source: b.source, el: sf.render, result: core.cache.get(core.ck(b)) ?? null }, click);
    core.setLastPosition(pos ? { id, ...pos } : null, pane);
    return { click, pos };
  }

  /** the editor in the popover: made, its caret or selection set, focused, laid out (not scrolled into view) */
  function mount(id, b, sf, pos, o) {
    s.editor?.destroy();
    s.note.value = null; s.rows.value = [];
    renderSourcePanel(sf.source, s);
    const island = sf.source.querySelector(':scope > .cm-island');
    s.editor = core.createEditor(island, {
      doc: b.source,
      carry: o.carry ?? null,                         // the editor of a pane that closed, going on here
      placeholder: 'LaTeX … (/ for a block type)',
      onChange: (text, update) => core.typed(s, text, update),
      // the caret mirrored; a move made in this editor (not another pane's change applied here) is followed
      onSelect: (_sel, u) => { if (!u?.transactions?.some((tr) => tr.annotation(remoteChange))) s.follow = true; caretSoon(); },
      onKey: (name) => core.editorKey(s, name),
      ...core.editorHelpers(),
    });
    core.attached(s);
    core.display(id);
    const view = s.editor.view;
    const at = pos ? pos.offset : o.caret;
    if (o.carry) { /* its selection came with it */ }
    else if (o.range) view.dispatch({ selection: { anchor: Math.min(o.range.from, view.state.doc.length), head: Math.min(o.range.to, view.state.doc.length) } });
    else if (at != null) view.dispatch({ selection: { anchor: Math.min(at, view.state.doc.length) } });
    else if (o.line != null && o.line >= 1 && o.line <= view.state.doc.lines) {
      const l = view.state.doc.line(o.line);
      view.dispatch({ selection: { anchor: l.from, head: l.to } });
    } else view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    s.editor.settle();
    refit();                                          // its wide displays whole, in this pane
    marks();
    core.find?.applyTo(id, s.editor);
  }
  /** the displays of the block edited here fitted to the pane (again after a result swapped a new view in) */
  function refit() { if (s.surface) fitOn(s.surface, core.viewerBlock?.(s.surface), { side: s.mode === 'side' }); }

  /** open in the stacked layout: the change (another editor here closed, this one mounted, the caret
   *  marked), the final place (motion/place.js) and one motion (motion/popover.js), all decided in this task */
  function enterStacked(id, b, u, sf, o, MP) {
    const { pos } = clickPosition(id, b, u, sf, o);
    const shows = core.shows(sf, u);
    const m = openMotion(MP, sf, {
      change: () => {
        if (s.id) leave({ animate: false });           // another block's editor in this pane: closed in the same change
        s.id = id;
        s.surface = sf;
        s.follow = true;                              // opened by the reader: its caret is followed until they scroll
        s.startSource = b.source;
        core.opened(s);
        const d = V().editLayoutFor(sf.root);
        s.mode = d.mode === 'replace' ? null : d.mode;
        s.layout.value = s.mode;
        sf.root.classList.add('editing');
        mount(id, b, sf, pos, o);
        revealInside(s.editor.view);
        V().floatIfLarge?.(sf, roomOf(core.paneScroll(pane)));
        if (shows) markNow({ scroll: false });         // the caret's line in the result: the placement keeps it in view
      },
      caret: () => sf.render.querySelector('.rtx-caret-bar')?.getBoundingClientRect() ?? null,
      float: () => sf.root.classList.contains('rtx-float'),
    });
    s.motion = m.finished;
    V()?.pulse?.(sf.root);                            // both current lines pulse once
    holdPopover(sf, m.renderH);                       // the height the motion read (no layout read after its animations)
    return true;
  }
  /** open with no motion and no scroll: the editor of a pane that closed goes on here, as it was (o.carry: its
   *  text, selection and undo; o.scrollTop: the editor's own scroll). The caller puts the page where it was seen. */
  function enterStill(id, b, u, sf, o) {
    if (s.id) leave({ animate: false });
    const shows = core.shows(sf, u);
    s.id = id;
    s.surface = sf;
    s.follow = o.follow ?? true;                       // following the caret as it was there
    s.startSource = b.source;
    core.opened(s);
    const d = V() ? V().editLayoutFor(sf.root) : { mode: 'replace' };
    s.mode = d.mode === 'replace' ? null : d.mode;
    s.layout.value = s.mode;
    sf.root.classList.add('editing');
    mount(id, b, sf, null, o);
    if (o.scrollTop != null) { s.editor.view.scrollDOM.scrollTop = o.scrollTop; s.editor.settle(); } else revealInside(s.editor.view);
    if (s.mode === 'stacked') V()?.floatIfLarge?.(sf, roomOf(core.paneScroll(pane)));
    if (shows) markNow({ scroll: false });
    holdPopover(sf);
    return true;
  }
  const roomOf = (ps) => (ps ? ps.bottom - (ps.origin ?? ps.top ?? 0) : visibleBox().bottom);

  /** the window's visible part changed (an on-screen keyboard came up or went down, a rotation; edit/index.js
   *  calls it in viewport.ts's reveal phase, after the panes' --pane-h: the popover's cap is half of what is seen). Only
   *  for the editor with the focus, while it is followed. The least scroll of the pane that shows the popover whole (it is at most half the pane), or its caret line when
   *  it is taller (side by side, replace), and the caret's line inside the popover's own scroller. Nothing moves when
   *  all of it is in view already. Stacked first: the float decided again for the new room and the preview's mirrored
   *  caret kept in its part (view/edit-layout.js keepCaretInView). */
  function keepInView() {
    const sf = s.surface, ed = s.editor;
    if (!s.id || !sf || !ed || !s.follow || !ed.view.hasFocus) return;
    revealInside(ed.view);
    // stacked: the float decided again for the new room, and the mirrored caret kept in the preview's part (keepCaretInView)
    if (s.mode === 'stacked') V()?.keepCaretInView?.(sf, core.paneScroll(pane), { follow: !sf.root.classList.contains('rtx-moving') });
    const ps = core.paneScroll(pane);
    if (!ps) return;
    const top = ps.top + 8, bottom = ps.bottom - POP_SHADOW;   // its shadow inside the pane (motion/place.js)
    const pop = sf.source.getBoundingClientRect(), c = ed.view.coordsAtPos(ed.view.state.selection.main.head);
    const r = pop.height <= bottom - top ? pop : c;
    if (!r) return;
    let dy = r.bottom > bottom ? r.bottom - bottom : 0;
    if (r.top - dy < top) dy = r.top - top;
    if (Math.abs(dy) >= 1) ps.scrollBy(dy);
  }

  /** the caret's line inside the popover's own scroller (never the window: it is placed already) */
  function revealInside(view) {
    const sc = view.scrollDOM, head = view.state.selection.main.head;
    if (sc.scrollHeight <= sc.clientHeight + 1) return;
    const line = view.lineBlockAt(head);
    if (line.top >= sc.scrollTop && line.bottom <= sc.scrollTop + sc.clientHeight) return;
    sc.scrollTop = Math.max(0, line.top - sc.clientHeight / 3);
    s.editor.settle();
  }

  /** stacked: the source popover keeps its place in the window while the preview above it changes height
   *  (a result with another line count): the page scrolls by the change, after layout and before paint, so only the
   *  preview moves. Not while the popover floats (it is sticky then), nor in another layout. h0: the preview's height
   *  now, when the caller read it already. */
  function holdPopover(sf, h0 = null) {
    s.ro?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    let h = h0 ?? sf.render.getBoundingClientRect().height;
    const check = () => {
      const now = sf.render.getBoundingClientRect().height, d = now - h;
      h = now;
      if (Math.abs(d) < 0.5 || s.surface !== sf || sf.root.dataset.editLayout !== 'stacked' || sf.root.classList.contains('rtx-float') || sf.render.hidden) return;
      if (sf.main.classList.contains('morphing') || sf.root.classList.contains('rtx-moving')) return;   // entering / leaving: the motion eases it
      core.scrollBy(pane, d, { hold: true });       // a correction: the keeper's reading point (the caret's line) stays
    };
    s.hold = check;                                   // the core calls it in the task that swaps a result in (no frame between)
    s.ro = new ResizeObserver(check);                 // and a backstop: any other change of the preview's height
    s.ro.observe(sf.render);
  }

  /** Close the editor: its source is the block's (it always was: every change went there), the layout goes. */
  function leave({ animate = true } = {}) {
    const id = s.id;
    if (!id) return;
    s.ro?.disconnect(); s.ro = null; s.hold = null;
    const sf = s.surface, ed = s.editor;
    const started = s.startSource;
    s.id = null;
    core.closing(s, id, ed);                          // the registry: lastCaret, the queue's "just left", the active session
    const change = () => {
      quiet(sf);                                      // the fit off first
      ed?.destroy();
      if (s.editor === ed) s.editor = null;
      strip(sf);
      core.surfaceLeft(s, id, sf);                    // the view is displayed as the block is again
    };
    // stacked: the mirror of the open — the popover fades where it is, out of the flow, the blocks
    // below slide up into its space (transforms); the editor goes when it has faded; the refresh after the motion
    const MP = sf && animate && sf.root.dataset.editLayout === 'stacked' ? core.motionPane?.(pane) : null;
    if (MP) {
      if (s.editor === ed) s.editor = null;
      try { ed?.view.contentDOM.blur(); } catch { /* gone */ }
      let m = null;
      m = closeMotion(MP, sf, {
        change: () => {
          quiet(sf);                                   // back to the column, inside the close motion
          V()?.clearMirrors?.(sf.root);
          core.surfaceLeft(s, id, sf);
        },
        teardown: () => {
          if (m && s.closing === m) s.closing = null;
          ed?.destroy();
          if (s.surface === sf && s.id) return;          // opened again meanwhile: its own panel is there
          strip(sf);
          if (!core.blockById(id)) return;
          core.display(id);                              // painted as the block is, now that the fade is over
        },
      });
      s.closing = m.ended() ? null : m;
      s.surface = null; s.mode = null; s.layout.value = null;
      // saved, contexts, other blocks displayed, compile: after the motion (not if the document went meanwhile)
      core.after(m.finished, () => { if (core.blockById(id)) core.closed(s, id, started); });
      return;
    }
    const r0 = sf && animate && sf.root.dataset.editLayout && sf.root.dataset.editLayout !== 'replace' && !sf.render.hidden ? sf.render.getBoundingClientRect() : null;
    if (sf && animate) morph(sf.main, change); else change();
    if (r0) V()?.slide?.(sf, r0, { entering: false });
    s.surface = null; s.mode = null; s.layout.value = null;
    core.closed(s, id, started);                      // saved, contexts, other blocks displayed, compile
  }

  // what a session leaves on its surface, taken off in two phases, one list each (leave, the close motion
  // and drop each had a copy; drop's left the frame pending, the source shown and the stale mark):
  //   quiet(sf): the session's live state off (its frame, the note and rows, the fit, the stale mark)
  //   strip(sf): the surface a view again (the panel, the source, the edit layout, its classes)
  function quiet(sf) {
    cancelAnimationFrame(s.raf); s.raf = 0;
    s.note.value = null; s.rows.value = [];
    if (!sf) return;
    fitOff(sf, core.viewerBlock?.(sf));
    sf.render.classList.remove('stale');
  }
  function strip(sf) {
    if (!sf) return;
    clearPanel(sf.source);
    sf.source.hidden = true;
    V()?.clearEditLayout?.(sf.root);
    sf.root.classList.remove('editing', 'rtx-float');
  }

  /** The block went (deleted, the document closed): the editor goes, nothing is saved from it. */
  function drop() {
    s.closing?.finish();
    if (!s.id) return;
    const id = s.id, sf = s.surface;
    s.id = null;
    s.ro?.disconnect(); s.ro = null; s.hold = null;
    s.editor?.destroy(); s.editor = null;
    quiet(sf);
    strip(sf);
    s.surface = null; s.mode = null; s.layout.value = null;
    core.dropped(s, id);
  }

  /** The surface while its block is edited: state = live.display()'s (null: replace mode, the source alone). */
  function show(state) {
    const sf = s.surface, u = ui(s.id);
    if (!sf || !u) return;
    // nothing typeset yet (the lower half of a split, until its compile lands): its source stands in, at once
    const src = core.blockById(s.id)?.source ?? '';
    const standIn = !!state && state.kind !== 'ok' && !u.mounted && !!src.trim();
    sf.preview.hidden = !standIn;
    if (standIn) { const p = previewOf('pending', src); if (sf.preview.className !== p.cls) sf.preview.className = p.cls; if (sf.preview.title !== p.title) sf.preview.title = p.title; if (sf.preview.textContent !== p.text) sf.preview.textContent = p.text; }
    sf.source.hidden = false;
    const m = sf.root.dataset.editLayout;            // decided again on a resize (view/index.js): the note follows
    s.layout.value = m && m !== 'replace' ? m : null;
    // live: the render this surface shows stays (or comes: the first live result)
    if (state && (state.kind === 'ok' || sf.mounted)) sf.render.hidden = false;
    if (!state) {
      sf.render.hidden = true;                       // 'replace': the source alone
      s.note.value = null; s.rows.value = [];
    } else if (state.kind === 'ok') {
      sf.render.classList.remove('stale');
      s.note.value = null; s.rows.value = [];
    } else if (state.kind === 'error') {
      if (!u.mounted) { s.note.value = null; s.rows.value = state.errors; }   // nothing shown yet: the rows (Copy, a click goes to the line)
      else {
        sf.render.classList.add('stale');                  // the last good render stays; a quiet cue on it
        const id = s.id, good = u.goodSource;
        s.rows.value = [];
        s.note.value = state.errors.length ? {
          errors: state.errors, good,
          current: () => s.editor?.text ?? null,
          report: (p) => core.problemReport(id, p),
          open: (p) => core.openProblem(id, p),
          revert: () => {
            // the last source that compiled, as one step of this editor's undo
            const v = s.editor?.view;
            if (!v || good == null) return;
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: good }, userEvent: 'input.revert' });
            v.focus();
          },
        } : null;
      }
    }
    renderErrorsPanel(sf.errors, s);
    if (state?.kind === 'ok' || state?.kind === 'none') caretSoon();
  }

  /** the caret and the selection mirrored in the render this surface shows */
  function caretSoon() {
    V()?.blink?.restart();                           // both carets: visible now, blinking together from here
    if (s.raf || !V()?.markCaret) return;
    s.raf = requestAnimationFrame(() => { s.raf = 0; markNow(); });
  }

  /** the caret and selection marked in the result now; o.scroll: false (the open places the page itself): no scroll */
  function markNow({ scroll = true } = {}) {
    {
      const id = s.id, u = ui(id), b = core.blockById(id), sf = s.surface;
      if (!id || !s.editor || !u?.mounted || !b || !sf) return;
      // the source the render was compiled from (the caret is carried across what was typed since)
      if (u.mounted.ck === core.viewKey(b)) { u.liveSource = b.source; u.liveCk = u.mounted.ck; if (core.cache.get(u.mounted.ck)?.status === 'ok') { u.goodSource = b.source; u.goodCk = u.mounted.ck; } }
      if (!core.shows(sf, u)) return;                // a view whose copy of the new result is still on its way: marked when it lands
      const compiled = u.liveCk === u.mounted.ck ? u.liveSource : null;
      try {
        const sm = s.editor.view.state.selection.main;
        const mk = V().markCaret(sf.render, core.cache.get(u.mounted.ck), compiled, s.editor.text, s.editor.caret, { from: sm.from, to: sm.to });
        // a caret in a wide display: the display scrolls (only as far as needed) so it stays in view, marked again there
        if (s.follow && mk?.x != null && revealCaret(sf, core.viewerBlock?.(sf), mk.x)) V().markCaret(sf.render, core.cache.get(u.mounted.ck), compiled, s.editor.text, s.editor.caret, { from: sm.from, to: sm.to });
        // the window moves only while following; not while the popover's motion slides the blocks (their
        // rects carry its transforms), nor when the open placed the page itself
        const follow = scroll && s.follow && !sf.root.classList.contains('rtx-moving');
        V().keepCaretInView?.(sf, core.paneScroll(pane), { follow });
        V().updateFades?.(sf);
      } catch (e) { console.warn('caret mark:', e.message); }
    }
  }

  /** the display the caret bar is in, scrolled so the caret is inside its visible width; true when it moved */
  function revealCaret(sf, block, x) {
    const bar = sf.render.querySelector('.rtx-caret-bar');
    if (!bar || !block?.revealInDisplay) return false;
    const el = shownBlock(sf.render);
    const shown = el ? [...el.querySelectorAll('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display')) : [];
    const b = bar.getBoundingClientRect(), y = (b.top + b.bottom) / 2;
    const i = shown.findIndex((d) => { const r = d.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
    if (i < 0) return false;
    const d = shown[i], svg = d.querySelector('svg'), m = screenCTM(svg);   // (CSS zoom in it in every browser)
    if (!m) return false;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    const before = d.scrollLeft;
    // the visible width: the display's box, less what of it the window (or a pane) cuts off
    const split = !!core.paneScroll(pane)?.split, clip = split ? sf.root.closest('main[data-pane]')?.getBoundingClientRect() : null;
    const r = d.getBoundingClientRect();
    const lo = Math.max(0, clip ? clip.left : 0), hi = Math.min(document.documentElement.clientWidth, clip ? clip.right : Infinity);
    const cut = Math.max(0, lo - r.left, r.right - hi);
    try { block.revealInDisplay(i, p.x, { margin: 24 + cut }); } catch { return false; }
    return d.scrollLeft !== before;
  }

  /** A click on the render of the block being edited: the caret goes there (the editor keeps its focus). */
  function previewClick(event) {
    const id = s.id, u = ui(id), b = core.blockById(id), sf = s.surface;
    if (!id || !s.editor || !u?.mounted || !sf || sf.render.hidden || !(sf.render.contains(event.target) || besideRender(sf.render, sf.root, sf.main, event)) || !core.shows(sf, u)) return;
    const compiled = u.liveCk === u.mounted.ck ? u.liveSource : u.mounted.ck === core.viewKey(b) ? b.source : null;
    const hit = compiled != null ? V()?.offsetAt?.(sf.render, core.cache.get(u.mounted.ck), compiled, s.editor.text, event.clientX, event.clientY) : null;
    const pos = hit != null ? { offset: hit, method: 'boundary', glyph: '' } : sourcePositionFor({ source: s.editor.text, el: sf.render, result: core.cache.get(u.mounted.ck) ?? null }, { x: event.clientX, y: event.clientY, target: event.target });
    if (!pos) return;
    core.setLastPosition({ id, ...pos }, pane);
    s.editor.view.focus();
    s.editor.select(Math.min(pos.offset, b ? b.source.length : pos.offset));
  }

  /** the block entered again here: a range, a caret, or the clicked place */
  function reposition(o) {
    if (!s.editor) return;
    if (o.range) s.editor.select(o.range.from, o.range.to);
    else if (o.caret != null) s.editor.select(o.caret);
    else if (o.event && 'clientX' in o.event) previewClick(o.event);
  }

  /** another editor of the same block changed it: the same change here, not in this editor's undo */
  function applyRemote(changes) { s.editor?.applyRemote(changes); }

  /** undefined refs and unknown cites underlined */
  function marks() { if (s.editor && s.id) s.editor.marks(core.marksFor(s.id, s.editor.text)); }

  return s;
}
