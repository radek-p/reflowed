// The live preview's click and caret paths, moved here as they were from app/app.js (the render's click rule),
// panes/block-view.js (its listeners) and edit/session.js (a click's place in the source, the caret marked, a caret
// in a wide display revealed). What they asked of the app is given to them: the host's callbacks and the values the
// app computed. No app state of their own.
//
//   INTERACTIVE                                      what a click on a typeset block leaves to the element clicked
//   listenRender({ root, main, render, preview }, on) -> detach   the gestures' listeners: on.click(e) (the render,
//                                                    and the frame just beside it), on.dblclick(e), on.focus(), on.preview(e)
//   renderClick(e, v, host)                          a click on a block's render: { blockById(id), enterEdit(id, e, …, pane),
//                                                    session?(pane) -> { id, leave() }, titleForm?(id) -> bool }
//   renderDblclick(e, v, host)                       a double click: host.enterEdit
//   positionAt(render, { result, compiled, text, click, fuzzyResult })   a point of the render -> { offset, method,
//                                                    glyph } in `text` | null: the engine's map (preview-marks offsetAt)
//                                                    on a render of `compiled`, else app/source-position.js's ways
//   revealCaret(render, block, x, clip)              the display the caret bar is in scrolled to it; true when it moved
//   markPreview(render, { result, compiled, text, caret, sel, block, follow, clip })   the caret and selection marked;
//                                                    a caret in a wide display revealed and marked again there
//
// For a host (a page with the viewer, createEditor and its own compiles), built on the functions above only:
//   const p = attachLivePreview({ editor, render, frame?, follow?, wholeDisplays?, clip? })   the editor's caret and
//     selection marked in the render, a click on it placing the caret (follow, wholeDisplays: off unless given)
//   p.setResult({ block, result, compiled }) · p.setStale(on) · p.offsetAt(x, y) · p.caret() · p.refresh() · p.dispose()
//   await swapIn(container, { host, nodelistB64, signal?, prepare? })   a new result swapped in with no frame without text
//   LIVE_PREVIEW_CSS                                 the marks' CSS (ReflowEd's page has its own, themed: view/style.js)
import { Compartment, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { screenCTM } from '../view/screen-ctm.ts';
// @ts-ignore: a JS module
import { carryDisplayScroll } from '../view/display-scroll.js';
import { shownBlock } from '../view/shown.ts';
// @ts-ignore: a JS module
import { sourcePositionFor } from '../app/source-position.js';
// @ts-ignore: a JS module
import { besideRender } from './frame-click.js';
import { markCaret, offsetAt, type PreviewResult } from './preview-marks.ts';

/** A block's elements the gestures are read on: its frame (root, main: a click beside the render counts), the
 *  render, and the source stand-in (shown while nothing is typeset). */
export interface RenderParts { root: HTMLElement; main: HTMLElement; render: HTMLElement; preview?: HTMLElement | null }
/** What a click resolves to: an offset in the editor's text, how it was found, the glyph's character. */
export interface SourcePlace { offset: number; method: string; glyph: string }
export interface ClickPoint { x: number; y: number; target?: EventTarget | null }
/** What renderClick asks of its host. */
export interface ClickHost {
  blockById(id: string): { id: string; kind?: string } | null | undefined;
  /** the editor open in that pane, if the host has editors per pane (none: no editor to leave) */
  session?(pane: string): { id: string | null; leave(): void };
  /** a title block's form, opened instead of its source when the host has one (none: the source) */
  titleForm?(id: string): boolean;
  enterEdit(id: string, event: Event | null, caret: number | null, line: number | null, range: unknown, pane: string): void;
}
/** A viewer Block as revealCaret uses it. */
export interface RevealBlock { revealInDisplay?(display: number, x?: number, o?: { margin?: number }): boolean }
/** A block's view as renderClick reads it. */
export interface RenderView { id: string; render: HTMLElement; pane: string }

// (a reference, a citation or a link is refnav's unit: refnav/index.js decides its click before this does)
export const INTERACTIVE = 'a, button, [role="button"], [tabindex], .latex-action, .latex-stream[data-kind="hint"]';

/** the render's listeners: a click on it (and in the frame just beside it: its padding, where a hanging full stop
 *  ends: as on the render), a double click, its focus; a click on the source stand-in */
export function listenRender(g: RenderParts, on: { click?(e: MouseEvent): void; dblclick?(e: MouseEvent): void; focus?(): void; preview?(e: MouseEvent): void }): () => void {
  const click = (e: MouseEvent) => on.click?.(e), dbl = (e: MouseEvent) => on.dblclick?.(e), foc = () => on.focus?.(), prev = (e: MouseEvent) => on.preview?.(e);
  g.render.addEventListener('click', click);
  const frame = (e: MouseEvent) => { if (besideRender(g.render, g.root, g.main, e)) click(e); };
  g.root.addEventListener('click', frame);
  g.render.addEventListener('dblclick', dbl);
  g.render.addEventListener('focus', foc);
  g.preview?.addEventListener('click', prev);
  return () => {
    g.render.removeEventListener('click', click);
    g.root.removeEventListener('click', frame);
    g.render.removeEventListener('dblclick', dbl);
    g.render.removeEventListener('focus', foc);
    g.preview?.removeEventListener('click', prev);
  };
}

/** a click on a block's render (v: { id, render, pane }): an interactive element of it is left to itself (another
 *  block's editor in this pane closes); a title block opens its form when it has one; else the block is edited here */
const NO_SESSION = { id: null, leave() {} };
export function renderClick(e: MouseEvent, v: RenderView, host: ClickHost): void {
  const b = host.blockById(v.id);
  if (!b) return;
  const s = host.session?.(v.pane) ?? NO_SESSION;                   // the editor of the pane clicked in
  const hit = (e.target as Element).closest(INTERACTIVE);
  if (hit && hit !== v.render && v.render.contains(hit)) { if (s.id && s.id !== b.id) s.leave(); return; }
  if (b.kind === 'title' && s.id !== b.id && host.titleForm?.(b.id)) { if (s.id) s.leave(); return; }
  host.enterEdit(b.id, e, null, null, null, v.pane);
}
export const renderDblclick = (e: MouseEvent, v: RenderView, host: ClickHost): void => host.enterEdit(v.id, e, null, null, null, v.pane);

/** a point of the render -> a place in `text`: the text editor's hit rule on a render of `compiled` (the engine's
 *  map: offsetAt); else the fuzzy ways (app/source-position.js) on `fuzzyResult` (default: `result`) */
export function positionAt(render: HTMLElement, { result, compiled, text, click, fuzzyResult = result }:
  { result: PreviewResult | null | undefined; compiled: string | null; text: string; click: ClickPoint; fuzzyResult?: PreviewResult | null }): SourcePlace | null {
  const hit = compiled != null ? offsetAt(render, result ?? null, compiled, text, click.x, click.y) : null;
  return hit != null ? { offset: hit, method: 'boundary', glyph: '' } : sourcePositionFor({ source: text, el: render, result: fuzzyResult ?? null }, click);
}

/** the display the caret bar is in, scrolled so the caret is inside its visible width; true when it moved.
 *  clip(): the box of the pane the render is shown in, when that cuts the window (null: the window) */
export function revealCaret(render: HTMLElement, block: RevealBlock | null | undefined,
                            x: number, clip: () => DOMRect | null = () => null): boolean {
  const bar = render.querySelector('.rtx-caret-bar');
  if (!bar || !block?.revealInDisplay) return false;
  const el = shownBlock(render);
  const shown = el ? [...el.querySelectorAll<HTMLElement>('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display')) : [];
  const b = bar.getBoundingClientRect(), y = (b.top + b.bottom) / 2;
  const i = shown.findIndex((d) => { const r = d.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
  if (i < 0) return false;
  const d = shown[i]!, svg = d.querySelector('svg'), m = screenCTM(svg);   // (CSS zoom in it in every browser)
  if (!m) return false;
  const p = new DOMPoint(x, y).matrixTransform(m.inverse());
  const before = d.scrollLeft;
  // the visible width: the display's box, less what of it the window (or a pane) cuts off
  const box = clip();
  const r = d.getBoundingClientRect();
  const lo = Math.max(0, box ? box.left : 0), hi = Math.min(render.ownerDocument.documentElement.clientWidth, box ? box.right : Infinity);
  const cut = Math.max(0, lo - r.left, r.right - hi);
  try { block.revealInDisplay(i, p.x, { margin: 24 + cut }); } catch { return false; }
  return d.scrollLeft !== before;
}

/** the caret and selection marked in the render; a caret in a wide display: the display scrolls (only as far as
 *  needed, while followed) so it stays in view, marked again there */
export function markPreview(render: HTMLElement, { result, compiled, text, caret, sel, block, follow, clip }: { result: PreviewResult | null | undefined; compiled: string | null;
  text: string; caret: number | null; sel: { from: number; to: number } | null; block: Parameters<typeof revealCaret>[1]; follow: boolean; clip?: () => DOMRect | null }) {
  const mk = markCaret(render, result ?? null, compiled, text, caret, sel);
  if (follow && mk?.x != null && revealCaret(render, block, mk.x, clip)) markCaret(render, result ?? null, compiled, text, caret, sel);
  return mk;
}

// ── For a host: the live preview attached to an editor and a render ────────────────────────────────────────────
// What ReflowEd's editing session does with the functions above, for a page that has the viewer, an editor
// (createEditor's view) and its own compiles: the caret and selection marked in the render as the editor's
// selection or text changes (one frame later, coalesced), a click (or double click) on the render placing the caret,
// the last good result dimmed on request; on request too (off unless enabled): the caret followed into a wide
// display (follow), and wide displays shown whole while attached (wholeDisplays). Everything is made in the
// render's own document and timed by its window, so the editor, the block and the host may be in a frame.

/** The CSS the marks need (the editor's page has its own, themed: view/style.js). The render must be a containing
 *  block (position: relative); custom properties --rtx-caret, --rtx-sel and --rtx-line-tint colour it. */
export const LIVE_PREVIEW_CSS = `
.rtx-caret-bar { position: absolute; z-index: 3; width: 2px; pointer-events: none; background: var(--rtx-caret, currentColor); }
.rtx-caret-bar.rtx-caret-unsure { opacity: 0.35; }
.rtx-sel-band { position: absolute; z-index: -1; pointer-events: none; background: var(--rtx-sel, color-mix(in srgb, Highlight 35%, transparent)); }
.rtx-line-band { position: absolute; z-index: -2; pointer-events: none; border-radius: 4px; background: var(--rtx-line-tint, color-mix(in srgb, currentColor 5%, transparent)); }
.rtx-live-preview { position: relative; isolation: isolate; }
.rtx-live-preview .latex-display { position: relative; }
.rtx-live-preview.stale > .latex-block { opacity: 0.55; }
`;

/** createEditor's view as read here: CodeMirror's EditorView. */
type EditorViewLike = EditorView;
/** A viewer Block as the preview uses it (host.mount's). */
type PreviewBlock = { setDisplayFade?(on: boolean | null): void; revealInDisplay?(display: number, x?: number, o?: { margin?: number }): boolean };

export interface LivePreviewOptions {
  /** createEditor(...).view */
  editor: EditorViewLike;
  /** the element the typeset block sits in: the marks are drawn in it, a click on it places the caret */
  render: HTMLElement;
  /** the element around the render whose click just beside the render counts as one on it (default: its parent) */
  frame?: HTMLElement;
  /** keep the caret in view: a wide display scrolls sideways to it (default: never; pass it to enable) */
  follow?: () => boolean;
  /** show the block's wide displays whole (no fade) while attached (default: no) */
  wholeDisplays?: boolean;
  /** the box that cuts the window where the render is shown (a scrolling pane), for that scroll */
  clip?: () => DOMRect | null;
}
export interface LivePreviewResult {
  /** the viewer Block shown in the render now (host.mount's) */
  block: PreviewBlock | null;
  /** the engine's result for it (its sourcemap); null: a stored drawing, mapped the fuzzy way */
  result: PreviewResult | null;
  /** the block's own source as it was compiled (the editor's text then); null: unknown (fuzzy) */
  compiled: string | null;
}
export interface LivePreview {
  setResult(r: LivePreviewResult): void;
  setStale(on: boolean): void;
  offsetAt(x: number, y: number): number | null;
  caret(): { x?: number; sure?: boolean; bands: number } | null;
  /** mark again now (after a change the preview cannot see: the render moved or was resized) */
  refresh(): void;
  dispose(): void;
}

export function attachLivePreview(o: LivePreviewOptions): LivePreview {
  const { editor, render } = o;
  const win = render.ownerDocument.defaultView ?? window;
  const frame = o.frame ?? render.parentElement ?? render;
  const follow = o.follow ?? (() => false), whole = o.wholeDisplays === true;
  let shown: LivePreviewResult = { block: null, result: null, compiled: null };
  let raf = 0, last: { x?: number; sure?: boolean; bands: number } | null = null, disposed = false;
  render.classList.add('rtx-live-preview');

  const mark = () => {
    raf = 0;
    if (disposed) return;
    const sm = editor.state.selection.main;
    last = markPreview(render, { result: shown.result, compiled: shown.compiled ?? (shown.result ? null : editor.state.doc.toString()),
      text: editor.state.doc.toString(), caret: sm.head, sel: { from: sm.from, to: sm.to }, block: shown.block, follow: follow(), clip: o.clip });
  };
  const soon = () => { if (!raf && !disposed) raf = win.requestAnimationFrame(mark); };
  const watch = new Compartment();
  editor.dispatch({ effects: StateEffect.appendConfig.of(watch.of(EditorView.updateListener.of((u) => {
    if (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) soon();
  }))) });

  const place = (e: MouseEvent) => {
    const text = editor.state.doc.toString();
    const pos = positionAt(render, { result: shown.result, compiled: shown.compiled, text, click: { x: e.clientX, y: e.clientY, target: e.target } });
    if (!pos) return;
    editor.focus();
    editor.dispatch({ selection: { anchor: Math.min(pos.offset, editor.state.doc.length) } });
  };
  const unlisten = listenRender({ root: frame, main: frame, render }, { click: place, dblclick: place });

  return {
    setResult(r) {
      if (whole && shown.block && shown.block !== r.block) { try { shown.block.setDisplayFade?.(null); } catch { /* gone */ } }
      shown = { block: r.block ?? null, result: r.result ?? null, compiled: r.compiled ?? null };
      if (whole) { try { shown.block?.setDisplayFade?.(false); } catch { /* gone */ } }   // shown whole while it is edited
      soon();
    },
    setStale(on) { render.classList.toggle('stale', on); },
    offsetAt(x, y) {
      return positionAt(render, { result: shown.result, compiled: shown.compiled, text: editor.state.doc.toString(), click: { x, y, target: null } })?.offset ?? null;
    },
    caret: () => last,
    refresh() { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } mark(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) win.cancelAnimationFrame(raf);
      unlisten();
      try { editor.dispatch({ effects: watch.reconfigure([]) }); } catch { /* the editor is gone */ }
      render.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').forEach((m) => m.remove());
      render.classList.remove('rtx-live-preview', 'stale');
      if (whole) { try { shown.block?.setDisplayFade?.(null); } catch { /* gone */ } }
    },
  };
}

// ── For a host: a new result swapped in with no frame without text ─────────────────────────────────────────────
/** The viewer's host as swapIn uses it. */
interface MountHost { mount(el: HTMLElement): Promise<{ el: HTMLElement; destroy(): void }> }
/** Mount a block element for `nodelistB64` beside the one `container` shows, hidden (class `incoming`: position
 *  absolute, visibility hidden; the host's CSS, as ReflowEd's), and swap it in once host.mount has resolved (its
 *  faces loaded and the segments near the viewport painted): the old block destroyed, a sideways-panned display's
 *  scroll carried over (view/display-scroll.js). The container's height is held (min-height) from the start of the
 *  mount until the swap, and released after it, so what is below never moves while both are there. `signal`: an
 *  aborted swap (a newer result started) destroys its incoming block and leaves the old one. Resolves with the new
 *  block, or null when aborted or when the mount failed (the old one stays). */
export async function swapIn(container: HTMLElement, { host, nodelistB64, signal, prepare }:
  { host: MountHost; nodelistB64: string; signal?: AbortSignal; prepare?(el: HTMLElement): void }) {
  const doc = container.ownerDocument;
  const old = [...container.children].find((c) => c.classList.contains('latex-block') && !c.classList.contains('incoming')) as HTMLElement | undefined;
  const el = doc.createElement('div');
  el.className = 'latex-block';
  if (old) el.classList.add('incoming');
  el.dataset.nodelistB64 = nodelistB64;
  prepare?.(el);
  const h = container.getBoundingClientRect().height, held = h > 0 && !!old;
  if (held) container.style.minHeight = `${h}px`;
  const release = () => { if (held) container.style.minHeight = ''; };
  container.append(el);
  let block: { el: HTMLElement; destroy(): void };
  try { block = await host.mount(el); } catch { el.remove(); release(); return null; }
  if (signal?.aborted) { try { block.destroy(); } catch { /* */ } el.remove(); release(); return null; }
  const prev = old ? (host as unknown as { block?(e: Element): { destroy(): void } | undefined }).block?.(old) : undefined;
  if (old) carryDisplayScroll(old, el);
  try { prev?.destroy(); } catch { /* gone */ }
  old?.remove();
  el.classList.remove('incoming');
  release();
  return block;
}
