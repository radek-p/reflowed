// the Document settings sheet's CSS (tokens only; a <style> of its own: the builds need no CSS loader).
const CSS = String.raw`
/* the sheet itself (width, header, tabs, body layout, footer and its note) is the kit's one Sheet: only the content here */
.ss-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--ui-3); }
.ss-panel[hidden] { display: none; }
.ss-preamble { overflow: hidden; }
.ss-hint { margin: 0; color: var(--ui-ink-2); font-size: var(--ui-text-sm); }
.ss-editor { flex: 1 1 auto; min-height: 120px; display: flex; border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); overflow: hidden; background: var(--ui-page); }
.ss-editor > .cm-editor { flex: 1 1 auto; height: 100%; font-size: var(--ui-text-md); }
.ss-editor .cm-editor.cm-focused { outline: none; }
.ss-editor:focus-within { border-color: var(--ui-accent-border); box-shadow: var(--ui-ring); }
.ss-editor .cm-scroller { font-family: var(--ui-mono); line-height: 1.6; overflow: auto; }
.ss-editor .cm-content { padding: var(--ui-2) 0; caret-color: var(--ui-ink); }
.ss-editor .cm-line { padding: 0 var(--ui-3); }
.ss-editor .cm-activeLine { background: var(--ui-tint); }
.ss-editor .cm-pre-error { text-decoration: underline wavy var(--ui-danger); text-decoration-thickness: 1px; text-underline-offset: 3px; }
.ss-errors { flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px; max-height: 30%; overflow-y: auto; }
.ss-err { color: var(--ui-danger); background: var(--ui-danger-tint); align-items: baseline; text-align: left; border: 0; font: inherit; cursor: pointer; padding: var(--ui-1) var(--ui-2); border-radius: var(--ui-r-sm); }
.ss-err:hover { color: var(--ui-danger); background: color-mix(in srgb, var(--ui-danger) 14%, transparent); }
.ss-err-line { flex: 0 0 auto; font: var(--ui-text-sm) var(--ui-mono); opacity: 0.8; }
.ss-err-msg { min-width: 0; word-break: break-word; }
.ss-field { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-3); min-height: var(--ui-h-lg); }
.ss-label { color: var(--ui-ink); }
.ss-value { color: var(--ui-ink-2); text-align: right; }
`;

export function installSettingsStyle() {
  if (document.getElementById('rtx-settings-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-settings-css';
  s.textContent = CSS;
  document.head.append(s);
}
