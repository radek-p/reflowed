// CodeMirror 6 for one block's LaTeX source: borderless, grows with its text,
// TeX highlighting (legacy stex mode), bracket matching (the undo history is the document's: edit/undo.js); for the
// editor also:
//   - completion of \ref-like keys (labels) and \cite-like keys (bib entries)
//   - hover cards over those keys
//   - go to definition: F12, or Mod-click on a key
//   - marks (diagnostics in the open block) and find highlights
//
//   createEditor(parent, { doc, onChange(text, update), onKey(name, view) -> bool, placeholder,
//                          complete: { labels() -> Option[], cites() -> Option[] },
//                          hover(ref) -> HTMLElement | null, goto(ref) -> bool })
//     ref = { type: 'ref' | 'cite', key, cmd }
//     Option = { label, detail?, info?, boost? }
//   onKey is asked for: escape, mod-enter, shift-enter, backspace-empty,
//   backspace-start, slash-empty, up-top, down-bottom, alt-up, alt-down, and undo (Mod-z) and redo (Mod-Shift-z,
//   Mod-y): CodeMirror's own history is off, so a host keeps the undo stack (onChange's updates have the changes).
//
//   What a host styles (the editor's page: view/style.js and workbench/src/theme-map.ts):
//     the highlighting's colours, CSS custom properties --cm-keyword (a command), --cm-atom (an environment name),
//     --cm-bracket, --cm-comment, --cm-number, --cm-math, --cm-error;
//     .cm-caretLine, the band on the caret's visual line (view/caret-line.js: an element in the scroller, placed by
//     the plugin; absolute, under the text, a tint);
//     .cm-can-scroll on the scroller while its text is taller than its box (overscroll-behavior: contain then).
import { EditorState, StateField, StateEffect, Compartment, Prec, Annotation, Transaction } from '@codemirror/state';
import { caretLine } from '../view/caret-line.js';   // the caret's visual line, banded
import { EditorView, keymap, placeholder as placeholderExt, drawSelection, Decoration, hoverTooltip, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';   // no CodeMirror history: the document's (doc/history.js)
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap, startCompletion, completionStatus, closeCompletion } from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import { REF_CMDS, CITE_CMDS } from '../tex/texscan.js';

const style = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cm-keyword)' },
  { tag: t.tagName, color: 'var(--cm-keyword)' },
  { tag: t.atom, color: 'var(--cm-atom)' },
  { tag: t.bracket, color: 'var(--cm-bracket)' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.string, color: 'var(--cm-math)' },
  { tag: t.variableName, color: 'var(--cm-math)' },
  { tag: t.meta, color: 'var(--cm-comment)' },
  { tag: t.invalid, color: 'var(--cm-error)' },
]);

const REF_RE = new RegExp(`\\\\(${REF_CMDS.join('|')})\\*?\\{([^{}]*)$`);
const CITE_RE = new RegExp(`\\\\(${CITE_CMDS.join('|')})\\*?(?:\\[[^\\]]*\\]){0,2}\\{([^{}]*)$`);

/** The \ref/\cite key around `pos`, if any: { type, key, cmd, from, to }. */
export function keyAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const text = line.text, col = pos - line.from;
  // the group around col
  if (col === 0) return null;
  const open = text.lastIndexOf('{', col - 1);
  if (open < 0) return null;
  const close = text.indexOf('}', open);
  if (close >= 0 && close < col) return null;
  const before = text.slice(0, open + 1);
  const m = REF_RE.exec(before) ?? CITE_RE.exec(before);
  if (!m) return null;
  const type = REF_RE.test(before) ? 'ref' : 'cite';
  const inner = text.slice(open + 1, close < 0 ? text.length : close);
  // the comma-separated key under col
  let start = open + 1;
  for (const part of inner.split(',')) {
    const end = start + part.length;
    if (col >= start && col <= end) {
      const lead = part.length - part.trimStart().length;
      return { type, cmd: m[1], key: part.trim(), from: line.from + start + lead, to: line.from + start + lead + part.trim().length };
    }
    start = end + 1;
  }
  return null;
}

/** a change another editor of the same block made, applied here (outside this editor's undo) */
export const remoteChange = Annotation.define();

const setMarks = StateEffect.define();
const marksField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setMarks)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** the scroller carries .cm-can-scroll while its content is taller than it: only then does a scroll gesture over
 *  it stay in it (CSS: overscroll-behavior), else the gesture scrolls the page as if the editor were not there */
const canScroll = ViewPlugin.fromClass(class {
  constructor(view) { this.on = null; this.check(view); }
  update(u) { if (u.geometryChanged || u.docChanged || u.viewportChanged) this.check(u.view); }
  check(view) {
    view.requestMeasure({
      read: () => view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight + 1,
      write: (on) => { if (on !== this.on) { this.on = on; view.scrollDOM.classList.toggle('cm-can-scroll', on); } },
    });
  }
});

const MAC = /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? '');
/** 'undo' (Mod-z), 'redo' (Mod-Shift-z, Mod-y), or null: by the event's key, case aside, and Shift */
function historyKey(e) {
  if (e.altKey || (MAC ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey)) return null;
  // the letter typed; on a layout whose letters are not Latin (Cyrillic, Greek), the key where z or y is
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

export function createEditor(parent, { doc = '', onChange = () => {}, onKey = () => false, placeholder = '',
  complete = null, hover = null, goto = null, onSelect = null, carry = null } = {}) {
  const ask = (name) => (view) => onKey(name, view) === true;
  const atEmpty = (name) => (view) => view.state.doc.length === 0 && ask(name)(view);
  const sel = (view) => view.state.selection.main;
  // the first or last VISUAL line: a long source line wraps in the editor, and ↑/↓ on its other
  // wrapped lines move the caret there, as in any text editor (they used to jump to the block before or after)
  const sameRow = (view, a, b) => { const p = view.coordsAtPos(a, sel(view).assoc || 1) ?? view.coordsAtPos(a), q = view.coordsAtPos(b); return !p || !q || Math.abs((p.top + p.bottom) / 2 - (q.top + q.bottom) / 2) < view.defaultLineHeight / 2; };
  const firstLine = (view) => view.state.doc.lineAt(sel(view).head).number === 1 && sel(view).empty && sameRow(view, sel(view).head, 0);
  const lastLine = (view) => view.state.doc.lineAt(sel(view).head).number === view.state.doc.lines && sel(view).empty && sameRow(view, sel(view).head, view.state.doc.length);
  const findCompartment = new Compartment();

  const completionSource = (ctx) => {
    if (!complete) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    let type = null, m = REF_RE.exec(before);
    if (m) type = 'ref'; else if ((m = CITE_RE.exec(before))) type = 'cite';
    if (!type) return null;
    const typed = m[2].split(',').pop();
    const lead = typed.length - typed.trimStart().length;
    const from = ctx.pos - typed.length + lead;
    // taking a key leaves the caret after the closing brace ("{" put one there), so
    // what is typed next (". and", " it follows") goes after the reference, not into its key
    const past = (view, completion, from, to) => {
      const next = view.state.sliceDoc(to, to + 1);
      view.dispatch({ changes: { from, to, insert: completion.label }, selection: { anchor: from + completion.label.length + (next === '}' ? 1 : 0) }, userEvent: 'input.complete' });
    };
    const options = ((type === 'ref' ? complete.labels?.(m[1]) : complete.cites?.()) ?? []).map((o) => (o.apply ? o : { ...o, apply: past }));
    return { from, options, validFor: /^[^,{}\s]*$/ };
  };

  const extensions = [
    canScroll,                                        // .cm-can-scroll while its text is taller than its box
    drawSelection({ cursorBlinkRate: 0 }),
    caretLine,                                // paired with the preview's line band
      // the blink is view/blink.js's: one clock for this caret and the preview's
    bracketMatching(),
    StreamLanguage.define(stex),
    syntaxHighlighting(style),
    EditorView.lineWrapping,
    placeholderExt(placeholder),
    marksField,
    findCompartment.of([]),
    // Escape: closes an open completion list, else leaves the block (a list
    // still pending – the ~100 ms after a keystroke – does not count)
    Prec.highest(keymap.of([{ key: 'Escape', run: (v) => (completionStatus(v.state) === 'active' ? closeCompletion(v) : ask('escape')(v)) }])),
    // undo and redo: the document's one history (edit/undo.js), asked of the host by the key event itself. A
    // keymap's Mod-z also matched Ctrl-Shift-z whenever the key came as a lowercase 'z' with Shift held (as Chromium
    // on Linux reports it), so redo ran undo
    Prec.highest(EditorView.domEventHandlers({ keydown: (e, view) => {
      const name = historyKey(e);
      if (!name || !ask(name)(view)) return false;
      e.preventDefault();
      return true;
    } })),
    keymap.of([
      { key: 'Mod-Enter', run: ask('mod-enter') },
      { key: 'Shift-Enter', run: ask('shift-enter') },
      { key: 'Backspace', run: (v) => (v.state.doc.length === 0 ? ask('backspace-empty')(v) : sel(v).empty && sel(v).head === 0 ? ask('backspace-start')(v) : false) },
      { key: '/', run: atEmpty('slash-empty') },
      { key: 'ArrowUp', run: (v) => firstLine(v) && ask('up-top')(v) },
      { key: 'ArrowDown', run: (v) => lastLine(v) && ask('down-bottom')(v) },
      { key: 'Alt-ArrowUp', run: ask('alt-up') },
      { key: 'Alt-ArrowDown', run: ask('alt-down') },
      { key: 'F12', run: (v) => { const k = keyAt(v.state, sel(v).head); return !!(k && goto?.(k)); } },
      indentWithTab,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString(), u); if (onSelect && (u.selectionSet || u.docChanged)) onSelect(u.state.selection.main, u); }),   // onSelect: the caret in the live result (u: the update)
    EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'LaTeX source' }),
  ];
  if (complete) {
    // interactionDelay 0: Enter right after typing takes the option (lists only open inside \ref{…}/\cite{…})
    extensions.push(autocompletion({ override: [completionSource], activateOnTyping: true, icons: false, closeOnBlur: true, maxRenderedOptions: 60, interactionDelay: 0 }));
    extensions.push(keymap.of(completionKeymap));
    // "{" right after \ref or \cite opens the list at once
    extensions.push(EditorView.inputHandler.of((view, from, to, text) => {
      // "}" typed right before the "}" of a \ref{…}/\cite{…} steps over it (no "}}")
      if (text === '}' && from === to && view.state.sliceDoc(from, from + 1) === '}') {
        const line = view.state.doc.lineAt(from);
        if (REF_RE.test(line.text.slice(0, from - line.from)) || CITE_RE.test(line.text.slice(0, from - line.from))) {
          view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'input.type' });
          return true;
        }
      }
      if (text !== '{') return false;
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from) + '{';
      if (REF_RE.test(before) || CITE_RE.test(before)) {
        view.dispatch({ changes: { from, to, insert: '{}' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
        startCompletion(view);
        return true;
      }
      return false;
    }));
  }
  if (hover) {
    extensions.push(hoverTooltip((view, pos) => {
      const k = keyAt(view.state, pos);
      if (!k || !k.key) return null;
      const dom = hover(k);
      if (!dom) return null;
      return { pos: k.from, end: k.to, above: true, create: () => ({ dom }) };
    }, { hoverTime: 250 }));
  }
  if (goto) {
    extensions.push(EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        const k = pos != null && keyAt(view.state, pos);
        if (k && k.key && goto(k)) { e.preventDefault(); return true; }
        return false;
      },
    }));
  }

  // carry: another editor's text, selection and undo history (its carry()), taken over as they were
  const state = carry ? EditorState.fromJSON(carry, { extensions }) : EditorState.create({ doc, extensions });
  const view = new EditorView({ parent, state });
  return {
    view,
    get text() { return view.state.doc.toString(); },
    /** set from outside (a structural step: setSource): not a typing step */
    set text(s) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s }, annotations: Transaction.addToHistory.of(false) }); },
    /** an undo or a redo of a typing step: its changes and where the caret goes (not recorded again) */
    applyHistory(changes, sel) { view.dispatch({ changes, selection: sel, scrollIntoView: true, userEvent: 'undo', annotations: Transaction.addToHistory.of(false) }); },
    focus(atEnd = true) {
      view.focus();
      if (atEnd) view.dispatch({ selection: { anchor: view.state.doc.length } });
    },
    select(anchor, head = anchor) {
      const n = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(anchor, n), head: Math.min(head, n) }, scrollIntoView: true });
    },
    get caret() { return sel(view).head; },
    /** lay out now, so the editor's height can be read at once (morph) */
    settle() { if (typeof view.measure === 'function') view.measure(); },
    reveal(pos) { view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 48 }) }); },
    /** underline ranges: [{ from, to, cls, title }] */
    marks(list) {
      const n = view.state.doc.length;
      const ds = list.filter((m) => m.from < m.to && m.to <= n)
        .sort((a, b) => a.from - b.from)
        .map((m) => Decoration.mark({ class: m.cls, attributes: m.title ? { title: m.title } : {} }).range(m.from, m.to));
      view.dispatch({ effects: setMarks.of(Decoration.set(ds, true)) });
    },
    /** highlight every match of a RegExp (global), or none */
    highlight(re) {
      if (!re) { view.dispatch({ effects: findCompartment.reconfigure([]) }); return; }
      const deco = new MatchDecorator({ regexp: re, decoration: Decoration.mark({ class: 'cm-find-match' }) });
      const plugin = ViewPlugin.fromClass(class {
        constructor(v) { this.decorations = deco.createDeco(v); }
        update(u) { this.decorations = deco.updateDeco(u, this.decorations); }
      }, { decorations: (p) => p.decorations });
      view.dispatch({ effects: findCompartment.reconfigure(plugin) });
    },
    /** another editor's change to the same text: applied, not in this undo history (which maps its steps through it) */
    applyRemote(changes) { view.dispatch({ changes, annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)] }); },
    /** what another editor needs to go on where this one is: text, selection, undo history (JSON) */
    carry() { return view.state.toJSON(); },
    destroy() { view.destroy(); },
  };
}
