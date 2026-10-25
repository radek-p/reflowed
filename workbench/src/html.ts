// htm bound to Preact, and the styles: the base colours before a theme (themes.ts), the kit's CSS and ours. The editor's
// kit core still supplies the metrics (--ui-text-*, --ui-r-*, the motion and the shadows: not theme tokens). With the
// styles, the platform's kind of scrollbars (scrollbars.ts): css.ts styles classic ones, elsewhere the workbench draws its own (overlay-scrollbar.ts).
import { h, render } from 'preact';
import htm from 'htm';
import '../../app/src/design/ui/core.js';
import CSS from './css.ts';
import KIT_CSS from './kit/css.ts';
import { THEME_DEFAULTS_CSS } from './themes.ts';
import { watchScrollbars } from './scrollbars.ts';

export const html = htm.bind(h);
export { h, render };
export function ensureWorkbenchStyles(doc: Document = document): void {
  if (doc.getElementById('wb-css')) return;
  const s = doc.createElement('style');
  s.id = 'wb-css';
  s.textContent = `${THEME_DEFAULTS_CSS}\n${KIT_CSS}\n${CSS}`;
  doc.head.append(s);
  watchScrollbars(doc);
}
if (typeof document !== 'undefined') ensureWorkbenchStyles();
