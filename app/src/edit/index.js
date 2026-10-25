// editing, out of app.js. One session per pane (edit/session.js), kept on the pane's
// DocumentView (view.edit); no module state, no "current block": two panes edit two blocks at once, or the
// same block twice.
//
// a pane's session edits on that pane's view of the block (panes/block-view.js): every pane the same
// way, no element moves between panes. The same block in both panes: one source of truth (the block's source),
// two surfaces. A change typed in one editor is applied to the other as a remote change (CodeMirror: outside its
// undo history, which maps its own steps through it), so each editor keeps its caret, selection and undo; the
// block's live preview (edit/live.js) is the block's, delivered to every view (panes/blocks.js mount). Leaving
// one editor leaves the other as it is.
//
//   const edits = createEditing(core)
//   edits.enter(id, { pane, event, caret, line, range }) · edits.session(pane) · edits.sessions() (open ones)
//   edits.active (the session last opened or focused) · edits.activeId() · edits.editorOf(id) (the active
//   session's editor of the block, else any) · edits.isEditing(id) · edits.sessionsOf(id)
//   edits.surfaceSession(rootEl) · edits.leave(pane, o) · edits.leaveBlock(id, o) · edits.leaveAll(o) · edits.dropBlock(id)
//   edits.dropPane(pane) (the pane goes) · edits.swapped(id) (a result landed in the views) · edits.live · edits.dispose()
//   edits.followed(id, change, source)   another tab changed the block (doc/follow.ts): its open editors take the change
//                                        as a remote one (outside their undo, the caret mapped), its live preview again
import { createSession } from './session.js';
import { createLive } from './live.js';
import { owns as ownsPress } from '../design/ui/layers.js';   // the one overlay layer's outside-press rule
import { remoteChange } from '../app/editor-entry.js';
import { createFollow, USER_SCROLL_EVENTS } from './follow.js';
import { createWarm } from './warm.js';
import { createEditorWarm } from './editor-warm.js';
import { onChange } from '../app/page-state.ts';
import { onVisible } from '../../../workbench/src/viewport.ts';

export function createEditing(core) {
  const byPane = new Map();             // pane -> session (also on the pane's DocumentView as .edit)
  // the editor's container (app/editor-root.ts): data-editing while a block is edited here; the listeners below
  // are its own (a press outside the editor's container is another editor's, which this one leaves alone)
  const root = core.root, me = {};
  let active = null;

  // (the hosts are prototypes, not copies: their getters stay live, the core defines some after this runs)
  const live = createLive(Object.assign(Object.create(core.liveHost), {
    isLive: (id) => !!core.view?.livePreview?.() && sessionsOf(id).some((s) => s.mode),
    noteShown: (id) => sessionsOf(id).some((s) => s.note.peek()),
    caretSoon: (id) => { for (const s of sessionsOf(id)) s.caretSoon(); },
  }));

  const open = () => [...byPane.values()].filter((s) => s.id);
  /** a block being edited shows its wide displays whole (no fade), in every view; null: the viewer's default again */
  function fade(id, off) {
    const b = core.blockOf?.(id) ?? null;
    let views = [];
    try { views = b ? (globalThis.reflowtex?.host?.views?.(b) ?? [b]) : []; } catch { views = b ? [b] : []; }
    for (const v of views) { try { v.setDisplayFade?.(off ? false : null); } catch { /* gone */ } }
  }
  function sessionsOf(id) { return open().filter((s) => s.id === id); }
  const isEditing = (id) => open().some((s) => s.id === id);

  /** the editor that stands for the block (find, splitting, a problem's report): the active session's, else any */
  function editorOf(id) {
    const ss = sessionsOf(id);
    return (ss.includes(active) ? active : ss[0])?.editor ?? null;
  }
  function setActive(s) { active = s; }

  // ── what a session asks of the editor core ──
  let lastPane = null;
  // work a session runs once its motion has ended (the refresh after a close): whenIdle waits for it
  const after = new Set();
  function afterMotion(p, fn) {
    const t = Promise.resolve(p).then(() => fn()).catch((e) => console.error('after the motion:', e));
    after.add(t);
    t.finally(() => after.delete(t));
  }
  const host = Object.create(core.sessionHost);
  Object.defineProperty(host, 'view', { get: () => core.view });
  Object.assign(host, {
    after: afterMotion,
    opened(s) {
      lastPane = s.pane;
      if (sessionsOf(s.id).length === 1) { live.begin(s.id); fade(s.id, true); }
      setActive(s);
      core.select(s.id, { focus: false });
      root.hold('editing', me, true);
    },
    attached() {},
    typed(s, text, update) {
      const id = s.id;
      if (!id) return;
      // a change another editor of this block made, applied here: already the block's
      if (update?.transactions?.some((tr) => tr.annotation(remoteChange))) return;
      const b = core.blockById(id);
      if (!b) return;
      b.source = text;
      core.recordTyping?.(s, update);                // a step of the document's history (edit/undo.js)
      for (const o of sessionsOf(id)) if (o !== s && o.editor && update?.changes) o.applyRemote(update.changes);
      core.typed(b);
      live.soon(id);
    },
    closing(s, id, ed) {
      if (ed) core.setLastCaret({ id, offset: ed.view.state.selection.main.to }, s.pane);   // (the pane's)
      core.leaving(id, s.startSource);                // the kind follows the source when it changed
      core.queue.left(id);                            // its recompile and result first
      if (active === s) active = open().find((x) => x !== s) ?? null;
      if (!sessionsOf(id).length) { live.end(id); fade(id, false); }
      if (!open().length) root.hold('editing', me, false);
    },
    surfaceLeft(s, id) { core.display(id); },
    closed(s, id, started) { core.closed(id, started); },
    dropped(s, id) {
      if (active === s) active = open().find((x) => x !== s) ?? null;
      if (!sessionsOf(id).length) { live.end(id); fade(id, false); }
      if (!open().length) root.hold('editing', me, false);
    },
  });

  function session(pane) {
    let s = byPane.get(pane);
    if (!s) {
      s = createSession(host, pane);
      byPane.set(pane, s);
      const v = core.viewOf(pane);
      if (v) v.edit = s;                              // per-pane state belongs to its DocumentView
    }
    return s;
  }

  /** open block `id` in a pane (o.pane, else the pane of o.event's target, else the active session's, else the
   *  focused pane): on that pane's view of the block */
  function enter(id, o = {}) {
    const keep = (p) => (p && (!core.hasPane || core.hasPane(p)) ? p : null);
    const pane = core.paneFor(o) ?? keep(active?.pane) ?? keep(lastPane) ?? core.focusedPane?.() ?? 'a';
    const s = session(pane);
    if (s.id === id) { s.reposition(o); return s; }
    const pick = core.surfaceFor(id, pane, s);
    if (!pick) return null;
    s.enter(id, { ...o, surface: pick.surface });
    return s;
  }

  // a press in a pane outside the block that pane's editor has open (and outside the overlay layer) closes that
  // editor; a press in another pane, or in no pane (the chrome around the panes: a tab strip, a sash, the bar, a
  // side panel), leaves it alone
  const onPress = (e) => {
    if (!core.hasDoc()) return;
    const where = core.paneOf(e.target);
    if (!where) return;
    for (const s of open()) {
      if (where !== s.pane) continue;
      if (s.surface?.root.contains(e.target) && !e.target.closest('.gutter')) continue;
      if (ownsPress(e.target)) continue;        // a layer (menus, popovers, toasts, CodeMirror's tooltips) or the chrome
      if (e.target.closest('.blk-render, .blk-preview')) continue;
      s.leave();
    }
  };
  // the editor last focused is the active one (the find bar, Cite, the caret API act on it)
  const onFocus = (e) => {
    for (const s of open()) if (s.surface?.source.contains(e.target) && active !== s) { setActive(s); return; }
  };
  const offs = [root.listen(root.el, 'pointerdown', onPress, true), root.listen(root.el, 'focusin', onFocus)];
  // a scroll of the reader's own in a pane: that pane's editor stops following its caret (until the next caret move)
  const follow = createFollow({ paneOf: (el) => core.paneOf(el), single: () => (core.paneCount?.() ?? 1) < 2, focused: () => core.focusedPane?.() ?? null });
  // the document's listeners (a key with the focus on <body>, a press on the window's scroll bar), for this editor's
  // events only (root.takesKey: in its container, else it was the editor last worked in)
  const onUserScroll = (e) => { if (!root.takesKey(e)) return; for (const s of open()) if (s.follow && follow.isUserScroll(e, s.pane)) s.follow = false; };
  for (const t of USER_SCROLL_EVENTS) offs.push(root.listen(root.doc, t, onUserScroll, { capture: true, passive: true }));
  // the window's visible part changed (an on-screen keyboard came up or went down): each open editor keeps
  // its caret in view, in the reveal phase (after the panes wrote their new heights: the popover's cap)
  offs.push(onVisible(() => { for (const s of open()) s.keepInView(); }, { phase: 'reveal' }));
  // the block under the resting pointer: its caret map made in idle time (edit/warm.js)
  const warm = createWarm({ root, warm: (r) => core.warmCaretMap?.(r) });
  // each pane's first editor made ahead in idle time (edit/editor-warm.js): the first open's press then
  // does not pay CodeMirror's one-time set-up
  const edWarm = createEditorWarm({ create: (parent) => core.sessionHost.createEditor(parent, { doc: 'x' }), panes: () => core.paneEls?.() ?? [] });
  const onShown = () => edWarm.soon();
  const offShown = onChange(root.state.displayed, onShown);   // the container's signal (app/page-state.ts)

  return {
    live,
    enter, session, sessionsOf, isEditing,
    sessions: open,
    get active() { return active?.id ? active : null; },
    activeId: () => (active?.id ? active.id : open()[0]?.id ?? null),
    editorOf,
    surfaceSession: (root) => open().find((s) => s.surface?.root === root) ?? null,
    leave(pane, o) { byPane.get(pane)?.leave(o); },
    leaveBlock(id, o) { for (const s of sessionsOf(id)) s.leave(o); },
    leaveAll(o) { for (const s of open()) s.leave(o); if (o?.animate === false) for (const s of byPane.values()) s.closing?.finish(); },
    dropBlock(id) { for (const s of sessionsOf(id)) s.drop(); },
    dropAll() { for (const s of byPane.values()) s.closing?.finish(); for (const s of open()) s.drop(); },
    dropPane(pane) { const s = byPane.get(pane); if (!s) return; s.closing?.finish(); s.leave({ animate: false }); byPane.delete(pane); const v = core.viewOf(pane); if (v?.edit === s) v.edit = null; },
    followed(id, change, source) {
      const ss = sessionsOf(id);
      for (const s of ss) { s.applyRemote(change); s.startSource = source; }   // (nothing of theirs to save on leaving)
      if (ss.length) live.soon(id);
    },
    /** a result of block `id` was swapped into its views: stacked popovers on it keep their place now, carets marked in it */
    swapped(id) { for (const s of sessionsOf(id)) { s.refit?.(); s.hold?.(); s.caretSoon(); } },
    marks() { for (const s of open()) s.marks(); },
    /** work waiting for a motion to end (a close's refresh): resolves when none is left */
    settling: () => after.size > 0,
    settled: () => Promise.all([...after]),
    warmStats: () => ({ ...warm.stats, starts: [...warm.stats.starts], editors: edWarm.stats.warmed }),
    /** the listeners this registry added (a second editor, a hot reload) */
    dispose() {
      for (const s of byPane.values()) s.closing?.finish();
      for (const s of open()) s.drop();
      edWarm.dispose(); offShown();
      for (const off of offs.splice(0)) off();
      root.hold('editing', me, false);
      warm.dispose();
    },
  };
}
export { createUndo } from './undo.js';   // undo, redo and what they show
