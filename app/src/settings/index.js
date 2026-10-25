// preamble sheet: the preamble is in no pane; the outline's first entry ("Preamble") opens this sheet at its
// Preamble tab and shows the preamble's problems as a badge (preambleProblems).
//
//   const settings = createSettings(host)
//   settings.open({ tab, line }) · settings.close({ apply }) · settings.isOpen · settings.state()
// per editor container (app/editor-root.ts: root.state.preambleErrors), the current document's:
//   showPreambleErrors(root, its signal) · preambleErrorsOf(root) ([{ line, message }]) · preambleProblemsOf(root)
//   (their count: the outline entry's badge)
//
// host: doc(), readOnly(), backends() [{ id, label }], backend() id, bibInfo() text,
//       applyPreamble(text)   one undoable edit (the app's perform): every block typesets again
//       setBackend(id)        the engine (typesets every block again)
import { signal, computed } from '@preact/signals';
import { createRef } from 'preact';
import { registerView, openView, view, slotsOf } from '../design/ui/views.ts';
import { SettingsPanel } from './sheet.js';
import { installSettingsStyle } from './style.js';

// the problems are each document's (doc/results.js preambleErrors); the container shows its current one's
/** the current document's preamble problems (the editor of the focused pane's document calls this) */
export function showPreambleErrors(root, errors) { root.state.preambleErrors.value = errors ?? null; }
const derived = new WeakMap();
const of = (root) => {
  let d = derived.get(root);
  if (!d) {
    const errors = computed(() => root.state.preambleErrors.value?.value ?? []);
    d = { errors, problems: computed(() => errors.value?.length ?? 0) };
    derived.set(root, d);
  }
  return d;
};
export const preambleErrorsOf = (root) => of(root).errors;
export const preambleProblemsOf = (root) => of(root).problems;

// a registered view: its content (SettingsPanel) apart from its container (the kit's Sheet, by default)
registerView({ id: 'settings', title: 'Document settings', slot: 'sheet', Component: SettingsPanel });

export function createSettings(host) {
  installSettingsStyle();
  let layer = null, opener = null;
  const api = createRef();
  const sheetHost = { ...host, errors: preambleErrorsOf(host.root), openReferences: null };

  function apply(c) {
    if (!c || host.readOnly()) return false;
    const doc = host.doc();
    let any = false;
    if (doc && c.preamble != null && c.preamble !== doc.preamble.source) { host.applyPreamble(c.preamble); any = true; }
    if (c.backend && c.backend !== host.backend()) { host.setBackend(c.backend); any = true; }
    return any;
  }
  function open({ tab = 'preamble', line = null } = {}) {
    if (layer) { if (tab) api.current?.setTab(tab); if (line) api.current?.goLine(line); return; }
    if (!host.doc()) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const start = { tab, line };
    sheetHost.openReferences = view('references') ? () => slotsOf(host.root).show('references') : null;      // only with the References pane
    layer = openView('settings', { host: sheetHost, start, api, done: (c) => {
      layer?.close(); layer = null;
      const applied = apply(c);
      const o = opener; opener = null;
      if (o?.isConnected) o.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent('editor:settings-closed', { detail: { applied } }));
    } });
  }
  return {
    open,
    /** apply: Done (true) or Cancel (false) */
    close({ apply: a = true } = {}) { if (layer) api.current?.finish(a); },
    get isOpen() { return !!layer; },
    /** tests: { open, tab, dirty, text } */
    state: () => ({ open: !!layer, ...(layer ? api.current?.state() : {}) }),
  };
}
