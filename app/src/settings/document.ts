// THE SETTINGS PANEL'S DOCUMENT TAB: the current document's own settings (settings/panel.ts draws it beside General),
// from its panel host (app/panel-host.ts: ctx.current, the focused pane's document). Two sections, one page:
//   Preamble       its code editor (CodeMirror, the blocks' editor: the active line marked, the problems as wavy lines),
//                  its problems listed under it (a click selects the line). Typing changes nothing yet: the text is
//                  applied when the focus leaves the section (as leaving a block applies its edit), with Apply or
//                  Ctrl/⌘↵ or Esc in the editor, and when the document closes first (host.draft); Revert puts the
//                  saved text back. Applied: one undoable edit, every block typesets again. A read-only document's
//                  is shown, never changed. The editor follows the saved text while nothing is typed (an undo,
//                  another tab's change).
//   Bibliography   the bibliography in a few words; Open References (the References pane), where the page has it
//
//   <${DocumentSettings} host ask asked />   host: the panel host (null: no document); ask(): the request to land on
//                                      the preamble taken (settings/panel.ts takeRequest: { line }), once, or null;
//                                      asked: the requests' count (a new one: ask again)
// Its CSS: settings/panel.ts (the panel's one style element). Hooks: section[data-section=preamble|bib], .rtx-set-editor,
// .rtx-set-err[data-line], .rtx-set-apply, .rtx-set-revert, .rtx-set-pre-note, #bib-info, .rtx-set-open-refs.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EditorView, highlightActiveLine } from '@codemirror/view';
import { EditorState, StateEffect } from '@codemirror/state';
import { html } from '../design/ui/core.js';
import { Button, Pill } from '../design/ui/index.js';
import { createEditor } from '../app/editor-entry.js';
import type { PanelHost, PreambleHost } from '../app/panel-host.ts';
import type { PreambleError } from '../app/page-state.ts';

/** a request to land on the preamble (its line selected) */
export interface Landing { line: number | null }
type Editor = ReturnType<typeof createEditor>;

export function DocumentSettings({ host, ask, asked = 0 }: { host: Pick<PanelHost, 'preamble' | 'bibliography'> | null; ask: () => Landing | null; asked?: number }) {
  if (!host?.preamble) return html`<p class="rtx-set-empty">Open a document to see its preamble and bibliography here.</p>`;
  const bib = host.bibliography;
  return html`
    <${PreambleSection} pre=${host.preamble} ask=${ask} asked=${asked} />
    ${bib ? html`<section class="rtx-set-section" data-section="bib" aria-labelledby="set-h-bib">
      <h3 class="rtx-set-h" id="set-h-bib">Bibliography</h3>
      <div class="rtx-set-row" data-setting="bib">
        <span class="rtx-set-text"><span class="rtx-set-label" id="bib-info">${bib.info.value}</span>
          ${bib.openReferences ? html`<span class="rtx-set-hint">Entries, lookups and citations are in the References pane.</span>` : null}</span>
        ${bib.openReferences ? html`<div class="rtx-set-control"><${Button} size="sm" class="rtx-set-open-refs" onClick=${() => bib.openReferences?.()}>Open References<//></div>` : null}
      </div>
    </section>` : null}`;
}

function PreambleSection({ pre, ask, asked }: { pre: PreambleHost; ask: () => Landing | null; asked: number }) {
  const box = useRef<HTMLDivElement>(null), sec = useRef<HTMLElement>(null);
  const editor = useRef<Editor | null>(null);
  const saved = pre.source.value, errs = pre.errors.value, readOnly = pre.readOnly();
  const [text, setText] = useState(saved);
  const base = useRef(saved);                         // the saved text the editor last took (or gave: an apply)
  const dirty = !readOnly && text !== base.current;    // typed since: what an apply would set

  const textNow = () => editor.current?.text ?? text;
  const typed = () => !readOnly && textNow() !== base.current;
  /** the text typed applied (nothing typed since the editor last took the saved text: nothing to apply; an undo
   *  that the editor has not taken yet is not undone again) */
  const apply = () => { pre.draft(null); if (!typed()) return; const t = textNow(); base.current = t; setText(t); pre.apply(t); };
  const put = (t: string) => {                        // the editor's whole text replaced (no undo step of its own)
    const v = editor.current?.view;
    if (v && v.state.doc.toString() !== t) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
    base.current = t; setText(t); pre.draft(null);
  };
  const goLine = (line: number | null) => {
    const v = editor.current?.view;
    if (!v) return;
    v.focus();
    if (!line || line > v.state.doc.lines) return;
    const l = v.state.doc.line(line);
    v.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  };

  useLayoutEffect(() => {
    const ed = createEditor(box.current, {
      doc: saved,
      placeholder: '\\usepackage{…}',
      onChange: (t: string) => { setText(t); pre.draft(t === base.current ? null : t); },
      onKey: (name: string) => { if (name === 'mod-enter' || name === 'escape') { apply(); return true; } return false; },
    });
    // a whole-file editor: the active line marked; a read-only document's cannot change
    ed.view.dispatch({ effects: StateEffect.appendConfig.of([highlightActiveLine(), EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    ed.view.contentDOM.setAttribute('aria-label', 'Preamble');
    editor.current = ed;
    return () => { ed.destroy?.(); editor.current = null; };
  }, []);
  // the saved text changed (an apply, an undo, another tab's): the editor follows while nothing is typed
  useLayoutEffect(() => { if (saved !== base.current && !typed()) put(saved); }, [saved]);
  // the problems as wavy lines
  useLayoutEffect(() => {
    const ed = editor.current;
    if (!ed?.marks) return;
    const d = ed.view.state.doc;
    const ms = errs.filter((e) => e.line && e.line <= d.lines).map((e) => { const l = d.line(e.line!); return { from: l.from, to: Math.max(l.to, Math.min(d.length, l.from + 1)), cls: 'cm-pre-error', title: e.message }; });
    try { ed.marks(ms); } catch { /* an empty last line */ }
  }, [errs]);
  // a request to land here (the outline's preamble entry, a preamble problem, Document settings…): the focus in the
  // editor, the line selected; once the section is shown (its column may open this frame)
  const landing = useRef(0);
  useEffect(() => {
    const want = ask();
    if (!want) return;
    let tries = 0;
    const go = () => { landing.current = 0; if (sec.current?.offsetParent || ++tries > 10) goLine(want.line); else landing.current = requestAnimationFrame(go); };
    cancelAnimationFrame(landing.current);
    landing.current = requestAnimationFrame(go);
  }, [asked]);
  // leaving the section applies (the focus elsewhere in the page; not the window losing it)
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!document.hasFocus() || (to && sec.current?.contains(to))) return;
    apply();
  };
  // gone with the text not applied (the panel closed, another document current): applied to its own document
  useEffect(() => () => {
    cancelAnimationFrame(landing.current);
    const t = editor.current?.text;
    if (t != null && !readOnly && t !== base.current) pre.apply(t);
  }, []);

  const keep = (e: MouseEvent) => e.preventDefault();      // a press on Apply or Revert keeps the focus where it is (Safari: nowhere)
  const n = pre.blocks();
  const note = readOnly ? 'This document is read-only.'
    : dirty ? `Not applied yet: leaving the preamble applies it, and all ${n} block${n === 1 ? '' : 's'} typeset again.`
    : 'Packages and macros every block shares. A change typesets every block again.';
  return html`<section ref=${sec} class="rtx-set-section rtx-set-pre" data-section="preamble" aria-labelledby="set-h-preamble" onFocusOut=${onFocusOut}>
    <h3 class="rtx-set-h" id="set-h-preamble">Preamble${errs.length ? html` <${Pill} tone="danger" title=${`${errs.length} problem${errs.length === 1 ? '' : 's'}`}>${errs.length}<//>` : null}</h3>
    <div class="rtx-set-editor" ref=${box}></div>
    <div class="rtx-set-pre-foot">
      <p class="rtx-set-hint rtx-set-pre-note" aria-live="polite">${note}</p>
      ${readOnly ? null : html`<div class="rtx-set-pre-acts" data-shown=${dirty ? 'true' : 'false'}>
        <${Button} size="sm" variant="ghost" class="rtx-set-revert" onMouseDown=${keep} disabled=${!dirty} onClick=${() => { put(pre.source.peek()); editor.current?.view.focus(); }}>Revert<//>
        <${Button} size="sm" variant="primary" class="rtx-set-apply" onMouseDown=${keep} disabled=${!dirty} title="Apply (Ctrl/⌘↵)" onClick=${apply}>Apply<//>
      </div>`}
    </div>
    ${errs.length ? html`<div class="rtx-set-errors" role="list" aria-label="Preamble problems">
      ${errs.map((e: PreambleError) => html`<button type="button" role="listitem" class="rtx-set-err" data-line=${e.line ?? ''} onClick=${() => goLine(e.line ?? null)}>
        ${e.line ? html`<span class="rtx-set-err-line">line ${e.line}</span>` : null}<span class="rtx-set-err-msg">${e.message}</span></button>`)}</div>` : null}
  </section>`;
}
