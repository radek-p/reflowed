// the References pane's and its dialogs' CSS on the kit's tokens, injected once;
// prefix bp-. The controls are the kit's (view.ts, dialogs.js); this lays them out.
const CSS = String.raw`
.sb-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.sb-tabs::-webkit-scrollbar { display: none; }
/* four tabs fit the sidebar once Refs is added (as before) */
.sb-tabs { gap: 0; padding-left: var(--ui-2); padding-right: var(--ui-2); }
.sb-tabs button { flex: 0 0 auto; padding-left: var(--ui-2); padding-right: var(--ui-2); }
#panel-references { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
#panel-references[hidden] { display: none !important; }
.bp-head { display: flex; align-items: center; gap: var(--ui-1); padding: 0 var(--ui-2) var(--ui-2) var(--ui-3); flex: 0 0 auto; }
.bp-search { position: relative; flex: 1 1 auto; min-width: 0; display: flex; }
.bp-search > .ui-field { flex: 1 1 auto; }
.bp-search .ui-input { width: 100%; padding-right: var(--ui-6); }
.bp-search kbd { position: absolute; right: var(--ui-2); top: 50%; transform: translateY(-50%); font: var(--ui-text-xs)/1.4 var(--ui-mono);
  color: var(--ui-ink-3); border: 1px solid var(--ui-border); border-radius: 4px; padding: 0 var(--ui-1); pointer-events: none; }
.bp-search:focus-within kbd, .bp-search:has(input:not(:placeholder-shown)) kbd { display: none; }
.bp-filters { display: flex; flex-wrap: wrap; gap: var(--ui-1); padding: 0 var(--ui-2) var(--ui-2) var(--ui-3); flex: 0 0 auto; }
.bp-chip .n { color: var(--ui-ink-3); font-variant-numeric: tabular-nums; }
.bp-chip.warn .n { color: var(--ui-danger); }
.bp-target { margin: 0 var(--ui-3) var(--ui-2); font-size: var(--ui-text-xs); line-height: var(--ui-leading); color: var(--ui-ink-3); flex: 0 0 auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp-target b { font-weight: var(--ui-medium); color: var(--ui-ink-2); }
.bp-hint { margin: 0 var(--ui-2) var(--ui-2); padding: var(--ui-2) var(--ui-3); border-radius: var(--ui-r-sm); flex: 0 0 auto;
  background: color-mix(in srgb, var(--ui-warn) 12%, transparent); color: var(--ui-ink); font-size: var(--ui-text-sm); line-height: var(--ui-leading); }
.bp-hint[hidden] { display: none; }
.bp-body { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--ui-1) var(--ui-3); overscroll-behavior: contain; }
.bp-body.drop { outline: 2px dashed var(--ui-accent-border); outline-offset: -6px; border-radius: var(--ui-r-md); background: var(--ui-accent-tint); }
/* the list: two columns, the text and the year; each row a subgrid of them, so the year column is as wide as the
   widest year shown (four tabular digits; "in press" widens it for every row) and the years form one line */
.bp-list { list-style: none; margin: 0; padding: 0; outline: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(4ch, max-content);
  row-gap: var(--ui-1); column-gap: var(--ui-3); }
.bp-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: baseline; position: relative;
  min-height: 48px; box-sizing: border-box; padding: 10px var(--ui-2); border-radius: var(--ui-r-sm); cursor: default; color: var(--ui-ink-2);
  transition: background-color var(--ui-fast) var(--ui-ease); }
.bp-row:hover { background: var(--ui-hover); }
.bp-row[aria-selected="true"] { background: var(--ui-selected); }
/* the row the keyboard is on: Enter cites it. A hairline while the pane is not focused; the kit's solid ring while
   the list or the search has the keyboard */
.bp-row.active { box-shadow: inset 0 0 0 1px var(--ui-accent-border); }
.bp-list:focus-visible .bp-row.active, .bp-head:has(input:focus-visible) ~ .bp-body .bp-row.active {
  box-shadow: none; outline: 2px solid var(--ui-ring-color); outline-offset: -2px; }
.bp-row.fresh { animation: bp-fresh 1.6s ease-out; }
@keyframes bp-fresh { from { background: color-mix(in srgb, var(--ui-accent) 18%, transparent); } to { background: transparent; } }
/* line 1: the authors' family names | the year */
.bp-who { grid-column: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--ui-text-sm); line-height: 16px; color: var(--ui-ink-2); }
.bp-year { grid-column: 2; text-align: right; white-space: nowrap; font-size: var(--ui-text-sm); line-height: 16px; color: var(--ui-ink-2);
  font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; }
.bp-year.none { color: var(--ui-ink-3); }
/* line 2: the title, two lines at most (the whole title in its tooltip and when the entry is open) */
.bp-title { grid-column: 1 / -1; margin-top: var(--ui-1); font-size: var(--ui-text-md); line-height: 18px; font-weight: var(--ui-medium); color: var(--ui-ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.bp-row.open .bp-title { -webkit-line-clamp: unset; display: block; }
/* line 3: the label TeX prints, the venue, "not cited"; Cite at its end */
.bp-meta { grid-column: 1 / -1; position: relative; display: flex; align-items: baseline; gap: var(--ui-2); min-width: 0; margin-top: var(--ui-1);
  font-size: var(--ui-text-xs); line-height: 16px; color: var(--ui-ink-3); }
.bp-label { flex: 0 0 auto; font: var(--ui-text-xs)/16px var(--ui-mono); color: var(--ui-ink-2); }
.bp-venue-s { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
.bp-tag { flex: 0 0 auto; padding: 0 var(--ui-1); border-radius: 4px; background: var(--ui-tint); box-shadow: inset 0 0 0 1px var(--ui-border-soft); }
.bp-row.uncited :is(.bp-who, .bp-year, .bp-title, .bp-label, .bp-venue-s) { opacity: 0.62; }
.bp-meta > .bp-cite { position: absolute; right: 0; bottom: -4px; height: var(--ui-h-sm); padding: 0 var(--ui-2); font-size: var(--ui-text-sm);
  background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); opacity: 0; }
.bp-row:hover .bp-cite, .bp-row.active .bp-cite, .bp-row[aria-selected="true"] .bp-cite, .bp-cite:focus-visible { opacity: 1; }
.bp-row.open .bp-meta > .bp-cite { display: none; }   /* the open entry has its own Cite */
@media (hover: none) { .bp-meta > .bp-cite { opacity: 1; } .bp-meta { padding-right: 52px; } }
/* the ⋯ menu: the kit's Menu inside a Popover; the Popover is the one surface */
.ui-popover.bp-menu { border-radius: var(--ui-r-md); }
.bp-menu > .ui-menu { background: none; box-shadow: none; }
.bp-more { grid-column: 1 / -1; margin-top: var(--ui-2); padding-top: var(--ui-2); border-top: 1px solid var(--ui-border-soft); font-size: var(--ui-text-sm); line-height: var(--ui-leading); }
.bp-venue { color: var(--ui-ink-2); }
.bp-venue a { color: var(--latex-link, var(--ui-accent)); text-decoration: none; }
.bp-venue a:hover { text-decoration: underline; }
.bp-key2 { font: var(--ui-text-xs) var(--ui-mono); color: var(--ui-ink-3); margin-top: 2px; }
.bp-uses { margin-top: var(--ui-1); display: flex; flex-direction: column; gap: 1px; }
.bp-uses .bp-k { font-size: var(--ui-text-xs); color: var(--ui-ink-3); }
.ui-row.bp-use { min-height: var(--ui-h-sm); padding: 0 var(--ui-2); margin: 0 calc(0px - var(--ui-2)); width: calc(100% + var(--ui-4)); font-size: var(--ui-text-sm);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.bp-actions { display: flex; flex-wrap: wrap; gap: var(--ui-1); margin-top: var(--ui-2); }
.bp-section { font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--ui-ink-3);
  padding: var(--ui-2) var(--ui-2) var(--ui-1); }
.bp-unknown { padding: var(--ui-1) var(--ui-2); border-radius: var(--ui-r-sm); display: flex; align-items: center; gap: var(--ui-2); }
.bp-unknown:hover { background: var(--ui-hover); }
.bp-unknown .ui-row.bp-key { flex: 1 1 auto; width: auto; margin: 0; font: var(--ui-text-sm)/var(--ui-leading-tight) var(--ui-mono); color: var(--ui-danger); }
.bp-unknown .bp-n { font-size: var(--ui-text-xs); color: var(--ui-ink-3); flex: 0 0 auto; }
.bp-empty { margin: var(--ui-4) var(--ui-2); font-size: var(--ui-text-sm); color: var(--ui-ink-3); line-height: 1.5; }
.bp-empty p { margin: 0; text-wrap: pretty; }
.bp-empty .ui-btn { margin-top: var(--ui-3); }
.bp-selbar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--ui-2); padding: var(--ui-2) var(--ui-3); border-top: 1px solid var(--ui-border-soft); font-size: var(--ui-text-sm); }
.bp-selbar[hidden] { display: none; }
.bp-selbar .grow { flex: 1 1 auto; color: var(--ui-ink-2); }
.bp-foot { flex: 0 0 auto; padding: var(--ui-1) var(--ui-4) var(--ui-2); font-size: var(--ui-text-xs); color: var(--ui-ink-3); }
.pb-add { margin: 2px var(--ui-2) var(--ui-1); }
.pb-list li:has(.pb-add) { display: flex; flex-direction: column; }

/* dialogs (the kit's Dialog) */
.bp-dialog .ui-dialog-foot { align-items: center; }
.bp-dialog .ui-dialog-foot .grow { flex: 1 1 auto; font-size: var(--ui-text-sm); color: var(--ui-ink-3); min-width: 0; }
.bp-dialog .ui-dialog-foot [hidden] { display: none; }
.bp-confirm-text { margin: 0; font-size: var(--ui-text-md); line-height: 1.5; }
.bp-seg { margin-bottom: var(--ui-3); }
.bp-seg > button[aria-selected="true"] { background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow-sm), 0 0 0 0.5px var(--ui-border); }
.bp-dialog textarea.ui-input { display: block; box-sizing: border-box; width: 100%; height: auto; padding: var(--ui-2); resize: vertical; line-height: 1.45; }
.bp-dialog textarea.bp-paste, .bp-dialog textarea.bp-raw { min-height: 120px; font-size: var(--ui-text-sm); }
.bp-dialog .bp-note { font-size: var(--ui-text-sm); color: var(--ui-ink-3); margin: var(--ui-2) 0 0; line-height: 1.45; }
.bp-dialog .bp-err { font-size: var(--ui-text-sm); color: var(--ui-danger); margin: var(--ui-2) 0 0; line-height: 1.45; }
.bp-dialog .bp-ok { font-size: var(--ui-text-sm); color: var(--cm-math, var(--ui-ink-2)); margin: var(--ui-2) 0 0; }
.bp-dialog .bp-check { display: flex; gap: var(--ui-2); align-items: center; cursor: pointer; }
.bp-lookup { display: flex; gap: var(--ui-2); }
.bp-lookup > .ui-input { flex: 1 1 auto; }
.bp-preview { margin-top: var(--ui-3); display: flex; flex-direction: column; gap: var(--ui-2); }
.bp-prev { border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); padding: var(--ui-2) var(--ui-3); }
.bp-prev.skip { opacity: 0.55; }
.bp-prev .bp-l1 { display: flex; align-items: baseline; gap: var(--ui-2); min-width: 0; font-size: var(--ui-text-sm); line-height: var(--ui-leading); }
.bp-prev .bp-who { flex: 1 1 auto; }
.bp-prev .bp-label { font-weight: var(--ui-medium); color: var(--ui-ink); }
.bp-prev .bp-title { -webkit-line-clamp: 3; margin-top: 2px; }
.bp-clash { margin-top: var(--ui-2); padding: var(--ui-2) var(--ui-3); border-radius: var(--ui-r-sm); background: color-mix(in srgb, var(--ui-warn) 12%, transparent);
  color: var(--ui-ink); font-size: var(--ui-text-sm); line-height: var(--ui-leading); }
.bp-clash .bp-choices { display: flex; flex-wrap: wrap; gap: var(--ui-1) var(--ui-3); margin-top: var(--ui-1); }
.bp-clash label { display: inline-flex; align-items: center; gap: var(--ui-1); cursor: pointer; }
.bp-shift { font-size: var(--ui-text-sm); color: var(--ui-ink-3); margin-top: var(--ui-1); }
.bp-form { display: grid; grid-template-columns: 92px 1fr; gap: var(--ui-2) var(--ui-3); align-items: center; }
.bp-form label { font-size: var(--ui-text-sm); color: var(--ui-ink-2); text-align: right; }
.bp-form .ui-input { width: 100%; box-sizing: border-box; }
.bp-form textarea.bp-area { min-height: 0; }
.bp-toggle { margin-top: var(--ui-2); color: var(--ui-accent); }
@media (max-width: 520px) {
  .bp-form { grid-template-columns: 1fr; gap: 3px; }
  .bp-form label { text-align: left; margin-top: var(--ui-1); }
}
`;
export function injectStyle(): void {
  if (document.getElementById('bp-style')) return;
  const s = document.createElement('style');
  s.id = 'bp-style';
  s.textContent = CSS;
  document.head.append(s);
}
