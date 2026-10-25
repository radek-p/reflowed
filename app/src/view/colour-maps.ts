// One way to register colour maps with the public viewer: ours merged into the maps in force and given to
// host.setColorMaps (the viewer keeps maps set before its first block over its #latex-color-maps island, map by map).
// view/index.js registers the editor's maps here; svgfig adds its figure colours to the same map.
//
//   registerColourMap(name, map, { keep })   merge into map `name`: per theme and tint; keep: entries already
//                                            there win (an addition under them), else the new ones win
//   colourMaps()                             all of ours
export interface ColourMap { colors?: Record<string, Record<string, string>>; tints?: Record<string, unknown>; [k: string]: unknown }
interface ViewerHost { colorMaps(): Record<string, ColourMap>; setColorMaps(maps: Record<string, ColourMap>): void }

const ours: Record<string, ColourMap> = {};
const host = (): ViewerHost | null => (globalThis as { reflowtex?: { host?: ViewerHost } }).reflowtex?.host ?? null;

/** b merged into a: colors per theme, tints; `keep`: a's entries win */
function merge(a: ColourMap = {}, b: ColourMap = {}, keep = false): ColourMap {
  const [lo, hi] = keep ? [b, a] : [a, b];
  const colors: Record<string, Record<string, string>> = { ...(lo.colors ?? {}) };
  for (const [t, e] of Object.entries(hi.colors ?? {})) colors[t] = { ...(colors[t] ?? {}), ...e };
  return { ...lo, ...hi, colors, tints: { ...(lo.tints ?? {}), ...(hi.tints ?? {}) } };
}

let waiting = false;
function apply(): void {
  const h = host();
  if (!h) {
    // the viewer's script not run yet: ours go once it has
    if (!waiting) { waiting = true; document.addEventListener('reflowtex:host', () => { waiting = false; apply(); }, { once: true }); }
    return;
  }
  try { h.setColorMaps({ ...h.colorMaps(), ...ours }); } catch (e) { console.warn('colour maps:', (e as Error).message); }
}

export function registerColourMap(name: string, map: ColourMap, { keep = false }: { keep?: boolean } = {}): void {
  ours[name] = merge(ours[name] ?? host()?.colorMaps()?.[name], map, keep);
  apply();
}
export const colourMaps = (): Record<string, ColourMap> => ({ ...ours });
