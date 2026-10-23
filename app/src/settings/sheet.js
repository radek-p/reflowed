// Bibliography / Engine and view. The preamble is a full CodeMirror editor filling the sheet, its problems
// listed under it (a click selects the line) and counted on the tab. Changes stay in the sheet until it closes:
// Done, Esc, the close button or a press outside apply them (the preamble as one undoable edit: every block
// typesets again; the engine); Cancel discards them. Show notes is a view option and applies at once.
// The sheet's content only (its tabs, the editor, the error list, the footer note): it renders the kit's Frame
// (design/ui/views.js), and
// the container it is opened in (THE kit Sheet, via openView) draws the header, the tabs, the footer and the scrim.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, Button, Select, Input } from '../design/ui/index.js';
import { registerSetting, visibleAt } from './registry.ts';
import { storedServer, resourceChoice, setResourceServer, checkServerAddress, DEFAULT_RESOURCE_SERVER, NONE } from './resources.ts';
import { Frame } from '../design/ui/views.js';
import { EditorView, highlightActiveLine } from '@codemirror/view';
import { EditorState, StateEffect } from '@codemirror/state';
import { createEditor } from '../app/editor-entry.js';

export const TABS = [{ id: 'preamble', label: 'Preamble' }, { id: 'bib', label: 'Bibliography' }, { id: 'engine', label: 'Engine and view' }];

/**
 * host: { doc(), readOnly(), errors (signal: [{ line, message }]), backends(), backend(), bibInfo(), notes?,
 *         openReferences?() }
 * start: { tab, line }; done({ preamble, backend, comments } | null): the changes to apply (null: Cancel)
 */
export function SettingsPanel({ host, start, done, api }) {
  const doc = host.doc();
  const pre0 = useRef(doc?.preamble.source ?? '').current;
  const [tab, setTab] = useState(start.tab ?? 'preamble');
  const [text, setText] = useState(pre0);
  const [backend, setBackend] = useState(host.backend());
  const notes0 = host.notes?.settings?.() ?? null;
  const [comments, setComments] = useState(notes0?.comments ?? true);
  const [hidden, setHidden] = useState(notes0?.hidden ?? false);
  const editor = useRef(null);
  const readOnly = host.readOnly();
  const errs = host.errors.value ?? [];

  const changes = () => ({ preamble: editor.current?.text ?? text, backend, comments });
  const dirty = (c = changes()) => c.preamble !== pre0 || c.backend !== host.backend() || (notes0 && c.comments !== notes0.comments);
  const finish = (apply) => done(apply ? changes() : null);
  api.current = { finish, editor: () => editor.current, state: () => ({ tab, dirty: dirty(), text: editor.current?.text ?? text }), setTab };

  const goLine = (line) => {
    const v = editor.current?.view;
    if (!v || !line || line > v.state.doc.lines) return;
    const l = v.state.doc.line(line);
    v.focus();
    v.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  };
  api.current.goLine = goLine;

  const c = changes();
  const note = readOnly ? 'This document is read-only.'
    : dirty(c) ? (c.preamble !== pre0 || c.backend !== host.backend() ? `Closing applies the changes: all ${doc?.blocks.length ?? 0} blocks typeset again.` : 'Closing applies the changes.')
    : errs.length ? `${errs.length} problem${errs.length === 1 ? '' : 's'} in the preamble` : 'No changes';
  const footer = html`<${Button} variant="ghost" class="ss-cancel" onClick=${() => finish(false)}>Cancel<//>
    <${Button} variant="primary" class="ss-done" onClick=${() => finish(true)}>Done<//>`;
  const items = TABS.map((t) => (t.id === 'preamble' && errs.length ? { ...t, count: errs.length, tone: 'danger' } : t));
  return html`<${Frame} class="settings-sheet" id="settings-sheet" title="Document settings" onClose=${() => finish(true)} footer=${footer} note=${note}
      tabs=${{ label: 'Settings', idPrefix: 'ss-tab', value: tab, onChange: setTab, items, class: 'ui-sheet-tabs ss-tabs' }}>
    <${PreambleTab} active=${tab === 'preamble'} pre0=${pre0} errs=${errs} editor=${editor} onText=${setText} readOnly=${readOnly}
      start=${start} goLine=${goLine} finish=${finish} />
    <div class="ss-panel" role="tabpanel" id="ss-panel-bib" aria-labelledby="ss-tab-bib" hidden=${tab !== 'bib'}>
      <div class="ss-field"><span class="ss-label">Bibliography</span><span class="ss-value" id="bib-info">${host.bibInfo()}</span></div>
      ${host.openReferences ? html`<p class="ss-hint">Entries, lookups and citations are in the References pane.</p>
        <div><${Button} class="ss-open-refs" onClick=${() => { finish(true); host.openReferences(); }}>Open References<//></div>` : null}
    </div>
    <div class="ss-panel" role="tabpanel" id="ss-panel-engine" aria-labelledby="ss-tab-engine" hidden=${tab !== 'engine'}>
      <label class="ss-field"><span class="ss-label">Typeset with</span>
        <${Select} id="backend-select" value=${backend} disabled=${readOnly} onChange=${(e) => setBackend(e.currentTarget.value)}>
          ${host.backends().map((b) => html`<option value=${b.id}>${b.label}</option>`)}<//></label>
      <p class="ss-hint">Another engine typesets every block again.</p>
      ${visibleAt('engine', { host }).map((s) => html`<${s.Control} key=${s.id} host=${host} />`)}
      ${notes0 ? html`
        <label class="ss-field"><span class="ss-label">Comments as notes</span>
          <input type="checkbox" class="ss-check" id="ss-comments" checked=${comments} onChange=${(e) => setComments(e.currentTarget.checked)} /></label>
        <p class="ss-hint">Comments on their own lines that read as notes show as chips (the blocks with them typeset again).</p>
        <label class="ss-field"><span class="ss-label">Show notes</span>
          <input type="checkbox" class="ss-check" id="ss-show-notes" checked=${!hidden} onChange=${(e) => { const h = !e.currentTarget.checked; setHidden(h); host.notes.setHidden(h); }} /></label>` : null}
      <p class="ss-hint">Theme, text size and width: the view button in the top bar.</p>
    </div>
  <//>`;
}

function PreambleTab({ active, pre0, errs, editor, onText, readOnly, start, goLine, finish }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    const ed = createEditor(box.current, {
      doc: pre0,
      placeholder: '\\usepackage{…}',
      onChange: (t) => onText(t),
      // Esc and ⌘↵ apply and close (Esc here, not on the sheet: CodeMirror's own Escape would first collapse a selection)
      onKey: (name) => { if (name === 'mod-enter' || name === 'escape') { finish(true); return true; } return false; },
    });
    // a whole-file editor: the active line marked; read-only documents cannot change it
    ed.view.dispatch({ effects: StateEffect.appendConfig.of([highlightActiveLine(), EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    ed.view.contentDOM.setAttribute('aria-label', 'Preamble');
    editor.current = ed;
    requestAnimationFrame(() => { if (start.line) goLine(start.line); else if ((start.tab ?? 'preamble') === 'preamble') ed.view.focus(); });
    return () => { ed.destroy?.(); editor.current = null; };
  }, []);
  // the problems as wavy lines in the editor
  useLayoutEffect(() => {
    const ed = editor.current;
    if (!ed?.marks) return;
    const d = ed.view.state.doc;
    const ms = errs.filter((e) => e.line && e.line <= d.lines).map((e) => { const l = d.line(e.line); return { from: l.from, to: Math.max(l.to, Math.min(d.length, l.from + 1)), cls: 'cm-pre-error', title: e.message }; });
    try { ed.marks(ms); } catch { /* an empty last line */ }
  }, [errs]);
  return html`<div class="ss-panel ss-preamble" role="tabpanel" id="ss-panel-preamble" aria-labelledby="ss-tab-preamble" hidden=${!active}>
    <p class="ss-hint">Packages and macros every block shares. Closing the sheet applies a change; every block typesets again.</p>
    <div class="ss-editor" ref=${box}></div>
    ${errs.length ? html`<div class="ss-errors" role="list" aria-label="Preamble problems">
      ${errs.map((e) => html`<button type="button" role="listitem" class="ss-err ui-row" data-line=${e.line ?? ''} onClick=${() => goLine(e.line)}>
        ${e.line ? html`<span class="ss-err-line">line ${e.line}</span>` : null}<span class="ss-err-msg">${e.message}</span></button>`)}</div>` : null}
  </div>`;
}

// the Engine tab's fields after the engine are registrations (settings/registry.ts, where 'engine')
registerSetting({ id: 'resource-server', where: 'engine', order: 10, advanced: true, Control: () => html`<${ResourceServerField} />` });

/** the TeX resource server: a preference of this browser, applied when the field is left or on
 *  Enter (not on Done: it is not part of the document); the blocks that failed for want of a file typeset again */
function ResourceServerField() {
  const [text, setText] = useState(storedServer.value ?? '');
  const [problem, setProblem] = useState('');
  const commit = () => {
    const why = checkServerAddress(text);
    setProblem(why);
    if (!why) setResourceServer(text);
  };
  return html`<label class="ss-field"><span class="ss-label">TeX resource server</span>
      <${Input} id="ss-resource-server" class="ss-url" mono=${true} type="url" spellcheck=${false} placeholder=${DEFAULT_RESOURCE_SERVER ? 'beside this page (texlive/2022/)' : NONE} value=${text}
        aria-invalid=${problem ? 'true' : 'false'} aria-describedby="ss-resource-hint"
        onInput=${(e) => { setText(e.currentTarget.value); if (problem) setProblem(''); }} onChange=${commit}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }} /></label>
    ${problem ? html`<p class="ss-hint ss-problem" role="alert">${problem}</p>` : null}
    <p class="ss-hint" id="ss-resource-hint">Packages, classes and fonts the editor does not carry are fetched from this
      address (a TeX Live tree on a web server) the first time a document needs them, then kept in this browser.
      ${DEFAULT_RESOURCE_SERVER ? 'Empty: the tree beside this page (texlive/2022/), when it is there.' : 'Empty: none.'}
      Type ${NONE} for no server.${resourceChoice.value.url ? '' : ' Now: none.'}</p>`;
}
