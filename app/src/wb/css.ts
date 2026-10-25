// The standalone page on the workbench (app/wb/host.ts): how the editor's parts sit in the workbench's boxes. The
// workbench's own CSS (workbench/src/css.ts) draws the tabs, groups and columns; the editor's (app.css, view/style.js)
// its blocks and controls. Colours: tokens only (no literal colour).
//
//   WB_CSS                       the stylesheet
//   lockedLeft(w, col) -> string a document's host while the groups' widths move (workbench lockHosts: kept at its
//                                width w): its CSS left, so its text column (--col wide) stays centred in the group
//                                while the group has room for it and its margins, and at its least margin from the
//                                group's left edge once it has not (where the column starts when laid out there)

/** a pane's side padding and its column's least margin, px (the rules below) */
const PANE_PAD = 16, COL_MARGIN = 4;
/** the text's half width plus its least inset from the left (the column as laid out in a pane w wide: min(col, room)),
 *  against the group's centre: the larger wins; less the host's half width */
export function lockedLeft(w: number, col: number): string {
  const inset = PANE_PAD + COL_MARGIN, room = w - 2 * inset;
  const text = col > 0 ? Math.min(col, room) : room;
  return `calc(max(${inset + text / 2}px, 50%) - ${w / 2}px)`;
}

export const WB_CSS = `
/* the container fills the app's frame (<body>: the visible part of the window, above an on-screen keyboard; the page never
   scrolls: workbench/src/viewport.ts), inside the safe area (viewport-fit=cover, index.html): no control under a notch,
   the Dynamic Island or the home indicator; those bands show the body's ground, the theme's page. With the keyboard up
   the bottom inset is 0 (body.wb-fitted, viewport.ts: the keyboard covers the home indicator; a class, not a variable read
   here: a variable read by this root restyled the whole page at each keyboard move). Its view holds the workbench */
.rtx-editor.rtx-wb { position: absolute; inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
body.wb-fitted .rtx-editor.rtx-wb { bottom: 0; }
.rtx-editor.rtx-wb > [data-part="view"].scrolls { display: block; height: 100%; }
.rtx-wb-mount, .rtx-wb-mount > .wb-root { height: 100%; }

/* a document tab: the pane's <main> is the scroller (the view itself does not scroll); the text starts under the glass
   strip (--wb-inset-top), which the pane knows as its scroll-padding-top (panes/pane.ts: box() starts below it) */
.rtx-wb .wb-view[data-view="document"] { overflow: hidden; padding-top: 0; }
.rtx-wb .rtx-tab { position: absolute; inset: 0; }
.rtx-wb .rtx-tab > main.rtx-pane[data-pane] { position: absolute; inset: 0; overflow: auto; overflow-x: hidden; overscroll-behavior: contain;
  padding: calc(var(--wb-inset-top, 0px) + 24px) ${PANE_PAD}px 0; scroll-padding-top: var(--wb-inset-top, 0px); box-sizing: border-box; outline: none; }
.rtx-wb .rtx-tab > main.rtx-pane[data-pane]::after { content: ''; display: block; height: 40vh; }
/* the strip's variables (and the frame's, viewport.ts: set on <body> while a keyboard is up) stop at the pane: the pane reads them (its padding, scroll-padding-top), nothing in
   it does. A group's strip switching between one line and two sets them on the group (data-form), and every element of
   its pane was restyled with them (4,732 in a 30-block article, 23 ms; four times in a drop between two groups) */
.rtx-wb .rtx-tab > main.rtx-pane[data-pane] > * { --wb-top: initial; --wb-strip-h: initial; --wb-head: initial; --wb-inset-top: initial; --wb-above: initial; --wb-vtop: initial; --wb-vh: initial; }
/* the column centred in its pane, at most the pane's width less small margins (as the split panes: app.css); while the
   groups' widths move, the pane's host is placed so that it stays so (lockedLeft). Its width, --col, is the pane's own, on
   the tab (view/index.js writePanes): read by the column's box and the find bar, by nothing inside the column, where it
   stops (a change of it restyled every element of the pane, at the end of every slide in 'fit' and a fitted 'paper') */
.rtx-wb .rtx-tab > main.rtx-pane[data-pane] > * { max-width: var(--col); margin-left: max(${COL_MARGIN}px, calc((100% - var(--col)) / 2)); margin-right: max(${COL_MARGIN}px, calc((100% - var(--col)) / 2)); }
.rtx-wb .rtx-tab > main.rtx-pane[data-pane] > * > * { --col: initial; }
.rtx-wb .rtx-tab .blk-render .latex-display { --latex-display-peek: 16px; }
.rtx-wb .rtx-tab > main.rtx-pane[data-pane][data-ctl="narrow"] .blk-render .latex-display { --latex-display-peek: 8px; }

/* the find bar: the current tab's, over its pane under the strip */
.rtx-wb .rtx-tab > [data-part="find"] { position: absolute; top: var(--wb-inset-top, 0px); left: 0; right: 0; z-index: 19; pointer-events: none; }
.rtx-wb .rtx-tab > [data-part="find"] .find-bar { pointer-events: auto; }

/* the home panel: the editor's Documents view as it is */
.wb-home > .rtx-wb-home { min-height: 100%; }

/* the side panels: the editor's panel content in the workbench's column */
.rtx-wb .rtx-wb-panel.sb-panel { position: absolute; inset: var(--ui-2, 8px) 0 0; overflow-y: auto; padding: 0 8px 12px; }   /* the old sidebar's inset below its tabs (8 px): the box itself, whatever a panel's own padding */

/* the window bar's controls (the editor's: split, View, the document menu) */
.rtx-wb-bar { display: inline-flex; align-items: center; gap: var(--wb-gap, 6px); }
.rtx-wb-bar .topbar-slot { display: contents; }
/* one control metric in a bar (the workbench's kit): the editor's icon buttons there (the View button) take the bar's
   height and radius as its own buttons do */
.rtx-wb-bar .ui-icon-btn { width: var(--wb-btn-h); height: var(--wb-btn-h); min-width: var(--wb-btn-h); border-radius: var(--wb-r); }
/* the app's icon: a purple tile with a white glyph, in the icon box (--wb-mark-icon, WORDMARK.md); the
   tile warmer in sepia (half the sepia accent), darker in high contrast (≥ 7:1 on white) */
.rtx-wb-logo { display: block; pointer-events: auto; cursor: default; width: var(--wb-mark-icon); height: var(--wb-mark-icon); --rtx-mark-tile: #A232C1; --rtx-mark-glyph: #fff; }
.rtx-wb-logo > svg { display: block; width: 100%; height: 100%; }
.rtx-wb-logo .rfed-mark-tile { fill: var(--rtx-mark-tile); }
.rtx-wb-logo .rfed-mark-glyph { fill: var(--rtx-mark-glyph); }
:root[data-wb-theme="sepia"] .rtx-wb-logo { --rtx-mark-tile: color-mix(in srgb, #A232C1 50%, var(--rfed-accent, #9a5b13)); }
:root[data-wb-theme="hc"] .rtx-wb-logo { --rtx-mark-tile: #7a1f94; }
.rtx-wb-version { margin: 0; }
/* the current document's word count, at the status line's end (its details in its tooltip) */
.rtx-word-count { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* focus mode (⌘⇧F): the side columns go, the window bar fades until the pointer or the focus is in it (as the old page did) */
.rtx-editor[data-focus-mode] .wb-side { display: none; }
.rtx-editor[data-focus-mode] .wb-bar { opacity: 0; transition: opacity 0.2s; }
.rtx-editor[data-focus-mode] .wb-bar:hover, .rtx-editor[data-focus-mode] .wb-bar:focus-within { opacity: 1; }
`;
