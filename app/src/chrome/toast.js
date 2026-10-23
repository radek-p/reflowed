// The document's toast ("Deleted block", "Note resolved", with Undo): the kit's one
// toast stack (design/ui/overlays.js showToast, in the one overlay layer), not a second host of its own. The app
// (app.js toast), the notes and the quota notice share it: a new toast replaces the last, one timer.
//   showToast(text, undo?, { label }?)   undo: a function (its button shows: "Undo", or label) or null
//   hideToast()
// Hooks kept for the tests: #toast (the toast), #toast-text, #toast-undo; gone from the page when hidden.
import { showToast as kitToast } from '../design/ui/overlays.js';

const SHOW_MS = 7000;
let current = null, state = null;

export function showToast(text, undo = null, { label = 'Undo' } = {}) {
  const t = { text, undo: undo ?? null };
  const action = undo ? { key: 'undo', id: 'toast-undo', label, onClick: () => undo() } : null;
  state = t;
  current = kitToast(text, { action, duration: SHOW_MS, id: 'toast', textId: 'toast-text' });
  current.onGone = () => { if (state === t) { state = null; current = null; } };
}
export function hideToast() {
  current?.close();
  state = null;
}
/** tests */
export const toastState = () => state;
