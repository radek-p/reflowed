// The control library's CSS: on the theme tokens (themes.ts) and the uniform metrics; no literal colours.
/**
 *  app/src/design/theme.ts), so they are a block of their own */
export const DERIVED_TOKENS_CSS = String.raw`:root {
  /* the derived colour tokens (THEMES.md): mixes of the base ones (a theme sets the base on <html>); a currentColor mix
     takes the ink of the element it is used on */
  --rfed-ink-2: color-mix(in srgb, var(--rfed-ink) 74%, transparent);     /* secondary text, idle icons */
  --rfed-ink-4: color-mix(in srgb, var(--rfed-ink) 32%, transparent);     /* disabled */
  --rfed-border: color-mix(in srgb, currentColor 13%, transparent);       /* frames */
  --rfed-border-soft: color-mix(in srgb, currentColor 9%, transparent);   /* separators, strip lines */
  --rfed-border-strong: color-mix(in srgb, currentColor 24%, transparent);/* inputs */
  --rfed-button-border: color-mix(in srgb, currentColor 16%, transparent);/* pill buttons */
  --rfed-hover: color-mix(in srgb, currentColor 7%, transparent);
  --rfed-press: color-mix(in srgb, currentColor 12%, transparent);
  --rfed-selected: color-mix(in srgb, currentColor 9%, transparent);      /* a selected tab or segment */
  --rfed-sidebar-bg: color-mix(in srgb, currentColor 3%, transparent);    /* the side columns' ground */
  --rfed-input-bg: color-mix(in srgb, currentColor 4%, transparent);
  --rfed-row-selected-bg: color-mix(in srgb, var(--rfed-accent) 12%, transparent);
  --rfed-accent-tint: color-mix(in srgb, var(--rfed-accent) 8%, transparent);
  --rfed-accent-border: color-mix(in srgb, var(--rfed-accent) 45%, transparent);
  --rfed-danger-tint: color-mix(in srgb, var(--rfed-danger) 9%, transparent);
  --rfed-focus: var(--rfed-accent);   /* solid: ≥ 3:1 against the grounds it sits on in every theme (the kit's 70 % ring fell to 2.3:1 on a light tab) */
  --rfed-focus-ring: inset 0 0 0 2px var(--rfed-focus);   /* THE keyboard focus ring: inset (no overflow clips it), on every control */
}
html.contrast { --rfed-focus-ring: inset 0 0 0 2px var(--rfed-focus), inset 0 0 0 3px var(--rfed-page); }`;
export default String.raw`
/* ── the metrics and the colour tokens' defaults (a theme sets them on <html>: themes.ts) ── */
:root {
  --wb-r: var(--ui-r-md);   /* the pill radius: tabs, every control, a popover */
  --wb-chip-inset: 3px;     /* a chip in a pill, a row in a popover: this far from the edge */
  --wb-chip-r: calc(var(--wb-r) - var(--wb-chip-inset));   /* their radius: concentric */
  --wb-pop-ring: 0.5px;     /* the popover shadow's ring (--ui-shadow-pop), drawn outside its box */
  --wb-pad: 8px;            /* an icon button's padding, all sides */
  --wb-pad-x: 12px;         /* a text button's and a tab's side padding */
  --wb-btn-h: 32px;
  --wb-chip-h: calc(var(--wb-btn-h) - 2 * var(--wb-chip-inset));   /* a chip's height in a one-line pill; a popover row's ground */
  --wb-gap: 6px;            /* THE gap around and between pills: strips, the top bar, side panels (above, below, between) */
  --wb-ts-dot: 0.4em;       /* a tab-stop list's bullet (kit/tabstops.ts): of the row's text size, a digit's weight */
}
${DERIVED_TOKENS_CSS}
html[data-wb-theme-type="hc"] { --wb-pop-ring: 1.5px; }
/* ── the one button: every icon and text button is a .wb-btn: the pill's radius and padding (square for an icon), a
   height per bar (--wb-btn-h), one hover, press, focus (an inset ring) and pressed look; nothing changes its size ── */
.wb-btn {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 0 0 auto;
  height: var(--wb-btn-h); min-width: var(--wb-btn-h); padding: 0 var(--wb-pad-x); margin: 0; border: 0; border-radius: var(--wb-r);
  background: transparent; color: var(--rfed-tab-inactive-ink); font: inherit; font-size: var(--ui-text-md); line-height: 1; white-space: nowrap; cursor: pointer; outline: none;
  transition: background-color var(--ui-fast) var(--ui-ease), color var(--ui-fast) var(--ui-ease), opacity var(--ui-fast) var(--ui-ease);
}
.wb-btn--icon { width: var(--wb-btn-h); padding: var(--wb-pad); }
.wb-btn:hover { background: var(--rfed-hover); color: var(--rfed-tab-name-ink); }
.wb-btn:active { background: var(--rfed-press); }
.wb-btn:focus-visible { box-shadow: var(--rfed-focus-ring); }
.wb-btn[aria-pressed="true"], .wb-btn[aria-selected="true"] { background: var(--rfed-selected); color: var(--rfed-tab-name-ink); }
.wb-btn svg { flex: 0 0 auto; width: var(--ui-icon-md); height: var(--ui-icon-md); }
.wb-btn:disabled { color: var(--rfed-ink-4); background: none; cursor: default; }
/* the text field: the button's height and radius, a frame from the strong border token */
.wb-input { box-sizing: border-box; height: var(--wb-btn-h); padding: 0 var(--ui-2); border: 1px solid var(--rfed-border-strong); border-radius: var(--wb-r);
  background: var(--rfed-page); color: var(--rfed-ink); font: inherit; font-size: var(--ui-input-text, var(--ui-text-md)); outline: none; }
.wb-input:focus-visible { box-shadow: 0 0 0 2px var(--rfed-focus); border-color: transparent; }
.wb-btn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* the switch: a track on the button's metrics */
.wb-switch { gap: var(--ui-2); }
.wb-switch-track { position: relative; flex: 0 0 auto; width: 28px; height: 16px; border-radius: var(--ui-r-pill); background: var(--rfed-border-strong); transition: background-color var(--ui-fast) var(--ui-ease); }
.wb-switch-knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--rfed-page); transition: transform var(--ui-fast) var(--ui-ease); }
.wb-switch[aria-checked="true"] .wb-switch-track { background: var(--rfed-accent); }
.wb-switch[aria-checked="true"] .wb-switch-knob { transform: translateX(12px); }

/* ── popovers, menus, selects: one item metric ── */
.wb-pop { position: fixed; z-index: var(--ui-z-float, 50); box-sizing: border-box; border-radius: var(--ui-r-md); background: var(--rfed-surface); color: var(--rfed-ink);
  box-shadow: var(--ui-shadow-pop); font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); outline: none; }
.wb-pop--pad { padding: var(--ui-3); }
.wb-float-in { animation: wb-float-in var(--ui-fast) var(--ui-ease-out); }
@keyframes wb-float-in { from { opacity: 0; transform: translateY(-2px) scale(0.985); } }
/* the menu sizes from its rows; it scrolls only when they pass its max-height (never sideways: overflow-x hidden, as
   overflow-y: auto would make it auto too, and Firefox showed both scrollbars for a sub-pixel overflow). Its padding
   is ONE value (--wb-menu-pad); a row that runs edge to edge (the separator) takes exactly it back, never more */
.wb-menu { box-sizing: border-box; min-width: 220px; max-width: min(360px, calc(100vw - 16px)); max-height: min(420px, 70vh); overflow: hidden auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: var(--wb-chip-inset);     /* between rows: the inset, no hover target */
  --wb-menu-pad: calc(var(--wb-chip-inset) - var(--wb-pop-ring));     /* the inset from the ring's outer edge: the chip's */
  padding: var(--wb-menu-pad); outline: none; }
.wb-menu > * { flex: none; }
.wb-menu-item {
  box-sizing: border-box; display: flex; align-items: center; gap: var(--ui-2); width: 100%; min-height: var(--wb-chip-h);
  padding: var(--ui-1) var(--ui-2); margin: 0; border: 0; border-radius: var(--wb-chip-r); background: none; color: inherit;
  font: inherit; font-size: var(--ui-text-md); line-height: var(--ui-leading-tight); text-align: left; cursor: pointer; outline: none;
}
.wb-menu-item:hover, .wb-menu[data-kbd] > .wb-menu-item:focus { background: var(--rfed-hover); }
/* the keyboard's focus in a menu or a select (data-kbd, menu.js: the list is driven by keys): THE ring (--rfed-focus-ring) on
   the focused row or button, inset, so the popover's edge (its overflow) never clips it; one rule for every popover */
.wb-menu[data-kbd] :is(.wb-menu-item, .wb-btn):focus { box-shadow: var(--rfed-focus-ring); }
.wb-menu-item:disabled { color: var(--rfed-ink-4); background: none; cursor: default; }
.wb-menu-item--danger { color: var(--rfed-danger); }
.wb-mi-lead { flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--ui-icon-md); height: var(--ui-icon-md); color: var(--rfed-ink-2); }
.wb-mi-lead svg { width: var(--ui-icon-md); height: var(--ui-icon-md); }
.wb-mi-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.wb-mi-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.wb-mi-hint { font-size: var(--ui-text-sm); color: var(--rfed-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-mi-key { margin-left: auto; padding-left: var(--ui-4); font-size: var(--ui-text-sm); color: var(--rfed-ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.wb-menu-sep { height: 1px; margin: 0 calc(-1 * var(--wb-menu-pad)); background: var(--rfed-border-soft); }
.wb-menu-label { padding: var(--ui-2) var(--ui-2) var(--ui-1); font-size: var(--ui-text-xs); font-weight: var(--ui-semibold);
  letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--rfed-ink-3); }
.wb-menu-label:first-child { padding-top: var(--ui-1); }
/* a select's rows: the item, and an action button at the right (the same row height) */
.wb-select { min-width: 260px; }
/* a row is ONE hover target, nested as a tab and its chips: the row takes the tab's hover ground and radius over its
   full width (the button's area included), the one-line chip's height (--wb-chip-h); the button inside it, the same height, adds its hover on
   top. Keyboard: the focused row shows the row ground, the focused button its own */
.wb-row { display: flex; align-items: center; gap: 2px; border-radius: var(--wb-chip-r); --wb-btn-h: var(--wb-chip-h);
  transition: background-color var(--ui-fast) var(--ui-ease); }
.wb-row .wb-menu-item, .wb-row .wb-menu-item:hover { background: none; border-radius: var(--wb-chip-r); }
.wb-row:hover, .wb-menu[data-kbd] .wb-row:focus-within { background: var(--rfed-tab-hover-bg); }
.wb-row.is-active { background: var(--rfed-tab-active-bg); }
.wb-row.is-active .wb-mi-label, .wb-row.is-active .wb-row-num { font-weight: var(--ui-semibold); }   /* the current one: bold, no check (its slot took a title's room) */
.wb-row.is-active:hover, .wb-menu[data-kbd] .wb-row.is-active:focus-within { background: color-mix(in srgb, var(--rfed-tab-active-bg), var(--rfed-tab-hover-bg)); }
.wb-row .wb-row-btn { border-radius: var(--wb-chip-r); }
.wb-row .wb-row-btn:hover, .wb-menu[data-kbd] .wb-row-btn:focus { background: var(--rfed-hover); }
.wb-row-main { flex: 1 1 auto; min-width: 0; }
.wb-row-act { flex: 0 0 auto; display: flex; }
.wb-row-btn { opacity: 0; }
/* the row button only on the hovered row, the keyboard-focused row (data-kbd: after a key, not the focus the menu gives when a press opens it),
   or on touch; the current row is marked by its ground, not by its button; its room is always kept (opacity) */
.wb-row:hover .wb-row-btn, .wb-menu[data-kbd] .wb-row:focus-within .wb-row-btn { opacity: 1; }
@media (hover: none) { .wb-row-btn { opacity: 1; } }
/* tab stops (kit/tabstops.ts): one tab per depth. The list is a grid; a row and the boxes down to its cells are subgrids
   of it, so every row shares the columns. A number column is auto: as wide as its depth's widest number, which ends at
   the tab (right-aligned); the name starts at it; depth d+1's column starts there. Names end before the action column */
.wb-ts { display: grid; column-gap: 0; --wb-ts-pad: var(--ui-2); --wb-ts-gap: var(--ui-2);
  grid-template-columns: var(--wb-ts-pad) [n0] auto [n0-end] var(--wb-ts-gap) [t0 n1] auto [n1-end] var(--wb-ts-gap)
    [t1 n2] auto [n2-end] var(--wb-ts-gap) [t2 n3] auto [n3-end] var(--wb-ts-gap) [t3] minmax(0, 1fr) [name-end] var(--wb-ts-pad); }
/* (the edges by number: Chromium does not resolve a subgrid's edge lines by their inherited names) */
.wb-ts-sub { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; gap: 0; align-items: center; min-width: 0; padding-left: 0; padding-right: 0; }
.wb-ts > :not(.wb-ts-sub) { grid-column: 1 / -1; }
.wb-ts-sub.wb-ts-main { grid-row: 1; }
/* a row's buttons take no room: they overlay the end of its name (the same grid cell), shown on the row's hover or
   focus (the list's rules); while shown, the name ellipsises before them (--wb-ts-room: --wb-ts-acts buttons, the row's) */
.wb-ts-acts { grid-column: -3 / -1; grid-row: 1; justify-self: end; display: flex; position: relative; }
.wb-ts-name { --wb-ts-room: max(0px, calc(var(--wb-ts-acts, 0) * var(--wb-btn-h) - var(--wb-ts-pad) + var(--ui-1))); }
.wb-ts .wb-row:hover .wb-ts-name, .wb-menu[data-kbd] .wb-row:focus-within .wb-ts-name { padding-right: var(--wb-ts-room); }
@media (hover: none) { .wb-ts .wb-ts-name { padding-right: var(--wb-ts-room); } }
[data-ts-depth="0"] { --wb-ts-n: n0; --wb-ts-t: t0; }
[data-ts-depth="1"] { --wb-ts-n: n1; --wb-ts-t: t1; }
[data-ts-depth="2"] { --wb-ts-n: n2; --wb-ts-t: t2; }
[data-ts-depth="3"] { --wb-ts-n: n3; --wb-ts-t: t3; }
.wb-ts-num, .wb-ts-bul { grid-column: var(--wb-ts-n, n0); justify-self: end; }
.wb-ts-num { white-space: nowrap; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--rfed-ink) 72%, var(--rfed-page)); }
/* the bullet: a dot of a digit's weight (--wb-ts-dot, of the row's text size), in the hint ink */
.wb-ts-bul { width: var(--wb-ts-dot); height: var(--wb-ts-dot); border-radius: 50%; background: var(--rfed-ink-3); }
.wb-ts-name { grid-column: var(--wb-ts-t, t0) / name-end; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the tooltip */
.wb-tooltip { position: fixed; z-index: var(--ui-z-tip, 90); max-width: 260px; padding: var(--ui-1) var(--ui-2); border-radius: var(--ui-r-sm);
  background: var(--rfed-ink); color: var(--rfed-page); font: var(--ui-text-sm)/var(--ui-leading-tight) var(--ui-font); pointer-events: none; animation: wb-float-in var(--ui-fast) var(--ui-ease-out); }
.wb-tooltip kbd { font: inherit; opacity: 0.75; margin-left: var(--ui-2); }
@media (prefers-reduced-motion: reduce) { .wb-float-in, .wb-tooltip { animation: none; } }
`;
