// The Documents screen's and the versions panel's CSS on the kit's tokens: no literal
// sizes or colours but 0, 1px hairlines and 50 % positions. A string injected once, as the kit's own CSS
// (the builds need no CSS loader). The class names .rh-* / .rv-* are kept: tests and dev probes use them.
const CSS = String.raw`
.rh { box-sizing: border-box; position: relative; max-width: 48rem; margin: 0 auto; padding: var(--ui-6) var(--ui-5);
  color: var(--ui-ink); font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); }
/* (home) the layout follows the panel it is in, not the window: a workbench group of any size */
.rh-c { container: rh / inline-size; }
@container rh (min-width: 600px) { .rh-head { margin-top: var(--ui-10); } }
.rh *, .rv * { box-sizing: border-box; }
.rh-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-2); margin: 0 0 var(--ui-4); }
.rh-head h1 { flex: 1 1 auto; margin: 0; font-size: var(--ui-text-3xl); line-height: var(--ui-leading-tight); font-weight: var(--ui-semibold); letter-spacing: -0.01em; }
/* "New document": the templates as small pages (a sketch of each); they wrap to fill the row, and scroll sideways
   when the panel is narrower than two of them */
.rh-new { margin: 0 0 var(--ui-5); }
.rh-new-head { margin: 0 0 var(--ui-2); font-size: var(--ui-text-sm); font-weight: var(--ui-medium); color: var(--ui-ink-3); }
.rh-tpls { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr)); gap: var(--ui-3); }
.rh-tpl { display: flex; flex-direction: column; align-items: stretch; gap: var(--ui-2); width: 100%; padding: 0; border: 0; background: none;
  color: var(--ui-ink-2); font: inherit; text-align: center; cursor: pointer; border-radius: var(--ui-r-sm); outline: none; }
.rh-tpl-page { box-sizing: border-box; display: flex; flex-direction: column; gap: 4%; aspect-ratio: 210 / 297; padding: 14% 13%; overflow: hidden;
  border: 1px solid var(--ui-border); border-radius: var(--ui-r-sm); background: var(--ui-page); box-shadow: var(--ui-shadow-sm);
  transition: border-color var(--ui-fast) var(--ui-ease), box-shadow var(--ui-fast) var(--ui-ease), transform var(--ui-fast) var(--ui-ease); }
.rh-tpl:hover .rh-tpl-page { border-color: var(--ui-border-strong); transform: translateY(-1px); }
.rh-tpl:focus-visible .rh-tpl-page { box-shadow: var(--ui-ring); }
.rh-tpl:active .rh-tpl-page { transform: none; }
.rh-tpl:hover, .rh-tpl:focus-visible { color: var(--ui-ink); }
.rh-tpl-label { font-size: var(--ui-text-sm); line-height: var(--ui-leading-tight); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rh-tpl-page > i { display: block; flex: 0 0 auto; height: 3px; border-radius: 1px; background: var(--ui-ink-4); }
.rh-tpl-page > .s-title { align-self: center; width: 62%; height: 6px; margin-bottom: 2%; background: var(--ui-ink-3); }
.rh-tpl-page > .s-auth { align-self: center; width: 38%; margin-bottom: 4%; }
.rh-tpl-page > .s-abs { width: 76%; align-self: center; }
.rh-tpl-page > .s-head { width: 44%; height: 4px; margin-top: 5%; background: var(--ui-ink-3); }
.rh-tpl-page > .s-short { width: 58%; }
.rh-tpl-page > .s-abs.s-short { width: 50%; margin-bottom: 3%; }
.rh-tpl-page > .s-eq { align-self: center; width: 34%; margin: 3% 0; }
.rh-tpl-page > .s-thm { width: 30%; background: var(--ui-ink-3); }
.rh-tpl-page > .s-item, .rh-tpl-page > .s-num { width: 80%; margin-left: 10%; position: relative; }
.rh-tpl-page > .s-item.s-short { width: 60%; }
.rh-tpl-page > .s-num-line { margin-left: 10%; width: 50%; }
.rh-tpl-page > .s-item::before, .rh-tpl-page > .s-num::before { content: ''; position: absolute; left: -12%; top: 0; width: 3px; height: 3px; border-radius: 50%; background: var(--ui-ink-3); }
.rh-tpl-page > .s-logo { width: 22%; height: 8px; margin-bottom: 4%; border-radius: 1px; background: var(--ui-accent); opacity: 0.55; }
@container rh (max-width: 360px) {
  .rh-tpls { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 4.75rem; overflow-x: auto; overscroll-behavior-x: contain;
    padding-bottom: var(--ui-1); scroll-snap-type: x proximity; }
  .rh-tpls > * { scroll-snap-align: start; }
}
.rh-find { display: flex; margin: 0 0 var(--ui-1); }
.rh-find > .ui-field { flex: 1 1 auto; }
.rh-find .ui-input { width: 100%; }
.rh-status { min-height: var(--ui-6); display: flex; align-items: center; gap: var(--ui-2); padding: 0 var(--ui-1);
  font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rh-status[data-kind="error"] { color: var(--ui-danger); }
.rh-status[data-kind="busy"]::before { content: ''; flex: 0 0 auto; width: var(--ui-2); height: var(--ui-2); border-radius: 50%;
  background: var(--ui-accent); animation: rh-pulse 1s ease-in-out infinite; }
@keyframes rh-pulse { 50% { opacity: 0.25; } }
.rh-list { display: flex; flex-direction: column; gap: 2px; }
/* a row's text runs from the search field's left edge to its right edge: the ⋯ takes the dates' place while the row is
   hovered or focused (or its menu is open), and has a column of its own only where it always shows (touch, narrow) */
.rh-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: var(--ui-3); min-height: var(--ui-row); padding: var(--ui-2); margin: 0 calc(0px - var(--ui-2)); border-radius: var(--ui-r-sm);
  cursor: pointer; outline: none; transition: background-color var(--ui-fast) var(--ui-ease); }
.rh-row:hover, .rh-row.menu-open { background: var(--ui-hover); }
.rh-row:focus-visible { background: var(--ui-hover); box-shadow: var(--ui-ring); }
.rh-main { min-width: 0; }
.rh-title { font-size: var(--ui-text-lg); font-weight: var(--ui-medium); line-height: var(--ui-leading-tight); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rh-title.untitled { color: var(--ui-ink-3); }
.rh-sub { margin-top: 2px; font-size: var(--ui-text-sm); color: var(--ui-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rh-sub .rh-authors { color: var(--ui-ink-2); }
.rh-hit { margin-top: 2px; font-size: var(--ui-text-sm); color: var(--ui-ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rh-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: var(--ui-text-sm); color: var(--ui-ink-3);
  white-space: nowrap; font-variant-numeric: tabular-nums; }
.rh-row .rh-more { position: absolute; right: var(--ui-2); top: 50%; transform: translateY(-50%); visibility: hidden; }
.rh-row:hover .rh-more, .rh-row:focus-within .rh-more, .rh-row.menu-open .rh-more { visibility: visible; }
.rh-row:hover .rh-meta, .rh-row:focus-within .rh-meta, .rh-row.menu-open .rh-meta { visibility: hidden; }
@media (hover: none) {
  .rh-row { grid-template-columns: minmax(0, 1fr) auto var(--ui-ctl-md); }
  .rh-row .rh-more { position: static; transform: none; visibility: visible; }
  .rh-row .rh-meta { visibility: visible; }
}
.rh mark { background: var(--match); color: inherit; border-radius: 2px; padding: 0 1px; }
.rh-rename { width: 100%; font-size: var(--ui-text-lg); font-weight: var(--ui-medium); }
.rh-empty { padding: var(--ui-10) 0; text-align: center; color: var(--ui-ink-3); font-size: var(--ui-text-md); }
.rh-empty strong { display: block; margin-bottom: var(--ui-1); color: var(--ui-ink); font-size: var(--ui-text-lg); font-weight: var(--ui-medium); }
.rh-drop { position: fixed; inset: var(--ui-2); z-index: 60; display: none; place-items: center; border: 2px dashed var(--ui-accent);
  border-radius: var(--ui-r-lg); background: var(--ui-accent-tint); color: var(--ui-accent); font-size: var(--ui-text-xl);
  font-weight: var(--ui-medium); pointer-events: none; }
.rh.dragging .rh-drop { display: grid; }
.rh-pop { z-index: 70; }
.rh-pop .ui-menu-label:first-child { padding-top: var(--ui-1); }
.home-foot { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--ui-2); padding: var(--ui-6) var(--ui-4) var(--ui-8);
  color: var(--ui-ink-3); font: var(--ui-text-sm)/var(--ui-leading) var(--ui-font); }
.home-foot .rtx-preview-pill { margin: 0; }
.home-foot .ui-btn { color: var(--ui-ink-3); }
.home-foot .ui-btn:hover { color: var(--ui-ink); }

/* the versions panel (the editor's Versions dialog, and the home's) */
.rv { color: var(--ui-ink); font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); }
.rv-head { display: flex; align-items: center; gap: var(--ui-2); margin: 0 0 var(--ui-3); }
.rv-head h2 { flex: 1 1 auto; margin: 0; font-size: var(--ui-text-xl); font-weight: var(--ui-semibold); line-height: var(--ui-leading-tight); }
.rv-save { display: flex; gap: var(--ui-2); margin: 0 0 var(--ui-3); }
.rv-save .ui-input { flex: 1 1 auto; }
.rv-list { display: flex; flex-direction: column; gap: 2px; }
.rv-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--ui-3); align-items: center; min-height: var(--ui-row);
  padding: var(--ui-2); margin: 0 calc(0px - var(--ui-2)); border-radius: var(--ui-r-sm); }
.rv-item:hover { background: var(--ui-hover); }
.rv-label { display: flex; align-items: center; gap: var(--ui-2); min-width: 0; font-weight: var(--ui-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-when { grid-column: 1; font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rv-actions { grid-row: 1 / span 2; grid-column: 2; display: flex; gap: var(--ui-1); }
.rv-confirm { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-2); margin-top: var(--ui-1);
  font-size: var(--ui-text-md); color: var(--ui-ink-2); }
.rv-confirm > span { flex: 1 1 14em; }
.rv-empty { padding: var(--ui-2) 0; font-size: var(--ui-text-md); color: var(--ui-ink-3); }
.rv-status { min-height: var(--ui-5); margin-top: var(--ui-2); font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rtx-import-tex .rtx-import-what { margin: 0 0 var(--ui-1); color: var(--ui-ink-2); }
.rtx-import-tex .rtx-import-note { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rtx-seed-banner { margin: 0 0 var(--ui-4); }
/* Reset local data; Updated sample available */
.rtx-reset { width: min(480px, calc(100vw - 32px)); }
.rtx-reset p { margin: 0 0 var(--ui-3); color: var(--ui-ink-2); }
.rtx-reset .rtx-reset-lead { margin-bottom: var(--ui-1); color: var(--ui-ink); }
.rtx-reset-list { margin: 0 0 var(--ui-3); padding-left: var(--ui-5); color: var(--ui-ink); }
.rtx-reset .rtx-reset-note { font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rtx-reset-status, .rtx-sample-status { flex: 1 1 auto; align-self: center; min-width: 0; font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.rtx-reset-status[data-kind="error"], .rtx-sample-status[data-kind="error"] { color: var(--ui-danger); }
.rtx-reset .ui-dialog-foot, .rtx-sample-update .ui-dialog-foot { flex-wrap: wrap; }
.rtx-sample-update { width: min(480px, calc(100vw - 32px)); }
.rtx-sample-update p { margin: 0 0 var(--ui-3); color: var(--ui-ink-2); }
.rtx-sample-update p:first-child { color: var(--ui-ink); }
.rh-update { flex: 0 0 auto; height: var(--ui-ctl-sm); padding: 0 var(--ui-2); border: 1px solid var(--ui-accent-border); border-radius: var(--ui-r-pill);
  background: var(--ui-accent-tint); color: color-mix(in srgb, var(--ui-accent) 70%, var(--ui-ink)); font: var(--ui-medium) var(--ui-text-sm)/1 var(--ui-font); white-space: nowrap; cursor: pointer; }
.rh-update:hover { background: color-mix(in srgb, var(--ui-accent) 18%, transparent); }
.rh-update:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.rh-title-line { display: flex; align-items: center; gap: var(--ui-2); min-width: 0; }
.rh-title-line .rh-title { min-width: 0; }

/* a narrow panel: the title on its own line, the two buttons together below it */
@container rh (max-width: 420px) { .rh-head h1 { flex-basis: 100%; } }
@container rh (max-width: 560px) {
  .rh-head h1 { font-size: var(--ui-text-2xl); }
  .rh-row { grid-template-columns: minmax(0, 1fr) var(--ui-ctl-md); }
  .rh-row .rh-more { position: static; transform: none; visibility: visible; }
  .rh-meta { display: none; }
}
`;

export function injectHomeStyle(doc: Document = document) {
  if (doc.getElementById('rtx-home-css')) return;
  const s = doc.createElement('style');
  s.id = 'rtx-home-css';
  s.textContent = CSS;
  doc.head.appendChild(s);
}
