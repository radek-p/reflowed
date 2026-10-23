// @ts-check
// A change typed in a block's code editor as an undo step of the DOCUMENT's history
// (CodeMirror's own history is off, its transactions are fed in here, so ⌘Z in an open editor and ⌘Z on the page are
// one stack). The steps are CodeMirror's typing groups, made by CodeMirror's own rules (@codemirror/commands
// history: a change joins the last one when it is typing or deleting, within 500 ms, adjacent to it, and the
// selection was not moved in between); closing an editor joins nothing. No DOM: tests/test-doc-units.ts.
//
//   textSteps(history, { doc, now }) -> { typed(block, pane, transactions), clearGroup() }
//     typed: every transaction of one editor update that changed the text, recorded or merged into the top step
//   applyText(source, step, how) -> string | null    the block's source after undoing/redoing step (null: it does
//                                                    not fit the source: the block changed outside the history)
//   selectionOf(step, how) -> { anchor, head }       where the caret goes
import { ChangeSet, Text, Transaction } from '@codemirror/state';

const GROUP_MS = 500;                                       // CodeMirror's newGroupDelay
const JOINABLE = /^(input\.type|delete)($|\.)/;             // CodeMirror's joinableUserEvent

/** @param {any} sel */
const selJSON = (sel) => ({ anchor: sel.main.anchor, head: sel.main.head });

/** does change `b` (in the text after `a`) touch what `a` changed? (CodeMirror's isAdjacent, on forward changes) */
function adjacent(/** @type {ChangeSet} */ a, /** @type {ChangeSet} */ b) {
  /** @type {number[]} */ const ranges = [];
  let hit = false;
  a.iterChangedRanges((_fa, _ta, fb, tb) => { ranges.push(fb, tb); });
  b.iterChangedRanges((fa, ta) => { for (let i = 0; i < ranges.length; i += 2) if (ta >= ranges[i] && fa <= ranges[i + 1]) hit = true; });
  return hit;
}

/** @param {any} history @param {{ doc: () => string | null, now?: () => number }} o */
export function textSteps(history, { doc, now = () => Date.now() }) {
  let open = null;                                          // the top step while typing may still join it
  return {
    /** @param {string} block @param {string | null} pane @param {readonly any[]} transactions */
    typed(block, pane, transactions) {
      for (const tr of transactions) {
        if (!tr.docChanged) continue;
        const ue = tr.annotation(Transaction.userEvent) ?? null;
        const t = now();
        const changes = tr.changes, inverse = tr.changes.invert(tr.startState.doc);
        const startSel = selJSON(tr.startState.selection), endSel = selJSON(tr.state.selection);
        const joined = history.extend((top) => top === open && top.type === 'text' && top.block === block && top.pane === pane
          && t - top.time < GROUP_MS && (!ue || JOINABLE.test(ue)) && (!top.event || JOINABLE.test(top.event))
          && top.after.anchor === startSel.anchor && top.after.head === startSel.head
          && adjacent(ChangeSet.fromJSON(top.changes), changes), (top) => {
          top.changes = ChangeSet.fromJSON(top.changes).compose(changes).toJSON();
          top.inverse = inverse.compose(ChangeSet.fromJSON(top.inverse)).toJSON();
          top.after = endSel;
          top.time = t;
        });
        if (joined) continue;
        open = history.record({ type: 'text', label: 'typing', doc: doc(), block, pane, changes: changes.toJSON(), inverse: inverse.toJSON(),
          before: startSel, after: endSel, event: ue, time: t });
      }
    },
    /** the next change starts a step of its own (an undo, a redo, the editor closed: CodeMirror isolates there too) */
    clearGroup() { open = null; },
  };
}

/** @param {string} source @param {any} step @param {'undo' | 'redo'} how */
export function applyText(source, step, how) {
  const ch = ChangeSet.fromJSON(how === 'undo' ? step.inverse : step.changes);
  if (ch.length !== source.length) return null;
  return ch.apply(Text.of(source.split('\n'))).toString();
}

/** the ChangeSet that undoes or redoes a text step (an open editor dispatches it) @param {any} step @param {'undo' | 'redo'} how */
export const changesOf = (step, how) => ChangeSet.fromJSON(how === 'undo' ? step.inverse : step.changes);

/** @param {any} step @param {'undo' | 'redo'} how */
export const selectionOf = (step, how) => (how === 'undo' ? step.before : step.after);
