// The demo's theme choice: a module of its own, so the signal exists before any component reads it (no import-order
// or declaration-order dependency: main.ts once read it before its declaration ran, and the page was blank).
import { signal } from '@preact/signals';
import { setTheme as applyWbTheme, registerTheme, themes } from '../src/index.ts';

/** The theme switch: the registered themes (Light, Dark, Sepia, High contrast, any other) and System; remembered in
 *  this browser; ?theme= overrides it for one visit. The choice is applied through the workbench's themes. */
export const THEME = signal(document.documentElement.dataset.themeChoice ?? 'system');
export function setTheme(choice: string): void {
  try { localStorage.setItem('wb-demo-theme', choice); } catch { /* no storage */ }
  document.documentElement.dataset.themeChoice = choice;
  THEME.value = choice;
  applyTheme();
}
export function applyTheme() {
  const c = THEME.peek();
  const id = c === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : themes().some((t) => t.id === c) ? c : 'light';
  applyWbTheme(id);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
applyTheme();
Object.assign(globalThis, { demoThemes: { registerTheme, setTheme, themes } });

