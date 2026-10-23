// The workbench's CSS (a string module, as the kit's: the builds need no CSS loader). Only the kit's tokens
// (--ui-*): no literal colours or sizes except 0, 1px hairlines, the separator's hit area and percentages.
// (Safari, viewport.ts) the workbench's boxes clip (overflow: clip), never hide: a hidden overflow is still a scroll
// container that focus() and scrollIntoView() can scroll, which moved whole groups for a moment.
import { SIDE_SIZE } from './model.ts';     // the side column's width before it is sized (the fallback of --wb-side-w)

export default String.raw`
/* ── the colour tokens' defaults: a theme (themes.ts) sets them on <html>; THEMES.md lists them ── */
:root {
  --wb-dirty-dot: 10px;     /* the unsaved dot's diameter (2 px more than the first 8) */
  /* the active tab: one set wherever the tab is (the top bar, a row): the kit's selected-tab ground, the name's ink;
     with several groups, the active tab of a group that is not focused steps back (half the ground) */
  --rfed-tab-active-bg: var(--rfed-selected);
  --rfed-tab-active-border: transparent;
  --rfed-tab-active-ink: var(--rfed-tab-name-ink);
  --rfed-tab-unfocused-active-bg: color-mix(in srgb, currentColor 5%, transparent);
  --rfed-tab-hover-bg: var(--rfed-hover);
  /* text colours are opaque mixes with the page (their contrast does not depend on what is behind): the name
     always above the section, both ≥ 4.5:1 over the glass */
  --rfed-tab-name-ink: var(--rfed-ink);
  --rfed-tab-inactive-ink: color-mix(in srgb, var(--rfed-ink) 88%, var(--rfed-page));
  --rfed-tab-active-section-ink: color-mix(in srgb, var(--rfed-ink) 82%, var(--rfed-page));
  --rfed-tab-section-ink: color-mix(in srgb, var(--rfed-ink) 76%, var(--rfed-page));
  --rfed-wordmark-icon-ink: color-mix(in srgb, var(--rfed-ink) 64%, var(--rfed-page));     /* wordmark.iconForeground: the host's logo, a step lighter than the section ink (76 %), the plain ε ≥ 3:1 against the bar */
  /* the glass bars: tinted enough that their text keeps 4.5:1 over any content */
  --rfed-tab-strip-bg: color-mix(in srgb, var(--rfed-page) 88%, transparent);
  --rfed-top-bar-bg: color-mix(in srgb, var(--rfed-page) 88%, transparent);
  /* lines: the editor's own edges (the sidebar's), set by every built-in theme */
  --rfed-splitter-border: var(--rfed-border-soft);
  --rfed-splitter-active-border: color-mix(in srgb, var(--rfed-accent) 70%, var(--rfed-page));
  --rfed-panel-border: var(--rfed-splitter-border);     /* every splitter line is the one token (splitter.border); this one: a sliding column's edge */
  --rfed-tab-strip-border: var(--rfed-border-soft);
  --rfed-top-bar-border: var(--rfed-border-soft);
  --rfed-drop-zone-bg: color-mix(in srgb, var(--rfed-accent) 10%, transparent);
  --rfed-drop-zone-border: color-mix(in srgb, var(--rfed-accent) 32%, transparent);
  --rfed-drag-insert-ink: var(--rfed-accent);
  /* the tab status: the progress fill, the error tint (tab.errorBackground), the success fill */
  --rfed-tab-progress-bg: color-mix(in srgb, var(--rfed-accent) 16%, transparent);
  --rfed-tab-error-bg: color-mix(in srgb, var(--rfed-danger) 16%, transparent);
  --rfed-tab-error-band-bg: color-mix(in srgb, var(--rfed-danger) 80%, transparent);     /* the band: no text over it */
  --rfed-tab-success-bg: color-mix(in srgb, var(--rfed-success) 24%, transparent);
}
.wb-root {
  position: relative; overflow: clip; contain: strict; box-sizing: border-box;
  /* the edge inset (--wb-edge-inset): on macOS 1 px left and right in the ground's own colour, under the rim macOS
     draws over a window's outermost pixel, so every gap is measured from inside the rim; elsewhere 0 */
  border: solid transparent; border-width: 0 var(--wb-edge-inset);
  font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); color: var(--rfed-ink); background: var(--rfed-page);
  --wb-strip-h: var(--ui-h-lg);
  --wb-spring: 450ms;
  /* the strip and the header row are glass: the content scrolls under them, blurred; tinted enough that their text
     keeps 4.5:1 over any content (the tests put solid ink behind them). Text colours are opaque mixes with the
     page (their contrast does not depend on what is behind): the name always above the section, both ≥ 4.5:1. */
  --wb-blur: saturate(180%) blur(14px);
  --wb-bleed: 14px;         /* the blur layer reaches this far past the strip, then is masked back (no edge sampling) */
}
.wb-root *, .wb-root *::before, .wb-root *::after { box-sizing: border-box; }
/* the first frames after a mount or a restore: no transitions (the layout is placed, not animated) */
.wb-root.wb-booting, .wb-root.wb-booting *, .wb-root.wb-booting *::before, .wb-root.wb-booting *::after { transition: none !important; }
/* every scroll area keeps its overscroll to itself (no chaining to the page, no bounce of the app) */
.wb-root, .wb-root * { overscroll-behavior: contain; }
.wb-root { display: flex; }
/* the solid fallback: no backdrop-filter, reduced transparency, or a host's .wb-solid */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .wb-root { --rfed-tab-strip-bg: var(--rfed-page); --rfed-top-bar-bg: var(--rfed-page); --wb-blur: none; } }
@media (prefers-reduced-transparency: reduce) { .wb-root { --rfed-tab-strip-bg: var(--rfed-page); --rfed-top-bar-bg: var(--rfed-page); --wb-blur: none; } }
.wb-root { --wb-edge-inset: 0px; }
html[data-wb-theme-type="dark"] .wb-root.wb-root--edge-rim { --wb-edge-inset: 1px; }     /* the rim shows on a dark window only */
/* beside an open side column the edge takes the column's ground */
.wb-root--edge-rim.wb-root--left-shown { border-left-color: var(--rfed-sidebar-bg); }     /* (classes from ui.ts: no :has() on the root) */
.wb-root--edge-rim.wb-root--right-shown { border-right-color: var(--rfed-sidebar-bg); }
.wb-root.wb-solid { --rfed-tab-strip-bg: var(--rfed-page); --rfed-top-bar-bg: var(--rfed-page); --wb-blur: none; }
/* high contrast: no translucency (the solid bars), strong rings */
html[data-wb-theme-type="hc"] .wb-root { --rfed-tab-strip-bg: var(--rfed-page); --rfed-top-bar-bg: var(--rfed-page); --wb-blur: none; }
/* the tint without blur: a host may prefer it */
.wb-root.wb-glass-tint { --wb-blur: none; }
.wb-main { position: relative; flex: 1 1 auto; min-width: 0; overflow: clip; }
.wb-groups { position: absolute; inset: 0; }
/* the window bar (a host's top bar, the editor's): 44 px, glass; with one tab it is the tab bar (the document's
   header in it); the groups start below it */
.wb-root { --wb-bar-h: calc(var(--ui-h-lg) + 2 * var(--wb-gap)); }     /* the bar, a one-line strip, a side strip: the gap, a pill, the gap */
/* the fit is a minimum, never the text: a strip is one line (and a group's strip in the top bar) while every tab gets
   --wb-tab-min (n × it + the gaps within the room for tabs: ui.js oneLine), else two lines (its own row). */
.wb-root { --wb-tab-min: 280px; }
/* the bar sits between the columns (they run the full height, as the editor's sidebar): it shortens when a column
   opens; each column's panel tabs are level with it */
.wb-root--bar .wb-groups { top: var(--wb-bar-h); }
.wb-bar {
  --wb-btn-h: 32px;
  position: absolute; top: 0; left: 0; right: 0; height: var(--wb-bar-h); z-index: 7; display: flex; align-items: center; gap: var(--wb-gap);
  padding: 0 var(--wb-gap); isolation: isolate;
}
/* the bar is glass as the strips are (the same layer, below): the top groups run up under it, their content scrolls
   beneath; their strip, header and first line start below it (--wb-above), the scrollbar track too */
.wb-root--bar .wb-group:is([data-top="true"], .wb-group--max) { margin-top: calc(-1 * var(--wb-bar-h)); --wb-above: var(--wb-bar-h); }
.wb-root--bar:not(.wb-root--solo) .wb-bar::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--rfed-top-bar-border); pointer-events: none; }
/* the free room between the left items and the right controls: the host's mark, then (in the bar) the strip. The mark's
   parts (icon, text) are optional items (ui.js barItems): each a clipped box, its content's width with the gap after it
   while in, 0 while out. The icon is a --wb-mark-icon square at ONE inset from the bar's left, top and bottom (after
   the show-sidebar button: the gap). The text is set as the tab text is: the same line (--wb-line, the one-line tab's)
   centred alike, its strut the UI font at the tab size, so its baseline is the tabs'; the host's face (any) takes no
   line room (line-height 0) and is scaled to the UI font's x-height (--wb-ui-ex, measured: ui.js), its apparent size */
.wb-root { --wb-line: 18px; --wb-mark-icon: 32px; }     /* the icon a button's size: [show sidebar] [icon] [home] read as one row of buttons */
.wb-bar-fill { flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: center; }
.wb-bar-mark { flex: 0 0 auto; display: flex; align-items: center; pointer-events: none; transition: margin-left var(--wb-slide-ms, 220ms) var(--ui-ease); }
.wb-mark-part { display: flex; align-items: center; overflow: clip; }
.wb-mark-part[data-on="false"] { width: 0; }
.wb-mark-in { flex: none; display: flex; align-items: center; padding-right: var(--wb-gap); white-space: nowrap; }
.wb-mark-part[data-part="icon"] > .wb-mark-in { height: var(--wb-mark-icon); }
.wb-mark-part[data-part="text"] > .wb-mark-in { display: block; font-size: var(--ui-text-md); line-height: var(--wb-line); }
/* keyed on the inner box's own class: a [data-part] in a rule whose subject is * made Chromium restyle the
   whole subtree of any element whose data-part changed (the editor moves data-part between panes as the focus moves) */
.wb-mark-in--text > * { line-height: 0; font-size: inherit; font-size-adjust: ex-height var(--wb-ui-ex, 0.5); }
@media (prefers-reduced-motion: reduce) { .wb-bar-mark { transition: none; } }
/* (with a bar) one group's tabs in the top bar: the compact one-line pills, the bar's button height */
/* (1/n) the strip fills the free room between home and the right controls (the one gap before them); its tabs
   share it equally: their widths follow the bar and the count, never the text (it truncates inside) */
.wb-strip.wb-strip--inbar { position: relative; top: auto; left: auto; right: auto; z-index: 1; flex: 1 1 0; min-width: 0; height: var(--wb-bar-h); padding: 0;
  --wb-btn-h: 32px; box-shadow: none !important; background: none; }
.wb-strip--inbar::before { display: none; }
.wb-strip--inbar .wb-tabs { flex: 1 1 auto !important; padding: 0 !important; min-width: 0; overflow: clip; }     /* the bar's tabs always fit (n × --wb-tab-min, else they go to the row): nothing to scroll; WebKit's 1/64 px rounding of their shares had made it scrollable by 1 px */
.wb-root .wb-strip--inbar .wb-tabs .wb-tab { height: var(--wb-btn-h); flex: 1 1 0; min-width: 0; max-width: none; }
/* a narrow window: the bar's strip draws its active tab alone (bar.ts, strip.ts single); the others behind
   this count after it, which opens them as a list */
.wb-tabs-count { flex: 0 0 auto; display: inline-flex; align-items: center; align-self: center; min-width: var(--wb-btn-h); height: var(--wb-btn-h); padding: 0 var(--ui-2); justify-content: center;
  font: var(--ui-semibold) var(--ui-text-sm)/1 var(--ui-font); font-variant-numeric: tabular-nums; color: var(--rfed-ink-2); }
.wb-root--inbar .wb-group--inbar { --wb-top: var(--wb-above, 0px); }
/* one tab T in the bar: no chip, no ×: it reads as the document's title (its name and section still dropdowns); a
   second tab fades them in (the tab's background and the close button's opacity transitions) */
/* home over a group: its panel on top of the group's views (kept, inert) */
.wb-home.wb-home--over { z-index: 2; background: var(--rfed-page); }
.wb-root--inbar .wb-bar-right { flex: 0 0 auto; }
.wb-bar-right { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: var(--wb-gap); }
.wb-bar .wb-btn.wb-side-toggle { margin: 0; }
/* the editor's breadcrumbs in the bar: 13 px, "/" between, the document's name medium, menus with a chevron */
.wb-crumbs.wb-crumbs--bar { --wb-btn-h: 32px; position: static; flex: 0 1 auto; height: var(--wb-btn-h); background: none; box-shadow: none; font-size: var(--ui-text-md); color: var(--rfed-ink); container: none; }
.wb-crumbs--bar::before { display: none; }
.wb-crumbs.wb-crumbs--bar ol { padding: 0; gap: var(--ui-1); }
/* home: an icon in a pill like a tab's (its radius, ground and hover; shorter); "Documents" is its name and tooltip */
.wb-crumbs--bar .wb-crumb--home .wb-crumb-label { display: none !important; }
.wb-crumbs--bar [data-crumb="doc"] { font-weight: var(--ui-medium); color: var(--rfed-tab-name-ink); }
.wb-crumbs--bar .wb-crumb-sep svg { display: none; }
.wb-crumbs--bar .wb-crumb-sep::before { content: "/"; color: var(--rfed-ink-4); padding: 0 2px; }
.wb-crumbs--bar .wb-crumb-more svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); color: var(--rfed-ink-2); }
.wb-crumbs--bar li:last-child { flex: 0 1 auto; }
.wb-crumb-action { color: var(--rfed-tab-section-ink); }

/* ── the document header modes ── */
/* home: the group's toggle, the strip's first item, outside the scrolling tabs */
.wb-strip .wb-home-btn { align-self: center; flex: 0 0 auto; width: var(--ui-h-lg); min-width: 0; }     /* its width is the one-line height in every form: tall and narrow in two lines */
.wb-crumb-more { display: inline-grid; color: var(--rfed-ink-3); margin-left: -2px; }
.wb-crumb-more svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); }
.wb-crumb[data-menu][aria-current="page"] { cursor: pointer; }
.wb-crumb[data-menu][aria-current="page"]:hover { background: var(--rfed-hover); }
/* two lines: the pill --wb-pill2-h (the strip 8 px more), its lines --wb-line-gap apart; the room goes INTO the tabs */
.wb-root { --wb-pill2-h: 49px; --wb-line-gap: 5px; --wb-strip-h: calc(var(--wb-pill2-h) + 2 * var(--wb-gap)); }
.wb-root .wb-tab { height: var(--wb-btn-h); padding: var(--ui-2) var(--ui-3); gap: var(--wb-tab-gap); border-radius: var(--ui-r-md); }
.wb-root { --wb-tab-gap: 10px; }
/* one line: the strip and its pills match the top bar (44 / 32, inset 6); two
   lines: the taller strip (57 / 49) */
.wb-root .wb-group[data-form="one"] { --wb-strip-h: var(--wb-bar-h); }
.wb-root .wb-group[data-form="one"] .wb-strip:not(.wb-strip--inbar) { --wb-btn-h: 32px; }
/* the tabs share the whole strip, each 1/n of it (no room left at the end) */
.wb-root .wb-tabs { flex: 1 1 auto; }
.wb-root .wb-tab { flex: 1 1 0; min-width: 0; max-width: none; }
/* the close box: a chip (the one inset and radius, above), in the pill's side padding. The text box runs up to it (the ×
   takes back the tab gap): a text grows until it is flush with the ×, and only then truncates (the chip's right
   padding below). Hidden, the × takes no room: the text box then ends the pill's side padding from its border, as it
   starts */
.wb-root .wb-tab-close { width: var(--wb-chip-h); height: calc(var(--wb-btn-h) - 2 * var(--wb-chip-inset));
  align-self: center; margin: 0 calc(var(--wb-chip-inset) - var(--ui-3)) 0 calc(-1 * var(--wb-tab-gap)); border-radius: var(--wb-chip-r); }

/* two lines: the document, then that tab's own section (smaller) */
.wb-tab-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: var(--wb-line-gap, 4px); }
.wb-tab-text .wb-tab-label { line-height: 16px; }
/* the section never sets the tab's width (inline-size containment): a section change while scrolling moves nothing */
.wb-tab-sub { contain: inline-size; display: flex; align-items: center; --wb-chip-gap: 4px; gap: var(--wb-chip-gap); min-width: 0; font-size: var(--ui-text-xs); line-height: 14px; color: var(--rfed-tab-section-ink); font-weight: normal; }     /* the chevron flush with the title's first letter, the section 4 px after it */
.wb-tab.wb-tab--on .wb-tab-sub { color: var(--rfed-tab-active-section-ink); }
.wb-tab-sub-label { min-width: 0; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }   /* a new section shows at once: no fade, no colour change */
.wb-tab-sub svg { flex: 0 0 auto; width: 10px; height: 10px; color: var(--rfed-ink-3); }
/* the name and the section are dropdowns on the active tab: chips (their geometry below); hover and press tint them */
.wb-tab.wb-tab--on :is([data-name], [data-sub]) { border-radius: var(--wb-chip-r); transition: background-color var(--ui-fast) var(--ui-ease); }
/* the chips (hover, press, the pointer) only where the dropdowns open, the focused group's strip (wb-strip--focused, from
   the render), its active tab, never during the press that made it so nor until the pointer leaves it (data-nochip): the active tab of the FOCUSED group (or the
   top bar's, whose group is the only one); elsewhere the active tab hovers as an inactive one, as a whole */
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-name] { cursor: pointer; }
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-name]:hover { background: var(--rfed-hover); }
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-name]:active { background: var(--rfed-press); }
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-sub] { cursor: pointer; }
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-sub]:hover { background: var(--rfed-hover); }
.wb-strip--focused:not(.wb-strip--home) .wb-tab.wb-tab--on:not([data-nochip]) [data-sub]:active { background: var(--rfed-press); }
/* a drag takes the chips (they fill the pill: every press on the active tab starts on one): no tint, no fade after the drop */
html:is(.wb-dragging, .wb-dropped) .wb-tab :is([data-name], [data-sub]) { background: none !important; transition: none !important; }
.wb-tab-sec svg { flex: 0 0 auto; width: 10px; height: 10px; color: var(--rfed-ink-3); align-self: center; }
/* two lines: a chevron before the section marks it a sub-level; it hangs left, so the section lines up under the name */
.wb-tab-sub .wb-tab-chev { width: 10px; flex: 0 0 auto; display: inline-grid; color: var(--rfed-tab-section-ink); margin-left: -2px; }     /* its stroke starts 3.3 px into the box, a title's first glyph ~1 px: painted flush */
.wb-tab-sub .wb-tab-chev svg { width: 10px; height: 10px; }
/* the chips (the name, the section, the ×) keep ONE inset from the pill's border (--wb-chip-inset) and take ONE radius
   (--wb-chip-r, concentric with the pill's): each is its text box grown by padding (the pill-side padding less the
   inset; toward the "›" its region less 2 px), the growth taken back by a negative margin: the text never moves, the
   tab keeps its box. Two lines: the name the top part, the section the bottom part; they overlap by
   --wb-chip-overlap across the band between the lines (one shows at a time). One line: the section mirrors the name
   around the "›". The × box: the inset on its three pill sides, the one-line height square */
.wb-root { --wb-chip-overlap: calc(var(--wb-line-gap, 4px) + 1px); }
.wb-root .wb-tab { --wb-cpl: calc(var(--ui-3) - var(--wb-chip-inset)); --wb-chev-x: calc(var(--ui-icon-xs) + 4px);
  --wb-t2: calc((var(--wb-btn-h) - 30px - var(--wb-line-gap, 4px)) / 2 - var(--wb-chip-inset)); --wb-t1: calc((var(--wb-btn-h) - 18px) / 2 - var(--wb-chip-inset)); }
.wb-tab.wb-tab--on .wb-tab-text > [data-name] { padding: var(--wb-t2) var(--wb-cpl) var(--wb-chip-overlap); margin: calc(-1 * var(--wb-t2)) calc(-1 * var(--wb-cpl)) calc(-1 * var(--wb-chip-overlap)); }
.wb-tab.wb-tab--on .wb-tab-sub[data-sub] { padding: var(--wb-line-gap) var(--wb-cpl) var(--wb-t2); margin: calc(-1 * var(--wb-line-gap)) calc(-1 * var(--wb-cpl)) calc(-1 * var(--wb-t2)); }
.wb-tab.wb-tab--on .wb-tab-line > [data-name] { padding: var(--wb-t1) var(--wb-chev-x) var(--wb-t1) var(--wb-cpl); margin: calc(-1 * var(--wb-t1)) calc(-1 * var(--wb-chev-x)) calc(-1 * var(--wb-t1)) calc(-1 * var(--wb-cpl)); }
.wb-tab.wb-tab--on .wb-tab-sec[data-sub] { padding: var(--wb-t1) var(--wb-cpl) var(--wb-t1) var(--wb-chev-x); margin: calc(-1 * var(--wb-t1)) calc(-1 * var(--wb-cpl)) calc(-1 * var(--wb-t1)) calc(-1 * var(--wb-chev-x)); }
/* the name alone on its line (no section): both sides as the pill side */
.wb-tab.wb-tab--on:not(:has(.wb-tab-sec)) .wb-tab-line > [data-name] { padding-right: var(--wb-cpl); margin-right: calc(-1 * var(--wb-cpl)); }
/* the chips' padding (border-box): on top of the text's minimum (below) */
.wb-root .wb-tab.wb-tab--on .wb-tab-line > :is([data-name], [data-sub]) { --wb-chip-pad: calc(var(--wb-cpl) + var(--wb-chev-x)); }
.wb-root .wb-tab.wb-tab--on:not(:has(.wb-tab-sec)) .wb-tab-line > [data-name] { --wb-chip-pad: calc(2 * var(--wb-cpl)); }
/* the chips facing the × (two lines: both; one line: the section, or the name alone): their right padding is a spacer
   after the text that shrinks first (flex-shrink 1000), so a long text uses it up and is flush with the × before it
   truncates; a short one keeps it (the ground as before). Their box ends where it always did: at the × (two lines),
   or the chip overlap past its edge (one line: --wb-x-over, the spacer's least width, so the text stops at the ×) */
.wb-tab-text { --wb-x-over: 0px; } .wb-tab-line { --wb-x-over: var(--wb-chip-overlap); }
.wb-tab.wb-tab--on :is(.wb-tab-text > [data-name], .wb-tab-sub[data-sub], .wb-tab-line > [data-sub], .wb-tab-line > [data-name]:last-child) { padding-right: 0; margin-right: calc(-1 * var(--wb-x-over)); }
.wb-tab.wb-tab--on :is(.wb-tab-text > [data-name], .wb-tab-sub[data-sub], .wb-tab-line > [data-sub], .wb-tab-line > [data-name]:last-child)::after { content: ""; flex: 0 1000 auto; width: var(--wb-cpl); min-width: var(--wb-x-over); margin-left: calc(-1 * var(--wb-chip-gap, 0px)); }     /* (the chip's own gap taken back: the spacer alone is the padding) */
/* the chevron between the one-line chips: drawn over both, never a hover target of its own */
.wb-tab.wb-tab--on .wb-tab-line > .wb-tab-chev { position: relative; z-index: 1; pointer-events: none; }
/* narrow (every form, both hosts): the tabs may shrink; their text truncates with "…"; only a tab whose text box is
   narrower than its name's first 3 characters and "…" (--wb-name-min) shows its icon instead (data-fit="tiny", per
   tab: ui.js fitTabs; in practice two lines: one line gives every tab --wb-tab-min). Never initials, never empty. */
@container wbgroup (max-width: 400px) { .wb-root .wb-tab:not(.wb-tab--on) { min-width: 0; } }
@container wbgroup (max-width: 240px) { .wb-root .wb-tab { min-width: 0; } }
/* the icon, over the text kept in place (unseen: the tab's box does not change, so no feedback) */
.wb-tab-tinyicon { display: none; flex: 0 0 auto; place-items: center; color: var(--rfed-ink-2); }
.wb-tab-tinyicon svg { width: var(--ui-icon-md); height: var(--ui-icon-md); }
.wb-tab[data-fit="tiny"] :is(.wb-tab-text, .wb-tab-line) { visibility: hidden; }
.wb-tab[data-fit="tiny"] .wb-tab-tinyicon { display: inline-grid; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.wb-tab[data-fit="tiny"].wb-tab--on .wb-tab-tinyicon { left: var(--ui-2); transform: translateY(-50%); }
.wb-tab[data-fit="tiny"]:not(.wb-tab--on) .wb-tab-close { visibility: hidden; }
/* one line: the name and the section share the line, and the name matters more (the section is known by its number).
   The name takes its whole text; the section the room left, from its minimum (--wb-sec-min: its number, its first 3
   characters and "…"; strip.ts fitTabs) up to its whole text: so the section yields first. Short of room for the whole
   name and that minimum, both shrink in proportion to their widths (flex-shrink weighs by the basis), down to their
   floors: the name's first 3 characters and "…" (--wb-name-min), the section's number and "…" (--wb-sec-floor;
   unnumbered: its first 3 characters and "…"). Neither takes everything, neither disappears */
.wb-root .wb-tab-line > .wb-tab-label { flex: 0 1 auto; min-width: calc(var(--wb-name-min, 4.5ch) + var(--wb-chip-pad, 0px)); max-width: max-content; }
.wb-root .wb-tab-line > .wb-tab-sec { flex: 1 1 calc(var(--wb-sec-min, 4.5ch) + var(--wb-chip-pad, 0px)); min-width: calc(var(--wb-sec-floor, 4.5ch) + var(--wb-chip-pad, 0px)); max-width: max-content; }

/* one line, "Document › Section": the name steps back (muted) when the group has the document twice; the section's
   number never truncates */
.wb-tab-line { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 3px; white-space: nowrap; line-height: var(--wb-line); }     /* a whole-pixel line: the text (and a rename field over it) on one pixel grid */
/* a shared name (the document open in several tabs) steps back to the section's level, never below it */
.wb-tab-line.is-shared .wb-tab-label, .wb-tab-text.is-shared .wb-tab-label { color: var(--rfed-tab-section-ink); font-weight: normal; }
.wb-tab.wb-tab--on .wb-tab-line.is-shared .wb-tab-label, .wb-tab.wb-tab--on .wb-tab-text.is-shared .wb-tab-label { color: var(--rfed-tab-active-section-ink); }
.wb-tab-chev { flex: 0 0 auto; display: inline-grid; color: var(--rfed-ink-3); }
.wb-tab-chev svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); }
.wb-tab-sec { flex: 0 1 auto; min-width: 0; display: flex; --wb-chip-gap: 5px; gap: var(--wb-chip-gap); color: var(--rfed-tab-active-section-ink); }
.wb-tab:not(.wb-tab--on) .wb-tab-sec { color: var(--rfed-tab-section-ink); }
.wb-tab-num { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.wb-tab-sec-text { min-width: 0; overflow: clip; text-overflow: ellipsis; }

/* ── sidebars (sides.js): a left and a right column of tool-window panels, a stack of panel groups each ── */
.wb-side {
  position: relative; z-index: 8; flex: 0 0 auto; width: min(var(--wb-side-w, ${SIDE_SIZE}px), 45%); display: flex; flex-direction: column; min-width: 0;
  overflow: visible; background: var(--rfed-sidebar-bg); container: wbside / inline-size;
}
/* a column's edge is ONE line, its splitter's, drawn on the column's inner pixel over the full height; the column sits
   above the top bar (z 8 > 7), so neither the line nor the splitter's hit area (4 px into the main area) is ever under
   the bar. While it slides (no splitter) the column draws the same line itself */
.wb-side--left { order: -1; } .wb-side--right { order: 1; }
.wb-side--sliding.wb-side--left { box-shadow: inset -1px 0 0 var(--rfed-splitter-border); }
.wb-side--sliding.wb-side--right { box-shadow: inset 1px 0 0 var(--rfed-splitter-border); }
/* hidden means fully gone: no room, no rail; kept mounted (its panels keep their state), not laid out */
.wb-side--hidden { position: absolute; top: 0; bottom: 0; visibility: hidden; content-visibility: hidden; pointer-events: none; }
.wb-side--hidden.wb-side--left { left: 0; } .wb-side--hidden.wb-side--right { right: 0; }
/* the slide: over the groups, a transform only (the groups were laid out once, at its start or its end) */
/* opening or closing: the column's room animates in the flow (sides.js), so the main area and the top bar move with
   its edge; its content keeps its width, held at the inner edge, and is clipped as the room narrows */
.wb-side.wb-side--sliding { position: relative; top: auto; bottom: auto; left: auto; right: auto; visibility: visible; content-visibility: visible; overflow: clip; flex: 0 0 auto; }
.wb-side--sliding > :not(.wb-sep) { flex-shrink: 0; width: var(--wb-slide-w); }
.wb-side--sliding.wb-side--left { align-items: flex-end; } .wb-side--sliding.wb-side--right { align-items: flex-start; }
.wb-side--sliding .wb-sep { visibility: hidden; }
/* a narrow window (sides.ts OVERLAY_MAX_W, 640 px): a shown column FLOATS over the main area, which keeps its
   width (no reflow of the documents); a scrim under it closes it on a tap; no splitter. Its slide is its own width */
.wb-side.wb-side--overlay { position: absolute; top: 0; bottom: 0; z-index: 30; width: min(var(--wb-side-w, ${SIDE_SIZE}px), 85%); background: linear-gradient(var(--rfed-sidebar-bg), var(--rfed-sidebar-bg)), var(--rfed-page);   /* its tint over the page: opaque over the document */ box-shadow: var(--ui-shadow-pop, none); }
.wb-side.wb-side--overlay.wb-side--sliding { position: absolute; top: 0; bottom: 0; }
.wb-side--overlay.wb-side--left { left: 0; right: auto; } .wb-side--overlay.wb-side--right { right: 0; left: auto; }
.wb-side--overlay .wb-sep { display: none; }
.wb-side-scrim { position: absolute; inset: 0; z-index: 29; background: var(--rfed-modal-backdrop-bg); animation: wb-scrim-in var(--wb-slide-ms, 220ms) var(--ui-ease); }
@keyframes wb-scrim-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .wb-side-scrim { animation: none; } }
/* the bar's open button: its slot shrinks to nothing as its column opens (the bar's contents slide over) and grows back;
   shrunk, it takes its gap with it (a negative --wb-gap): the next item is where it would be with no slot at all */
.wb-bar-slot { flex: 0 0 auto; display: inline-flex; overflow: clip; width: var(--wb-btn-h); transition: width var(--wb-slide-ms, 220ms) var(--ui-ease), margin var(--wb-slide-ms, 220ms) var(--ui-ease); }
.wb-bar-slot > .wb-btn { flex: 0 0 auto; }
.wb-bar-slot--left[data-open="true"] { width: 0; margin-right: calc(-1 * var(--wb-gap)); }
.wb-bar-slot--right[data-open="true"] { width: 0; margin-left: calc(-1 * var(--wb-gap)); }
@media (prefers-reduced-motion: reduce) { .wb-bar-slot { transition: none; } }
/* a floating column (narrow window) covers the bar's open button: the slot keeps its width, so nothing in the bar moves */
@media (max-width: 640px) { .wb-bar-slot--left[data-open="true"], .wb-bar-slot--right[data-open="true"] { width: var(--wb-btn-h); margin: 0; } }
/* the stack: its groups placed as the document groups are (snapped boxes from the fractions), the shared splitters between them */
.wb-side-groups { position: relative; flex: 1 1 auto; min-height: 0; }
.wb-side-pane { position: absolute; display: flex; flex-direction: column; min-height: 0; overflow: clip; }
.wb-side-strip { --wb-btn-h: 32px; flex: 0 0 auto; display: flex; align-items: center; gap: var(--wb-gap); min-width: 0; height: var(--wb-bar-h); padding: 0 var(--wb-gap); }
/* (no border on either side of a splitter: the splitter alone draws the one line) */
.wb-ptabs { --wb-tab-min: 0px; } /* (the document tabs' minimum is not the panels': fitTabs sets theirs) */
.wb-ptabs { position: relative; flex: 1 1 auto; display: flex; align-items: center; gap: var(--wb-gap); min-width: 0; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
.wb-ptabs::-webkit-scrollbar { display: none; }
.wb-ptab { flex: 1 1 0; min-width: var(--wb-tab-min); justify-content: center; font-size: var(--ui-text-sm); cursor: default; user-select: none; -webkit-user-select: none; touch-action: none; }
.wb-ptab-badge { margin-left: 4px; min-width: 16px; padding: 0 4px; box-sizing: border-box; border-radius: var(--ui-r-pill); background: var(--rfed-selected); color: var(--rfed-ink-2); font: var(--ui-medium) var(--ui-text-xs)/16px var(--ui-font); text-align: center; }
.wb-ptab-badge[data-tone="danger"] { color: var(--rfed-danger); }
.wb-ptab-icon { display: none; place-items: center; color: var(--rfed-ink-3); }
.wb-ptab-icon svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); }
/* the tabs as icons when their labels do not fit the strip (sides.ts fitTabs): a narrow column, many panels */
.wb-ptabs[data-compact] .wb-ptab-icon { display: inline-grid; }
.wb-ptabs[data-compact] .wb-ptab-label { display: none; }
.wb-ptabs[data-compact] .wb-ptab[aria-selected="true"] .wb-ptab-icon { color: var(--rfed-ink); }
/* the even split: each tab 1/n of the strip, at least its minimum (sides.ts fitTabs: the widest label; as icons the kit's
   icon-button box), else the strip scrolls; measured at their own widths */
.wb-ptabs[data-measure] .wb-ptab { flex: none; min-width: 0; }
.wb-ptabs[data-compact] { --wb-tab-min: var(--wb-btn-h); }
.wb-ptabs[data-compact] .wb-ptab { position: relative; padding-inline: 0; }
.wb-ptabs[data-compact] .wb-ptab-badge { position: absolute; top: 1px; right: -2px; margin: 0; min-width: 14px; padding: 0 3px; font-size: 9px; line-height: 14px; }
/* the left column's status bar (the host's sideStatus), below its groups: VS Code's, on the kit's metrics: a small row,
   small secondary text, the hairline above it the columns' line (splitter.border) */
.wb-side-status { flex: 0 0 auto; display: flex; align-items: center; gap: var(--wb-gap); min-width: 0; height: var(--ui-h-sm); padding: 0 var(--ui-3);
  border-top: 1px solid var(--rfed-splitter-border); font-size: var(--ui-text-sm); line-height: 1; color: var(--rfed-tab-section-ink); white-space: nowrap; overflow: clip; }     /* the section's ink: secondary, ≥ 4.5:1 */
.wb-side-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: clip; }
.wb-side .wb-panel { background: transparent; }
.wb-side-sep { top: 0; bottom: 0; }
.wb-sep[aria-orientation].wb-side-sep { margin-left: 0; }
.wb-side-sep--left { right: -4px; } .wb-side-sep--right { left: -4px; }
.wb-sep[aria-orientation].wb-side-sep--left::before { left: 3px; }     /* [edge - 1, edge]: inside the column */
.wb-sep[aria-orientation].wb-side-sep--right::before { left: 4px; }
/* the show button of a hidden column (the app's sidebar toggle), where the strip begins (left) or ends (right) */
.wb-btn.wb-side-toggle { align-self: center; }
.wb-side-toggle--left + .wb-tabs { box-shadow: inset 1px 0 0 var(--rfed-border-soft); }
/* during a panel drag: a top and a bottom zone at each edge of the main area (a hidden or empty column) */
.wb-edge { position: absolute; top: 8px; bottom: 8px; width: 72px; z-index: 6; display: flex; flex-direction: column; gap: 6px; animation: wb-fade var(--ui-fast) var(--ui-ease-out); }
.wb-edge--left { left: 8px; } .wb-edge--right { right: 8px; }
.wb-edge-half {
  flex: 1 1 0; display: grid; place-items: center; border-radius: var(--ui-r-md);
  background: color-mix(in srgb, var(--rfed-accent) 6%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rfed-accent) 22%, transparent);
  color: var(--rfed-accent); font-size: var(--ui-text-xs); transition: background-color var(--ui-fast) var(--ui-ease);
}
.wb-edge-half span { writing-mode: vertical-rl; letter-spacing: var(--ui-caps-track); text-transform: uppercase; pointer-events: none; }
.wb-edge-half.is-over { background: color-mix(in srgb, var(--rfed-accent) 16%, transparent); }

/* ── groups: absolutely placed from the layout's fractions (no measuring) ── */
.wb-group {
  position: absolute; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: clip;
  background: var(--rfed-page);
}
/* the tabs' size queries (@container wbgroup) are the strip's: a group as the size container restyled everything in it,
   its documents included, in every frame its width moved (200 ms frames as a side
   column slid) */
.wb-group > .wb-strip { container: wbgroup / inline-size; }
/* the line between groups is the separator's (it takes no room: a group's insets do not depend on its neighbours) */
.wb-group--off { visibility: hidden; content-visibility: hidden; }
.wb-group--max { z-index: 3; border: 0 !important; }

/* ── the strip (layout; the look is below) ── */
/* every gap around and between pills is one token (--wb-gap, the kit's): edge → home → tab → tab → the splitter line
   or edge, and above and below the pills; the same in the rows, the top bar and the side panels */
.wb-strip { --wb-btn-h: calc(var(--wb-strip-h) - 2 * var(--wb-gap)); --wb-inset: var(--wb-gap);
  padding: 0 var(--wb-inset); gap: var(--wb-gap); position: absolute; top: var(--wb-above, 0px); left: 0; right: 0; z-index: 3; height: var(--wb-strip-h); display: flex; align-items: stretch; min-width: 0; isolation: isolate; }
/* the glass is its own layer: the tint and the blur on a pseudo-element that bleeds past the strip by the blur
   radius at the top and the bottom and is masked back to the strip, on its own compositor layer at whole pixels:
   the blur samples content that is really there at its edges, so it does not shimmer while the content scrolls */
.wb-strip::before, .wb-crumbs::before, .wb-bar::before {
  content: ""; position: absolute; left: 0; right: 0; top: calc(-1 * var(--wb-bleed)); bottom: calc(-1 * var(--wb-bleed)); z-index: -1; pointer-events: none;
  background: var(--rfed-tab-strip-bg); -webkit-backdrop-filter: var(--wb-blur); backdrop-filter: var(--wb-blur);
  transform: translateZ(0); will-change: transform;
  -webkit-mask-image: linear-gradient(to bottom, transparent var(--wb-bleed), currentColor var(--wb-bleed), currentColor calc(100% - var(--wb-bleed)), transparent calc(100% - var(--wb-bleed)));
  mask-image: linear-gradient(to bottom, transparent var(--wb-bleed), currentColor var(--wb-bleed), currentColor calc(100% - var(--wb-bleed)), transparent calc(100% - var(--wb-bleed)));
}
.wb-bar::before { background: var(--rfed-top-bar-bg); }
/* the content starts under the strip (and the header row): views pad by --wb-inset-top, so nothing hides at rest */
.wb-group { --wb-top: calc(var(--wb-above, 0px) + var(--wb-strip-h)); }
/* beside a splitter: the strip pads by the line's share (see .wb-sep), so pill → line = --wb-inset on each side */
.wb-group[data-left="false"]:not(.wb-group--max) > .wb-strip { padding-left: calc(var(--wb-inset) + 1px - var(--wb-hair)); }
.wb-group[data-right="false"]:not(.wb-group--max) > .wb-strip { padding-right: calc(var(--wb-inset) + var(--wb-hair)); }
.wb-group[data-top="false"]:not(.wb-group--max) { --wb-above: calc(1px - var(--wb-hair)); }
.wb-root--solo .wb-group { --wb-top: var(--wb-above, 0px); }
.wb-strip[hidden] { display: none; }
.wb-strip--reveal { animation: wb-strip-in var(--ui-mid) var(--ui-ease-out); overflow: clip; }
@keyframes wb-strip-in { from { opacity: 0; transform: translateY(-8px); } }
.wb-tabs {
  flex: 0 1 auto; display: flex; align-items: center; gap: var(--wb-gap); min-width: 0; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; overscroll-behavior-x: contain; position: relative;
}
.wb-tabs::-webkit-scrollbar { display: none; }
.wb-strip-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--wb-gap); margin-left: auto; }
.wb-strip-actions:empty { display: none; }   /* no room kept at the end: the tabs reach the same inset as at the start */
/* the buttons: kit/css.ts (one control library) */

.wb-tab {
  position: relative; flex: 0 1 auto; display: flex; align-items: center; gap: 6px;
  min-width: 96px; max-width: min(220px, 70cqi); padding: 0 var(--ui-1) 0 var(--ui-3);
  color: var(--rfed-tab-inactive-ink); cursor: default; user-select: none; -webkit-user-select: none; white-space: nowrap;
  outline: none; touch-action: none; font-size: var(--ui-text-md);
  transition: background-color var(--ui-fast) var(--ui-ease), color var(--ui-fast) var(--ui-ease), box-shadow var(--ui-fast) var(--ui-ease);
}
.wb-tab:hover { color: var(--rfed-ink); }
/* the active, hovered and focused states take exactly the box of the idle one: colour, ground and inset rings only
   (no border, padding, weight or flex change: the pill's width is its 1/n, never its content's) */
.wb-tab.wb-tab--on { color: var(--rfed-tab-name-ink); }
/* the keyboard's ring (--rfed-focus-ring, the kit's): the tab's on its pill (the role=tab element is an empty box laid over the
   pill), a control's on its chip, raised over its neighbours (the chips overlap by --wb-chip-overlap); inset: no strip
   (overflow) clips it; above every state's ring (the active and the unfocused-active looks) */
.wb-tab-tab { position: absolute; inset: 0; border-radius: inherit; outline: none; pointer-events: none; }
.wb-tab--preview .wb-tab-label { font-style: italic; }
.wb-tab--dragging { opacity: 0.45; }
.wb-tab-icon { flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--ui-icon-md); height: var(--ui-icon-md); color: var(--rfed-ink-3); }
.wb-tab.wb-tab--on .wb-tab-icon { color: var(--rfed-ink-2); }
.wb-tab-icon svg { width: var(--ui-icon-md); height: var(--ui-icon-md); }
.wb-tab-label { flex: 1 1 auto; min-width: 0; display: flex; }
.wb-tab-name { min-width: 0; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
/* the ×: shown on hover, with the keyboard inside the tab, on the active and pinned tabs, without hover; hidden it
   takes no room (the text's last line part takes it), shown it takes it back at once (no transition) */
.wb-tab-close {
  flex: 0 0 auto; display: none; place-items: center; width: 20px; height: 20px; border-radius: var(--ui-r-sm);
  cursor: pointer; transition: background-color var(--ui-fast) var(--ui-ease);
}
.wb-tab-close svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); color: var(--rfed-ink-3); }     /* the slot itself keeps the tab's ink (the unsaved dot's) */
.wb-tab:is(:hover, :focus-within, .wb-tab--on, .wb-tab--pinned) .wb-tab-close { display: inline-grid; }
.wb-tab-close:hover { background: var(--rfed-hover); }
.wb-tab-close:hover > svg { color: var(--rfed-ink); }
@media (hover: none) { .wb-tab-close { display: inline-grid; } }
.wb-tab--pinned { min-width: 0; max-width: 160px; }
/* document status in the pills (DESIGN.md §12; tab/parts.ts statusOf): never a change of the pill's box or the text's
   start. Unsaved is a filled dot in the × slot: the slot is there while it holds the dot (the room the hovered × takes: the
   text's end, never its start); on hover, or with the keyboard in the tab, the × shows instead. Saved: nothing, and a
   hidden × takes no room */
.wb-tab--st-slot .wb-tab-close { display: inline-grid; }
.wb-tab-close > :is(svg, .wb-st) { grid-area: 1 / 1; }
/* :has() names the tab's own focusable parts (bar.ts: the tab, its name, its section, its close): a bare
   :has(:focus-visible) matched any element, so every focus change anywhere restyled every icon of the page (the
   editing popover's open: 14 style recalcs of ~700 SVGs) */
.wb-tab--st-slot:not(:hover, :has(:is([role="tab"], [data-name], [data-sub], .wb-tab-close):focus-visible)) .wb-tab-close > svg,
.wb-tab--st-slot:is(:hover, :has(:is([role="tab"], [data-name], [data-sub], .wb-tab-close):focus-visible)) .wb-st--slot { visibility: hidden; }
.wb-st { display: inline-grid; place-items: center; box-sizing: border-box; border-radius: 50%; color: var(--rfed-ink-2); pointer-events: none; }
.wb-st--unsaved { width: var(--wb-dirty-dot); height: var(--wb-dirty-dot); color: inherit; background: currentColor; }     /* in the tab's own ink: its name's colour in its state */
/* the status layer: the pill's background (tab/parts.ts StatusLayer, progress.ts): under the text (the pill isolates, the layer at z -1), clipped to the
   pill's radius. Typesetting: a soft accent fill from the leading edge, its length set each frame (a transform: nothing
   moves); errors: a danger tint over the whole pill (high contrast: hatched, a cue without colour); done without errors:
   the fill runs to 100 % in the success colour, then fades out (FLASH_MS) */
.wb-tab--status { isolation: isolate; }
.wb-status { position: absolute; inset: 0; z-index: -1; border-radius: inherit; overflow: clip; pointer-events: none; }
/* errors: a band along the pill's bottom (--wb-status-band, below); the active pill starts with the whole pill tinted, and after
   --wb-status-err-hold its tint settles down into the band */
.wb-status--error::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--wb-status-band); background-color: var(--rfed-tab-error-band-bg); }
.wb-tab--on .wb-status--error::after { height: 100%; background-color: var(--rfed-tab-error-bg); animation: wb-status-err-settle var(--ui-slow, 450ms) var(--ui-ease) var(--wb-status-err-hold, 2.5s) forwards; }
@keyframes wb-status-err-settle { to { height: var(--wb-status-band); background-color: var(--rfed-tab-error-band-bg); } }
html[data-wb-theme-type="hc"] .wb-status--error::after { background-image: repeating-linear-gradient(135deg, color-mix(in srgb, var(--rfed-danger) 35%, transparent) 0 2px, transparent 2px 7px); }
@media (prefers-reduced-motion: reduce) { .wb-tab--on .wb-status--error::after { animation-duration: 1ms; } }
.wb-status-fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); background: var(--rfed-tab-progress-bg); }
/* an inactive pill shows the fill and the tint as a band 6 device px tall along its bottom, still clipped by the pill's
   radius (the corners shape its ends); the active pill keeps the whole height */
.wb-root { --wb-status-band: 6px; }
@media (min-resolution: 1.5dppx) { .wb-root { --wb-status-band: 4px; } }
@media (min-resolution: 2dppx) { .wb-root { --wb-status-band: 3px; } }
@media (min-resolution: 3dppx) { .wb-root { --wb-status-band: 2px; } }
/* the band on an inactive pill, and on the active one too when the host asks for it (bar: 'band', e.g. a few blocks) */
.wb-tab:not(.wb-tab--on) .wb-status-fill, .wb-status--band .wb-status-fill { top: auto; height: var(--wb-status-band); }
.wb-status--done .wb-status-fill { background: var(--rfed-tab-success-bg); animation: wb-status-done-fade var(--wb-status-flash, 1500ms) linear forwards; }
@keyframes wb-status-done-fade { from { transform: scaleX(var(--wb-p0, 0)); } 20% { transform: scaleX(1); opacity: 1; } 55% { transform: scaleX(1); opacity: 1; } to { transform: scaleX(1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .wb-status--done .wb-status-fill { animation: none; transform: scaleX(1); } }
/* spring-loading during a content drag: a fill shows the wait */
.wb-tab[data-spring]::after {
  content: ""; position: absolute; left: var(--wb-spring-inset, 0); right: var(--wb-spring-inset, 0); bottom: var(--wb-spring-bottom, 0); height: 2px;
  border-radius: 1px; background: var(--rfed-accent); transform-origin: left; animation: wb-spring var(--wb-spring) linear forwards;
}
@keyframes wb-spring { from { transform: scaleX(0); } to { transform: scaleX(1); } }


/* the insertion bar while a tab is dragged over a strip */
.wb-insert {
  position: absolute; top: 6px; bottom: 6px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--rfed-drag-insert-ink);
  pointer-events: none; z-index: 2; animation: wb-fade var(--ui-fast) var(--ui-ease-out); transition: left var(--ui-fast) var(--ui-ease-out);
}
@keyframes wb-fade { from { opacity: 0; } }

/* ── the look: the editor's own tabs (the sidebar's Outline / Problems): rounded pills, on the page, the active one filled ── */
.wb-root { --wb-spring-inset: 8px; --wb-spring-bottom: 3px; }
/* a line under every tab strip, the side panels' too (the splitters' token at rest: they meet without a gap); over the
   glass layer (a box shadow would be under it); just below the strip, on the next element's first pixel, so the gap
   above the pills and the gap below them are the one inset; the bar draws its own the same way */
.wb-strip:not(.wb-strip--inbar)::after, .wb-side-strip::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--rfed-tab-strip-border); pointer-events: none; }
.wb-side-strip { position: relative; }
/* below a splitter the strip starts after the line's share, as a lower document group's does (--wb-above) */
.wb-side-pane[data-top="false"] > .wb-side-strip { margin-top: calc(1px - var(--wb-hair)); }
.wb-root .wb-tab:hover { background: var(--rfed-tab-hover-bg); }
.wb-root .wb-tab.wb-tab--on { background: var(--rfed-tab-active-bg); box-shadow: inset 0 0 0 1.5px var(--rfed-tab-active-border); color: var(--rfed-tab-active-ink); }
/* the focused-active look belongs to ONE item per strip: the active tab of the focused group, or its home while home
   shows; the active tab of an unfocused group, or of a group showing home, and the home of an unfocused group take
   the unfocused-active look (the same tokens) */
.wb-root :is(.wb-strip:not(.wb-strip--focused), .wb-strip--home) :is(.wb-tab.wb-tab--on, .wb-home-btn[aria-pressed="true"]) { background: var(--rfed-tab-unfocused-active-bg); box-shadow: none; }
.wb-root .wb-strip--focused.wb-strip--home .wb-home-btn[aria-pressed="true"] { background: var(--rfed-tab-active-bg); box-shadow: inset 0 0 0 1.5px var(--rfed-tab-active-border); color: var(--rfed-tab-active-ink); }
.wb-root :is(.wb-strip:not(.wb-strip--focused), .wb-strip--home) .wb-tab.wb-tab--on:hover { background: var(--rfed-hover); }     /* an inactive tab's hover (the same ink) */

.wb-root .wb-strip-actions .wb-btn { opacity: 0; }
.wb-root .wb-group:hover .wb-strip-actions .wb-btn, .wb-root .wb-group--active .wb-strip-actions .wb-btn,
.wb-root .wb-strip-actions .wb-btn:focus-visible, .wb-root .wb-strip-actions .wb-side-toggle { opacity: 1; }
@media (hover: none) { .wb-root .wb-strip-actions .wb-btn { opacity: 1; } }
/* the keyboard's ring on a tab and on its controls: after the active and unfocused-active looks above (one specificity: the order wins) */
.wb-root .wb-tabs .wb-tab:has(> .wb-tab-tab:focus-visible) { box-shadow: var(--rfed-focus-ring); }
.wb-root .wb-tab :is([data-name], [data-sub], .wb-tab-close):focus-visible { position: relative; z-index: 2; outline: none; box-shadow: var(--rfed-focus-ring); }

/* ── the body: panels stacked; hidden ones kept but not laid out ── */
.wb-body { position: absolute; inset: 0; }
.wb-panels { position: absolute; inset: 0; overflow: clip; }   /* a host locked wider than its group mid-motion (lockHosts) stays inside it */
/* a view is its own stacking context: whatever it draws (a document's popovers, its block controls) stays under its group's
   strip and the window bar, which keep their glass on top; only the global layers (menus, dialogs, toasts) go above */
.wb-panel { position: absolute; inset: 0; outline: none; background: var(--rfed-page); isolation: isolate; --wb-head: var(--wb-top, 0px); --wb-inset-top: var(--wb-head); }
/* (workbench.ts lockHosts) a tab's host while the groups' widths move: its width kept (inline), its own layer: moved, not laid out or painted again */
.wb-panel--locked { will-change: transform; contain: layout paint; }
.wb-panel:has(> .wb-crumbs) { --wb-head: calc(var(--wb-top, 0px) + var(--ui-h-md) + 1px); }
.wb-side .wb-panel { --wb-head: 0px; }
/* no room is reserved for a scrollbar: an overlay one (macOS, iOS) takes none, a classic one shrinks the box itself, the
   same on every path (mount, split, move, restore). Where the bars are classic (scrollbars.ts measures it), they are
   thin and start below the glass header: the track is inset by it (Chromium, WebKit). Overlay bars stay the platform's:
   a styled ::-webkit-scrollbar is always a classic one, which took 12 px of every view on macOS and iOS.
   They apply to the view and to a host's scrollers marked [data-wb-scroll] (no surprises in other content). */
[data-wb-scrollbars="classic"] .wb-view::-webkit-scrollbar, [data-wb-scrollbars="classic"] .wb-panel [data-wb-scroll]::-webkit-scrollbar { width: 12px; height: 12px; }
[data-wb-scrollbars="classic"] .wb-view::-webkit-scrollbar-thumb, [data-wb-scrollbars="classic"] .wb-panel [data-wb-scroll]::-webkit-scrollbar-thumb {
  border: 3px solid transparent; border-radius: var(--ui-r-pill); background: color-mix(in srgb, currentColor 24%, transparent) padding-box; }
[data-wb-scrollbars="classic"] .wb-view::-webkit-scrollbar-thumb:hover, [data-wb-scrollbars="classic"] .wb-panel [data-wb-scroll]::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, currentColor 38%, transparent); }
[data-wb-scrollbars="classic"] .wb-view::-webkit-scrollbar-track, [data-wb-scrollbars="classic"] .wb-panel [data-wb-scroll]::-webkit-scrollbar-track { margin-top: var(--wb-head); background: transparent; }
[data-wb-scrollbars="classic"] .wb-view::-webkit-scrollbar-corner, [data-wb-scrollbars="classic"] .wb-panel [data-wb-scroll]::-webkit-scrollbar-corner { background: transparent; }
/* Firefox has no track margin: there the view starts below the header (the content does not run under it) */
@supports not selector(::-webkit-scrollbar) { .wb-group .wb-view { top: var(--wb-head); } .wb-group .wb-panel { --wb-inset-top: 0px; } }
.wb-panel--hidden { content-visibility: hidden; visibility: hidden; }
.wb-view { position: absolute; inset: 0; overflow: auto; padding-top: var(--wb-inset-top); scroll-padding-top: var(--wb-inset-top); }
.wb-home { position: absolute; inset: 0; overflow: auto; padding-top: var(--wb-top, 0px); }
.wb-missing { padding: var(--ui-6); color: var(--rfed-ink-3); }

/* the drop zone preview while a tab is dragged over a body */
/* a soft tinted overlay that glides between the zones */
.wb-zone {
  position: absolute; pointer-events: none; z-index: 4; border-radius: var(--ui-r-md);
  background: var(--rfed-drop-zone-bg);
  box-shadow: inset 0 0 0 1px var(--rfed-drop-zone-border);
  animation: wb-zone-in var(--ui-mid) var(--ui-ease-out);
  transition: left var(--ui-mid) var(--ui-ease-out), top var(--ui-mid) var(--ui-ease-out), width var(--ui-mid) var(--ui-ease-out), height var(--ui-mid) var(--ui-ease-out);
}
@keyframes wb-zone-in { from { opacity: 0; transform: scale(0.98); } }

/* ── breadcrumbs (document tabs) ── */
.wb-crumbs {
  position: absolute; top: var(--wb-top, 0px); left: 0; right: 0; z-index: 2; display: flex; align-items: center; container: wbcrumbs / inline-size;
  min-width: 0; height: calc(var(--ui-h-md) + 1px); box-shadow: inset 0 -1px 0 var(--rfed-border-soft); color: var(--rfed-tab-section-ink); font-size: var(--ui-text-sm);
  isolation: isolate;
}
.wb-crumbs-nav { flex: 1 1 auto; min-width: 0; height: 100%; }
.wb-crumbs .wb-side-toggle { margin: 0 var(--ui-1) 0 var(--ui-2); }   /* where the strip has it: the home after it lines up */
/* the rename field over the name (absolute: the tab or crumb keeps its box) */
.wb-rename { position: absolute; z-index: 3; box-sizing: border-box; margin: 0; padding: 0; border: 0; border-radius: 4px; outline: none; text-indent: 0; min-width: 0; appearance: none;
  box-shadow: 0 0 0 2px var(--rfed-focus); background: var(--rfed-surface); color: var(--rfed-tab-name-ink); font: inherit; font-weight: inherit; }
.wb-crumbs--bar li { position: relative; }
/* the row menu (the document switcher): a row and its 'open in a new tab' button, whose room is always kept */
.wb-crumbs ol { display: flex; align-items: center; gap: 2px; height: 100%; margin: 0; padding: 0 4px;   /* home where the strip's home is */ list-style: none; min-width: 0; overflow: clip; }
.wb-crumbs li { display: flex; align-items: center; min-width: 0; flex: 0 1 auto; }
.wb-crumbs li:last-child { flex: 1 1 auto; }
.wb-crumbs { --wb-btn-h: 24px; }
.wb-crumb { min-width: 0; color: inherit; }
.wb-crumb[aria-current="page"] { color: var(--rfed-tab-name-ink); cursor: default; }
.wb-crumb[aria-current="page"]:hover { background: none; }
.wb-crumb-label { overflow: clip; text-overflow: ellipsis; min-width: 0; }
.wb-crumb svg { flex: 0 0 auto; width: var(--ui-icon-sm); height: var(--ui-icon-sm); }
.wb-crumb.wb-btn--icon svg { width: var(--ui-icon-md); height: var(--ui-icon-md); }
.wb-crumb-sep { flex: 0 0 auto; display: inline-grid; color: var(--rfed-ink-4); }
.wb-crumb-sep svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); }
/* the home crumb is its icon when the bar is narrow; its label stays its accessible name and tooltip */
@container wbcrumbs (max-width: 480px) { .wb-crumb--home .wb-crumb-label { display: none; } }

/* ── separators: a hairline; hovered, dragged or focused it is drawn 3× as thick, centred on itself (a transform: no
   layout moves), in the active splitter colour; no handle ── */
.wb-sep { position: absolute; z-index: 5; outline: none; touch-action: none; }
/* the splitter is one more gap with a line in its middle: an 8 px hit area centred on the boundary b (snapped as the
   groups' edges); its 1 px line at [b - h, b + 1 - h], h = --wb-hair: 0 at DPR 1 (whole pixels; the centre b + 0.5),
   0.5 px from DPR 2 (the centre exactly b). The groups beside it pad their strips by the line's share (below), so
   pill → line on both sides equals pill → pill and edge → pill (--wb-inset) */
:root { --wb-hair: 0px; }
@media (min-resolution: 2dppx) { :root { --wb-hair: 0.5px; } }
.wb-sep[aria-orientation="vertical"] { width: 8px; margin-left: -4px; cursor: col-resize; }
.wb-sep[aria-orientation="horizontal"] { height: 8px; margin-top: -4px; cursor: row-resize; }
.wb-sep::before { content: ""; position: absolute; pointer-events: none; background: var(--rfed-splitter-border);
  transition: transform var(--ui-fast) var(--ui-ease), background-color var(--ui-fast) var(--ui-ease); }
.wb-sep:is(:hover, .wb-sep--drag, :focus-visible)::before { background: var(--rfed-splitter-active-border); }   /* the divider: drawn by the separator (over the groups' strips and panels) */
.wb-sep[aria-orientation="vertical"]:is(:hover, .wb-sep--drag, :focus-visible)::before { transform: scaleX(3); }
.wb-sep[aria-orientation="horizontal"]:is(:hover, .wb-sep--drag, :focus-visible)::before { transform: scaleY(3); }
.wb-sep[aria-orientation="vertical"]::before { left: calc(4px - var(--wb-hair)); width: 1px; top: 0; bottom: 0; }
.wb-sep[aria-orientation="horizontal"]::before { top: calc(4px - var(--wb-hair)); height: 1px; left: 0; right: 0; }
.wb-root--max .wb-sep { display: none; }
/* no user-select rule while resizing: the splitter's pointerdown is default-prevented and its pointer
   captured, so no selection starts; user-select is inherited, and setting it on the root restyled every element of the
   page at the drag's start and at its drop (5,000 in a 30-block article, 25 ms each). The cursor costs a few hundred. */
.wb-root--resizing-col { cursor: col-resize; }
.wb-root--resizing-row { cursor: row-resize; }

/* ── the drag ghost (top layer) ── */
.wb-ghost {
  position: fixed; inset: auto; left: 0; top: 0; margin: 0; padding: 0; border: 0; background: transparent;
  overflow: visible; pointer-events: none; color: var(--rfed-ink); will-change: transform; z-index: 2147483000;
}
.wb-ghost--none { opacity: 0.5; }
.wb-ghost-chip {
  display: inline-flex; align-items: center; gap: 6px; height: var(--ui-h-md); padding: 0 var(--ui-3); max-width: 260px;
  border-radius: var(--ui-r-sm); background: var(--rfed-surface); box-shadow: var(--ui-shadow-pop);
  font: var(--ui-text-md)/1 var(--ui-font); white-space: nowrap; overflow: clip; text-overflow: ellipsis;
}
.wb-ghost-chip svg { width: var(--ui-icon-md); height: var(--ui-icon-md); color: var(--rfed-ink-3); }
.wb-dragging, .wb-dragging * { cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }

.wb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wb-park { position: absolute; inset: 0; visibility: hidden; content-visibility: hidden; pointer-events: none; }
/* ── the keyboard shortcuts view (shortcuts.js) ── */
.wb-keys { box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: calc(var(--wb-inset-top, 0px) + var(--ui-6)) var(--ui-6) var(--ui-8); color: var(--rfed-ink); font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); }
.wb-keys-title { font-size: var(--ui-text-xl, 20px); font-weight: var(--ui-semibold); margin: 0 0 var(--ui-4); }
.wb-keys-search { width: 100%; }
.wb-keys-count { color: var(--rfed-ink-3); font-size: var(--ui-text-sm); margin: var(--ui-2) 0 var(--ui-4); }
.wb-keys-area h2 { font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--rfed-ink-3); margin: var(--ui-6) 0 var(--ui-2); }
.wb-keys table { width: 100%; border-collapse: collapse; }
.wb-keys th, .wb-keys td { text-align: left; font-weight: normal; padding: var(--ui-2) 0; border-bottom: 1px solid var(--rfed-border-soft); vertical-align: baseline; }
.wb-keys td { text-align: right; white-space: nowrap; padding-left: var(--ui-4); }
.wb-keys kbd { display: inline-block; min-width: 1.6em; padding: 1px 6px; border-radius: var(--ui-r-sm); background: var(--rfed-selected); color: var(--rfed-ink); font: inherit; font-size: var(--ui-text-sm); text-align: center; }
.wb-keys-then, .wb-keys-or { color: var(--rfed-ink-3); font-size: var(--ui-text-sm); margin: 0 6px; }
.wb-keys-none { color: var(--rfed-ink-3); }
`;
