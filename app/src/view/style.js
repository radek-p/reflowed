// the view's CSS, injected once (so neither build needs another
// stylesheet): colour themes for the chrome, the zoom and width hooks, the
// View popover, and the edit layouts.
//
// Themes: the colours are the JSON themes' tokens (design/theme.ts: the editor's variables are their
// aliases); the theme class on <html> (the companion's reading.setTheme and the workbench's setTheme set it, the
// viewer's colour maps key off it) keeps the rules that are not colours. --latex-page-bg follows the page (the viewer
// mixes tints against it and paints a picture's white with it).
import { POP_SHADOW_Y, POP_SHADOW_BLUR, POP_MARGIN } from '../motion/place.js';

const CSS = String.raw`
/* no colour per theme here: the editor's colour variables are aliases of the theme tokens (design/theme.ts;
   the JSON themes, workbench/src/themes.ts, are the one source). The shadows are not colours: theirs stay */
html.dark { --shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 3px 6px rgba(0, 0, 0, 0.35), 0 9px 24px rgba(0, 0, 0, 0.45); color-scheme: dark; }
html.contrast { --shadow: 0 0 0 1.5px #000, 0 6px 18px rgba(0, 0, 0, 0.2); }
html.contrast :focus-visible { outline: 2px solid #0040c0 !important; outline-offset: 2px; }
html.contrast .topbar { box-shadow: 0 1px 0 #000; }

/* app.css's literals, through the variables */
html, body { background: var(--bg); color: var(--text); }
.sidebar { border-right-color: var(--border-soft); }
.sb-tabs button.on { background: var(--tab-on); }
.sb-foot { border-top-color: var(--border-soft); }
.td-chip { background: var(--chip-bg); border-color: var(--border-soft); }
.topbar { background: var(--topbar-bg); }
.crumb-sep { color: var(--faint-text); }
.doc-title::placeholder { color: var(--faint-text); }
.logo { background: var(--logo-bg); color: var(--logo-text); }
.ghost { color: var(--ghost-text); }
.settings-toggle:hover { color: var(--ghost-text); }
.settings-toggle .muted, .settings-row .muted { color: var(--faint-text); }
.settings-row select { background: var(--panel-bg); color: var(--text); border-color: var(--faint); }
.blk[data-state="source"] .blk-preview, .blk-preview.error { color: var(--soft-text); }
.blk-preview { color: var(--soft-text); }
.blk-preview.placeholder, .cm-host .cm-placeholder { color: var(--faint-text); }
.gutter button { color: var(--gutter-text); }
.gutter button:hover { color: var(--gutter-hover); }
.preamble-editor { background: var(--panel-bg); }
.err-line { color: var(--err-line); }
.menu { background: var(--panel-bg); color: var(--text); }
.menu-filter { color: var(--text); }
.mi-icon { background: var(--panel-bg); color: var(--ghost-text); border-color: var(--faint); }
.menu-item:disabled { color: var(--faint-text); }
dialog.shortcuts, dialog.versions-dialog { background: var(--panel-bg); color: var(--text); }
dialog.shortcuts dt { color: var(--ghost-text); }
.blk-render .latex-block { color: var(--doc-ink); }
.fig-edit { background: var(--panel-bg); color: var(--ghost-text); }
.fig-edit:hover { background: var(--panel-bg); color: var(--text); }
.blk-preview.marker.macros, .blk-preview.marker.comment { color: var(--soft-text); }
/* a raster image on a dark page: slightly dimmed (a PNG's white would glare) */
html.dark .blk-render .latex-block image { opacity: 0.88; }

/* ── zoom and width ── */
/* the viewer's own scale (2 px/pt) times the reader's: each block element is
   zoomed, so its width in its own px is column / zoom and the viewer breaks
   its lines for that measure (the morph ghost is a .blk-render copy too) */
.blk-render > .latex-block { zoom: var(--rtx-view-zoom, var(--rtx-zoom, 1)); }
.cm-host .cm-editor { font-size: calc(13.5px * min(var(--rtx-zoom, 1), 1.5)); }
/* iOS Safari zooms the page on focus when the focused editable is under 16 px: on touch devices the code is at
   least 16 px, its lines as high as before (13.5 px x 1.6 = 21.6 px = 16 px x 1.35); user zoom stays allowed */
@media (pointer: coarse) {
  .cm-host .cm-editor { font-size: max(16px, calc(13.5px * min(var(--rtx-zoom, 1), 1.5))); }
  .cm-host .cm-scroller { line-height: 1.35; }
}
/* a wide display peeks into the free margin beside the column, not past the window (app.css's
   50vw assumes a column centred in the window; with the sidebar it is not) */
.shell { overflow-x: clip; }
.blk-render .latex-display { --latex-display-peek: clamp(0px, calc(var(--rtx-free, 100px) / var(--rtx-view-zoom, 1)), 100px); }
/* the variables that follow the panes' sizes stop at an svg (none inside one reads them): a change of the
   column (on <body>, view/index.js) or of a pane's height (--pane-h, panes/pane.ts: a strip switching to two lines)
   restyles the blocks' boxes, not their glyphs (4,300 of the 5,000 elements of a 30-block article) */
svg { --col: initial; --rtx-free: initial; --rtx-view-zoom: initial; --pane-h: initial; }
html.rtx-width-anim .rtx-editor:not(.rtx-wb) [data-part="page"] { transition: max-width 0.22s cubic-bezier(0.2, 0, 0, 1); }
html[data-no-handles] .gutter { display: none; }

/* ── errors: selectable text, a Copy button (copy-errors.js) ── */
.err-row, .pb-row, .err-row *, .pb-row * { -webkit-user-select: text; user-select: text; }
.err-row .err-msg { flex: 1; min-width: 0; }
/* the kit's one Copy button (design/ui/copy.js) in its error-row look: quiet until hovered, on tokens */
.err-copy { flex: none; margin-left: auto; border: 0; background: none; padding: 0 var(--ui-1); border-radius: var(--ui-r-sm); font: inherit; font-size: var(--ui-text-sm); line-height: 1.6;
  color: inherit; opacity: 0.65; cursor: pointer; -webkit-user-select: none; user-select: none; }
.err-copy:hover { opacity: 1; background: var(--ui-hover); }
.err-copy:focus-visible { opacity: 1; outline: none; box-shadow: var(--ui-ring); }
.err-copy[data-copied="1"] { opacity: 1; color: var(--ui-accent); }
.pb-list > li { display: flex; align-items: flex-start; gap: 2px; }
.pb-list > li > .pb-row { flex: 1; min-width: 0; }
.pb-list > li > .pb-copy { margin-top: 3px; color: var(--muted); opacity: 0; }
.pb-list > li:hover > .pb-copy, .pb-list > li > .pb-copy:focus-visible, .pb-list > li > .pb-copy[data-copied] { opacity: 1; }
.pb-copyall { display: flex; justify-content: flex-end; padding: 0 4px 2px; }
.pb-copyall .pb-copy { color: var(--muted); }

/* ── the View button and popover ── */
.rtx-view-btn svg { display: block; }

/* ── editing: the source beside or below its live result (edit-layout.js) ── */
.blk.editing[data-edit-layout="side"] { width: var(--edit-row); margin-left: calc(-8px - var(--edit-shift, 0px)); }
.blk.editing[data-edit-layout="side"] > .blk-main:has(> .blk-render:not([hidden])) {
  display: grid; grid-template-columns: var(--edit-preview) var(--edit-editor); column-gap: var(--edit-gap, 20px); align-items: start;
  background: none; margin: 0; padding: 0; }
.blk.editing[data-edit-layout="side"] > .blk-main > .blk-render { grid-column: 1; grid-row: 1 / span 2; }
.blk.editing[data-edit-layout="side"] > .blk-main > .blk-source { grid-column: 2; grid-row: 1; background: var(--editor-bg); border-radius: 5px; padding: 4px 10px;
  position: sticky; top: 52px; max-height: calc(100vh - 72px); overflow: auto; }
.blk.editing[data-edit-layout="side"] > .blk-main > .errors { grid-column: 2; grid-row: 2; }
.blk.editing[data-edit-layout="stacked"] > .blk-main:has(> .blk-render:not([hidden])) { background: none; margin: 0; padding: 0; }
/* stacked: the source as a popover under its result (rounded, a soft layered shadow, a hairline, a
   small arrow toward the result). It pushes what follows down; when the result is taller than the
   window it sticks to the window's lower part, floating over the result (position: sticky, bottom),
   and its editor is at most half the window high, scrolling inside. On a phone: a bottom sheet. */
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source {
  --pop-bg: var(--panel-bg);
  /* the website's example frames (figure.latex-example): a 13 % currentColor hairline, 12 px radius */
  --pop-line: color-mix(in srgb, currentColor 13%, transparent);
  position: relative; z-index: 5; margin: 12px -16px 2px; padding: 10px 16px 10px;
  background: var(--pop-bg); border-radius: 12px; border: 1px solid var(--pop-line);
  /* the largest layer's reach below (offset + blur) is the room the popover keeps above the pane's bottom
     (motion/place.js POP_SHADOW): the pane clips below it, so a larger shadow was cut there */
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 2px 6px rgba(0, 0, 0, 0.06), 0 ${POP_SHADOW_Y}px ${POP_SHADOW_BLUR}px rgba(0, 0, 0, 0.13);
  transform-origin: 40px 0; }
html.dark .blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source { --pop-bg: #242423; box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 2px 6px rgba(0, 0, 0, 0.4), 0 ${POP_SHADOW_Y}px ${POP_SHADOW_BLUR}px rgba(0, 0, 0, 0.55); }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source::before {
  content: ''; position: absolute; top: -6px; left: 34px; width: 11px; height: 11px; transform: rotate(45deg);
  background: var(--pop-bg); border-left: 1px solid var(--pop-line); border-top: 1px solid var(--pop-line); border-top-left-radius: 2px; }
.blk.editing.rtx-float[data-edit-layout="stacked"] > .blk-main > .blk-source { position: sticky; bottom: ${POP_MARGIN}px; }
/* (MOTION) a closing popover: out of the flow where it was seen, as it was drawn, fading out (motion/popover.js) */
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source.rtx-pop-leaving { position: absolute; z-index: 5; left: 0; top: 0; margin: 0;
  box-sizing: border-box; width: var(--leave-w); height: var(--leave-h); overflow: hidden; pointer-events: none;
  transform: translate(var(--leave-x, 0px), var(--leave-y, 0px)); }
/* the popover covers at most half of its pane (--pane-h: panes/pane.js), on open and while typing: its editor
   shrinks and scrolls inside it (the note under it keeps its own height) */
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source { box-sizing: border-box; max-height: calc(var(--pane-h, calc(100vh - 56px)) / 2); display: flex; flex-direction: column; }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source > .cm-island { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source > .cm-island > .cm-host, .blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source .cm-editor { flex: 0 1 auto; min-height: 0; max-height: 100%; }
/* keyed on .blk-source alone (it is a flex column only in the stacked layout): a subject with no class,
   behind the block's data-edit-layout, made Chromium restyle the whole block when editing began (4,900 glyphs of a
   tall paragraph, 27 ms in the press) */
.blk-source > :not(.cm-island) { flex: none; }
/* a scrollable source or wide display keeps the gesture at its end: the page does not take it over */
.blk-source .cm-scroller { overscroll-behavior: auto; }
/* only a code view that can scroll keeps the gesture (none chains past its end); one whose text all fits lets it
   scroll the document */
.blk-source .cm-scroller.cm-can-scroll { overscroll-behavior: contain; }
.latex-display { overscroll-behavior-x: contain; }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source .cm-scroller { overflow: auto;
  /* fades where more source is hidden (edit-layout.js updateFades) */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 var(--fade-top, 0px), #000 calc(100% - var(--fade-bottom, 0px)), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 var(--fade-top, 0px), #000 calc(100% - var(--fade-bottom, 0px)), transparent 100%); }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .errors:empty { display: none; }
.blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source .live-note { margin: 6px 0 0; padding-top: 6px; border-top: 0.5px solid var(--view-sep); }
@media (max-width: 720px) {
  .blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source { bottom: 0; margin: 10px -16px 0; border-radius: 14px 14px 0 0; }
  .blk.editing[data-edit-layout="stacked"] > .blk-main > .blk-source::before { display: none; }
}
/* the block's side line (editing; the pending/landed pulse is the same line in app.css): 2 px, --rtx-side-gap from
   the text, the same in every layout and pane (a fitted render is padded: the line stays at the column) */
:root { --rtx-side-gap: 12px; }
.blk.editing:is([data-edit-layout="side"], [data-edit-layout="stacked"]) > .blk-main > .blk-render::after { content: ''; position: absolute; z-index: -3;
  left: calc(var(--fit-l, 0px) - var(--rtx-side-gap) - 2px); top: 1px; bottom: 1px; width: 2px; border-radius: 1px; background: var(--side-c, var(--view-sep)); pointer-events: none; }
/* an error while editing: the last good render stays as it is, a thin amber edge and a small badge;
   the message is one quiet line under the editor (app.js showLiveNote), opening to the copyable rows */
.blk.editing:is([data-edit-layout="side"], [data-edit-layout="stacked"]) .blk-render.stale > .latex-block:not(.incoming) { opacity: 1; }
.blk.editing:is([data-edit-layout="side"], [data-edit-layout="stacked"]) > .blk-main > .blk-render.stale { --side-c: var(--warn); }
.blk.editing:is([data-edit-layout="side"], [data-edit-layout="stacked"]) > .blk-main > .blk-render.stale::before {
  content: 'not updated'; position: absolute; z-index: 1; top: -6px; right: 0; padding: 0 7px; border-radius: 8px; pointer-events: none;
  font: 500 10.5px/16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 0.02em;
  color: var(--warn); background: var(--bg); box-shadow: 0 0 0 1px color-mix(in srgb, var(--warn) 35%, transparent); }
/* an edited block's displays fitted to the pane (edit/fit.js): the render widened to the pane by padding and the
   same negative margin (the column stays put); what drew on its border box draws at the column's edge again */
.blk.rtx-fit > .blk-main > .blk-render { padding-left: var(--fit-l, 0px); padding-right: var(--fit-r, 0px);
  margin-left: calc(-1 * var(--fit-l, 0px)); margin-right: calc(-1 * var(--fit-r, 0px)); }
.blk.rtx-fit > .blk-main > .blk-render > .latex-block.incoming { left: var(--fit-l, 0px); right: var(--fit-r, 0px); }
.blk.rtx-fit > .blk-main > .blk-render .rtx-line-band { margin-left: var(--fit-l, 0px); margin-right: var(--fit-r, 0px); }
.blk.editing.rtx-fit:is([data-edit-layout="side"], [data-edit-layout="stacked"]) > .blk-main > .blk-render.stale::before { right: var(--fit-r, 0px); }
.live-note { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
.live-note > summary { display: flex; align-items: baseline; gap: 7px; list-style: none; cursor: pointer; padding: 2px 2px; border-radius: 4px; }
.live-note > summary::-webkit-details-marker { display: none; }
.live-note > summary:hover { background: var(--hover); }
.live-note-icon { flex: none; display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; font: 700 10px/1 ui-sans-serif, system-ui, sans-serif;
  color: var(--bg); background: var(--warn); transform: translateY(2px); }
.live-note-text { color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-note-hint { flex: none; color: var(--muted); font-size: 11.5px; }
.live-note-hint::before { content: '· '; }
.live-note[open] > summary .live-note-text { white-space: normal; }
.live-note > .err-row { margin-top: 3px; }
@media (max-width: 720px) { .live-note-hint { display: none; } }
/* errors of a block not being edited: a quiet line, not a red slab */
.errors .err-row { background: color-mix(in srgb, var(--error) 7%, transparent); color: color-mix(in srgb, var(--error) 85%, var(--text)); font-size: 12px; }
.blk[data-state="error"] .blk-main { box-shadow: inset 2px 0 0 color-mix(in srgb, var(--error) 55%, transparent); }
/* the glyphs under the caret, in the live result */
.rtx-caret-bar { position: absolute; z-index: 3; width: 2px; pointer-events: none; background: var(--caret, var(--text)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 60%, transparent);
  }
/* the current line, in the source and in the preview: the same faint tint; a pulse on opening */
:root { --line-tint: color-mix(in srgb, var(--accent) 5%, transparent); --line-pulse: color-mix(in srgb, var(--accent) 16%, transparent); }
/* the marks under the caret's line and the selection are drawn BELOW the glyphs (negative z in the result's own
   stacking context), so a selected letter keeps the text's colour; the caret bar stays above */
.blk.editing .blk-render { isolation: isolate; }
.rtx-line-band { position: absolute; z-index: -2; pointer-events: none; border-radius: 4px; background: var(--line-tint); }
.cm-host .cm-caretLine { position: absolute; left: 0; right: 0; z-index: -2; pointer-events: none; background: var(--line-tint); }
.cm-host .cm-scroller { position: relative; z-index: 0; }
@keyframes rtx-line-pulse { from { background: var(--line-pulse); } to { background: var(--line-tint); } }
.rtx-line-pulse .rtx-line-band, .rtx-line-pulse .cm-host .cm-caretLine { animation: rtx-line-pulse 0.6s ease-out; }
@media (prefers-reduced-motion: reduce) { .rtx-line-pulse .rtx-line-band, .rtx-line-pulse .cm-host .cm-caretLine { animation: none; } }
/* one blink for both carets (blink.js): the class is on <html> in the off half of the period */
html.rtx-caret-off .rtx-caret-bar, html.rtx-caret-off .cm-host .cm-cursor { visibility: hidden; }
/* an editor without the focus (the other pane's, or any while the focus is elsewhere): both its carets, the code's
   and the preview's, stay shown, still and dimmed (as an inactive selection does); the focused editor's two blink together */
:root { --rtx-caret-idle: 0.4; }
.cm-host .cm-editor:not(.cm-focused) .cm-cursor-primary { display: block; visibility: visible; opacity: var(--rtx-caret-idle); }
.blk.editing:not(:has(.cm-editor.cm-focused)) .rtx-caret-bar { visibility: visible; opacity: var(--rtx-caret-idle); }
/* ONE selection shade for the code view (CodeMirror) and the preview (.rtx-sel-band): the code view's, opaque,
   so it reads the same over the page, the popover and the caret line's band (which lies under it in both) */
:root { --rtx-sel: color-mix(in srgb, var(--accent) 20%, var(--panel-bg)); }
html.dark { --rtx-sel: color-mix(in srgb, #2383e2 20%, #242423); }   /* 36,55,73: the code view's dark shade */
.rtx-sel-band { position: absolute; z-index: -1; pointer-events: none; background: var(--rtx-sel); }
.rtx-caret-bar.rtx-caret-unsure { opacity: 0.35; }
/* a wide display of the block being edited holds its own marks (caret, selected glyphs) in its scroller's
   content coordinates (edit-layout.js markCaret): they scroll with it */
.blk.editing .blk-render .latex-display { position: relative; }
html.contrast .rtx-caret-bar { background: #000; }
/* the note's diff: the last source that compiled against the current one */
.live-note-actions { display: flex; gap: var(--ui-1); margin: var(--ui-1) 0 0 21px; }   /* kit Buttons (ghost, sm): their own look */
.live-diff { margin: var(--ui-1) 0 0 21px; padding: 6px var(--ui-2); border-radius: var(--ui-r-sm); background: var(--editor-bg); font: var(--ui-text-sm)/1.5 var(--ui-mono);
  white-space: pre-wrap; word-break: break-word; color: var(--ui-ink); }
.live-diff ins { text-decoration: none; background: color-mix(in srgb, #1f9d55 22%, transparent); border-radius: 2px; }
.live-diff del { text-decoration: line-through; background: color-mix(in srgb, var(--ui-danger) 18%, transparent); border-radius: 2px; }
.live-diff .ctx { color: var(--ui-ink-2); }
/* the source editor's caret: 2 px in the accent colour (CodeMirror draws its own: drawSelection) */
.cm-host .cm-cursor, .cm-host .cm-dropCursor { border-left: 2.5px solid var(--caret, var(--text)); margin-left: -1.25px; }
html.contrast .cm-host .cm-cursor { border-left-color: #000; border-left-width: 2.5px; }
@media (prefers-reduced-motion: reduce) { html.rtx-width-anim [data-part="page"] { transition: none !important; } }
`;

export function installStyle() {
  if (document.getElementById('rtx-view-style')) return;
  const s = document.createElement('style');
  s.id = 'rtx-view-style';
  s.textContent = CSS;
  // after app.css and the other stylesheets: index.html's <div id="latex-schema"> ends <head>, so
  // its <link>s are in <body>; a style in <head> would lose to them at equal specificity
  document.body.append(s);
}
