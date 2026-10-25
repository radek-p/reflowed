// @ts-check
// One document's undo history, as DATA (one history per document, shared by its panes;
// no folding; every undo and redo reveals the change). No DOM, no closures in the stack: tests/test-doc-units.ts.
//
// A step is a plain object, `{ type, label, doc, ...tags }`, one of
//   { type: 'text', block, pane, changes, inverse, before, after, event, time }   a change typed in a block's code
//       editor (one of CodeMirror's typing groups: adjacent typing within 500 ms): changes/inverse are CodeMirror
//       ChangeSets as JSON (doc/text-step.js), before/after the selections { anchor, head } around it
//   { type: 'doc', before, after, focus }   a structural change (insert, delete, split, merge, move, duplicate,
//       setSource, a nesting change, a replace, the preamble or the bibliography): before/after are the parts of the
//       document it changed, { order: [block ids] | null, blocks: { id: block record | null }, meta: { field: value } }
//       (doc/ops.js diffs them, restores either side)
//   { type: 'asset', asset, before, after }   a figure's drawing (svgfig: the file's bytes and rendition)
// What a step means is the appliers': history.define(type, (step, how) => bool) — the session's ops for 'doc', the
// page for 'text' (through the block's editor, else the model), svgfig for 'asset'.
//
//   const history = createHistory({ limit, before, after })
//     history.onRecord(fn)                         fn(step) for each step done now, before it is stacked (the page
//                                                  tags it with the pane it was made in: edit/undo.js)
//     history.define(type, apply)                  apply(step, 'undo' | 'redo'): false when it cannot (the step goes)
//     history.record(step) -> step                 a step done now goes on the undo stack; the redo stack is emptied
//     history.extend(step, merge) -> bool          the top step merged with a new one (merge(top) -> top'), if it is
//                                                  still the top and nothing was undone since: CodeMirror's grouping
//     history.undo() -> step | null                before(step, 'undo') first (the editors close or the block's opens)
//     history.redo() -> step | null
//     history.top() · history.drop(pred) · history.labels() · history.steps() (oldest first, tests) · history.clear()
//     history.forget(pred)                         every step pred names goes, undo and redo (a block changed in another
//                                                  tab: its typing steps no longer fit its text) -> how many
//     history.canUndo() · history.canRedo()

/** @param {{ limit?: number, before?: (step: any, how: 'undo' | 'redo') => void, after?: (step: any, how: 'undo' | 'redo') => void }} [o] */
export function createHistory({ limit = 200, before = () => {}, after = () => {} } = {}) {
  /** @type {(step: any) => void} */ let recorded = () => {};
  /** @type {any[]} */ const undoStack = [];
  /** @type {any[]} */ const redoStack = [];
  /** @type {Map<string, (step: any, how: 'undo' | 'redo') => boolean | void>} */ const appliers = new Map();

  /** @param {any} step */
  function record(step) {
    recorded(step);
    undoStack.push(step);
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
    return step;
  }
  /** @param {(top: any) => boolean} can @param {(top: any) => void} merge */
  function extend(can, merge) {
    const top = undoStack.at(-1);
    if (!top || redoStack.length || !can(top)) return false;
    merge(top);
    return true;
  }
  /** @param {any} step @param {'undo' | 'redo'} how */
  function run(step, how) {
    const f = appliers.get(step.type);
    if (!f) { console.warn(`history: no applier for ${step.type}`); return false; }
    return f(step, how) !== false;
  }
  function undo() {
    for (;;) {
      const u = undoStack.pop();
      if (!u) return null;
      before(u, 'undo');
      if (!run(u, 'undo')) continue;                       // it no longer applies (the block went outside history): the next one
      redoStack.push(u);
      after(u, 'undo');
      return u;
    }
  }
  function redo() {
    for (;;) {
      const u = redoStack.pop();
      if (!u) return null;
      before(u, 'redo');
      if (!run(u, 'redo')) continue;
      undoStack.push(u);
      after(u, 'redo');
      return u;
    }
  }
  /** @param {(step: any) => boolean} pred */
  function drop(pred) {
    for (let i = undoStack.length - 1; i >= 0; i--) if (pred(undoStack[i])) { undoStack.splice(i, 1); return true; }
    return false;
  }
  /** @param {(step: any) => boolean} pred */
  function forget(pred) {
    let n = 0;
    for (const stack of [undoStack, redoStack]) for (let i = stack.length - 1; i >= 0; i--) if (pred(stack[i])) { stack.splice(i, 1); n++; }
    return n;
  }
  return {
    /** @param {(step: any) => void} fn */
    onRecord(fn) { recorded = fn; },
    /** @param {string} type @param {(step: any, how: 'undo' | 'redo') => boolean | void} apply */
    define(type, apply) { appliers.set(type, apply); },
    record, extend, undo, redo, drop, forget,
    top: () => undoStack.at(-1) ?? null,
    labels: () => undoStack.map((u) => u.label),
    steps: () => [...undoStack],
    redoSteps: () => [...redoStack],
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() { undoStack.length = 0; redoStack.length = 0; },
  };
}
