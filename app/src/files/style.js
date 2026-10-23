// the Files panel's CSS (tokens only: light and dark follow; a <style> of its own, the builds need no CSS loader)
const CSS = String.raw`
.fl { display: flex; flex-direction: column; gap: var(--ui-2); }
.fl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.fl-row { display: flex; align-items: flex-start; gap: var(--ui-2); width: 100%; min-height: var(--ui-row); box-sizing: border-box;
  border: 0; background: none; text-align: left; font: inherit; color: var(--ui-ink); padding: var(--ui-1) var(--ui-2);
  border-radius: var(--ui-r-sm); cursor: pointer; transition: background var(--ui-fast) var(--ui-ease-out); }
.fl-row:hover { background: var(--ui-hover); }
.fl-row:active { background: var(--ui-press); }
.fl-row:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.fl-row[aria-disabled="true"] { cursor: default; }
.fl-row[aria-disabled="true"]:hover, .fl-row[aria-disabled="true"]:active { background: none; }
.fl-sub { padding-left: calc(var(--ui-2) + var(--ui-4)); }
.fl-ico { flex: 0 0 auto; display: inline-flex; padding-top: 2px; color: var(--ui-ink-3); }
.fl-ico svg { width: var(--ui-icon-sm); height: var(--ui-icon-sm); }
.fl-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.fl-name { font-size: var(--ui-text-md); font-weight: var(--ui-medium); overflow-wrap: anywhere; }
.fl-dir { color: var(--ui-ink-3); font-weight: normal; }
.fl-meta { display: flex; gap: var(--ui-2); font-size: var(--ui-text-xs); color: var(--ui-ink-2); }
.fl-size { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--ui-ink-3); }
.fl-where { font-size: var(--ui-text-xs); color: var(--ui-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fl-foot { margin: var(--ui-1) var(--ui-2) 0; font-size: var(--ui-text-xs); color: var(--ui-ink-3); }
.fl-warn { margin: 0; padding: 0 var(--ui-2) 0 var(--ui-6); font-size: var(--ui-text-xs); color: var(--ui-warn); }
`;

export function installFilesStyle() {
  if (document.getElementById('rtx-files-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-files-css';
  s.textContent = CSS;
  document.head.append(s);
}
