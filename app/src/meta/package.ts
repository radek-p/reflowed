// The text of tex/reflowed-meta.sty for exports. The app's entry registers it (main.js imports
// the .sty as text; the build's loader); Node callers (tests) pass the file's text themselves.
export const PACKAGE_FILE = 'reflowed-meta.sty';
let text = '';
export function setMetaPackage(t: string): void { text = t; }
export const metaPackage = (): string => text;
