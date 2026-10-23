// A DOCUMENT'S STATUS AS DATA: what a host shows of a document — the workbench in its
// tab pill (look f), VS Code in its status bar and the webview's crumb bar — without reading the top bar's texts.
// One per document (doc/results.js: results.status); no DOM.
//
//   const st = createDocStatus()
//   st.value                         signal: { typesetting: { done, total } | false, errors, unsaved }
//   st.typesetting(left, errors?)    the compile queue: `left` blocks still to typeset (0: all done), `errors` blocks
//                                    with errors when known. A run's total is the most it had left since it was idle,
//                                    so `done` counts up as blocks land ("Typesetting 3 of 10")
//   st.full() the next run (or the one going) typesets the whole document (an open, the
//                                    preamble changed, Recompile all): its bar is 'full'; any other run (a few blocks
//                                    after an edit) is a 'band' (the workbench's two progress forms)
//   st.unsaved(on)                   the store's writes failed (the standalone page autosaves: unsaved only then);
//                                    a VS Code host sets its dirty state here
//   st.reset()                       the document closed
import { signal, type ReadonlySignal } from '@preact/signals';

export type Bar = 'full' | 'band';
export interface DocStatus { typesetting: { done: number; total: number; bar: Bar } | false; errors: number; unsaved: boolean }
export interface DocStatusModel {
  readonly value: ReadonlySignal<DocStatus>;
  typesetting(left: number, errors?: number): void;
  unsaved(on: boolean): void;
  full(): void;
  reset(): void;
}

const IDLE: DocStatus = { typesetting: false, errors: 0, unsaved: false };

export function createDocStatus(): DocStatusModel {
  const value = signal<DocStatus>(IDLE);
  let total = 0, bar: Bar = 'band';
  const put = (next: DocStatus) => {
    const was = value.peek(), a = was.typesetting, b = next.typesetting;
    const same = was.errors === next.errors && was.unsaved === next.unsaved && (a === b || (!!a && !!b && a.done === b.done && a.total === b.total && a.bar === b.bar));
    if (!same) value.value = next;
  };
  return {
    value,
    typesetting(left, errors) {
      const cur = value.peek();
      if (left > 0) total = Math.max(total, left); else total = 0;
      put({ ...cur, typesetting: left > 0 ? { done: total - left, total, bar } : false, errors: errors ?? cur.errors });
      if (left <= 0) bar = 'band';            // the run is over: the next is an edit's, unless full() says otherwise
    },
    full() {
      bar = 'full';
      const t = value.peek().typesetting;
      if (t && t.bar !== 'full') put({ ...value.peek(), typesetting: { ...t, bar } });
    },
    unsaved(on) { put({ ...value.peek(), unsaved: on }); },
    reset() { total = 0; bar = 'band'; put(IDLE); },
  };
}
