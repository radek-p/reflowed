// The command layer's units (app/src/commands/), in Node: the registry, the shortcuts
// dialog's rows (the same as the table app.js kept by hand), and the editor's commands on a DocSession over a Memory
// store (the same operations, saved and undoable, as the menus and keys did directly).
//   node tests/test-commands-units.ts
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p: string) => import(pathToFileURL(join(HERE, p)).href);
const { createCommands, editorCommands, createEditorKeys } = await imp('app/src/commands/index.js');
const { createDocSession } = await imp('app/src/doc/session.ts');
const { createRefs } = await imp('app/src/refs/index.ts');
const { memoryStore, ids } = await imp('app/src/store/api.ts');

let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };

// ── the registry ──
{
  const seen: string[] = [];
  const R = createCommands({ context: (via: string) => ({ via, seen }) });
  R.define({ id: 'a.run', label: 'Run', key: 'run', shortcut: 'R', run: (c: any, i: any) => { c.seen.push(`${c.via}:${i.x}`); return i.x * 2; } });
  R.define({ id: 'a.never', label: 'Never', when: () => false, run: () => { throw new Error('ran'); } });
  let dup = false; try { R.define({ id: 'a.run', label: '', run: () => {} }); } catch { dup = true; }
  let badId = false; try { R.define({ id: 'nodot', label: '', run: () => {} }); } catch { badId = true; }
  const out = R.call('a.run', { x: 3 }, { via: 'key' });
  const never = R.call('a.never');
  const mi = R.menuItem('a.run', { x: 4 }), mn = R.menuItem('a.never'), forced = R.menuItem('a.run', {}, { disabled: true });
  mi.fn();
  check('registry: define (ids group.verb, once), call with its via, `when` false skips it, menu entries from commands (label, data-action key, shortcut, disabled), recent calls',
    out === 6 && never === undefined && dup && badId && mi.label === 'Run' && mi.key === 'run' && mi.shortcut === 'R' && !mi.disabled && mn.disabled && forced.disabled
      && seen.join() === 'key:3,ui:4' && R.recent().map((r: any) => `${r.id}/${r.via}`).join() === 'a.run/key,a.run/ui', { seen, recent: R.recent() });
}

// ── the shortcuts dialog: its rows, as the old hand-kept table listed them ──
// (keys with a modifier as the workbench writes its own: ⇧⌘Z on macOS, Ctrl+Shift+Z on Windows and Linux, never "CtrlZ")
// (Enter as ↵ on macOS, spelled out elsewhere)
for (const [platform, mod, sh, alt, ret] of [['mac', '⌘', '⇧⌘', '⌥', '↵'], ['other', 'Ctrl+', 'Ctrl+Shift+', 'Alt+', 'Enter']]) {
  const enter = `${mod}${ret}`;
  const old = [
    ['↑ ↓ or j k', 'Select the block above / below'], [ret, 'Edit the selected block'], ['Esc', 'Leave the editor (the block stays selected)'],
    [`${alt}↑ ${alt}↓`, 'Move the block'], [enter, 'Split the block at the caret'], ['⌫ at the start', 'Merge with the block above'],
    [platform === 'mac' ? '⇧↵' : 'Shift+Enter', 'New block below'], ['/', 'Block types (in an empty block, or with a block selected)'], [`${mod}D`, 'Duplicate'], ['⌫ / Del', 'Delete the selected block'],
    [`${mod}Z  ${sh}Z`, 'Undo / redo block changes'], [`${mod}F`, 'Find and replace'], [`${sh}F`, 'Focus mode'], [`${mod}\\`, 'Sidebar'], [`${mod}B`, 'Bold, in a block\'s source (elsewhere: the sidebar)'],
    [`F12 or ${platform === 'mac' ? '⌘' : 'Ctrl'}-click`, 'Go to the label or bibliography entry'],
  ];
  const C = createCommands({ context: () => ({}) }).define(editorCommands(platform));
  const rows = C.shortcuts();
  check(`shortcuts (${platform}): the dialog's rows are the commands', equal to the old hand-kept table`, JSON.stringify(rows) === JSON.stringify(old), rows);
  const menu = ['block.duplicate', 'doc.undo', 'find.open', 'view.focusMode', 'block.moveUp', 'block.moveDown'].map((id) => C.menuItem(id).shortcut);
  check(`shortcuts (${platform}): the menus' keys`, JSON.stringify(menu) === JSON.stringify([`${mod}D`, '', `${mod}F`, `${sh}F`, `${alt}↑`, `${alt}↓`]), menu);
}

// ── the editor's commands on a DocSession (Memory store) ──
{
  const store = memoryStore();
  const id = await store.createDoc({ title: 'T', preamble: '\\documentclass{article}', blocks: [
    { kind: 'heading', source: '\\section{A}' }, { kind: 'paragraph', source: 'One two' }, { kind: 'paragraph', source: 'Three' }] });
  const noop = () => {};
  const nest = { repair: (l: any[]) => ({ blocks: l, changed: [] }), order: (l: any[]) => l, contextView: (l: any[]) => l, extraContext: () => '', compileSource: (b: any) => b.source,
    treeSig: () => 'flat', remove: () => false, duplicate: () => false, moveBy: () => false, moveIndex: () => false, split: () => null, merge: () => null, parentAt: () => null, visibleStep: (i: number, d: number) => i + d };
  const edited: string[] = [], selected: string[] = [], page: string[] = [];
  const S = createDocSession({ store, ids, refs: createRefs(), backend: () => ({ id: 'v1' }), nest, hooks: {
    saveChanged: noop, saveFailed: noop, unplaced: noop, beforeUndo: noop, afterUndo: noop,
    ops: { edits: { leaveAll: noop, leaveBlock: noop, editorOf: () => null, sessionsOf: () => [] }, applied: noop,
      enterEdit: (bid: string, _e: any, caret: any) => edited.push(`${bid}@${caret}`), kindOf: () => 'paragraph', toast: noop, undo: noop, duplicateOwned: () => false, gone: noop } } });
  await S.load(id); S.loaded();
  const ctx = (via: string) => ({ via, S, selected: () => selected.at(-1) ?? null, select: (bid: string) => selected.push(bid), focusedPane: () => 'a',
    enterEdit: (bid: string, _e: any, caret: any) => edited.push(`${bid}@${caret}`), parentAt: () => null,
    selectStep: (from: number, dir: number) => selected.push(S.doc.blocks[from + dir]?.id), selectIndex: (k: number) => selected.push(S.doc.blocks[k]?.id), slashBelow: noop,
    page: new Proxy({ can: { resetSeed: () => false, importTex: () => true, exportZip: () => true, exportPdf: () => false } }, { get: (t: any, k: string) => t[k] ?? ((...a: any[]) => page.push(`${k}${a.length ? `(${JSON.stringify(a[0])})` : ''}`)) }) });
  const C = createCommands({ context: ctx }).define(editorCommands('mac'));
  const text = () => S.doc.blocks.map((b: any) => b.source).join('|');
  const start = text();
  const [h, p1, p2] = S.doc.blocks.map((b: any) => b.id);
  const nid = C.call('block.insert', { index: 1, kind: 'paragraph', source: 'New' }, { via: 'test' });
  C.call('block.split', { id: p1, offset: 3 }, { via: 'test' });
  const afterSplit = text();
  C.call('block.moveUp', { id: p2 }, { via: 'key' });
  C.call('block.setSource', { id: nid, source: 'Newer' }, { via: 'test' });
  const below = C.call('block.insertBelow', { id: h, pane: 'b' }, { via: 'key' });
  C.call('block.delete', { id: below }, { via: 'ui' });
  C.call('block.duplicate', { id: h }, { via: 'ui' });
  await S.persist.settled();
  const done = text();
  const storeNow = (await store.getBlocks(id)).sort((a: any, b: any) => (a.pos < b.pos ? -1 : 1)).map((b: any) => b.source).join('|');
  let k = 0; while (C.call('doc.undo', {}, { via: 'key' }) && k < 20) k++;
  await S.persist.settled();
  const back = text(), backStore = (await store.getBlocks(id)).sort((a: any, b: any) => (a.pos < b.pos ? -1 : 1)).map((b: any) => b.source).join('|');
  const redo = C.call('doc.redo', {}, { via: 'key' });
  const mergeFirst = C.call('block.merge', { id: S.doc.blocks[0].id });                 // nothing above: `when` says no
  C.call('doc.exportZip'); C.call('doc.exportPdf'); C.call('view.focusMode', { on: false }); C.call('find.open');
  check('commands: insert, split, move, setSource, insertBelow (edits the new block in its pane), delete, duplicate: in memory and in the store; every one undone with doc.undo; redo; a merge at the top and a PDF export without one are refused',
    afterSplit === '\\section{A}|New|One|two|Three' && done === storeNow && edited.includes(`${below}@null`) && back === start && backStore === start && k === 7 && redo === true && mergeFirst === undefined
      && page.join() === 'exportZip,toggleFocus(false),find', { afterSplit, done, storeNow, back, k, page, edited });
  // the block editor's keys (commands/editor-keys.js)
  const left: string[] = [];
  const keys = createEditorKeys({ command: (cid: string, input: any, via: string) => C.call(cid, input, { via }), doc: () => S.doc, indexOf: S.model.indexOf, blockById: S.model.blockById,
    enterEdit: (bid: string, _e: any, caret: any, _l: any, _r: any, pane: string) => edited.push(`${bid}@${caret}:${pane}`), openSlashMenu: noop, focusEditor: noop });
  const sess = (bid: string) => ({ id: bid, pane: 'b', editor: { caret: 2 }, leave: () => left.push(bid), drop: noop });
  edited.length = 0;
  const first = S.doc.blocks[0].id, second = S.doc.blocks[1].id;
  const esc = keys(sess(second), 'escape'), top = keys(sess(first), 'up-top'), up = keys(sess(second), 'up-top'), noEditor = keys({ id: second, pane: 'b', editor: null }, 'escape');
  check('editor keys: Esc leaves (the block selected), ↑ at the top of the first block is not handled, of the second edits the first in the same pane; no editor, nothing',
    esc === true && left.join() === second && selected.at(-1) === second && top === false && up === true && edited.at(-1) === `${first}@null:b` && noEditor === false, { left, edited, selected: selected.at(-1) });
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
