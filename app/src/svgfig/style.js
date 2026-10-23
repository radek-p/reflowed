// svgfig look: the app's own colours (app.css: --bg, --text, --accent, and
// the themes' values of them), frames as on the website (1 px of the text
// colour at 13 %, 12 px corners), no heavy chrome. Injected once, so the
// module needs no stylesheet of its own in the page.

const CSS = `
.svf-root { position: relative; color: var(--text, #2f2e2b); font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --svf-line: color-mix(in srgb, currentColor 13%, transparent); --svf-soft: color-mix(in srgb, currentColor 6%, transparent);
  --svf-panel: var(--bg, #fff); --svf-accent: var(--accent, #2383e2); --svf-back: var(--editor-bg, #f7f7f5); outline: none; }
.svf-root.svf-overlay { position: fixed; inset: 0; z-index: 1000; }
.svf-viewport { position: absolute; inset: 0; overflow: hidden; touch-action: none; }
/* the backdrop and the sheet's shadow are elements of their own (layers): the open/close animation
   fades them (opacity) without repainting the sheet; box-shadow on the sheet, or opacity on
   pseudo-elements, repainted the drawing every frame in WebKit (2-4 frames per opening) */
.svf-back { position: absolute; inset: 0; pointer-events: none; will-change: opacity; background-color: var(--svf-back);
  background-image: radial-gradient(color-mix(in srgb, currentColor 14%, transparent) 1px, transparent 1.2px); background-size: 20px 20px; }
.svf-root:not(.svf-shown) .svf-back, .svf-root:not(.svf-shown) .svf-chrome, .svf-root:not(.svf-shown) .svf-shade { opacity: 0; }
.svf-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.svf-sheet { position: relative; background: var(--latex-page-bg, #fff); }
.svf-shade { position: absolute; left: 0; top: 0; pointer-events: none; will-change: opacity;
  box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 9%, transparent), 0 8px 28px rgba(15, 15, 15, 0.08); }
.svf-svg { position: absolute; left: 0; top: 0; overflow: visible; display: block; }
.svf-live { position: absolute; inset: 0; pointer-events: none; }
.svf-live-text { position: absolute; }
.svf-live-text .latex-block { pointer-events: none; }
.svf-root[data-tool="rect"] .svf-viewport, .svf-root[data-tool="ellipse"] .svf-viewport, .svf-root[data-tool="line"] .svf-viewport,
.svf-root[data-tool="arrow"] .svf-viewport, .svf-root[data-tool="path"] .svf-viewport, .svf-root[data-tool="box"] .svf-viewport { cursor: crosshair; }
.svf-root[data-tool="label"] .svf-viewport { cursor: text; }
.svf-root[data-tool="hand"] .svf-viewport, .svf-root.svf-pan-ready .svf-viewport { cursor: grab; }
.svf-root.svf-panning .svf-viewport { cursor: grabbing; }
.svf-obj:hover > :not(.svf-glyphs) { }
.svf-content .svf-error .svf-hit { stroke: var(--error, #d44c47); stroke-dasharray: 2 2; stroke-width: 0.8; vector-effect: non-scaling-stroke; }
.svf-proxy { cursor: move; }
.svf-proxy-pts { cursor: move; }
.svf-guide { stroke: #e5489a; vector-effect: non-scaling-stroke; pointer-events: none; }
.svf-marquee { fill: color-mix(in srgb, var(--svf-accent) 8%, transparent); stroke: var(--svf-accent); vector-effect: non-scaling-stroke; pointer-events: none; }
.svf-svg .svg_select_shape, .svf-svg .svg_select_shape_pointSelect { fill: none; stroke: var(--svf-accent); stroke-width: 1px; stroke-dasharray: none; stroke-opacity: 1; vector-effect: non-scaling-stroke; pointer-events: none; }
.svf-svg .svg_select_shape_pointSelect { stroke-opacity: 0.35; }
.svf-svg .svg_select_handle { fill: #fff; stroke: var(--svf-accent); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.svf-svg .svg_select_handle_point { fill: #fff; stroke: var(--svf-accent); stroke-width: 1.2px; vector-effect: non-scaling-stroke; cursor: move; }
.svf-svg .svg_select_handle_rot .svf-rot-stem { stroke: var(--svf-accent); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.svf-svg .svg_select_handle_rot .svf-rot-knob { fill: #fff; stroke: var(--svf-accent); stroke-width: 1.2px; vector-effect: non-scaling-stroke; cursor: grab; }
.svf-root[data-gesture] .svg_select_handle_rot { opacity: 0.6; }

.svf-chrome { position: absolute; inset: 0; pointer-events: none; }
.svf-chrome > * { pointer-events: auto; }
.svf-frame { background: var(--svf-panel); border: 1px solid var(--svf-line); border-radius: 12px; box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04), 0 6px 20px rgba(15, 15, 15, 0.06); }
.svf-top { position: absolute; top: var(--svf-m); left: var(--svf-m); right: var(--svf-m); height: 48px; box-sizing: border-box; display: flex; align-items: center; gap: 14px; padding: 0 8px 0 16px; }
.svf-title { display: flex; flex-direction: column; min-width: 0; margin-right: auto; }
.svf-kicker { font-size: 11px; letter-spacing: 0.02em; color: var(--muted, #9b9a97); }
.svf-name { font-weight: 560; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.svf-status { color: var(--muted, #9b9a97); display: flex; align-items: center; gap: 6px; font-size: 12px; min-height: 16px; }
.svf-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--svf-accent); animation: svf-pulse 1s ease-in-out infinite alternate; }
@keyframes svf-pulse { from { opacity: 0.25; } to { opacity: 1; } }
.svf-err { color: var(--error, #d44c47); }
.svf-group { display: flex; align-items: center; gap: 2px; }
.svf-btn { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; height: 32px; min-width: 32px; padding: 0 7px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.12s, color 0.12s; }
.svf-btn:hover { background: var(--svf-soft); }
.svf-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--svf-accent) 55%, transparent); outline-offset: 1px; }
.svf-btn.is-on { background: color-mix(in srgb, var(--svf-accent) 13%, transparent); color: var(--svf-accent); }
.svf-btn:disabled { opacity: 0.35; cursor: default; background: transparent; }
.svf-text-btn { padding: 0 12px; }
.svf-primary { background: var(--svf-accent); color: #fff; }
.svf-primary:hover { background: color-mix(in srgb, var(--svf-accent) 88%, #000); }
.svf-zoomval { min-width: 52px; font-variant-numeric: tabular-nums; color: var(--muted, #9b9a97); }
.svf-sep { width: 1px; align-self: stretch; margin: 6px 4px; background: var(--svf-line); }
.svf-ic { display: block; }

/* The floating cards keep one margin (--svf-m) to the window and to each other. The layers card runs
   from under the top bar to the window's bottom edge; the tools sit centred over the canvas, the area
   right of the layers card (where fit() centres the figure), so the two never meet. (The card
   used to stop 76 px up, clear of a toolbar centred on the whole window, which it never reached on
   a wide screen.) */
.svf-root { --svf-m: 12px; --svf-pane: 232px; }
.svf-tools { position: absolute; left: calc(var(--svf-m) + var(--svf-pane) + (100% - var(--svf-m) - var(--svf-pane)) / 2); bottom: var(--svf-m); transform: translateX(-50%); display: flex; gap: 2px; padding: 5px; }
.svf-tools .svf-btn { height: 36px; min-width: 36px; }

.svf-layers { position: absolute; top: calc(var(--svf-m) * 2 + 48px); left: var(--svf-m); width: var(--svf-pane); bottom: var(--svf-m); display: flex; flex-direction: column; overflow: hidden; }
.svf-panel-head { padding: 12px 14px 8px; font-weight: 560; display: flex; align-items: center; gap: 6px; }
.svf-count { color: var(--muted, #9b9a97); font-weight: 400; font-size: 12px; }
.svf-rows { position: relative; overflow: auto; padding: 0 6px 8px; flex: 1; }
.svf-row { position: relative; height: 30px; display: flex; align-items: center; gap: 4px; border-radius: 8px; padding-right: 4px; cursor: default; user-select: none;
  transition: background-color 0.1s; }
.svf-row:hover { background: var(--svf-soft); }
.svf-row.is-sel { background: color-mix(in srgb, var(--svf-accent) 11%, transparent); }
.svf-row.is-hidden .svf-row-name, .svf-row.is-hidden .svf-row-ic { opacity: 0.45; }
.svf-row.is-drag { z-index: 2; background: var(--svf-panel); box-shadow: 0 4px 14px rgba(15, 15, 15, 0.14); transition: none; }
.svf-row-ic { color: var(--muted, #9b9a97); display: inline-flex; }
.svf-row-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.svf-row-act { appearance: none; border: 0; background: transparent; color: var(--muted, #9b9a97); width: 24px; height: 24px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; }
.svf-row:hover .svf-row-act, .svf-row.is-hidden .svf-row-act, .svf-row-act.svf-twist { opacity: 1; }
.svf-row-act:hover { background: var(--svf-soft); color: inherit; }
.svf-twist { width: 16px; }
.svf-twist .svf-ic { transition: transform 0.15s; }
.svf-twist.is-open .svf-ic { transform: rotate(90deg); }
.svf-twist-sp { width: 16px; flex: none; }
.svf-rename { flex: 1; min-width: 0; font: inherit; border: 1px solid var(--svf-accent); border-radius: 6px; padding: 2px 5px; background: var(--svf-panel); color: inherit; }
.svf-drop { position: absolute; right: 8px; height: 2px; border-radius: 1px; background: var(--svf-accent); pointer-events: none; }
.svf-empty { color: var(--muted, #9b9a97); padding: 10px 10px; font-size: 12px; }

.svf-pop { position: fixed; z-index: 3; width: 292px; padding: 4px 0; transition: opacity 0.12s; }
.svf-pop.is-quiet { opacity: 0.35; pointer-events: none; }
.svf-sec { padding: 8px 12px; }
.svf-sec + .svf-sec { border-top: 1px solid var(--svf-line); }
.svf-sec-head { font-size: 11px; color: var(--muted, #9b9a97); margin-bottom: 6px; display: flex; justify-content: space-between; }
.svf-hint { opacity: 0.8; }
.svf-title { font-weight: 600; font-size: 12px; }
.svf-replace { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--svf-line); }
.svf-swatches { display: flex; flex-wrap: wrap; gap: 5px; }
.svf-sw { appearance: none; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--svf-line); padding: 0; cursor: pointer; transition: transform 0.1s; }
.svf-sw:hover { transform: scale(1.12); }
.svf-sw.is-on { box-shadow: 0 0 0 2px var(--svf-panel), 0 0 0 3.5px var(--svf-accent); }
.svf-sw-none { background: linear-gradient(135deg, transparent 45%, var(--error, #d44c47) 45%, var(--error, #d44c47) 55%, transparent 55%); }
.svf-row2 { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.svf-seg { display: inline-flex; background: var(--svf-soft); border-radius: 8px; padding: 2px; }
.svf-seg button { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; height: 26px; min-width: 28px; padding: 0 6px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; }
.svf-seg button.is-on { background: var(--svf-panel); box-shadow: 0 1px 2px rgba(15, 15, 15, 0.12); color: var(--svf-accent); }
.svf-slider { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--muted, #9b9a97); }
.svf-slider input { flex: 1; accent-color: var(--svf-accent); }
.svf-slider output { width: 36px; text-align: right; font-variant-numeric: tabular-nums; }
.svf-src { width: 100%; box-sizing: border-box; resize: vertical; font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: inherit; background: var(--svf-soft);
  border: 1px solid transparent; border-radius: 8px; padding: 7px 8px; outline: none; }
.svf-src:focus { border-color: color-mix(in srgb, var(--svf-accent) 60%, transparent); background: var(--svf-panel); }
.svf-errmsg { color: var(--error, #d44c47); font-size: 12px; margin-top: 6px; }
.svf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1px; padding: 6px 8px; }
.svf-actions .svf-btn { height: 30px; min-width: 30px; }
.svf-figpanel { display: flex; align-items: center; gap: 8px; padding-right: 6px; margin-right: 4px; border-right: 1px solid var(--svf-line); }
.svf-quiet { color: var(--muted, #9b9a97); }
.svf-figpanel label { display: flex; align-items: center; gap: 5px; color: var(--muted, #9b9a97); }
.svf-figpanel input { width: 58px; font: inherit; color: var(--text, #2f2e2b); background: var(--svf-soft); border: 1px solid transparent; border-radius: 6px; padding: 3px 6px; }
.svf-unit { color: var(--muted, #9b9a97); }
@media (prefers-reduced-motion: reduce) { .svf-root * { transition: none !important; animation: none !important; } }
`;

export function injectStyle() {
  if (document.getElementById('svf-style')) return;
  const s = document.createElement('style');
  s.id = 'svf-style';
  s.textContent = CSS;
  document.head.append(s);
}
