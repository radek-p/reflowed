import { registerColourMap } from '../view/colour-maps.ts';
// svgfig colours: the palette a figure draws with, and the substitutions that
// make it follow the viewer's themes. The palette's colours are keys of the
// viewer's colour map (web/src/view/index.js registers the 'editor' map; this
// adds the figure's own entries to it), so a figure in the document is
// recoloured by light/dark/sepia/contrast as TikZ pictures are: its SVG writes
// fill='#rrggbb' / stroke='#rrggbb', the picture step (rewritePictureSvg) turns
// them into var(--latex-color-rrggbb, …), and the map's rules set those.
// Fills use tints: a colour mixed with the page at TINT %, which the map
// derives again from the current page colour (so a light-blue box is a dark
// blue box in dark mode). '#ffffff' is "the page": a white fill follows the
// background.

export const TINT = 18;

/** Solid colours (stroke, text, fill). Light values; name for tooltips. */
export const SOLIDS = [
  { hex: '#000000', name: 'Black (the text colour)' },
  { hex: '#77767b', name: 'Grey' },
  { hex: '#3584e4', name: 'Blue' },
  { hex: '#9141ac', name: 'Purple' },
  { hex: '#e01b24', name: 'Red' },
  { hex: '#e66100', name: 'Orange' },
  { hex: '#26a269', name: 'Green' },
  { hex: '#c88800', name: 'Yellow' },
];
export const PAGE = '#ffffff';

const DARK = { '#77767b': '#a8a6a1', '#3584e4': '#78aeed', '#9141ac': '#c89ee0', '#e01b24': '#ff7b72', '#e66100': '#ffa348', '#26a269': '#57e389', '#c88800': '#f6d32d' };
const SEPIA = { '#77767b': '#6b604c', '#3584e4': '#1c5c9c', '#9141ac': '#6e2c86', '#e01b24': '#a51d2d', '#e66100': '#a54a00', '#26a269': '#1b6e46', '#c88800': '#8a6500' };
const CONTRAST = { '#77767b': '#3d3d3d', '#3584e4': '#0b4fa8', '#9141ac': '#5e1a78', '#e01b24': '#a0000a', '#e66100': '#8f3d00', '#26a269': '#0b5a33', '#c88800': '#5c4600' };

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** base mixed into white at pct % (what xcolor's base!pct!white bakes). */
export function tintOf(hex, pct = TINT) {
  const [r, g, b] = rgbOf(hex);
  const m = (c) => c * pct / 100 + 255 * (1 - pct / 100);
  return `#${hex2(m(r))}${hex2(m(g))}${hex2(m(b))}`;
}
/** Fill swatches: none, the page, tints, then the solids. */
export const FILLS = [
  { hex: null, name: 'No fill' },
  { hex: PAGE, name: 'Page (white; the background in dark mode)' },
  ...SOLIDS.map((s) => ({ hex: tintOf(s.hex), name: `${s.name.replace(/ \(.*\)/, '')} tint`, tint: s.hex })),
  ...SOLIDS.map((s) => ({ hex: s.hex, name: s.name })),
];

/** The figure's entries for the viewer's colour map. */
export const FIGURE_COLOURS = {
  colors: { dark: DARK, sepia: SEPIA, contrast: CONTRAST },
  tints: {
    [PAGE]: ['#000000', 0],
    ...Object.fromEntries(SOLIDS.map((s) => [tintOf(s.hex), [s.hex, TINT]])),
  },
};

/** Add FIGURE_COLOURS to the viewer's map `name` (idempotent; keeps what is there). Through the
 *  one registration path, view/colour-maps.ts. */
export function installFigureColours(name = 'editor') {
  registerColourMap(name, FIGURE_COLOURS, { keep: true });
  return true;
}

/** The theme on <html> (unclassed = light). */
export function currentTheme() {
  const c = globalThis.document?.documentElement.classList;
  for (const t of ['dark', 'sepia', 'contrast']) if (c?.contains(t)) return t;
  return 'light';
}

/** What a colour shows as in a theme (for the editor's own canvas and swatches),
 *  from the viewer's map `name` when there is one, else FIGURE_COLOURS. */
export function shown(hex, theme = currentTheme(), name = 'editor', pageBg = null) {
  if (!hex) return 'none';
  const m = globalThis.window?.reflowtex?.host?.colorMaps?.()?.[name] ?? FIGURE_COLOURS;
  const sub = (h) => (theme === 'light' ? null : m.colors?.[theme]?.[h] ?? FIGURE_COLOURS.colors[theme]?.[h] ?? null);
  const tint = m.tints?.[hex] ?? FIGURE_COLOURS.tints[hex];
  if (tint) {
    const base = sub(tint[0]) ?? (tint[0] === '#000000' ? 'currentColor' : tint[0]);
    return `color-mix(in srgb, ${base} ${tint[1]}%, ${pageBg ?? 'var(--latex-page-bg, Canvas)'})`;
  }
  if (hex === '#000000') return sub(hex) ?? 'currentColor';
  return sub(hex) ?? hex;
}

/** TikZ colour for an exact hex: {rgb,255:red,R;green,G;blue,B}. */
export function tikzColour(hex) {
  if (hex === '#000000') return 'black';
  if (hex === PAGE) return 'white';
  const [r, g, b] = rgbOf(hex);
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}
