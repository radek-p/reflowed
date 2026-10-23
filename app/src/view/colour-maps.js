// one way to register colour maps with the public viewer.
// The viewer reads its #latex-color-maps island once, when it starts (lazily, at the first block; it then
// marks <html data-latex-viewer>), and that REPLACES whatever host.setColorMaps gave before. So a map goes
// into the island AND to setColorMaps, and is set again once the viewer has started.
// view/index.js registers the editor's maps here; svgfig adds its figure colours to the same map.
//
//   registerColourMap(name, map, { keep })   merge into map `name`: per theme and tint; keep: entries already
//                                            there win (an addition under them), else the new ones win
//   colourMaps()                             all of ours
const ours = {};
let armed = false;

/** b merged into a: colors per theme, tints; `keep`: a's entries win */
function merge(a = {}, b = {}, keep = false) {
  const [lo, hi] = keep ? [b, a] : [a, b];
  const colors = { ...(lo.colors ?? {}) };
  for (const [t, e] of Object.entries(hi.colors ?? {})) colors[t] = { ...(colors[t] ?? {}), ...e };
  return { ...lo, ...hi, colors, tints: { ...(lo.tints ?? {}), ...(hi.tints ?? {}) } };
}

function apply() {
  const host = globalThis.reflowtex?.host;
  let island = document.getElementById('latex-color-maps'), maps = {};
  try { maps = island ? JSON.parse(island.textContent) : {}; } catch { maps = {}; }
  maps = { ...maps, ...(host?.colorMaps?.() ?? {}), ...ours };
  if (!island) { island = document.createElement('script'); island.id = 'latex-color-maps'; island.type = 'application/json'; document.head.append(island); }
  island.textContent = JSON.stringify(maps);
  host?.setColorMaps?.(maps);
}
const safely = () => { try { apply(); } catch (e) { console.warn('colour maps:', e.message); } };
/** the viewer has not started yet: set ours again once it has (it marks <html data-latex-viewer>) */
function arm() {
  const root = document.documentElement;
  if (armed || root.hasAttribute('data-latex-viewer')) return;
  armed = true;
  const obs = new MutationObserver(() => {
    if (!root.hasAttribute('data-latex-viewer') || !globalThis.reflowtex?.host?.setColorMaps) return;
    obs.disconnect(); armed = false; safely();
  });
  obs.observe(root, { attributes: true, attributeFilter: ['data-latex-viewer'] });
}

export function registerColourMap(name, map, { keep = false } = {}) {
  ours[name] = merge(ours[name] ?? globalThis.reflowtex?.host?.colorMaps?.()?.[name], map, keep);
  safely();
  arm();
}
export const colourMaps = () => ({ ...ours });
