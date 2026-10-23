// THE EDITOR'S COLOURS FROM THE THEME TOKENS: one source, the workbench's JSON themes
// (workbench/src/themes.ts: light, dark, sepia, high contrast, --rfed-* tokens). The editor's own colour
// variables (app.css's --text, --bg …, the kit's --ui-*, CodeMirror's --cm-*, the page's --latex-page-bg …) are
// aliases of the tokens, generated from the migration table (workbench/src/theme-map.ts); none of them is set per theme
// any more. Their cleanup (the editor's CSS on the --rfed-* names, the aliases gone) can follow.
//
//   THEME_CSS          the aliases and the derived tokens, in the page once this module loads (ensureThemeStyles)
//   applyTheme(name)   the View options' theme ('light' | 'dark' | 'sepia' | 'contrast') applied: its tokens on <html>
//   THEME_OF           the View options' names -> the workbench's theme ids
//
// Not colours, not aliased: the shadows (--shadow, --ui-shadow-*: their own per-theme values stay in the editor's CSS).
import { EDITOR_VARIABLES } from '../../../workbench/src/theme-map.ts';
import { DERIVED_TOKENS_CSS } from '../../../workbench/src/kit/css.ts';
import { setTheme, currentTheme } from '../../../workbench/src/themes.ts';

const SHADOW = /^--rfed-shadow-/;
export const ALIASES: readonly { css: string; to: string }[] = EDITOR_VARIABLES.filter((v) => !SHADOW.test(v.to)).map((v) => ({ css: v.css, to: v.to }));
export const THEME_CSS = `${DERIVED_TOKENS_CSS}
/* the editor's colour variables: aliases of the theme tokens (app/src/design/theme.ts, from workbench/src/theme-map.ts) */
:root { ${ALIASES.map((a) => `${a.css}: var(${a.to});`).join(' ')} }`;

export type ViewTheme = 'light' | 'dark' | 'sepia' | 'contrast';
export const THEME_OF: Record<ViewTheme, string> = { light: 'light', dark: 'dark', sepia: 'sepia', contrast: 'hc' };
/** the View options' theme applied to the page: the workbench's theme of that name (its tokens on <html>, the classes) */
export function applyTheme(name: string): boolean {
  const id = THEME_OF[name as ViewTheme] ?? name;
  if (currentTheme() === id && document.documentElement.dataset.wbTheme === id) return true;
  return setTheme(id);
}

/** the aliases in the page (once), before any colour is read: view/index.js imports this module at the page's start */
export function ensureThemeStyles(doc: Document = document): void {
  if (doc.getElementById('rtx-theme-css')) return;
  const st = doc.createElement('style');
  st.id = 'rtx-theme-css';
  st.textContent = THEME_CSS;
  doc.head.append(st);
}
if (typeof document !== 'undefined') ensureThemeStyles();
