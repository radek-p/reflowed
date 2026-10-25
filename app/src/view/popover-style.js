// The View popover's CSS (view/popover.ts; its rows in the Settings panel too), on the kit's tokens: light, dark, sepia and contrast follow from them.
// A <style> of its own (the builds need no CSS loader). The theme swatches keep literal colours: they show each theme.
const CSS = String.raw`
.rtx-vp { width: 318px; max-width: calc(100vw - 16px); max-height: calc(100vh - 60px); overflow-y: auto; padding: var(--ui-1) 0 var(--ui-2); }
.rtx-vp[hidden] { display: none !important; }
.rtx-vp-row { padding: var(--ui-2) var(--ui-3); }
.rtx-vp-row + .rtx-vp-row { border-top: 1px solid var(--ui-border-soft); }
.rtx-vp-cap { display: flex; justify-content: space-between; align-items: baseline; gap: var(--ui-2); margin: 0 0 var(--ui-2); font-size: var(--ui-text-xs); font-weight: var(--ui-medium); color: var(--ui-ink-2); }
.rtx-vp-cap output, .rtx-vp-cap > span + span { font-weight: 400; font-variant-numeric: tabular-nums; color: var(--ui-ink-2); }
.rtx-vp-hint { margin: calc(-1 * var(--ui-1)) 0 var(--ui-2); font-size: var(--ui-text-xs); color: var(--ui-ink-2); }
.rtx-vp-seg { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); width: 100%; box-sizing: border-box; }
.rtx-vp-seg > button { padding: 0 2px; font-size: var(--ui-text-sm); white-space: nowrap; }
.rtx-vp-range { width: 100%; margin: var(--ui-2) 0 0; accent-color: var(--ui-accent); }
.rtx-vp-zoom { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--ui-1); }
.rtx-vp-zoom > [data-z="0"] { font-variant-numeric: tabular-nums; justify-content: center; }
.rtx-vp-themes { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--ui-1); }
.rtx-vp-themes > button { display: flex; flex-direction: column; align-items: center; gap: var(--ui-1); border: 0; background: none; padding: 2px 0;
  border-radius: var(--ui-r-sm); cursor: pointer; font: var(--ui-text-xs)/1.2 var(--ui-font); color: var(--ui-ink-2); }
.rtx-vp-themes > button:hover { color: var(--ui-ink); }
.rtx-vp-themes > button:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.rtx-vp-themes > button[aria-checked="true"] { color: var(--ui-ink); font-weight: var(--ui-semibold); }
.rtx-vp-sw { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; font: 15px/1 Georgia, serif; box-shadow: inset 0 0 0 1px var(--ui-border-strong); }
.rtx-vp-themes > button[aria-checked="true"] .rtx-vp-sw { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.rtx-vp-sw[data-t="light"] { background: #fff; color: #000; }
.rtx-vp-sw[data-t="dark"] { background: #191919; color: #e6e4df; }
.rtx-vp-sw[data-t="sepia"] { background: #f4ecd8; color: #453a26; }
.rtx-vp-sw[data-t="contrast"] { background: #fff; color: #000; box-shadow: inset 0 0 0 2px #000; }
.rtx-vp-sw[data-t="system"] { background: linear-gradient(135deg, #fff 50%, #191919 50%); color: #888; }
.rtx-vp-note { margin: var(--ui-2) 0 0; font-size: var(--ui-text-xs); color: var(--ui-ink-2); }
.rtx-vp-keys { padding: var(--ui-1) var(--ui-3) 0; font-size: var(--ui-text-xs); color: var(--ui-ink-2); }
`;

export function installPopoverStyle() {
  if (document.getElementById('rtx-view-pop-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-view-pop-css';
  s.textContent = CSS;
  document.head.append(s);
}
