// Find and replace across blocks, on the sources. The bar sits under the
// top bar; Enter / ⇧Enter go to the next / previous match, which opens its
// block in the editor with the match selected (and every match in it
// highlighted). Blocks with matches get a mark in the margin. Replace
// changes the current match; Replace all changes every block with a match
// in one undoable step – only those blocks lose their result, so only they
// compile again.
import { mountFindBar } from '../chrome/find-bar.js';   // the bar: a Preact component

// c.editorOf(id): the editor open on a block (the active pane's, else any); a match's mark is the block's
// decor (in every pane); a match opens in the focused pane (c.revealBlock)
// the bar is the editor's (its container's [data-part=find], app/editor-root.ts): one find per open
// document, the one that opened it last renders its bar there (root.claim)
export function createFind(c) {
  const me = {};
  const root = c.root;
  let bar = null, q = '', opts = { caseSensitive: false, regex: false, word: false };
  let matches = [], cur = -1, error = '';

  function toRegExp(query, o = opts) {
    if (!query) return null;
    let src = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (o.word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    return new RegExp(src, `gu${o.caseSensitive ? '' : 'i'}`);
  }

  /** Every match: [{ blockId, from, to }] in document order. */
  function search(query, o = opts) {
    let re;
    try { re = toRegExp(query, o); } catch (e) { error = e.message; return []; }
    error = '';
    if (!re || !c.doc) return [];
    const out = [];
    for (const b of c.doc.blocks) {
      const src = sourceOf(b);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        out.push({ blockId: b.id, from: m.index, to: m.index + m[0].length });
        if (out.length > 5000) return out;
      }
    }
    return out;
  }
  const sourceOf = (b) => { const ed = c.editing === b.id ? c.editorOf(b.id) : null; return ed ? ed.text : b.source; };

  function replaceAll(query, repl, o = opts) {
    let re;
    try { re = toRegExp(query, o); } catch { return 0; }
    if (!re || !c.doc) return 0;
    const changes = [];
    let n = 0;
    for (const b of c.doc.blocks) {
      const src = sourceOf(b);
      re.lastIndex = 0;
      const k = (src.match(re) ?? []).filter((x) => x !== '').length;
      if (!k) continue;
      n += k;
      re.lastIndex = 0;
      changes.push({ id: b.id, from: src, to: src.replace(re, o.regex ? repl : () => repl) });
    }
    if (!changes.length) return 0;
    c.safety?.('replacing all');
    c.perform(`replace ${n}`, () => { for (const x of changes) c.setSource(x.id, x.to, { record: false }); });
    c.toast(`Replaced ${n} match${n === 1 ? '' : 'es'} in ${changes.length} block${changes.length === 1 ? '' : 's'}`, () => {
      c.undo?.();                                         // the history's step, not a change beside it
    });
    return n;
  }

  // the bar is a Preact component (../chrome/find-bar.js); this module keeps what it does
  function build() {
    bar = mountFindBar(root.part('find'), {
      input: (v) => { q = v; run(); },
      next: (dir) => go(dir),
      replace: (text) => { replaceOne(text); run(); },
      replaceAll: (text) => { replaceAll(q, text); run(); },
      close: () => closeBar(),
      toggle: (key) => { opts[key] = !opts[key]; bar.model.opts.value = { ...opts }; run(); },
    }, opts);
  }
  /** shown or hidden at once (the component follows): open() focuses the input in the same task */
  function show(on) { bar.model.visible.value = on; const el = bar.el; if (el) el.hidden = !on; }

  function run() {
    matches = search(q);
    if (cur >= matches.length) cur = matches.length - 1;
    paint();
  }
  function paint() {
    if (!bar) return;
    const blocks = new Set(matches.map((m) => m.blockId));
    bar.model.count.value = {
      text: error ? 'Invalid pattern' : !q ? '' : matches.length ? `${cur >= 0 ? `${cur + 1} of ` : ''}${matches.length} in ${blocks.size} block${blocks.size === 1 ? '' : 's'}` : 'No matches',
      kind: error ? 'error' : q && !matches.length ? 'none' : '',
    };
    for (const [id, u] of c.ui) u.cls('has-match', blocks.has(id));
    if (c.editing) applyTo(c.editing, c.editorOf(c.editing));
  }
  function go(dir) {
    if (!matches.length) return;
    // from the caret of the open block, if any
    const caretBlock = c.editing, caret = caretBlock ? c.editorOf(caretBlock)?.caret ?? 0 : -1;
    if (cur < 0 && caretBlock) {
      const order = c.doc.blocks.map((b) => b.id);
      const at = order.indexOf(caretBlock);
      cur = matches.findIndex((m) => order.indexOf(m.blockId) > at || (m.blockId === caretBlock && m.from >= caret));
      if (dir < 0) cur = (cur < 0 ? matches.length : cur) - 1; else if (cur < 0) cur = 0;
    } else cur = (cur + dir + matches.length) % matches.length;
    if (cur < 0) cur = matches.length - 1;
    const m = matches[cur];
    c.revealBlock(m.blockId, { from: m.from, to: m.to });
    paint();
    bar.find.focus();
  }
  function replaceOne(repl) {
    const m = matches[cur];
    if (!m) { go(1); return; }
    const b = c.blockById(m.blockId);
    const src = sourceOf(b);
    let text = repl;
    if (opts.regex) { const re = toRegExp(q); re.lastIndex = 0; const mm = re.exec(src.slice(m.from)); if (mm && mm.index === 0) text = mm[0].replace(toRegExp(q), repl); }
    const ed = c.editing === b.id ? c.editorOf(b.id) : null;
    if (ed) {
      ed.view.dispatch({ changes: { from: m.from, to: m.to, insert: text } });
    } else {
      c.setSource(b.id, src.slice(0, m.from) + text + src.slice(m.to));
    }
    matches = search(q);
    cur = Math.min(cur, matches.length - 1);
    if (matches.length) { cur = Math.max(0, matches.findIndex((x) => x.blockId === m.blockId ? x.from >= m.from + text.length : c.doc.blocks.findIndex((b2) => b2.id === x.blockId) > c.doc.blocks.findIndex((b2) => b2.id === m.blockId))); const n = matches[cur]; if (n) c.revealBlock(n.blockId, { from: n.from, to: n.to }); }
    paint();
    bar.find.focus();
  }

  /** Highlight the matches in an open block's editor. */
  function applyTo(id, editor) {
    if (!editor) return;
    let re = null;
    if (bar && q) { try { re = toRegExp(q); } catch { re = null; } }
    editor.highlight(re);
  }

  function open() {
    if (!bar || root.owner('find') !== me) build();
    root.claim('find', me);
    show(true);
    root.flag('finding', true);
    // the selection in the open editor as the query
    const ed = c.editing && c.editorOf(c.editing);
    if (ed) { const s = ed.view.state.selection.main; if (!s.empty && s.to - s.from < 200) { q = ed.view.state.sliceDoc(s.from, s.to); bar.find.value = q; } }
    bar.find.focus();
    bar.find.select();
    cur = -1;
    run();
  }
  function closeBar() {
    if (!bar || root.owner('find') !== me) return;
    show(false);
    root.flag('finding', false);
    for (const u of c.ui.values()) u.cls('has-match', false);
    const ed = c.editing && c.editorOf(c.editing);
    ed?.highlight(null);
    if (ed) ed.view.focus();
  }

  return { open, close: closeBar, search, replaceAll, applyTo, refresh: () => { if (bar && root.owner('find') === me && bar.model.visible.peek()) { matches = search(q); paint(); } }, get query() { return q; } };
}
