// the title form's look (injected once; the kit's tokens only, so light, dark, sepia and contrast follow).
const CSS = `
/* the sheet itself (width, header, body layout, footer) is the kit's one Sheet: only the content here */
.mf-section { display: flex; flex-direction: column; gap: var(--ui-3); }
.mf-section-head { display: flex; align-items: center; gap: var(--ui-2); min-height: var(--ui-ctl-md); }
.mf-section-head h3 { flex: 1 1 auto; margin: 0; font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); letter-spacing: var(--ui-caps-track); text-transform: uppercase; color: var(--ui-ink-2); }
.mf-count, .mf-preview-state { font-size: var(--ui-text-xs); color: var(--ui-ink-3); }
.mf-field { display: flex; flex-direction: column; gap: var(--ui-1); min-width: 0; }
.mf-label-row { display: flex; align-items: center; gap: var(--ui-2); font-size: var(--ui-text-sm); color: var(--ui-ink-2); }
.mf-label-row label { flex: 1 1 auto; }
.mf-input { width: 100%; box-sizing: border-box; }
textarea.mf-area { height: auto; min-height: calc(var(--ui-ctl-md) * 2); padding-top: var(--ui-1); padding-bottom: var(--ui-1); resize: vertical; line-height: var(--ui-leading); }
.mf-latex-toggle, .mf-latex-mark { border: 1px solid var(--ui-border-pill); border-radius: var(--ui-r-pill); background: none; color: var(--ui-ink-3);
  font: var(--ui-medium) var(--ui-text-xs)/1 var(--ui-font); padding: 2px var(--ui-2); }
.mf-latex-toggle { cursor: pointer; }
.mf-latex-toggle[aria-pressed="true"], .mf-latex-mark { color: var(--ui-ink-2); background: var(--ui-on); }
.mf-latex-toggle:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.mf-msg { font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.mf-msg.is-bad { color: var(--ui-danger); }
.mf-bad .mf-input { border-color: var(--ui-danger); }
.mf-ok { color: var(--ui-accent); display: inline-flex; }
.mf-ok svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); }
.mf-flag { display: flex; align-items: center; gap: var(--ui-2); min-height: var(--ui-row); font-size: var(--ui-text-md); cursor: pointer; }
.mf-flag input { margin: 0; accent-color: var(--ui-accent); width: 14px; height: 14px; }
.mf-flags { display: flex; flex-wrap: wrap; gap: 0 var(--ui-4); }
.mf-pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ui-3); }
@media (max-width: 480px) { .mf-pair { grid-template-columns: 1fr; } }
.mf-more summary, .mf-source summary { cursor: pointer; font-size: var(--ui-text-sm); color: var(--ui-ink-2); padding: var(--ui-1) 0; line-height: calc(var(--ui-row) - 2 * var(--ui-1)); }
.mf-more[open] { display: flex; flex-direction: column; gap: var(--ui-3); }
.mf-authors, .mf-affils { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ui-1); }
.mf-author { border: 1px solid var(--ui-border); border-radius: var(--ui-r-sm); background: var(--ui-surface); transition: transform var(--ui-mid) var(--ui-ease-out); }
.mf-authors.is-dragging .mf-author { user-select: none; }
.mf-author.is-dragged { transition: none; position: relative; z-index: 1; box-shadow: var(--ui-shadow-pop); }
/* handle | name over affiliations | chevron: a grid, so every row has the list's width and one left edge */
.mf-author-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 0 var(--ui-1); min-height: var(--ui-row); padding: 2px var(--ui-1); }
.mf-author-main { display: flex; flex-direction: column; align-items: stretch; gap: 0; min-width: 0; }
.mf-author-row > .mf-handle, .mf-author-row > .ui-icon-btn { margin-top: 2px; }
.mf-handle { cursor: grab; touch-action: none; color: var(--ui-ink-3); }
.mf-authors.is-dragging .mf-handle { cursor: grabbing; }
.mf-author-name { width: 100%; min-width: 0; border: 0; background: none; color: var(--ui-ink); font: var(--ui-medium) var(--ui-text-md)/var(--ui-leading-tight) var(--ui-font);
  text-align: left; padding: var(--ui-1); border-radius: var(--ui-r-sm); cursor: pointer; display: flex; gap: var(--ui-2); align-items: center; }
.mf-author-name:hover { background: var(--ui-hover); }
.mf-author-name:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.mf-placeholder { color: var(--ui-ink-3); font-weight: normal; }
.mf-badge { font-size: var(--ui-text-xs); color: var(--ui-ink-3); font-weight: normal; }
.mf-chips { display: flex; flex-wrap: wrap; gap: var(--ui-1); align-items: center; min-width: 0; padding: 0 0 2px var(--ui-1); color: var(--ui-ink-2); }
.mf-chips .mf-chip { color: var(--ui-ink-2); background: transparent; border-color: var(--ui-border-soft); }
.mf-chip { display: inline-flex; align-items: center; gap: var(--ui-1); max-width: 100%; height: var(--ui-ctl-sm); padding: 0 2px 0 var(--ui-1); cursor: default; }
.mf-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 32em; font-size: var(--ui-text-sm); }
.mf-chip-x { border: 0; background: none; color: var(--ui-ink-3); width: 18px; height: 18px; padding: 0; border-radius: var(--ui-r-pill); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.mf-chip-x svg { width: var(--ui-icon-xs); height: var(--ui-icon-xs); }
.mf-chip-x:hover { background: var(--ui-hover); color: var(--ui-ink); }
.mf-chip-x:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.mf-num { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 3px; box-sizing: border-box; border-radius: var(--ui-r-pill);
  background: var(--ui-on); color: var(--ui-ink-2); font: var(--ui-medium) var(--ui-text-xs)/1 var(--ui-font); flex: 0 0 auto; }
.mf-author-details { display: flex; flex-direction: column; gap: var(--ui-3); padding: var(--ui-2) var(--ui-3) var(--ui-3) var(--ui-8); border-top: 1px solid var(--ui-border-soft); }
.mf-others { font-size: var(--ui-text-sm); color: var(--ui-ink-3); }
.mf-others code { font: var(--ui-text-sm) var(--ui-mono); }
.mf-row-actions { display: flex; justify-content: flex-end; }
.mf-picker { margin: 0 var(--ui-2) var(--ui-2) var(--ui-8); padding: var(--ui-2); border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); background: var(--ui-surface); box-shadow: var(--ui-shadow-pop);
  display: flex; flex-direction: column; gap: var(--ui-1); }
.mf-picker-list { display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; }
.mf-hint { font-size: var(--ui-text-sm); color: var(--ui-ink-3); padding: var(--ui-1) var(--ui-2); }
.mf-removed, .mf-note { display: flex; align-items: center; gap: var(--ui-2); font-size: var(--ui-text-sm); color: var(--ui-ink-2); }
.mf-affil { display: flex; align-items: flex-start; gap: var(--ui-2); padding: var(--ui-2) 0; border-bottom: 1px solid var(--ui-border-soft); }
.mf-affil > .mf-num { margin-top: var(--ui-1); }
.mf-affil-fields { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--ui-2); min-width: 0; }
.mf-preview { min-height: 80px; border: 1px solid var(--ui-border); border-radius: var(--ui-r-lg); padding: var(--ui-3); background: var(--ui-page); overflow: hidden; transition: opacity var(--ui-fast) var(--ui-ease); }
.mf-preview.is-pending { opacity: 0.6; }
.mf-errors { margin: 0; padding-left: var(--ui-4); color: var(--ui-danger); font-size: var(--ui-text-sm); }
.mf-pre { margin: 0; padding: var(--ui-2) var(--ui-3); border-radius: var(--ui-r-sm); background: var(--ui-tint); font: var(--ui-text-sm)/var(--ui-leading) var(--ui-mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow-y: auto; }
.mf-convert { display: flex; flex-direction: column; gap: var(--ui-3); }
.mf-convert p { margin: 0; }
.mf-convert code { font: var(--ui-text-sm) var(--ui-mono); }
.mf-notes { margin: 0; padding-left: var(--ui-4); color: var(--ui-ink-2); font-size: var(--ui-text-sm); }
.mf-convert-actions { display: flex; justify-content: flex-end; gap: var(--ui-2); }
`;
let done = false;
export function ensureFormStyles(doc = document) {
  if (done && doc.getElementById('rtx-meta-form-css')) return;
  done = true;
  if (doc.getElementById('rtx-meta-form-css')) return;
  const s = doc.createElement('style');
  s.id = 'rtx-meta-form-css';
  s.textContent = CSS;
  doc.head.append(s);
}
