// The UI's own state per drawn workbench (ui.ts Workbench makes one and provides it): what the components share that
// is not the store's (the UI never writes fields on the store). Its window bar and the left column's status bar
// (the host's), which group was focused when the latest press began (a press on an unfocused group's active tab only
// focuses it: ui.ts Tab), and the strips that decide their one- or two-line form together (ui.ts useHybridForm).
import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { BarSpec } from './workbench.ts';

export type Form = 'one' | 'two';
/** A strip in the strip-row registry: its own wish (one or two lines), the form to take, its tabs' box. */
export type StripEntry = { own(): Form | null; apply(f: Form): void; box(): HTMLElement | null };
export type UiState = {
  bar: BarSpec | null;
  sideStatus: (() => ComponentChildren) | null;
  pressGroup: string | null;
  strips: Map<string, StripEntry>;
};
export const newUiState = (): UiState => ({ bar: null, sideStatus: null, pressGroup: null, strips: new Map() });
export const UiContext = createContext<UiState>(newUiState());
export const useUi = (): UiState => useContext(UiContext);
