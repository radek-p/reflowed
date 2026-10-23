// the reader's view settings, per user (localStorage), applied to the page.
//
// What each setting drives, and whose mechanism it uses:
//   theme      the companion's `reading.setTheme` (a class on <html>: dark,
//              sepia, contrast; data-theme; key reflowtex-theme), which the
//              viewer's colour maps key off; 'system' is ours: it follows
//              prefers-color-scheme and sets the resolved theme through it.
//   zoom       the companion's `reading.setZoom` (--rtx-zoom on <html>, key
//              reflowtex-zoom); style.js applies it as CSS `zoom` on each
//              block element, whose own width then shrinks by the factor, so
//              the viewer lays the text out at column / (2 × zoom) pt: bigger
//              text, lines broken again.
//   width      the column in screen px (--col, which app.css's #page reads):
//              a preset or the slider; 'paper' is the document's \textwidth
//              (the viewer's source_width) × 2 px/pt × zoom, so the measure in
//              pt is the PDF's and so are the line breaks.
//   align      the viewer's --latex-align (justify | left) on <html>.
//   notes      own setting (notes.setHidden), shown here too.
//   handles    the hover gutter (+ and drag handle), a body class.
//   editLayout while a block is edited: 'side' (source beside its live
//              render when both fit; stacked otherwise), 'stacked', 'replace'
//              (the source replaces the render: the old behaviour).
// Everything else here is ours, in one JSON value under KEY.
export const KEY = 'rtx-editor.view';
export const PX_PER_PT = 2;                 // the viewer's ZOOM (engine/core.js): 1 pt = 2 CSS px at 100 %
export const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const WIDTHS = [
  { name: 'narrow', label: 'Narrow', px: 328, hint: 'a phone: 360 px less its margins' },
  { name: 'medium', label: 'Medium', px: 704, hint: 'the editor’s usual column' },
  { name: 'wide', label: 'Wide', px: 960 },
  { name: 'paper', label: 'Paper', hint: 'the document’s \\textwidth: the PDF’s line breaks' },
  { name: 'fit', label: 'Fit', hint: 'as wide as the window allows' },
];
export const SLIDER = { min: 280, max: 1600, step: 4 };
export const THEMES = [
  { name: 'system', label: 'System' }, { name: 'light', label: 'Light' }, { name: 'dark', label: 'Dark' },
  { name: 'sepia', label: 'Sepia' }, { name: 'contrast', label: 'Contrast' },
];
export const EDIT_LAYOUTS = [
  { name: 'side', label: 'Side by side', hint: 'source beside its live result (stacked when the window is too narrow)' },
  { name: 'stacked', label: 'Stacked', hint: 'the live result, the source below it' },
  { name: 'replace', label: 'Replace', hint: 'the source replaces the result while editing' },
];
// the document's \\textwidth by default; narrower windows and panes fit (view/index.js layout)
export const DEFAULTS = { theme: 'system', zoom: 1, width: 'paper', widthPx: 704, align: 'justify', handles: true, editLayout: 'stacked' };
/** Side by side and Replace are kept behind a debug switch (?layouts, or localStorage rtx-editor.layouts = 1):
 *  stacked is the layout (the user's decision). */
export const layoutsDebug = () => { try { return new URLSearchParams(location.search).has('layouts') || localStorage.getItem('rtx-editor.layouts') === '1'; } catch { return false; } };

const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: not kept */ } };

/** The saved settings, checked; the companion's own keys win for theme and zoom
 *  (the same reader's choice on another page of this origin). */
export function loadSettings() {
  let s = {};
  try { s = JSON.parse(load(KEY) || '{}') || {}; } catch { s = {}; }
  const out = { ...DEFAULTS };
  if (THEMES.some((t) => t.name === s.theme)) out.theme = s.theme;
  const z = parseFloat(load('reflowtex-zoom') ?? s.zoom);
  if (z > 0) out.zoom = Math.min(ZOOMS.at(-1), Math.max(ZOOMS[0], z));
  if (WIDTHS.some((w) => w.name === s.width) || s.width === 'custom') out.width = s.width;
  if (Number.isFinite(s.widthPx)) out.widthPx = Math.min(SLIDER.max, Math.max(SLIDER.min, s.widthPx));
  if (s.align === 'left' || s.align === 'justify') out.align = s.align;
  if (typeof s.handles === 'boolean') out.handles = s.handles;
  if (layoutsDebug() && EDIT_LAYOUTS.some((l) => l.name === s.editLayout)) out.editLayout = s.editLayout;
  return out;
}
export function saveSettings(s) {
  const { theme, zoom, width, widthPx, align, handles, editLayout } = s;
  save(KEY, JSON.stringify({ theme, zoom, width, widthPx, align, handles, editLayout }));
}

/** The next zoom step up (dir 1), down (-1), or 100 % (0). */
export function stepZoom(z, dir) {
  if (dir === 0) return 1;
  if (dir > 0) return ZOOMS.find((x) => x > z + 1e-6) ?? ZOOMS.at(-1);
  return [...ZOOMS].reverse().find((x) => x < z - 1e-6) ?? ZOOMS[0];
}

export const systemTheme = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; } };
export const resolveTheme = (t) => (t === 'system' ? systemTheme() : t);
