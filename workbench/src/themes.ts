// Colour themes, as VS Code's: a theme is JSON, { id, label, type: 'light' | 'dark' | 'hc', colors: { token: colour },
// extends? }. Every colour of the workbench comes from these tokens (CSS custom properties; the components hold no
// literal colours: tests/arch.test.ts). One scheme: every colour token is --rfed-<role> (the base) or
// --rfed-<part>-<state>-<ink | bg | border> (a part), its JSON key VS Code's form; the editor's variables map onto them
// (theme-map.ts: the migration table).
//   registerTheme(json) → { ok, errors }    setTheme(id[, el])    themes()    resolveTheme(id)    onTheme(f)
// This file and the built-in themes below are the only place literal colours live.

/** token → { css: the custom property, about: what it colours } */
export const TOKENS = {
  // the base: the few roles everything else derives from (the scheme). VS Code's own names where it has one
  'foreground': { css: '--rfed-ink', about: 'text and icons' },
  'descriptionForeground': { css: '--rfed-ink-3', about: 'hints and placeholders' },
  'pageBackground': { css: '--rfed-page', about: 'the page: documents, panels, the ground under the glass bars' },
  'surfaceBackground': { css: '--rfed-surface', about: 'menus, popovers, tooltips' },
  'accent': { css: '--rfed-accent', about: 'the accent: drop zones, insertion bars, the dragged splitter' },
  'errorForeground': { css: '--rfed-danger', about: 'errors' },
  'warningForeground': { css: '--rfed-warn', about: 'warnings' },
  'successForeground': { css: '--rfed-success', about: 'a good state (the success fill)' },
  'frameBorder': { css: '--rfed-border', about: 'frames' },
  'softBorder': { css: '--rfed-border-soft', about: 'separators, strip lines' },
  'strongBorder': { css: '--rfed-border-strong', about: 'inputs, a splitter\'s handle' },
  'hoverBackground': { css: '--rfed-hover', about: 'a hovered control\'s ground (the one hover: the editor\'s --hover maps here)' },
  'pressBackground': { css: '--rfed-press', about: 'a pressed control\'s ground' },
  'selectedBackground': { css: '--rfed-selected', about: 'a selected tab or segment (the editor\'s --tab-on maps here)' },
  'focusBorder': { css: '--rfed-focus', about: 'the focus ring of tabs and controls (one ring: the kit\'s ringColor merged in)' },
  // the parts: <part>.<state><Property> → --rfed-<part>-<state>-<ink | bg | border>
  'button.foreground': { css: '--rfed-button-ink', about: 'text on the accent' },
  'button.border': { css: '--rfed-button-border', about: 'a pill button\'s frame' },
  'sideBar.background': { css: '--rfed-sidebar-bg', about: 'the side columns\' ground' },
  'tab.nameForeground': { css: '--rfed-tab-name-ink', about: 'a tab\'s document name (active)' },
  'tab.inactiveForeground': { css: '--rfed-tab-inactive-ink', about: 'an inactive tab\'s name' },
  'tab.activeSectionForeground': { css: '--rfed-tab-active-section-ink', about: 'the active tab\'s section (never above the name)' },
  'tab.sectionForeground': { css: '--rfed-tab-section-ink', about: 'an inactive tab\'s section' },
  'tab.activeBackground': { css: '--rfed-tab-active-bg', about: 'the active tab\'s ground' },
  'tab.activeForeground': { css: '--rfed-tab-active-ink', about: 'the active tab\'s ink' },
  'tab.activeBorder': { css: '--rfed-tab-active-border', about: 'the active tab\'s ring (high contrast)' },
  'tab.unfocusedActiveBackground': { css: '--rfed-tab-unfocused-active-bg', about: 'the active tab of a group that is not focused' },
  'tab.hoverBackground': { css: '--rfed-tab-hover-bg', about: 'a hovered tab\'s ground' },
  'tab.errorBackground': { css: '--rfed-tab-error-bg', about: 'the tab status: the tint of a tab whose document has errors (its text kept ≥ 4.5:1)' },
  'tab.errorBandBackground': { css: '--rfed-tab-error-band-bg', about: 'the tab status: the error band along a pill\'s bottom (an inactive tab; the active one settles to it)' },
  'tabStrip.background': { css: '--rfed-tab-strip-bg', about: 'the tab rows\' glass (translucent over the content)' },
  'tabStrip.border': { css: '--rfed-tab-strip-border', about: 'the line under a tab row' },
  'topBar.background': { css: '--rfed-top-bar-bg', about: 'the top bar\'s glass' },
  'topBar.border': { css: '--rfed-top-bar-border', about: 'the line under the top bar' },
  'wordmark.iconForeground': { css: '--rfed-wordmark-icon-ink', about: 'the host\'s wordmark icon (WORDMARK.md): subdued, a step lighter than the section\'s ink (default the ink at 64 %; high contrast #3d3d3d); the plain ε ≥ 3:1 against the bar' },
  'splitter.border': { css: '--rfed-splitter-border', about: 'the line between groups (the editor\'s sidebar edge)' },
  'splitter.activeBorder': { css: '--rfed-splitter-active-border', about: 'a hovered or dragged splitter' },
  'panel.border': { css: '--rfed-panel-border', about: 'a sliding side column\'s edge (every splitter line, the columns\' too, is splitter.border)' },
  'dropZone.background': { css: '--rfed-drop-zone-bg', about: 'a drop zone\'s ground' },
  'dropZone.border': { css: '--rfed-drop-zone-border', about: 'a drop zone\'s edge' },
  'dragInsert.foreground': { css: '--rfed-drag-insert-ink', about: 'the insertion bar while dragging' },
  // the editor's parts (the theme map's tokens to add): its blocks, its block editor
  // (CodeMirror: code.*), the typeset page (paper.*), toasts, counts, chips; the editor's variables are aliases of these
  'editor.faintBackground': { css: '--rfed-editor-faint-bg', about: 'faint grounds (a figure\'s placeholder, a disabled field)' },
  'editor.errorBackground': { css: '--rfed-editor-error-bg', about: 'a failed block\'s ground' },
  'editor.background': { css: '--rfed-editor-bg', about: 'the block editor\'s ground (CodeMirror)' },
  'sideBar.foreground': { css: '--rfed-sidebar-ink', about: 'the sidebar\'s text' },
  'editor.selectionBackground': { css: '--rfed-editor-selection-bg', about: 'a selected block' },
  'editor.selectionSoftBackground': { css: '--rfed-editor-selection-soft-bg', about: 'the block a hovered handle moves (issue 133)' },
  'editor.findMatchBackground': { css: '--rfed-editor-find-match-bg', about: 'a find match' },
  'findWidget.background': { css: '--rfed-find-widget-bg', about: 'the find bar\'s glass' },
  'editor.ghostForeground': { css: '--rfed-editor-ghost-ink', about: 'an empty block\'s placeholder' },
  'editor.faintForeground': { css: '--rfed-editor-faint-ink', about: 'faint text (counts, dividers\' labels)' },
  'editor.softForeground': { css: '--rfed-editor-soft-ink', about: 'soft text (captions)' },
  'editorGutter.foreground': { css: '--rfed-editor-gutter-ink', about: 'the block handles\' gutter' },
  'editorGutter.hoverForeground': { css: '--rfed-editor-gutter-hover-ink', about: 'a hovered handle' },
  'chip.background': { css: '--rfed-chip-bg', about: 'chips (the reference chips, the title form)' },
  'notification.background': { css: '--rfed-notification-bg', about: 'toasts' },
  'notification.foreground': { css: '--rfed-notification-ink', about: 'toasts\' text' },
  'wordmark.tileForeground': { css: '--rfed-wordmark-tile-ink', about: 'the ε on the tile: a cut-out in the workbench\'s placeholder (WORDMARK.md: one colour); a token only if the icon gets a second colour' },
  'editor.errorBorder': { css: '--rfed-editor-error-border', about: 'a failed block\'s line' },
  'badge.background': { css: '--rfed-badge-bg', about: 'counts (Problems, TODOs)' },
  'badge.foreground': { css: '--rfed-badge-ink', about: 'counts\' text' },
  'modal.backdropBackground': { css: '--rfed-modal-backdrop-bg', about: 'a modal\'s backdrop' },
  'code.keywordForeground': { css: '--rfed-code-keyword-ink', about: 'a TeX command' },
  'code.atomForeground': { css: '--rfed-code-atom-ink', about: 'an environment name' },
  'code.bracketForeground': { css: '--rfed-code-bracket-ink', about: 'braces' },
  'code.commentForeground': { css: '--rfed-code-comment-ink', about: 'comments' },
  'code.numberForeground': { css: '--rfed-code-number-ink', about: 'numbers, lengths' },
  'code.mathForeground': { css: '--rfed-code-math-ink', about: 'math' },
  'code.errorForeground': { css: '--rfed-code-error-ink', about: 'an error mark' },
  'paper.foreground': { css: '--rfed-paper-ink', about: 'the typeset text\'s ink (the group is paper: page is the UI\'s ground)' },
  'paper.background': { css: '--rfed-paper-bg', about: 'the page\'s colour (a white page in a dark theme is a choice: INTEGRATION-PLAN Q7)' },
  'paper.linkForeground': { css: '--rfed-paper-link-ink', about: 'links' },
  'paper.linkHoverForeground': { css: '--rfed-paper-link-hover-ink', about: 'a hovered link' },
} as const satisfies Record<string, { css: string; about: string }>;
export type Token = keyof typeof TOKENS;
export type ThemeType = 'light' | 'dark' | 'hc';
export type Colors = { [K in Token]?: string };
/** A theme as JSON (VS Code's form): its colours by token; `extends` a registered theme's id. */
export type ThemeJson = { id: string; label?: string; type: ThemeType; colors?: Colors; extends?: string | null };
/** A registered theme: its own colours (resolveTheme merges its base's in). */
export type Theme = { id: string; label: string; type: ThemeType; extends: string | null; colors: Colors };
export type ThemeEvent = { kind: 'register' | 'apply'; id: string };
const isToken = (k: string): k is Token => Object.hasOwn(TOKENS, k);
const TYPES: readonly string[] = ['light', 'dark', 'hc'];

// the editor's own colours (app.css :root, app/src/view/style.js html.dark / .sepia / .contrast), not new ones
type EditorColours = { page: string; ink: string; muted: string; accent: string; danger: string; warn: string; ok: string; surface: string; edge: string };
const EDITOR: Record<'light' | 'dark' | 'sepia' | 'contrast', EditorColours> = {
  light: { page: '#ffffff', ink: '#2f2e2b', muted: '#9b9a97', accent: '#2383e2', danger: '#d44c47', warn: '#b7791f', ok: '#2e9e5b', surface: '#ffffff', edge: 'rgba(55, 53, 47, 0.07)' },
  dark: { page: '#191919', ink: '#e6e4df', muted: '#8e8c87', accent: '#4a9ff0', danger: '#ff7b72', warn: '#e3b341', ok: '#3fb950', surface: '#252524', edge: 'rgba(255, 255, 255, 0.08)' },
  sepia: { page: '#f4ecd8', ink: '#453a26', muted: '#8c7c5c', accent: '#9a5b13', danger: '#b3261e', warn: '#b7791f', ok: '#3d6b36', surface: '#faf4e6', edge: 'rgba(69, 58, 38, 0.1)' },
  contrast: { page: '#ffffff', ink: '#000000', muted: '#3d3d3d', accent: '#0040c0', danger: '#b00020', warn: '#8a3b00', ok: '#005c2e', surface: '#ffffff', edge: '#000000' },
};
// them here, the one source; a theme without a value has none, as the editor's CSS had none)
const PARTS: Record<'light' | 'dark' | 'sepia' | 'hc', Colors> = {
  light: { 'editor.faintBackground': '#e9e9e7', 'editor.errorBackground': '#fdf1f0', 'editor.background': '#f7f7f5', 'sideBar.foreground': '#5f5e5b', 'editor.selectionBackground': 'rgba(35, 131, 226, 0.09)', 'editor.selectionSoftBackground': 'rgba(35, 131, 226, 0.045)', 'editor.findMatchBackground': 'rgba(255, 212, 0, 0.45)', 'findWidget.background': 'rgba(255, 255, 255, 0.95)', 'editor.ghostForeground': '#55534e', 'editor.faintForeground': '#c7c6c3', 'editor.softForeground': '#8b8a86', 'editorGutter.foreground': '#b3b2ae', 'editorGutter.hoverForeground': '#6f6e69', 'chip.background': '#fff', 'notification.background': '#2f2e2b', 'notification.foreground': '#fff', 'wordmark.tileForeground': '#fff', 'editor.errorBorder': '#b0605c', 'badge.background': '#f1f1ef', 'badge.foreground': '#787774', 'modal.backdropBackground': 'color-mix(in srgb, #000 18%, transparent)', 'code.keywordForeground': '#3558a8', 'code.atomForeground': '#8a3ea3', 'code.bracketForeground': '#8a8a86', 'code.commentForeground': '#9b9a97', 'code.numberForeground': '#b35c00', 'code.mathForeground': '#1d7a55', 'code.errorForeground': '#d44c47', 'paper.foreground': '#000', 'paper.background': '#fff', 'paper.linkForeground': '#2f6fb3' },
  dark: { 'editor.faintBackground': '#2f2f2e', 'editor.errorBackground': '#3a2020', 'editor.background': '#232322', 'sideBar.foreground': '#b5b3ad', 'editor.selectionBackground': 'rgba(74, 159, 240, 0.2)', 'editor.selectionSoftBackground': 'rgba(74, 159, 240, 0.1)', 'editor.findMatchBackground': 'rgba(227, 179, 65, 0.4)', 'findWidget.background': 'rgba(25, 25, 25, 0.95)', 'editor.ghostForeground': '#c9c7c1', 'editor.faintForeground': '#5f5e5a', 'editor.softForeground': '#9a9893', 'editorGutter.foreground': '#6f6d68', 'editorGutter.hoverForeground': '#c9c7c1', 'chip.background': '#252524', 'notification.background': '#3a3a38', 'notification.foreground': '#f1f0ec', 'wordmark.tileForeground': '#191919', 'editor.errorBorder': '#ff9d96', 'badge.background': '#2f2f2e', 'badge.foreground': '#a9a7a1', 'modal.backdropBackground': 'color-mix(in srgb, #000 45%, transparent)', 'code.keywordForeground': '#86a8f0', 'code.atomForeground': '#d2a8ff', 'code.bracketForeground': '#8e8c87', 'code.commentForeground': '#8e8c87', 'code.numberForeground': '#f0a35e', 'code.mathForeground': '#6fd0a0', 'code.errorForeground': '#ff7b72', 'paper.foreground': '#e6e4df', 'paper.background': '#191919', 'paper.linkForeground': '#79b8ff', 'paper.linkHoverForeground': '#a5d0ff' },
  sepia: { 'editor.faintBackground': '#e3d7ba', 'editor.errorBackground': '#f5dccf', 'editor.background': '#ece2c9', 'sideBar.foreground': '#5d5038', 'editor.selectionBackground': 'rgba(154, 91, 19, 0.13)', 'editor.selectionSoftBackground': 'rgba(154, 91, 19, 0.065)', 'editor.findMatchBackground': 'rgba(214, 160, 40, 0.4)', 'findWidget.background': 'rgba(244, 236, 216, 0.95)', 'editor.ghostForeground': '#5d5038', 'editor.faintForeground': '#b5a684', 'editor.softForeground': '#8c7c5c', 'editorGutter.foreground': '#b5a684', 'editorGutter.hoverForeground': '#5d5038', 'chip.background': '#faf4e6', 'notification.background': '#453a26', 'notification.foreground': '#f4ecd8', 'wordmark.tileForeground': '#f4ecd8', 'editor.errorBorder': '#b0605c', 'badge.background': '#e8dcc0', 'badge.foreground': '#6d5f44', 'modal.backdropBackground': 'color-mix(in srgb, #000 18%, transparent)', 'code.keywordForeground': '#6a4a8c', 'code.atomForeground': '#8a3e6e', 'code.bracketForeground': '#8c7c5c', 'code.commentForeground': '#8c7c5c', 'code.numberForeground': '#a0520d', 'code.mathForeground': '#3d6b36', 'code.errorForeground': '#d44c47', 'paper.foreground': '#453a26', 'paper.background': '#f4ecd8', 'paper.linkForeground': '#155e97' },
  hc: { 'editor.faintBackground': '#767676', 'editor.errorBackground': '#fff0f0', 'editor.background': '#f2f2f2', 'sideBar.foreground': '#000', 'editor.selectionBackground': 'rgba(0, 64, 192, 0.16)', 'editor.selectionSoftBackground': 'rgba(0, 64, 192, 0.08)', 'editor.findMatchBackground': 'rgba(255, 200, 0, 0.6)', 'findWidget.background': '#fff', 'editor.ghostForeground': '#000', 'editor.faintForeground': '#595959', 'editor.softForeground': '#3d3d3d', 'editorGutter.foreground': '#3d3d3d', 'editorGutter.hoverForeground': '#000', 'chip.background': '#fff', 'notification.background': '#000', 'notification.foreground': '#fff', 'wordmark.tileForeground': '#fff', 'editor.errorBorder': '#b00020', 'badge.background': '#fff', 'badge.foreground': '#000', 'modal.backdropBackground': 'color-mix(in srgb, #000 18%, transparent)', 'code.keywordForeground': '#0033a0', 'code.atomForeground': '#6a0080', 'code.bracketForeground': '#3d3d3d', 'code.commentForeground': '#3d3d3d', 'code.numberForeground': '#8a3b00', 'code.mathForeground': '#005c2e', 'code.errorForeground': '#b00020', 'paper.foreground': '#000', 'paper.background': '#fff', 'paper.linkForeground': '#0033a0' },
};
const base = (e: EditorColours): Colors => ({ 'pageBackground': e.page, 'foreground': e.ink, 'descriptionForeground': e.muted, 'accent': e.accent, 'errorForeground': e.danger, 'warningForeground': e.warn, 'successForeground': e.ok, 'surfaceBackground': e.surface,
  'splitter.border': e.edge, 'panel.border': e.edge, 'topBar.border': e.edge, 'tabStrip.border': e.edge });
export const BUILTIN: readonly ThemeJson[] = [
  { id: 'light', label: 'Light', type: 'light', colors: { ...base(EDITOR.light), ...PARTS.light } },
  { id: 'dark', label: 'Dark', type: 'dark', colors: { ...base(EDITOR.dark), ...PARTS.dark } },
  { id: 'sepia', label: 'Sepia', type: 'light', colors: { ...base(EDITOR.sepia), ...PARTS.sepia, 'tab.errorBackground': 'rgba(179, 38, 30, 0.055)', 'wordmark.iconForeground': '#7b715d' } },     // (its section ink leaves less room: 4.5:1 kept; the icon ink the ink at ~68 %: 3:1 kept)
  // high contrast: no translucency (the bars solid), strong borders, a ring on the active tab, the kit's contrast ring
  { id: 'hc', label: 'High contrast', type: 'hc', colors: { ...base(EDITOR.contrast), ...PARTS.hc,
    'frameBorder': '#000000', 'softBorder': '#767676', 'strongBorder': '#000000', 'focusBorder': '#0040c0',
    'tab.nameForeground': '#000000', 'tab.inactiveForeground': '#000000', 'tab.activeSectionForeground': '#1f1f1f', 'tab.sectionForeground': '#3d3d3d', 'wordmark.iconForeground': '#3d3d3d',
    'tab.activeBackground': 'rgba(0, 0, 0, 0.12)', 'tab.activeBorder': '#000000', 'tab.unfocusedActiveBackground': 'rgba(0, 0, 0, 0.06)',
    'tabStrip.background': '#ffffff', 'topBar.background': '#ffffff', 'splitter.activeBorder': '#0040c0',
    'dropZone.background': 'rgba(0, 64, 192, 0.12)', 'dropZone.border': '#0040c0', 'dragInsert.foreground': '#0040c0' } },
];

const registry = new Map<string, Theme>();
const listeners = new Set<(e: ThemeEvent) => void>();
let current: string | null = null, applied: string[] = [];
// a browser asks CSS; elsewhere (node: the unit tests) the forms CSS takes
const COLOUR = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color|color-mix)\(.*\)|transparent|currentcolor|[a-z]+)$/i;
const isColour = (v: unknown): v is string => typeof v === 'string' && (typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('color', v) : COLOUR.test(v.trim()));
/** Register (or replace) a theme from JSON (an object or a string). Unknown tokens and bad values are reported and skipped. */
export function registerTheme(json: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown = json;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`not JSON: ${(e as Error).message}`] }; } }
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['a theme is an object'] };
  const t = raw as { id?: unknown; label?: unknown; type?: unknown; colors?: unknown; extends?: unknown };
  if (!t.id || typeof t.id !== 'string') errors.push('a theme needs an id');
  if (!TYPES.includes(t.type as string)) errors.push(`type must be light, dark or hc (got ${JSON.stringify(t.type)})`);
  const ext = typeof t.extends === 'string' ? t.extends : null;
  if (t.extends && !(ext && registry.has(ext))) errors.push(`extends an unknown theme "${String(t.extends)}"`);
  const colors: Colors = {};
  for (const [k, v] of Object.entries((t.colors ?? {}) as Record<string, unknown>)) {
    if (!isToken(k)) errors.push(`unknown token "${k}"`);
    else if (!isColour(v)) errors.push(`"${k}": not a colour (${JSON.stringify(v)})`);
    else colors[k] = v;
  }
  if (!t.id || typeof t.id !== 'string' || !TYPES.includes(t.type as string)) return { ok: false, errors };
  registry.set(t.id, { id: t.id, label: typeof t.label === 'string' ? t.label : t.id, type: t.type as ThemeType, extends: ext && registry.has(ext) ? ext : null, colors });
  if (errors.length && typeof console !== 'undefined') console.warn(`workbench theme "${t.id}":`, errors.join('; '));
  for (const f of listeners) f({ kind: 'register', id: t.id });
  return { ok: errors.length === 0, errors };
}
/** What a theme of each type has unless it says otherwise (the colours that differ by type, not by theme). */
const TYPE_COLORS: Record<ThemeType, Colors> = {
  light: { 'button.foreground': '#ffffff' },
  dark: { 'button.foreground': '#0d1b2a' },
  hc: { 'button.foreground': '#ffffff', 'button.border': '#000000' },
};
/** The base tokens before any theme is applied (a host that never calls setTheme): the light theme's, at the lowest
 *  priority (:where), so a theme on <html> and the derived defaults (css.ts, kit/css.ts) win. ensureWorkbenchStyles
 *  puts it first. */
export const THEME_DEFAULTS_CSS = `:where(:root) { ${(['foreground', 'descriptionForeground', 'pageBackground', 'surfaceBackground', 'accent', 'errorForeground', 'warningForeground', 'successForeground'] as const)
  .map((k) => `${TOKENS[k].css}: ${BUILTIN[0]!.colors![k]};`).join(' ')} }`;
/** The theme with its base themes merged in (its type's colours first, then the base, the theme's own colours over them). */
export function resolveTheme(id: string): Theme | null {
  const t = registry.get(id);
  if (!t) return null;
  const chain: Theme[] = [];
  for (let x: Theme | undefined = t, seen = new Set<string>(); x && !seen.has(x.id); x = x.extends ? registry.get(x.extends) : undefined) { seen.add(x.id); chain.unshift(x); }
  return { ...t, colors: Object.assign({}, TYPE_COLORS[t.type], ...chain.map((x) => x.colors)) };
}
export const themes = (): { id: string; label: string; type: ThemeType }[] => [...registry.values()].map(({ id, label, type }) => ({ id, label, type }));
export const currentTheme = (): string | null => current;
export function onTheme(f: (e: ThemeEvent) => void): () => boolean { listeners.add(f); return () => listeners.delete(f); }
/** Apply a theme to the document (its custom properties on <html>; the classes the editor uses: dark, sepia, contrast;
 *  on <html>: its ground and <meta name="theme-color"> the theme's page colour). */
export function setTheme(id: string, el: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): boolean {
  const t = resolveTheme(id);
  if (!t || !el) return false;
  for (const p of applied) el.style.removeProperty(p);
  applied = [];
  for (const [k, v] of Object.entries(t.colors)) { if (!isToken(k) || v == null) continue; el.style.setProperty(TOKENS[k].css, v); applied.push(TOKENS[k].css); }
  el.classList.toggle('dark', t.type === 'dark');
  el.classList.toggle('contrast', t.type === 'hc');
  el.classList.toggle('sepia', id === 'sepia' || t.extends === 'sepia');
  el.dataset.wbTheme = id;
  el.dataset.wbThemeType = t.type;
  el.style.colorScheme = t.type === 'dark' ? 'dark' : 'light';
  // the page's own ground and the browser's colour for it, as plain values (never a variable on <html>,
  // ): the canvas shows in overscroll and around the page (the notch, the home indicator, under
  // Safari's bars), and theme-color tints the browser's bars; index.html's head sets both for the first frame
  if (el === el.ownerDocument?.documentElement) {
    const page = t.colors.pageBackground ?? null;
    el.style.backgroundColor = page ?? '';
    const doc = el.ownerDocument;
    let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta && page) { meta = doc.createElement('meta'); meta.name = 'theme-color'; doc.head?.append(meta); }
    if (meta && page) meta.content = page;
  }
  current = id;
  for (const f of listeners) f({ kind: 'apply', id });
  return true;
}
for (const t of BUILTIN) registerTheme(t);
