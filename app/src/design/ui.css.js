// CSS as a string module: the builds need no CSS loader. Edit the CSS between the backticks.
export default `
/* The kit's CSS (ui/*.js renders these classes; plain-DOM code may use
   them too). Only tokens (tokens.css): no literal sizes or colours below
   except 0, 1px hairlines and 50 % positions. GUIDE.md has the rules. */

/* ── shared: font, focus, motion ── */
.ui-btn, .ui-icon-btn, .ui-input, .ui-tab, .ui-chip, .ui-menu-item, .ui-seg > button {
  font-family: var(--ui-font); -webkit-tap-highlight-color: transparent;
  transition: background-color var(--ui-fast) var(--ui-ease), color var(--ui-fast) var(--ui-ease),
    border-color var(--ui-fast) var(--ui-ease), box-shadow var(--ui-fast) var(--ui-ease), opacity var(--ui-fast) var(--ui-ease);
}
.ui-btn:focus-visible, .ui-icon-btn:focus-visible, .ui-tab:focus-visible, .ui-chip:focus-visible,
.ui-menu-item:focus-visible, .ui-seg > button:focus-visible, .ui-focusable:focus-visible {
  outline: none; box-shadow: var(--ui-ring);
}
.ui-icon, .ui-btn svg, .ui-icon-btn svg, .ui-menu-item svg { flex: 0 0 auto; width: var(--ui-icon-md); height: var(--ui-icon-md); }

/* ── Button ── */
.ui-btn {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: var(--ui-2);
  height: var(--ui-ctl-md); min-width: var(--ui-ctl-md); padding: 0 var(--ui-3); margin: 0;
  border: 1px solid var(--ui-border-pill); border-radius: var(--ui-r-sm); background: transparent; color: var(--ui-ink);
  font-size: var(--ui-text-md); font-weight: var(--ui-medium); line-height: 1; white-space: nowrap; cursor: pointer; user-select: none;
  text-decoration: none;
}
.ui-btn:hover { background: var(--ui-hover); border-color: var(--ui-border-strong); }
.ui-btn:active { background: var(--ui-press); }
.ui-btn--sm { height: var(--ui-ctl-sm); min-width: var(--ui-ctl-sm); padding: 0 var(--ui-2); font-size: var(--ui-text-sm); gap: var(--ui-1); }
.ui-btn--sm svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); }
.ui-btn--lg { height: var(--ui-ctl-lg); min-width: var(--ui-ctl-lg); padding: 0 var(--ui-4); }
.ui-btn--primary { background: var(--ui-accent); border-color: transparent; color: var(--ui-on-accent); }
.ui-btn--primary:hover { background: color-mix(in srgb, var(--ui-accent) 88%, #000); border-color: transparent; }
.ui-btn--primary:active { background: color-mix(in srgb, var(--ui-accent) 78%, #000); }
.ui-btn--ghost { border-color: transparent; color: var(--ui-ink-2); }
.ui-btn--ghost:hover { border-color: transparent; color: var(--ui-ink); }
.ui-btn--danger { color: var(--ui-danger); }
.ui-btn--danger:hover { background: var(--ui-danger-tint); border-color: color-mix(in srgb, var(--ui-danger) 35%, transparent); }
.ui-btn--pill { border-radius: var(--ui-r-pill); }
.ui-btn--block { width: 100%; justify-content: flex-start; }
.ui-btn:disabled, .ui-btn[aria-disabled="true"] { color: var(--ui-ink-4); background: transparent; border-color: var(--ui-border-soft); cursor: default; }
.ui-btn--primary:disabled { background: var(--ui-on); color: var(--ui-ink-4); border-color: transparent; }

/* ── IconButton: square, the icon centred ── */
.ui-icon-btn {
  box-sizing: border-box; display: inline-grid; place-items: center; flex: 0 0 auto;
  width: var(--ui-ctl-md); height: var(--ui-ctl-md); padding: 0; margin: 0;
  border: 0; border-radius: var(--ui-r-sm); background: transparent; color: var(--ui-ink-2);
  font-size: var(--ui-text-md); line-height: 1; cursor: pointer;
}
.ui-icon-btn:hover { background: var(--ui-hover); color: var(--ui-ink); }
.ui-icon-btn:active { background: var(--ui-press); }
.ui-icon-btn--sm { width: var(--ui-ctl-sm); height: var(--ui-ctl-sm); }
.ui-icon-btn--lg { width: var(--ui-ctl-lg); height: var(--ui-ctl-lg); }
.ui-icon-btn--quiet { color: var(--ui-ink-3); }
.ui-icon-btn[aria-pressed="true"], .ui-icon-btn[aria-expanded="true"] { background: var(--ui-on); color: var(--ui-ink); }
.ui-icon-btn:disabled { color: var(--ui-ink-4); background: transparent; cursor: default; }
.ui-icon-btn .ui-glyph { font-size: var(--ui-text-md); font-weight: var(--ui-semibold); letter-spacing: -0.01em; }

/* ── Input ── */
.ui-input {
  box-sizing: border-box; height: var(--ui-ctl-md); min-width: 0; padding: 0 var(--ui-2); margin: 0;
  border: 1px solid var(--ui-border); border-radius: var(--ui-r-sm); background: var(--ui-field); color: var(--ui-ink);
  font-size: var(--ui-input-text); line-height: var(--ui-leading-tight); outline: none;
}
.ui-input::placeholder { color: var(--ui-ink-3); opacity: 1; }
.ui-input:hover { border-color: var(--ui-border-strong); }
.ui-input:focus, .ui-input:focus-visible { border-color: var(--ui-accent-border); box-shadow: var(--ui-ring); background: var(--ui-surface); }
.ui-input--sm { height: var(--ui-ctl-sm); font-size: var(--ui-input-text); }
.ui-input--lg { height: var(--ui-ctl-lg); padding: 0 var(--ui-3); }
.ui-input--quiet { border-color: transparent; background: transparent; }
.ui-input--quiet:hover { border-color: transparent; background: var(--ui-hover); }
.ui-input--quiet:focus { border-color: var(--ui-accent-border); background: var(--ui-surface); }
.ui-input--mono { font-family: var(--ui-mono); }
.ui-field { display: inline-flex; align-items: center; position: relative; min-width: 0; }
.ui-field > .ui-field-icon { position: absolute; left: var(--ui-2); width: var(--ui-icon-sm); height: var(--ui-icon-sm); color: var(--ui-ink-3); pointer-events: none; }
.ui-field > .ui-field-icon + .ui-input { padding-left: calc(var(--ui-2) + var(--ui-icon-sm) + var(--ui-2)); }
select.ui-input { padding-right: var(--ui-6); appearance: none; -webkit-appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 13px) 50%, calc(100% - 9px) 50%; background-size: 4px 4px; background-repeat: no-repeat; }

/* ── Tabs: segmented (the default) or the website's strip ── */
.ui-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; }
.ui-tab {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: var(--ui-1);
  height: var(--ui-ctl-sm); padding: 0 var(--ui-2); margin: 0; border: 0; border-radius: var(--ui-r-sm);
  background: transparent; color: var(--ui-ink-3); font-size: var(--ui-text-sm); font-weight: var(--ui-medium); line-height: 1;
  white-space: nowrap; cursor: pointer;
}
.ui-tab:hover { background: var(--ui-hover); color: var(--ui-ink-2); }
.ui-tab[aria-selected="true"] { background: var(--ui-on); color: var(--ui-ink); }
.ui-tabs--fill > .ui-tab { flex: 1 1 0; }
.ui-tabs--strip { gap: 0; background: var(--ui-tint); border-bottom: 1px solid var(--ui-border-soft); padding: 0 var(--ui-2); }
.ui-tabs--strip > .ui-tab {
  height: var(--ui-ctl-lg); padding: 0 var(--ui-3); border-radius: 0; margin-bottom: -1px; background: none;
  border-bottom: 2px solid transparent; color: var(--ui-ink); opacity: 0.55;
  font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); letter-spacing: var(--ui-caps-track); text-transform: uppercase;
}
.ui-tabs--strip > .ui-tab:hover { opacity: 0.8; background: none; }
.ui-tabs--strip > .ui-tab[aria-selected="true"] { opacity: 1; border-bottom-color: currentColor; }

/* ── Segmented control (one of a few values) ── */
.ui-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: var(--ui-r-md); background: var(--ui-hover); }
.ui-seg > button {
  box-sizing: border-box; flex: 1 1 0; height: calc(var(--ui-ctl-md) - 4px); min-width: 0; padding: 0 var(--ui-2); margin: 0;
  border: 0; border-radius: var(--ui-r-sm); background: transparent; color: var(--ui-ink-2);
  font-size: var(--ui-text-sm); font-weight: var(--ui-medium); line-height: 1; cursor: pointer; white-space: nowrap;
}
.ui-seg > button:hover { color: var(--ui-ink); }
.ui-seg > button[aria-checked="true"], .ui-seg > button[aria-pressed="true"] { background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-sm), 0 0 0 0.5px var(--ui-border); }

/* ── Chip (a toggle or filter) and Pill (a count or badge, not a control) ── */
.ui-chip {
  box-sizing: border-box; display: inline-flex; align-items: center; gap: var(--ui-1);
  height: var(--ui-ctl-sm); padding: 0 var(--ui-2); margin: 0; border: 1px solid var(--ui-border-pill); border-radius: var(--ui-r-pill);
  background: transparent; color: var(--ui-ink-2); font-size: var(--ui-text-sm); line-height: 1; white-space: nowrap; cursor: pointer;
}
.ui-chip:hover { border-color: var(--ui-border-strong); background: var(--ui-hover); color: var(--ui-ink); }
.ui-chip[aria-pressed="true"] { border-color: var(--ui-accent-border); background: var(--ui-accent-tint); color: var(--ui-ink); }
.ui-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.ui-pill {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 var(--ui-1); border-radius: var(--ui-r-pill);
  background: var(--ui-on); color: var(--ui-ink-2); font: var(--ui-medium) var(--ui-text-xs)/1 var(--ui-font); font-variant-numeric: tabular-nums;
}
.ui-pill--danger { background: var(--ui-danger-tint); color: var(--ui-danger); }
.ui-pill--accent { background: var(--ui-accent-tint); color: var(--ui-accent); }
.ui-pill--outline { background: transparent; box-shadow: inset 0 0 0 1px var(--ui-border-pill); }

/* ── Menu ── */
.ui-menu {
  box-sizing: border-box; min-width: 200px; max-width: min(340px, calc(100vw - 16px)); padding: var(--ui-1);
  border-radius: var(--ui-r-md); background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-pop);
  font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); outline: none;
}
.ui-menu-list { max-height: min(360px, 60vh); overflow-y: auto; overscroll-behavior: contain; }
.ui-menu-item {
  box-sizing: border-box; display: flex; align-items: center; gap: var(--ui-2); width: 100%; min-height: var(--ui-row);
  padding: var(--ui-1) var(--ui-2); margin: 0; border: 0; border-radius: var(--ui-r-sm); background: none; color: inherit;
  font-size: var(--ui-text-md); line-height: var(--ui-leading-tight); text-align: left; cursor: pointer;
}
.ui-menu-item:hover, .ui-menu-item.is-active { background: var(--ui-hover); }
.ui-menu-item:focus-visible { background: var(--ui-hover); box-shadow: inset 0 0 0 2px var(--ui-ring-color); }   /* the ring, inset: a menu clips its rows */
.ui-menu-item:disabled, .ui-menu-item[aria-disabled="true"] { color: var(--ui-ink-4); background: none; cursor: default; }
.ui-menu-item--danger { color: var(--ui-danger); }
.ui-menu-item--danger:hover { background: var(--ui-danger-tint); }
.ui-menu-item > svg, .ui-menu-item > .ui-mi-lead { color: var(--ui-ink-2); }
.ui-mi-tile { flex: 0 0 auto; box-sizing: border-box; width: var(--ui-h-md); height: var(--ui-h-md); display: grid; place-items: center;
  border: 1px solid var(--ui-border); border-radius: var(--ui-r-sm); color: var(--ui-ink-2); font: var(--ui-text-md)/1 Georgia, "Times New Roman", serif; }
.ui-mi-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.ui-mi-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.ui-mi-hint { font-size: var(--ui-text-sm); color: var(--ui-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-mi-key { margin-left: auto; padding-left: var(--ui-4); font-size: var(--ui-text-sm); color: var(--ui-ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-menu-item:disabled .ui-mi-key, .ui-menu-item:disabled > svg { color: inherit; }
.ui-menu-sep { height: 1px; margin: var(--ui-1) calc(0px - var(--ui-1)); background: var(--ui-border-soft); }
.ui-menu-label { padding: var(--ui-2) var(--ui-2) var(--ui-1); font-size: var(--ui-text-xs); font-weight: var(--ui-semibold);
  letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--ui-ink-3); }
.ui-menu-label:first-child { padding-top: var(--ui-1); }
.ui-menu-empty { padding: var(--ui-2); font-size: var(--ui-text-md); color: var(--ui-ink-3); }
.ui-menu > .ui-input { display: block; width: 100%; margin: 0 0 var(--ui-1); }

/* ── the overlay layer's host (ui/layers.js openLayer): at the page's origin, 0 × 0, its own stacking context;
   its children place themselves in page (absolute) or viewport (fixed) coordinates ── */
.ui-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; }

/* ── Popover (a floating panel) ── */
.ui-popover {
  box-sizing: border-box; position: fixed; z-index: var(--ui-z-float); margin: 0; max-width: calc(100vw - 16px);
  border-radius: var(--ui-r-lg); background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-pop);
  font: var(--ui-text-md)/var(--ui-leading) var(--ui-font);
}
.ui-popover--pad { padding: var(--ui-3); }
.ui-popover.ui-menu { border-radius: var(--ui-r-md); }
.ui-float-in { animation: ui-float-in var(--ui-fast) var(--ui-ease-out); }
@keyframes ui-float-in { from { opacity: 0; transform: translateY(-2px) scale(0.985); } }

/* ── Card (the website's example frame) ── */
.ui-card { box-sizing: border-box; border: 1px solid var(--ui-border); border-radius: var(--ui-r-lg); overflow: hidden; background: transparent; color: inherit; }
.ui-card-body { padding: var(--ui-4) var(--ui-5); }
.ui-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-2); padding: var(--ui-3) var(--ui-4) 0 var(--ui-5); }
.ui-card-title { font: var(--ui-semibold) var(--ui-text-xs)/1.2 var(--ui-font); letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--ui-ink-3); }

/* ── Toast ── */
.ui-toasts { position: fixed; z-index: var(--ui-z-toast); left: 50%; bottom: max(var(--ui-5), env(safe-area-inset-bottom)); transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: var(--ui-2); pointer-events: none; width: max-content; max-width: calc(100vw - 32px); }
.ui-toast {
  box-sizing: border-box; display: flex; align-items: center; gap: var(--ui-3); min-height: var(--ui-10); max-width: 100%;
  padding: var(--ui-1) var(--ui-1) var(--ui-1) var(--ui-4); border-radius: var(--ui-r-lg);
  background: var(--toast-bg, color-mix(in srgb, var(--ui-ink) 94%, transparent)); color: var(--toast-text, var(--ui-page));
  box-shadow: var(--ui-shadow-pop); font: var(--ui-text-md)/var(--ui-leading-tight) var(--ui-font); pointer-events: auto;
  animation: ui-toast-in var(--ui-mid) var(--ui-ease-out);
}
.ui-toast:not(:has(.ui-btn)) { padding-right: var(--ui-4); }
.ui-toast-text { min-width: 0; padding: var(--ui-2) 0; }
.ui-toast .ui-btn { color: inherit; }
.ui-toast .ui-btn:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
.ui-toast.is-leaving { animation: ui-toast-out var(--ui-fast) var(--ui-ease) forwards; }
@keyframes ui-toast-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes ui-toast-out { to { opacity: 0; transform: translateY(4px); } }

/* ── Banner (a line above the page: seed changes, notices) ── */
.ui-banner { box-sizing: border-box; display: flex; align-items: center; flex-wrap: wrap; gap: var(--ui-2) var(--ui-3);
  padding: var(--ui-2) var(--ui-2) var(--ui-2) var(--ui-4); border: 1px solid var(--ui-border); border-radius: var(--ui-r-lg);
  background: var(--ui-tint); color: var(--ui-ink-2); font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); }
.ui-banner-text { flex: 1 1 16em; min-width: 0; }
.ui-banner-actions { display: flex; gap: var(--ui-2); flex-wrap: wrap; }

/* ── Dialog ── */
.ui-dialog {
  box-sizing: border-box; width: min(520px, calc(100vw - 32px)); max-height: min(80vh, calc(var(--wb-vh, 100dvh) - 32px)); padding: 0; margin: auto;
  border: 0; border-radius: var(--ui-r-lg); background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-dialog);
  font: var(--ui-text-lg)/var(--ui-leading) var(--ui-font); overflow: hidden; display: flex; flex-direction: column;
}
/* centred in the visible part of the window: above an on-screen keyboard (--wb-vtop, --wb-vh on <body> while
   one is up: workbench/src/viewport.ts; at rest the fallbacks: the whole window) */
dialog.ui-dialog { top: var(--wb-vtop, 0px); bottom: calc(100% - var(--wb-vtop, 0px) - var(--wb-vh, 100%)); }
dialog.ui-dialog:not([open]) { display: none; }
dialog.ui-dialog[open] { animation: ui-dialog-in var(--ui-mid) var(--ui-ease-out); }
dialog.ui-dialog::backdrop { background: var(--ui-backdrop); }
.ui-dialog--wide { width: min(720px, calc(100vw - 32px)) !important; }
.ui-dialog-head { flex: 0 0 auto; display: flex; align-items: center; gap: var(--ui-2); padding: var(--ui-4) var(--ui-3) var(--ui-2) var(--ui-5); }
.ui-dialog-title { flex: 1 1 auto; margin: 0; font-size: var(--ui-text-xl); font-weight: var(--ui-semibold); line-height: var(--ui-leading-tight); }
.ui-dialog-body { flex: 1 1 auto; overflow-y: auto; padding: var(--ui-1) var(--ui-5) var(--ui-4); overscroll-behavior: contain; }
.ui-dialog-foot { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: var(--ui-2); padding: var(--ui-3) var(--ui-5) var(--ui-4);
  border-top: 1px solid var(--ui-border-soft); }
@keyframes ui-dialog-in { from { opacity: 0; transform: translateY(6px) scale(0.99); } }

/* ── Sheet: THE side sheet, a dialog at the right edge, full height; one width, one body layout ── */
.ui-sheet {
  box-sizing: border-box; position: fixed; inset: var(--wb-vtop, 0px) 0 auto auto; width: min(var(--ui-sheet-w), 100vw); height: var(--wb-vh, 100dvh); max-width: 100vw; max-height: var(--wb-vh, 100dvh); margin: 0;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) 0;   /* the visible part (viewport.ts: above a keyboard), its content inside the safe area */
  border: 0; border-left: 1px solid var(--ui-border); background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-dialog);
  font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); overflow: hidden; display: flex; flex-direction: column;
}
body.wb-fitted dialog.ui-sheet { padding-bottom: 0; }   /* the keyboard covers the home indicator */
dialog.ui-sheet:not([open]) { display: none; }
dialog.ui-sheet[open] { animation: ui-sheet-in var(--ui-mid) var(--ui-ease-out); }
dialog.ui-sheet::backdrop { background: var(--ui-backdrop); }
.ui-sheet:focus { outline: none; }
.ui-sheet-tabs { flex: 0 0 auto; padding: 0 var(--ui-3); }
.ui-sheet-body { display: flex; flex-direction: column; gap: var(--ui-5); min-height: 0; padding: var(--ui-4) var(--ui-5); }
.ui-sheet-foot { align-items: center; }
.ui-sheet-note { flex: 1 1 auto; min-width: 0; color: var(--ui-ink-2); font-size: var(--ui-text-sm); }
@keyframes ui-sheet-in { from { opacity: 0; transform: translateX(16px); } }

/* ── Tooltip ── */
.ui-tooltip { position: fixed; z-index: var(--ui-z-tip); max-width: 260px; padding: var(--ui-1) var(--ui-2); border-radius: var(--ui-r-sm);
  background: var(--toast-bg, color-mix(in srgb, var(--ui-ink) 94%, transparent)); color: var(--toast-text, var(--ui-page));
  font: var(--ui-text-sm)/var(--ui-leading-tight) var(--ui-font); pointer-events: none; animation: ui-fade var(--ui-fast) var(--ui-ease); }
.ui-tooltip kbd { font: inherit; opacity: 0.7; margin-left: var(--ui-2); }
@keyframes ui-fade { from { opacity: 0; } }

/* ── List row (the sidebar, the home list): a row-height hit target ── */
.ui-row { box-sizing: border-box; display: flex; align-items: center; gap: var(--ui-2); width: 100%; min-height: var(--ui-row);
  padding: var(--ui-1) var(--ui-2); margin: 0; border: 0; border-radius: var(--ui-r-sm); background: none; color: var(--ui-ink-2);
  font: var(--ui-text-md)/var(--ui-leading-tight) var(--ui-font); text-align: left; cursor: pointer;
  transition: background-color var(--ui-fast) var(--ui-ease), color var(--ui-fast) var(--ui-ease); }
.ui-row:hover { background: var(--ui-hover); color: var(--ui-ink); }
.ui-row:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.ui-row[aria-current="true"], .ui-row.is-current { background: var(--ui-on); color: var(--ui-ink); }

@media (prefers-reduced-motion: reduce) {
  .ui-float-in, .ui-toast, dialog.ui-dialog[open], dialog.ui-sheet[open], .ui-tooltip { animation: none; }
}
`;
