// The editor's state as signals ("one way to communicate: state is signals, change is
// commands"): what the app's modules used to follow through DOM CustomEvents. Each signal has one writer, named
// below; any number of readers. A signal carries its current value, so a module that subscribes late is safe.
//
// ONE PER EDITOR CONTAINER (app/editor-root.ts: root.state), not one per page: two editors on a page have
// their own current document, results shown, refreshes, width changes and section focus. Only the route is the
// page's: the standalone page's URL (one per page, main.js); an embedded editor has none.
// Tests still wait on DOM events: main.js dispatches them, in one place, from the standalone editor's signals and
// the route (dispatchForTests).
//
//   root.state.current      { doc }: the container's current document, the focused pane's (app/workspace.js)  ↔ editor:current
//   root.state.displayed    { n, id }: a block's result shown, in any pane of any document (panes/blocks.js)  ↔ editor:displayed
//   root.state.refreshed    { n }: an editor refreshed its refs and panels (app/app.js)                        ↔ editor:refreshed
//   root.state.widths       { moving }: the panes' widths are changing (panes/widths.js)
//   root.state.sectionFocus { n, pane, id }: a pane's section focus changed (docview/focus.js, close-split.js)
//   root.state.words        the current document's word count signal (doc/results.js: app/panels.ts shows it)
//   root.state.preambleErrors  the current document's preamble problems signal (doc/results.js: app/app.js shows it)
//   root.state.panels the current document's side panels' host (app/panels.ts: app/app.js activate())
//   page.route              { name: 'doc', id } | { name: 'home' }: the route as opened (main.js)          ↔ editor:route
//
//   createEditorState()     a container's signals (editor-root.ts makes them)
//   bump(sig, detail)       a new value of a counting signal: { n: n + 1, ...detail }
//   onChange(sig, fn)       fn(value) on every change after now (not with the current value) -> unsubscribe
//   next(sig) -> Promise    the next change
import { signal, type Signal, type ReadonlySignal } from '@preact/signals';
import type { PanelHost } from './panel-host.ts';

export type Route = { name: 'doc'; id: string } | { name: 'home' };
export interface Counted { n: number }
export interface Displayed extends Counted { id: string | null }
export interface SectionFocus extends Counted { pane: string | null; id: string | null }
export interface WordCount { words: number; blocks: number; inline: number; displays: number; characters: number }
export interface PreambleError { line?: number; message: string }

export interface EditorState {
  readonly current: Signal<{ doc: string | null }>;
  readonly displayed: Signal<Displayed>;
  readonly refreshed: Signal<Counted>;
  readonly widths: Signal<{ moving: boolean }>;
  readonly sectionFocus: Signal<SectionFocus>;
  /** the current document's word count (its DocSession's signal), or null */
  readonly words: Signal<ReadonlySignal<WordCount | null> | null>;
  /** the current document's preamble problems (its DocSession's signal), or null */
  readonly preambleErrors: Signal<ReadonlySignal<PreambleError[]> | null>;
  /** the current document's side panels' host (app/panels.ts): what the container's panels follow */
  readonly panels: Signal<PanelHost | null>;
}

export function createEditorState(): EditorState {
  return {
    current: signal({ doc: null }),
    displayed: signal({ n: 0, id: null }),
    refreshed: signal({ n: 0 }),
    widths: signal({ moving: false }),
    sectionFocus: signal({ n: 0, pane: null, id: null }),
    words: signal(null),
    preambleErrors: signal(null),
    panels: signal(null),
  };
}

/** the page's own: the standalone page's route */
export const page = {
  route: signal<Route>({ name: 'home' }),
};

export function bump<T extends Counted>(sig: Signal<T>, detail: Omit<T, 'n'>): void;
export function bump(sig: Signal<Counted>): void;
export function bump<T extends Counted>(sig: Signal<T>, detail: Partial<T> = {}): void {
  sig.value = { ...sig.peek(), ...detail, n: (sig.peek()?.n ?? 0) + 1 };
}

export function onChange<T>(sig: ReadonlySignal<T>, fn: (v: T) => void): () => void {
  let first = true;
  return sig.subscribe((v) => { if (first) { first = false; return; } fn(v); });
}

export function next<T>(sig: ReadonlySignal<T>): Promise<T> { return new Promise((r) => { const off = onChange(sig, (v) => { off(); r(v); }); }); }

/** main.js: the DOM events tests wait on, from the standalone editor's signals and the route (the one place they are dispatched) */
export function dispatchForTests(state: EditorState, doc: Pick<Document, 'dispatchEvent'> = document): () => void {
  const fire = (type: string, detail: object) => doc.dispatchEvent(new CustomEvent(type, { detail }));
  const offs = [
    onChange(page.route, (r) => fire('editor:route', r)),
    onChange(state.current, (c) => fire('editor:current', c)),
    onChange(state.displayed, (d) => fire('editor:displayed', { id: d.id })),
    onChange(state.refreshed, () => fire('editor:refreshed', {})),
  ];
  return () => { for (const off of offs) off(); };
}
