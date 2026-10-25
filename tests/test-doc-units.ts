// The document model's units (6–8: app/src/doc/), in Node on a Memory store, no DOM.
//   node tests/test-doc-units.ts
// Each check runs a sequence of edits the editor makes (place, type, unplace, rekey, meta, title) and compares the
// store and the op log with the document in memory.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p: string) => import(pathToFileURL(join(HERE, p)).href);
const { memoryStore, ids, blankDoc } = await imp('app/src/store/api.ts');
const { createPersist, splice } = await imp('app/src/doc/persist.ts');
const { createModel } = await imp('app/src/doc/model.js');

let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };

/** a clock the test advances by hand */
function fakeClock() {
  let now = 0, seq = 0; const timers: { at: number; fn: () => void; id: number }[] = [];
  return {
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimeout: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    tick(ms: number) { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.fn(); } now = end; },
    pending: () => timers.length,
  };
}

async function setup(o: { readOnly?: boolean } = {}) {
  const store = memoryStore();
  const id = await store.createDoc(typeof blankDoc === 'function' ? { title: 'T', preamble: '\\documentclass{article}' } : { title: 'T' });
  const d = await store.getDoc(id);
  const doc: any = { ...d, blocks: d.blocks ?? await store.getBlocks(id) };
  const clock = fakeClock();
  const changes: number[] = [];
  const safeties: string[] = [];
  const persist = createPersist({ store, ids, doc: () => doc, readOnly: () => !!o.readOnly, clock, onChange: () => changes.push(1),
    beforeDestructive: (_s: any, _id: string, what: string) => { safeties.push(what); } });
  persist.loaded(doc.blocks);
  const unplaced: string[] = [];
  const model = createModel({ ids, persist, doc: () => doc, onUnplace: (bid: string) => unplaced.push(bid) });
  return { store, id, doc, clock, persist, model, changes, safeties, unplaced };
}
const stored = async (t: any) => (await t.store.getBlocks(t.id)).sort((a: any, b: any) => (a.pos < b.pos ? -1 : 1)).map((b: any) => `${b.kind}:${b.source}`).join('|');
const inMemory = (t: any) => t.doc.blocks.map((b: any) => `${b.kind}:${b.source}`).join('|');

// splice: the one change between two sources
{
  const ok = JSON.stringify(splice('abcdef', 'abXYef')) === JSON.stringify([2, 4, 'XY']) && JSON.stringify(splice('', 'x')) === JSON.stringify([0, 0, 'x'])
    && JSON.stringify(splice('same', 'same')) === JSON.stringify([4, 4, '']) && JSON.stringify(splice('aaa', 'aa')) === JSON.stringify([2, 3, '']);
  check('splice: prefix and suffix kept, the middle replaced', ok);
}
// place, type (debounced), unplace: the store and the op log follow the document
{
  const t = await setup();
  for (const b of [...t.doc.blocks]) t.model.unplaceBlock(b.id);
  const a = t.model.newBlock('paragraph', 'Alpha', null), b = t.model.newBlock('heading', '\\section{B}', 'sec.tex');
  t.model.placeBlock(a, 0); t.model.placeBlock(b, 0);
  a.source = 'Alpha beta'; t.persist.saveBlock(a, { typing: true });
  const typingBefore = t.persist.typing();
  t.clock.tick(399);
  while (t.persist.writer.pending) await t.persist.writer.idle();
  const notYet = (await t.store.getOps(t.id)).filter((o: any) => o.blockId === a.id).map((o: any) => o.t).join();
  t.clock.tick(1);
  await t.persist.settled();
  const ops = (await t.store.getOps(t.id)).filter((o: any) => o.blockId === a.id).map((o: any) => o.t);
  const edit = (await t.store.getOps(t.id)).find((o: any) => o.t === 'edit');
  check('model: placed blocks are in order (fractional keys), saved, each with an insert op', inMemory(t) === await stored(t) && t.doc.blocks[0].id === b.id && b.pos < a.pos && b.file === 'sec.tex' && a.file === 'main.tex', { mem: inMemory(t), store: await stored(t) });
  check('persist: typing writes after 400 ms of quiet, one edit op (a splice from the stored source)', typingBefore && notYet === 'insert' && ops.join() === 'insert,edit' && JSON.stringify(edit?.payload?.changes) === JSON.stringify([[5, 5, ' beta']]) && !t.persist.typing(), { ops, edit: edit?.payload, notYet });
  const r = t.model.unplaceBlock(b.id);
  await t.persist.settled();
  check('model: unplace removes it from the list and the store, with a delete op; onUnplace first; one safety snapshot a minute', r?.i === 0 && r.b.id === b.id && inMemory(t) === await stored(t) && t.unplaced.includes(b.id) && (await t.store.getOps(t.id)).some((o: any) => o.t === 'delete' && o.blockId === b.id) && t.safeties.length === 1, { safeties: t.safeties, mem: inMemory(t) });
  check('model: unplacing an unknown block does nothing', t.model.unplaceBlock('nope') === null);
}
// an unplaced block's pending typing is dropped, not written after its delete
{
  const t = await setup();
  const a = t.model.newBlock('paragraph', 'x', null); t.model.placeBlock(a, t.doc.blocks.length);
  a.source = 'xy'; t.persist.saveBlock(a, { typing: true });
  t.model.unplaceBlock(a.id);
  t.clock.tick(1000); await t.persist.settled();
  check('persist: a removed block\'s typing timer is cancelled (nothing written after the delete)', !(await t.store.getBlocks(t.id)).some((x: any) => x.id === a.id) && t.clock.pending() === 0);
}
// rekey: the longest run in order keeps its keys
{
  const t = await setup();
  let k: string | null = null; const list = [0, 1, 2, 3, 4].map(() => ({ pos: (k = ids.keyBetween(k, null)) }));
  const moved = [list[0], list[3], list[1], list[2], list[4]];            // a3 moved up
  const kept = moved.map((x) => x.pos);
  t.model.rekey(moved);
  const sorted = moved.every((x, i) => i === 0 || moved[i - 1].pos < x.pos);
  const changed = moved.filter((x, i) => x.pos !== kept[i]).length;
  const fresh = [{ pos: '' }, { pos: list[1].pos }, { pos: '' }];
  t.model.rekey(fresh);
  check('model: rekey gives a list in its new order sorted keys, changing only the block out of the run; new blocks get keys', sorted && changed === 1 && fresh.every((x, i) => x.pos && (i === 0 || fresh[i - 1].pos < x.pos)), { moved, fresh });
}
// meta and the title
{
  const t = await setup();
  t.persist.saveMeta({ preamble: { source: '\\documentclass{amsart}', rev: 1 } });
  t.doc.title = 'Renamed'; t.persist.setTitle();
  const typing = t.persist.typing();
  await t.persist.settled();
  const rec = await t.store.getDoc(t.id);
  const metaOps = (await t.store.getOps(t.id)).filter((o: any) => o.t === 'meta');
  check('persist: meta written with a meta op; a title typed just before settled() is written by it', typing && rec.title === 'Renamed' && rec.preamble.source === '\\documentclass{amsart}' && metaOps.length === 2 && !t.persist.typing(), { title: rec.title, metaOps: metaOps.length });
}
// a pagehide (or a close) right after a rename: flushTyping writes the title at once, and its timer does not again
{
  const t = await setup();
  t.doc.title = 'Away'; t.persist.setTitle();
  t.persist.flushTyping();
  while (t.persist.writer.pending) await t.persist.writer.idle();
  const title = (await t.store.getDoc(t.id)).title;
  t.clock.tick(1000);
  while (t.persist.writer.pending) await t.persist.writer.idle();
  const metaOps = (await t.store.getOps(t.id)).filter((o: any) => o.t === 'meta').length;
  check('persist: flushTyping (pagehide, close) writes a pending title once, the timer cancelled', title === 'Away' && metaOps === 1 && t.clock.pending() === 0 && !t.persist.typing(), { title, metaOps });
}
// read-only: nothing is written
{
  const t = await setup({ readOnly: true });
  const before = await stored(t);
  const a = t.model.newBlock('paragraph', 'never', null); t.model.placeBlock(a, 0);
  t.persist.saveMeta({ title: 'no' });
  await t.persist.settled();
  check('persist: a read-only document is never written', await stored(t) === before && (await t.store.getDoc(t.id)).title === 'T');
}

// ── the history: one per document, its steps data, their meaning the appliers' ──
{
  const { createHistory } = await imp('app/src/doc/history.js');
  const seen: string[] = [];
  const H = createHistory({ limit: 3, before: (u: any, how: string) => seen.push(`before ${how} ${u.label}`), after: (u: any, how: string) => seen.push(`after ${how} ${u.label}`) });
  let x = 0;
  H.define('add', (st: any, how: string) => { x += how === 'undo' ? -st.k : st.k; });
  const doAdd = (k: number) => { x += k; H.record({ type: 'add', label: `+${k}`, k }); };
  for (const k of [1, 2, 3, 4]) doAdd(k);
  const afterDo = x;
  const u1 = H.undo()?.label, u2 = H.undo()?.label;
  const r1 = H.redo()?.label;
  doAdd(10);
  const noRedo = H.redo();
  const labels = H.labels().join();
  const e = H.top(); e.blockId = 'B';
  const dropped = H.drop((y: any) => y.blockId === 'B') && !H.labels().includes('+10');
  // a step whose applier says no is skipped: the next one is undone
  H.define('never', () => false);
  H.record({ type: 'never', label: 'stale' });
  const skip = H.undo()?.label;
  const json = H.steps().every((st: any) => JSON.stringify(JSON.parse(JSON.stringify(st))) === JSON.stringify(st) && !Object.values(st).some((v) => typeof v === 'function'));
  H.clear();
  check('history: steps are data (no functions); undo and redo through the appliers, in order, at most `limit` steps, a new step empties redo, drop by tag, a step that no longer applies skipped, before/after around each',
    afterDo === 10 && u1 === '+4' && u2 === '+3' && r1 === '+3' && noRedo === null && labels === '+2,+3,+10' && dropped && skip === '+3' && json && !H.canUndo()
      && seen.slice(0, 6).join('|') === 'before undo +4|after undo +4|before undo +3|after undo +3|before redo +3|after redo +3',
    { afterDo, u1, u2, r1, labels, skip, seen });
}
// ── typing as steps: CodeMirror's groups (adjacent typing within 500 ms, the caret not moved between) ──
{
  const { createHistory } = await imp('app/src/doc/history.js');
  const { textSteps, applyText } = await imp('app/src/doc/text-step.js');
  const { EditorState } = await imp('app/node_modules/@codemirror/state/dist/index.js');
  const H = createHistory();
  let now = 0;
  const rec = textSteps(H, { doc: () => 'D', now: () => now });
  let st = EditorState.create({ doc: 'abc', selection: { anchor: 3 } });
  const type = (ins: string, at = st.selection.main.head, ue = 'input.type') => { const tr = st.update({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, userEvent: ue }); st = tr.state; rec.typed('X', 'a', [tr]); };
  type('d'); now += 100; type('e'); now += 100; type('f');            // one group: "def"
  now += 600; type('g');                                               // a pause: a step of its own
  now += 100; st = st.update({ selection: { anchor: 0 } }).state; type('Z');   // the caret moved: its own
  now += 100; type('1', st.selection.main.head, 'input.paste');        // a paste: its own
  const steps = H.steps();
  const shape = steps.map((s: any) => `${s.block}:${s.before.head}->${s.after.head}`).join(' ');
  let src = st.doc.toString();
  const undone: string[] = [];
  for (let k = steps.length - 1; k >= 0; k--) { src = applyText(src, steps[k], 'undo'); undone.push(src); }
  let re = src; for (const s of steps) re = applyText(re, s, 'redo');
  check('text steps: CodeMirror\'s grouping (typing within 500 ms, adjacent; a pause, a moved caret or a paste starts a step); each undoes and redoes on the source, data only',
    steps.length === 4 && shape === 'X:3->6 X:6->7 X:0->1 X:1->2' && undone.join('|') === 'Zabcdefg|abcdefg|abcdef|abc' && re === st.doc.toString() && steps.every((s: any) => s.doc === 'D' && s.type === 'text')
      && applyText('too short', steps[0], 'undo') === null, { shape, undone, re });
}
// ── the block operations, each one undo step, on a Memory store ──
{
  const { createHistory } = await imp('app/src/doc/history.js');
  const { createOps } = await imp('app/src/doc/ops.ts');
  const t = await setup();
  for (const b of [...t.doc.blocks]) t.model.unplaceBlock(b.id);
  const H = createHistory();
  const calls: string[] = [];
  const records: any[] = [];
  const nest = { remove: () => false, duplicate: () => false, moveBy: () => false, moveIndex: () => false, split: () => null, merge: () => null };
  const hooks = {
    edits: { leaveAll: () => calls.push('leaveAll'), leaveBlock: () => calls.push('leaveBlock'), editorOf: () => null, sessionsOf: () => [] },
    applied: (r: any) => { calls.push('applied'); records.push(r); },
    enterEdit: (id: string, _e: any, caret: number) => calls.push(`edit ${id}@${caret}`), kindOf: (s: string) => (s.startsWith('\\section') ? 'heading' : 'paragraph'),
    toast: (m: string) => calls.push(`toast ${m}`), undo: () => H.undo(), duplicateOwned: () => false, gone: (id: string) => calls.push(`gone ${id}`),
  };
  const O = createOps({ model: t.model, persist: t.persist, history: H, doc: () => t.doc, ids, nest, hooks });
  const a = O.insertBlock(0, 'paragraph', 'One two'), b = O.insertBlock(1, 'heading', '\\section{S}'), c = O.insertBlock(2, 'paragraph', 'Three');
  await t.persist.settled();
  const start = inMemory(t);
  const nid = O.splitBlock(a.id, 3);
  const split = inMemory(t);
  O.mergeBlock(nid);
  const merged = inMemory(t);
  O.moveBlock(c.id, 0);
  const moved = inMemory(t);
  O.duplicateBlock(b.id);
  O.setSource(a.id, 'One, two');
  O.removeBlock(c.id);
  await t.persist.settled();
  const done = inMemory(t), doneStored = await stored(t);
  while (H.canUndo() && H.labels().length > 3) H.undo();             // back to the three inserts
  await t.persist.settled();
  const back = inMemory(t), backStored = await stored(t);
  check('ops: split, merge, move, duplicate, setSource, remove: each in memory and in the store; undone in turn, the document and the store are as before',
    split === 'paragraph:One|paragraph:two|heading:\\section{S}|paragraph:Three' && merged === 'paragraph:One\n\ntwo|heading:\\section{S}|paragraph:Three' && moved.startsWith('paragraph:Three|')
      && done === doneStored && back === start && backStored === start && calls.includes('toast Block deleted'),
    { split, merged, moved, done, back, backStored, start });
  // applyBlocks: a whole new list as one step; kept blocks keep their keys where the order allows
  const pos0 = new Map(t.doc.blocks.map((x: any) => [x.id, x.pos]));
  O.applyBlocks('reverse', (list: any[]) => [...list].reverse().concat([{ id: 'NEW', pos: '', kind: 'paragraph', source: 'New', file: 'main.tex', attrs: {} }]));
  await t.persist.settled();
  const rev = inMemory(t), revStored = await stored(t);
  const keptKeys = t.doc.blocks.filter((x: any) => pos0.get(x.id) === x.pos).length;
  const opsLog = (await t.store.getOps(t.id)).slice(-5).map((o: any) => o.t).sort().join();
  H.undo(); await t.persist.settled();
  check('ops: applyBlocks makes the new list one step (rekeyed, the longest run in order keeps its keys, an insert op for the new block); its undo restores the list and the store',
    rev === 'paragraph:Three|heading:\\section{S}|paragraph:One two|paragraph:New' && rev === revStored && keptKeys === 1 && /insert/.test(opsLog) && inMemory(t) === start && await stored(t) === start,
    { rev, revStored, keptKeys, opsLog, after: inMemory(t) });
  // every change ends in one change record, published once (the page's hooks.applied, then onChange): what
  // it changed, not "draw everything" from inside each operation; a change inside another is part of it
  records.length = 0;
  const seen: any[] = [];
  const off = O.onChange((r: any) => seen.push(r));
  const rv0 = O.revision();
  const x = O.insertBlock(0, 'paragraph', 'X');
  O.setSource(x.id, 'X2');
  O.moveBlock(x.id, 2);
  let y = '';
  O.change('two at once', () => { O.setSource(x.id, 'X3'); y = O.insertBlock(0, 'paragraph', 'Y').id; });
  const labels = H.labels().slice(-4).join('|');
  H.undo();
  O.setSource(x.id, 'X4', { record: false });
  O.change('nothing', () => {});
  off();
  O.setSource(x.id, 'X5');
  const sh = (r: any) => `${r.how} ${r.label}: ${r.blocks.length}${r.added.length ? ` +${r.added.join()}` : ''}${r.removed.length ? ` -${r.removed.join()}` : ''}${r.order ? ' order' : ''}`;
  const got = records.map(sh).join(' / ').split(x.id).join('X').split(y).join('Y');
  check('ops: one change record per change, naming what changed (added, removed, the order, the blocks); a change inside another is one step and one record; an undo is one; a quiet setSource is published without a step; subscribers stop when they unsubscribe',
    got === 'do insert block: 1 +X order / do edit: 1 / do move block: 1 order / do two at once: 2 +Y order / undo two at once: 2 -Y order / do edit: 1 / do edit: 1'
      && seen.length === 6 && O.revision() - rv0 === 7 && labels === 'insert block|edit|move block|two at once',
    { got, seen: seen.length, revs: O.revision() - rv0, labels });
}

// ── random sequences of operations and typing: undone to the start and redone to the end, the document, the
// store and the op log's replay agree at every end ──
{
  const { createHistory } = await imp('app/src/doc/history.js');
  const { createOps } = await imp('app/src/doc/ops.ts');
  const { textSteps, applyText } = await imp('app/src/doc/text-step.js');
  const { replay, stateOf, diffStates } = await imp('app/src/store/replay.ts');
  const { EditorState } = await imp('app/node_modules/@codemirror/state/dist/index.js');
  let seed = 7;
  const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  const bad: string[] = [];
  for (let run = 0; run < 6; run++) {
    const t = await setup();
    for (const b of [...t.doc.blocks]) t.model.unplaceBlock(b.id);
    const H = createHistory({ limit: 1000 });
    const nest = { remove: () => false, duplicate: () => false, moveBy: () => false, moveIndex: () => false, split: () => null, merge: () => null };
    const hooks = {
      edits: { leaveAll: () => {}, leaveBlock: () => {}, editorOf: () => null, sessionsOf: () => [] },
      applied: () => {}, enterEdit: () => {},
      kindOf: (s: string) => (s.startsWith('\\section') ? 'heading' : 'paragraph'), toast: () => {}, undo: () => H.undo(), duplicateOwned: () => false, gone: () => {},
      meta: (f: string, v: any) => { if (f === 'preamble') { t.doc.preamble = { source: v }; t.persist.saveMeta({ preamble: t.doc.preamble }); } },
    };
    const O = createOps({ model: t.model, persist: t.persist, history: H, doc: () => t.doc, ids, nest, hooks });
    // the page's 'text' applier without an editor: the model (edit/undo.js's fallback)
    H.define('text', (st: any, how: string) => { const b = t.model.blockById(st.block); const s = b && applyText(b.source, st, how); if (s == null) return false; b.source = s; t.persist.saveBlock(b); return true; });
    let now = 0;
    const rec = textSteps(H, { doc: () => t.id, now: () => now });
    for (const s of ['One two three', '\\section{S}', 'Four five']) O.insertBlock(t.doc.blocks.length, s.startsWith('\\') ? 'heading' : 'paragraph', s);
    H.clear();
    await t.persist.settled();
    const snap = JSON.parse(JSON.stringify(t.doc));
    const ops0 = (await t.store.getOps(t.id)).length;
    const start = inMemory(t);
    const log: string[] = [];
    for (let k = 0; k < 30; k++) {
      const bl = t.doc.blocks, n = bl.length, b = bl[rnd(n)];
      const r = rnd(9);
      if (r === 0) { O.insertBlock(rnd(n + 1), 'paragraph', `new ${k}`); log.push('insert'); }
      else if (r === 1 && n > 1) { O.removeBlock(b.id, { quiet: true }); log.push('remove'); }
      else if (r === 2) { O.splitBlock(b.id, rnd(b.source.length + 1)); log.push('split'); }
      else if (r === 3 && n > 1) { O.mergeBlock(b.id); log.push('merge'); }
      else if (r === 4) { O.moveBlock(b.id, rnd(n)); log.push('move'); }
      else if (r === 5) { O.duplicateBlock(b.id); log.push('duplicate'); }
      else if (r === 6) { O.setSource(b.id, `${b.source} set${k}`); log.push('setSource'); }
      else if (r === 7) { O.applyBlocks('reverse', (list: any[]) => [...list].reverse()); log.push('applyBlocks'); }
      else {
        // typing: a few keystrokes in one editor, as CodeMirror makes them (some join, some not)
        let st = EditorState.create({ doc: b.source, selection: { anchor: rnd(b.source.length + 1) } });
        for (let j = 0; j < 1 + rnd(4); j++) {
          const at = st.selection.main.head, tr = st.update({ changes: { from: at, insert: 'xy'.slice(0, 1 + rnd(2)) }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
          st = tr.state; b.source = st.doc.toString(); t.persist.saveBlock(b, { typing: true }); rec.typed(b.id, 'a', [tr]);
          now += rnd(2) ? 100 : 700;
        }
        rec.clearGroup();
        log.push('type');
      }
      if (rnd(3) === 0) t.clock.tick(500);
    }
    t.clock.tick(500);
    await t.persist.settled();
    const end = inMemory(t), endStored = await stored(t);
    const steps = H.steps();
    const dataOnly = steps.every((s: any) => !JSON.stringify(s, (_k, v) => (typeof v === 'function' ? '!fn' : v)).includes('!fn'));
    while (H.undo()) { /* */ }
    t.clock.tick(500); await t.persist.settled();
    const back = inMemory(t), backStored = await stored(t);
    const rp1 = diffStates(replay(snap, (await t.store.getOps(t.id)).slice(ops0)), stateOf(t.doc));
    while (H.redo()) { /* */ }
    t.clock.tick(500); await t.persist.settled();
    const again = inMemory(t), againStored = await stored(t);
    const rp2 = diffStates(replay(snap, (await t.store.getOps(t.id)).slice(ops0)), stateOf(t.doc));
    const ok = dataOnly && end === endStored && back === start && backStored === start && again === end && againStored === end && !rp1.length && !rp2.length;
    if (!ok) bad.push(JSON.stringify({ run, log: log.join(','), end, back, start, again, rp1: rp1.slice(0, 3), rp2: rp2.slice(0, 3), dataOnly }).slice(0, 900));
  }
  check('history: 6 random runs of 30 operations and typing: all undone = the start, all redone = the end, in memory, in the store and in the op log\'s replay; every step data', bad.length === 0, bad[0] ?? '');
}

// ── derived state and results per document: keys as the editor made them, two documents apart ──
{
  const { createDerived, hash } = await imp('app/src/doc/derived.js');
  const { createResults } = await imp('app/src/doc/results.js');
  const { blockCacheKey } = await imp('app/src/doc/cache-key.js');
  const { splitMeta, blockSource } = await imp('app/src/meta/compile.ts');
  const { guessKind, theoremKinds } = await imp('app/src/doc/kinds.js');
  const { createRefs } = await imp('app/src/refs/index.ts');
  // the intro from its source (always in the checkout)
  const { buildIntroSeed } = await import('../samples/intro/seed-intro.ts');
  const inits: [string, any][] = [['intro', (await buildIntroSeed()).seed.init]];
  // a flat document (no containers): the nesting's view of it is the list itself
  const nest = { contextView: (l: any[]) => l, extraContext: () => '', compileSource: (b: any) => b.source, treeSig: () => 'flat' };
  const backend = { id: 'tectonic', keyFor: (b: any) => `e1.${hash(`${b.context}\u0000${b.source}`)}` };
  const make = (d: any) => {
    const results = createResults(), refs = createRefs();
    const blockById = (id: string) => d.blocks.find((b: any) => b.id === id);
    const derived = createDerived({ doc: () => d, blockById, nest, refs, backend: () => backend, salt: () => 'S', results });
    derived.loadAssets(d.assets); derived.preambleChanged(); derived.computeContexts();
    return { derived, results, refs };
  };
  const docs = inits.map(([p, s]) => { return { id: p, title: s.title, preamble: { source: s.preamble }, bib: s.bib, assets: (s.assets ?? []).map((a: any) => ({ name: a.name, hash: a.hash ?? a.name })), blocks: s.blocks }; });
  let same = true, n = 0, firstBad = '';
  const sets = docs.map((d) => {
    const { derived } = make(d);
    // the editor's earlier formula, written out: the key of each block from the same parts
    const pre = splitMeta(d.preamble.source);
    const preHash = hash(`${pre.preamble}\n${d.bib?.source ?? ''}`);
    const thm = new Set(theoremKinds(d.preamble.source).map((t: any) => t.env));
    const keys = d.blocks.map((b: any) => {
      const want = blockCacheKey(backend, { source: blockSource(b.kind, b.source, pre), context: derived.contexts.get(b.id) ?? '' }, { salt: 'S', preHash, assets: derived.assetSig(b) });
      const got = derived.ck(b);
      n++; if (got !== want) { same = false; firstBad ||= `${d.id} ${b.id}`; }
      if (derived.kindOf(b.source) !== guessKind(b.source, thm)) { same = false; firstBad ||= `kind ${b.id}`; }
      return got;
    });
    return new Set(keys);
  });
  check(`derived: every block's key of the seeds equals the formula the editor used (${n} blocks, ${docs.length} documents), the kinds too`, docs.length > 0 && same && n > 0, firstBad);
  // two documents' results and refs kept apart, asked in turn
  if (docs.length === 2) {
    const A = make(docs[0]), B = make(docs[1]);
    A.results.cache.set('k', { status: 'ok' }); A.results.preamble.value = { errors: [{ line: 1, message: 'x' }], warnings: [] };
    const apart = !B.results.cache.has('k') && B.results.preambleErrors.value.length === 0 && A.results.preambleErrors.value.length === 1
      && [...sets[0]].every((k) => !sets[1].has(k)) && A.derived.preHash !== B.derived.preHash;
    A.results.clear();
    check('results: two documents\' result maps, preamble problems and keys are their own; clear() empties the map, the problems stay', apart && A.results.cache.size === 0 && A.results.preambleErrors.value.length === 1);
  }
}

// ── the DocSession: one open document, loaded from the store, its parts composed ──
{
  const { createDocSession } = await imp('app/src/doc/session.ts');
  const { createRefs } = await imp('app/src/refs/index.ts');
  const store = memoryStore();
  const id = await store.createDoc({ title: 'T', preamble: '\\documentclass{article}\n\\newtheorem{lemma}{Lemma}', blocks: [
    { kind: 'heading', source: '\\section{A}' }, { kind: 'paragraph', source: 'One.' }, { kind: 'lemma', source: '\\begin{lemma}\\label{l}x\\end{lemma}' }] });
  const repaired: string[] = [];
  const nest = { repair: (l: any[]) => ({ blocks: l, changed: [] }), order: (l: any[]) => l, contextView: (l: any[]) => l, extraContext: () => '', compileSource: (b: any) => b.source, treeSig: () => 'flat',
    remove: () => false, duplicate: () => false, moveBy: () => false, moveIndex: () => false, split: () => null, merge: () => null };
  const noop = () => {};
  const mk = () => createDocSession({ store, ids, refs: createRefs(), backend: () => ({ id: 'v1' }), nest, hooks: {
    saveChanged: noop, saveFailed: noop, unplaced: noop, beforeUndo: noop, afterUndo: noop,
    ops: { edits: { leaveAll: noop, leaveBlock: noop, editorOf: () => null, sessionsOf: () => [] }, applied: noop,
      enterEdit: noop, kindOf: (s: string) => 'paragraph', toast: noop, undo: noop, duplicateOwned: () => false, gone: noop } } });
  const A = mk(), B = mk();
  const okA = await A.load(id), okB = await B.load(id), gone = await mk().load('nope');
  A.loaded(); B.loaded();
  const sorted = A.doc.blocks.every((b: any, i: number, l: any[]) => i === 0 || l[i - 1].pos <= b.pos);
  A.derived.preambleChanged(); A.derived.computeContexts();
  const key = A.derived.ck(A.doc.blocks[2]);
  A.ops.insertBlock(1, 'paragraph', 'New in A');
  await A.persist.settled();
  const bUntouched = B.doc.blocks.length === 3 && A.doc.blocks.length === 4 && A.doc !== B.doc && !B.history.canUndo() && A.history.canUndo();
  A.history.undo(); await A.persist.settled();
  const stored = (await store.getBlocks(id)).length;
  A.unload();
  check('session: load reads the document (sorted), a missing one is false; two sessions of it are apart (doc, history); an operation and its undo reach the store; unload',
    okA && okB && !gone && sorted && !!key && bUntouched && stored === 3 && A.doc === null && A.id() === null && B.id() === id, { okA, okB, gone, sorted, bUntouched, stored });
  void repaired;
}

// a block written with `expect` (store/core.ts): only over that source; another one there, or none, is a BlockConflict
{
  const store = memoryStore();
  const id = await store.createDoc({ title: 'T', blocks: [{ kind: 'paragraph', source: 'Theirs.' }] });
  const [b] = await store.getBlocks(id);
  let c1: any = null, c2: any = null;
  try { await store.putBlock(id, { ...b, source: 'Mine.', expect: 'Mine before.' }); } catch (e) { c1 = e; }
  const kept = (await store.getBlocks(id))[0];
  await store.putBlock(id, { ...b, source: 'Mine.', expect: 'Theirs.' });
  const over = (await store.getBlocks(id))[0];
  await store.deleteBlock(id, b.id);
  try { await store.putBlock(id, { ...b, source: 'Mine again.', expect: 'Mine.' }); } catch (e) { c2 = e; }
  check('store: a block written with expect only over that source; another one there (or none): BlockConflict with what is stored, nothing written, expect never stored',
    c1?.name === 'BlockConflict' && c1.stored?.source === 'Theirs.' && kept.source === 'Theirs.' && over.source === 'Mine.' && !('expect' in over) && c2?.name === 'BlockConflict' && c2.stored === null
      && (await store.getBlocks(id)).length === 0, { c1: c1?.message, kept: kept.source, over, c2: c2?.message });
}

// ── another tab's writes followed (doc/follow.ts): two sessions, each on its own store over one backend, a
// BroadcastChannel between the stores as between two tabs ──
{
  const { createDocSession } = await imp('app/src/doc/session.ts');
  const { createRefs } = await imp('app/src/refs/index.ts');
  const { CoreStore } = await imp('app/src/store/core.ts');
  const { memoryBackend } = await imp('app/src/store/backend.ts');
  const shared = memoryBackend(), channel = `follow-${process.pid}-${Date.now()}`;
  const sA = new CoreStore(shared, { channel }), sB = new CoreStore(shared, { channel });
  const id = await sA.createDoc({ title: 'T', preamble: '\\documentclass{article}', blocks: [
    { kind: 'heading', source: '\\section{A}' }, { kind: 'paragraph', source: 'One.' }, { kind: 'paragraph', source: 'Two.' }, { kind: 'paragraph', source: 'Three.' }] });
  const nest = { repair: (l: any[]) => ({ blocks: l, changed: [] }), order: (l: any[]) => l, contextView: (l: any[]) => l, extraContext: () => '', compileSource: (b: any) => b.source, treeSig: () => 'flat',
    remove: () => false, duplicate: () => false, moveBy: () => false, moveIndex: () => false, split: () => null, merge: () => null };
  const noop = () => {};
  const mk = (store: any, log: string[], toasts: any[]) => {
    const S: any = createDocSession({ store, ids, refs: createRefs(), backend: () => ({ id: 'v1' }), nest,
      beforeDestructive: (st: any, d: string, what: string) => st.snapshots.put(d, `Before ${what}`, { kind: 'auto' }),
      hooks: {
        saveChanged: noop, saveFailed: (e: any) => log.push(`failed ${e?.message}`), unplaced: (b: string) => log.push(`unplaced ${b}`), beforeUndo: noop, afterUndo: noop, gone: () => log.push('gone'),
        ops: { edits: { leaveAll: noop, leaveBlock: noop, editorOf: () => null, sessionsOf: () => [], followed: (b: string, c: any) => log.push(`followed ${b} ${JSON.stringify(c)}`) },
          applied: (r: any) => log.push(`applied ${r.how} ${r.blocks.length}${r.order ? ' order' : ''}`), enterEdit: noop, kindOf: (s: string) => (s.startsWith('\\section') ? 'heading' : 'paragraph'),
          toast: (t: string, a: any, o: any) => { log.push(`toast ${t}`); toasts.push({ t, a, o }); }, undo: noop, duplicateOwned: () => false, gone: noop,
          meta: (f: string, v: any, o: any) => { log.push(`meta ${f} save=${o?.save}`); if (f === 'title') S.doc.title = v; else if (f === 'preamble') S.doc.preamble = { source: v }; else S.doc.bib = v; } } } });
    return S;
  };
  const logA: string[] = [], logB: string[] = [], toastsB: any[] = [];
  const A = mk(sA, logA, []), B = mk(sB, logB, toastsB);
  await A.load(id); await B.load(id); A.loaded(); B.loaded();
  const list = (S: any) => S.doc.blocks.map((b: any) => b.source).join('|');
  /** wait on state (the other tab's events land asynchronously), then on both sessions' follow being idle */
  // (flush: false: B's typing is left to its timer)
  const until = async (f: () => boolean, { ms = 4000, flush = true } = {}) => {
    const t0 = Date.now();
    for (;;) {
      await A.persist.settled(); if (flush) await B.persist.settled(); await A.follow.idle(); await B.follow.idle();
      if (f()) return true;
      if (Date.now() - t0 > ms) return false;
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const [h, p1, p2, p3] = A.doc.blocks.map((b: any) => b.id);
  // a text step of B's on p1 (B typed there before): it must not be undone onto A's text later
  B.history.record({ type: 'text', label: 'typing', doc: id, block: p1, pane: 'a', changes: [4, [0, 'x']], inverse: [4, [1]], before: { anchor: 4, head: 4 }, after: { anchor: 5, head: 5 } });
  // edit in A: B shows it, its editor told (a splice), nothing written by B
  A.ops.setSource(p1, 'One, changed in A.');
  const edited = await until(() => B.model.blockById(p1)?.source === 'One, changed in A.');
  check('follow: a block edited in one tab is the same in the other (re-read from the store, its open editors given the change as a splice)',
    edited && B.persist.savedOf(p1) === 'One, changed in A.' && logB.some((l) => l.startsWith(`followed ${p1} {"from":3,"to":3,"insert":", changed in A"}`)) && logB.includes('applied remote 1'), { b: list(B), logB });
  check('follow: the block\'s typing steps leave the other tab\'s history (they no longer fit its text); undo there throws nothing',
    !B.history.steps().some((s: any) => s.type === 'text' && s.block === p1) && (() => { try { B.history.undo(); return true; } catch { return false; } })());
  // insert, move, remove in A
  const nb = A.ops.insertBlock(2, 'paragraph', 'Inserted in A.');
  const ins = await until(() => list(B) === list(A));
  A.ops.moveBlock(p3, 0);
  const mv = await until(() => list(B) === list(A));
  A.ops.removeBlock(p2, { quiet: true });
  const rm = await until(() => list(B) === list(A));
  check('follow: insert, move and remove in one tab: the other has the same blocks in the same order; a block removed there drops its editors here',
    ins && mv && rm && list(B) === 'Three.|\\section{A}|One, changed in A.|Inserted in A.' && logB.includes(`unplaced ${p2}`) && !!B.model.blockById(nb.id), { a: list(A), b: list(B) });
  // the title and the preamble
  A.doc.title = 'Renamed in A'; A.persist.saveMeta({ title: 'Renamed in A' });
  A.doc.preamble = { source: '\\documentclass{amsart}', rev: 2 }; A.persist.saveMeta({ preamble: A.doc.preamble });
  const meta = await until(() => B.doc.title === 'Renamed in A' && B.doc.preamble.source === '\\documentclass{amsart}');
  check('follow: the title and the preamble follow, set without being saved again', meta && logB.includes('meta title save=false') && logB.includes('meta preamble save=false'), logB.filter((l) => l.startsWith('meta')));
  // no echo: B wrote nothing of what it followed
  const opsB = (await sA.getOps(id)).filter((o: any) => o.actor === sB.actor).length;
  check('follow: nothing followed is written back (no op of the following tab in the log)', opsB === 0, { opsB });
  // the conflict: typed in B (not written yet), changed in A, B's change written (it finds A's in the store, not the
  // source it started from): B's kept and written (A's in a snapshot first), a toast with Use theirs
  const b1 = B.model.blockById(p1);
  b1.source = 'Typed in B, not saved yet.'; B.persist.saveBlock(b1, { typing: true });
  A.ops.setSource(p1, 'Changed in A meanwhile.');
  await A.persist.settled();
  B.persist.flushTyping();                                // its timer fires before the other tab's event is read
  const told = await until(() => toastsB.length > 0 && A.model.blockById(p1)?.source === 'Typed in B, not saved yet.');
  const snaps = await sA.snapshots.list(id);
  const snap = snaps.length ? await sA.snapshots.get(snaps[0].id) : null;
  check('follow: typed here and changed there: ours is kept and written (the other tab follows it), theirs in a snapshot first, a toast offers Use theirs',
    told && B.model.blockById(p1).source === 'Typed in B, not saved yet.' && (await sA.getBlocks(id)).find((b: any) => b.id === p1)?.source === 'Typed in B, not saved yet.'
      && snap?.blocks.some((b: any) => b.id === p1 && b.source === 'Changed in A meanwhile.') && /yours is kept/.test(toastsB[0]?.t) && toastsB[0]?.o?.label === 'Use theirs',
    { b: B.model.blockById(p1)?.source, a: A.model.blockById(p1)?.source, toasts: toastsB.map((t) => t.t), snaps: snaps.map((s: any) => s.label) });
  toastsB[0].a();                                         // Use theirs: one step of B's, followed by A
  const theirs = await until(() => A.model.blockById(p1)?.source === 'Changed in A meanwhile.' && B.model.blockById(p1)?.source === 'Changed in A meanwhile.');
  check('follow: Use theirs puts the other tab\'s text back (an undo step here), and the other tab follows', theirs && B.history.labels().at(-1) === 'edit', B.history.labels());
  // the same, the other tab's event read while B's typing timer still runs: B's kept and written at once
  const b2 = B.model.blockById(nb.id);
  b2.source = 'Inserted, typed in B.'; B.persist.saveBlock(b2, { typing: true });
  A.ops.setSource(nb.id, 'Inserted, changed in A.');
  const told2 = await until(() => toastsB.length > 1, { flush: false });
  await until(() => A.model.blockById(nb.id)?.source === 'Inserted, typed in B.');
  check('follow: typed here (its timer still running) when the other tab\'s change is read: ours is kept and written, the toast says so',
    told2 && /yours is kept/.test(toastsB[1]?.t) && B.model.blockById(nb.id).source === 'Inserted, typed in B.' && A.model.blockById(nb.id)?.source === 'Inserted, typed in B.',
    { a: A.model.blockById(nb.id)?.source, toasts: toastsB.map((t) => t.t) });
  // deleted there while typed here: ours is kept and put back
  const b3 = B.model.blockById(p3);
  b3.source = 'Three, typed in B.'; B.persist.saveBlock(b3, { typing: true });
  A.ops.removeBlock(p3, { quiet: true });
  const back = await until(() => !!A.model.blockById(p3) && toastsB.length > 2);
  check('follow: deleted there while typed here: ours is kept and put back in the store (the other tab gets it again), a toast offers Delete',
    back && (await sA.getBlocks(id)).some((b: any) => b.id === p3 && b.source === 'Three, typed in B.') && toastsB[2]?.o?.label === 'Delete' && list(A) === list(B), { a: list(A), b: list(B), toasts: toastsB.map((t) => t.t) });
  // the document deleted in A's tab: B is told and writes nothing more
  await sA.deleteDoc(id);
  const gone = await until(() => logB.includes('gone'));
  const bb = B.doc.blocks[0]; bb.source = 'after the delete'; B.persist.saveBlock(bb);
  await B.persist.settled();
  check('follow: the document deleted in another tab: gone(), and nothing more is written (no failed write)', gone && !logB.some((l) => l.startsWith('failed')) && B.persist.writer.state().failed === 0, logB.filter((l) => /gone|failed/.test(l)));
  A.unload(); B.unload();
  sA.close(); sB.close();
}

// ── the panels' data (doc/panels.ts): the outline, the problems and the TODOs as values ──
{
  const P = await imp('app/src/doc/panels.ts');
  const blocks = [
    { id: 'abs', kind: 'abstract', source: '\\begin{abstract}A.\\end{abstract}' },
    { id: 's1', kind: 'heading', source: '\\section{Intro}\\label{sec:intro}' },
    { id: 'p1', kind: 'paragraph', source: 'See Section~\\ref{sec:intro} and \\ref{sec:none}, \\cite{known,unknown}. \\todo{Ann: fix this}' },
    { id: 's2', kind: 'subheading', source: '\\subsection{Details}' },
    { id: 'app', kind: 'paragraph', source: '\\appendix' },
    { id: 's3', kind: 'heading', source: '\\section{Proofs}\\label{sec:proofs}' },
    { id: 'bib', kind: 'bibliography', source: '\\begin{thebibliography}{9}\\bibitem{known} K.\\end{thebibliography}' },
  ];
  const refs = { labels: {}, refs: [{ blockId: 'p1', cmd: 'ref', keys: ['sec:intro'], offset: 12 }, { blockId: 'p1', cmd: 'ref', keys: ['sec:none'], offset: 34 }],
    cites: [{ blockId: 'p1', cmd: 'cite', keys: ['known', 'unknown'], offset: 50 }], bib: { known: { key: 'known' } }, numbers: {}, duplicates: [] };
  const src = { blocks, preamble: '\\newcommand{\\ann}[1]{\\todo{Ann: #1}}', refs, preambleProblems: [{ line: 3, message: 'Undefined control sequence' }],
    resultOf: (b: any) => (b.id === 's2' ? { status: 'error', errors: [{ line: 1, message: 'Missing $' }] } : null) };
  const ol = P.outlineOf(src).map((x: any) => `${x.number}|${x.title}`);
  check('panels: the outline in order, numbered, \\appendix to letters, the abstract and the references as special rows',
    ol.join() === '|Abstract,1|Intro,1.1|Details,A|Proofs,|References', ol);
  const dg = P.diagnosticsOf(src).map((d: any) => `${d.kind}:${d.blockId ?? '-'}:${d.key ?? d.line ?? ''}`);
  check('panels: the problems: the preamble\'s and a block\'s errors, an undefined reference, an unknown citation, an unused label',
    dg.join() === 'error:-:3,error:s2:1,undefined-ref:p1:sec:none,unknown-cite:p1:unknown,unused-label:s3:sec:proofs', dg);
  const td = P.todosOf({ blocks: [...blocks, { id: 'p2', kind: 'paragraph', source: 'x \\ann{later}' }], preamble: src.preamble }).map((t: any) => `${t.blockId}:${t.author}:${t.text}`);
  check('panels: the TODOs, the preamble\'s own todo macros too, by author', td.join() === 'p1:Ann:fix this,p2:Ann:later', td);
  const items = P.outlineOf(src);
  const sec = P.sectionBlocks(blocks, items, items.find((x: any) => x.id === 's1'));
  check('panels: a section\'s blocks run to the next heading of its level or higher', sec.join() === 's1,p1,s2,app', sec);
}

// ── a document's status and a pane's crumbs as data (doc/status.ts, docview/crumbs.ts) ──
{
  const { createDocStatus } = await imp('app/src/doc/status.ts');
  const { crumbsOf } = await imp('app/src/docview/crumbs.ts');
  const st = createDocStatus();
  const seen: string[] = [];
  const off = st.value.subscribe((v: any) => seen.push(v.typesetting ? `${v.typesetting.done}/${v.typesetting.total}` : `idle:${v.errors}${v.unsaved ? ':unsaved' : ''}`));
  st.typesetting(10); st.typesetting(7); st.typesetting(7); st.typesetting(3, 1); st.typesetting(0, 2); st.unsaved(true); st.unsaved(true); st.unsaved(false); st.typesetting(4); st.reset();
  off();
  check('status: typesetting counts up within a run (k of n, its total the most left since idle), errors and unsaved; no repeats',
    seen.join() === 'idle:0,0/10,3/10,7/10,idle:2,idle:2:unsaved,idle:2,0/4,idle:0', seen);
  const c = crumbsOf({ docId: 'D', title: '', section: { id: 'b', level: 2, number: '2.1', title: 'Details', appendix: false } });
  const none = crumbsOf({ docId: null, title: 'Paper', section: null });
  check('crumbs: the document chip (an untitled one named so) and the section chip as the pane bar names it',
    c.doc.title === 'Untitled' && c.section?.label === '2.1 Details' && c.section?.num === '2.1' && c.section?.text === 'Details' && none.section === null && none.doc.title === 'Paper', { c, none });
  // the bar of a run: full for a whole document (full() before or during the run), band for an edit's few blocks;
  // a full run's end makes the next one a band again
  const st2 = createDocStatus();
  const bars: string[] = [];
  const off2 = st2.value.subscribe((v: any) => { if (v.typesetting) bars.push(`${v.typesetting.done}/${v.typesetting.total}:${v.typesetting.bar}`); });
  st2.full(); st2.typesetting(5); st2.typesetting(2); st2.typesetting(0);
  st2.typesetting(2); st2.typesetting(0);
  st2.typesetting(3); st2.full(); st2.typesetting(1); st2.typesetting(0);
  off2();
  check('status: a full run (open, recompile all) has the full bar, an edit\'s run the band; full() during a run makes it full',
    bars.join() === '0/5:full,3/5:full,0/2:band,0/3:band,0/3:full,2/3:full', bars);
  const ch = crumbsOf({ docId: 'D', title: 'Book', section: { id: 'c', level: 1, number: '2', title: 'Minors', appendix: false, kind: 'Chapter' } });
  check('crumbs: a chapter names its kind (the chip\'s name, the tooltip); a section is a Section',
    ch.section?.kind === 'Chapter' && ch.section?.title === 'Chapter 2 Minors' && c.section?.kind === 'Section', { ch, c });
}
// the outline names chapters and parts (the crumb's kind)
{
  const { outlineOf } = await imp('app/src/doc/panels.ts');
  const items = outlineOf({ blocks: [{ id: 'p', kind: 'heading', source: '\\part{Foundations}' }, { id: 'c', kind: 'heading', source: '\\chapter{Intro}' }, { id: 's', kind: 'heading', source: '\\section{Motivation}' }], refs: { labels: {} } });
  check('panels: the outline names a part and a chapter (kind), a section has none',
    items.map((i: any) => i.kind ?? '-').join() === 'Part,Chapter,-', items);
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
