// The layout model's operations as pure functions: invariants after every operation, collapse,
// no mutation (inputs deep-frozen), no-ops return the same object, structural sharing, persistence round trip.
//
//   node --test workbench/tests/model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.ts';

const freeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
const tab = (id: string, extra: object = {}) => ({ id, view: 'text', state: { n: id }, ...extra });
/** A node as a split, or as a group (the test knows which it is). */
const S = (n: M.DocNode | undefined) => n as M.Split<M.Group>;
const G = (n: M.DocNode) => n as M.Group;
const ok = (L: M.Layout): M.Layout => { assert.deepEqual(M.validate(L), []); return L; };
/** apply op on a frozen copy: the input never changes, the output is valid */
function run(L: M.Layout, f: (L: M.Layout) => M.Layout): M.Layout {
  const before = JSON.stringify(L);
  freeze(L);
  const out = f(L);
  assert.equal(JSON.stringify(L), before, 'input unchanged');
  return ok(out);
}
function three() {
  // [ g1: a b c | g2: d ]
  let L = M.emptyLayout('g1');
  for (const t of ['a', 'b', 'c']) L = M.openTab(L, tab(t));
  L = M.openTab(L, tab('d'));
  L = M.splitTab(L, 'd', 'g1', 'right', 'g2', 's1');
  return ok(L);
}

test('empty layout is valid; the root group may be empty', () => { ok(M.emptyLayout()); });

test('open: after the active tab, activates, mru top', () => {
  let L = M.emptyLayout('g1');
  L = run(L, (l) => M.openTab(l, tab('a')));
  L = run(L, (l) => M.openTab(l, tab('b')));
  L = run(L, (l) => M.activateTab(l, 'a'));
  L = run(L, (l) => M.openTab(l, tab('c')));
  const g = M.groups(L)[0];
  assert.deepEqual(g.tabs.map((t: any) => t.id), ['a', 'c', 'b']);
  assert.equal(g.active, 'c');
  assert.deepEqual(g.mru, ['b', 'a', 'c']);
  assert.equal(M.openTab(L, tab('a')), L, 'duplicate id: no-op, same object');
});

test('open without activating keeps the active tab', () => {
  let L = M.openTab(M.emptyLayout('g1'), tab('a'));
  L = run(L, (l) => M.openTab(l, tab('b'), { activate: false }));
  assert.equal(M.groups(L)[0].active, 'a');
});

test('preview tabs: one per group, replaced in place, kept by keep()', () => {
  let L = M.openTab(M.emptyLayout('g1'), tab('a'));
  L = run(L, (l) => M.openTab(l, tab('p1'), { preview: true }));
  L = run(L, (l) => M.openTab(l, tab('b')));
  L = run(L, (l) => M.openTab(l, tab('p2'), { preview: true }));
  assert.deepEqual(M.groups(L)[0].tabs.map((t: any) => t.id), ['a', 'p2', 'b']);
  L = run(L, (l) => M.keep(l, 'p2'));
  assert.equal(M.findTab(L, 'p2')!.preview, undefined);
  L = run(L, (l) => M.openTab(l, tab('p3'), { preview: true }));
  assert.equal(M.groups(L)[0].tabs.length, 4);
});

test('close: next active is the previous in mru; the last tab of the root leaves an empty group', () => {
  let L = M.emptyLayout('g1');
  for (const t of ['a', 'b', 'c']) L = M.openTab(L, tab(t));
  L = M.activateTab(L, 'a');
  L = M.activateTab(L, 'c');
  L = run(L, (l) => M.closeTab(l, 'c'));
  assert.equal(M.groups(L)[0].active, 'a');
  L = run(L, (l) => M.closeTab(l, 'a'));
  L = run(L, (l) => M.closeTab(l, 'b'));
  assert.equal(L.root.kind, 'group');
  assert.equal(G(L.root).tabs.length, 0);
  assert.equal(G(L.root).active, null);
  assert.equal(M.closeTab(L, 'zz'), L);
});

test('empty groups collapse; the sibling takes the space and the focus', () => {
  let L = three();
  assert.equal(L.root.kind, 'split');
  assert.equal(L.active, 'g2');
  L = run(L, (l) => M.closeTab(l, 'd'));
  assert.equal(L.root.kind, 'group');
  assert.equal(L.root.id, 'g1');
  assert.equal(L.active, 'g1');
});

test('collapse in a nested split flattens and keeps sizes summing to 1', () => {
  let L = three();                                         // row [g1 | g2]
  L = M.splitTab(L, 'c', 'g2', 'bottom', 'g3', 's2');     // row [g1 | column [g2 / g3]]
  ok(L);
  assert.equal(S(L.root).children[1].kind, 'split');
  L = M.splitTab(L, 'b', 'g3', 'right', 'g4', 's3');      // g3 → row [g3 | g4] inside the column
  ok(L);
  L = run(L, (l) => M.closeTab(l, 'c'));                  // g3 empties: the row [g3|g4] collapses to g4
  L = run(L, (l) => M.closeTab(l, 'd'));                  // g2 empties: the column collapses to g4; same dir as root → flattened
  assert.equal(L.root.kind, 'split');
  assert.equal(L.root.dir, 'row');
  assert.deepEqual(S(L.root).children.map((c: any) => c.id), ['g1', 'g4']);
});

test('split: right of its own group, into an existing split of the same dir, wrapping across dirs', () => {
  let L = M.emptyLayout('g1');
  for (const t of ['a', 'b', 'c']) L = M.openTab(L, tab(t));
  assert.equal(M.splitTab(M.openTab(M.emptyLayout('g1'), tab('x')), 'x', 'g1', 'right', 'g2', 's1').root.kind, 'group', 'only tab: no-op');
  L = run(L, (l) => M.splitTab(l, 'c', 'g1', 'right', 'g2', 's1'));
  assert.deepEqual(S(L.root).children.map((c: any) => c.id), ['g1', 'g2']);
  assert.deepEqual(S(L.root).sizes, [0.5, 0.5]);
  L = run(L, (l) => M.splitTab(l, 'b', 'g2', 'left', 'g3', 's2'));
  assert.deepEqual(S(L.root).children.map((c: any) => c.id), ['g1', 'g3', 'g2']);
  assert.deepEqual(S(L.root).sizes, [0.5, 0.25, 0.25]);
  L = run(L, (l) => M.splitTab(l, 'b', 'g1', 'top', 'g4', 's3'));   // g3 empties and collapses
  assert.equal(S(L.root).children.length, 2);
  assert.equal(S(S(L.root).children[0]).dir, 'column');
  assert.deepEqual(S(S(L.root).children[0]).children.map((c: any) => c.id), ['g4', 'g1']);
  assert.equal(L.active, 'g4');
});

test('move: reorder within a group (index before the move), between groups, pinned block respected', () => {
  let L = three();
  L = run(L, (l) => M.moveTab(l, 'a', 'g1', 3));
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['b', 'c', 'a']);
  L = run(L, (l) => M.moveTab(l, 'a', 'g1', 0));
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['a', 'b', 'c']);
  L = run(L, (l) => M.pin(l, 'c'));
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['c', 'a', 'b']);
  L = run(L, (l) => M.moveTab(l, 'b', 'g1', 0));          // unpinned can't go before pinned
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['c', 'b', 'a']);
  L = run(L, (l) => M.moveTab(l, 'b', 'g2', 0));
  assert.deepEqual(M.findGroup(L, 'g2')!.tabs.map((t: any) => t.id), ['b', 'd']);
  assert.equal(L.active, 'g2');
  L = run(L, (l) => M.moveTab(l, 'b', 'g1', 1));
  L = run(L, (l) => M.moveTab(l, 'd', 'g1', 1));          // g2 empties: collapses
  assert.equal(L.root.kind, 'group');
});

test('unpin goes to the start of the unpinned tabs', () => {
  let L = three();
  L = M.pin(L, 'b'); L = M.pin(L, 'c');
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['b', 'c', 'a']);
  L = run(L, (l) => M.pin(l, 'b', false));
  assert.deepEqual(M.findGroup(L, 'g1')!.tabs.map((t: any) => t.id), ['c', 'b', 'a']);
  assert.equal(M.pin(L, 'b', false), L);
});

test('close others / to the right keep pinned tabs', () => {
  let L = M.emptyLayout('g1');
  for (const t of ['a', 'b', 'c', 'd', 'e']) L = M.openTab(L, tab(t));
  L = M.pin(L, 'e');                                       // e a b c d
  let R = run(L, (l) => M.closeRight(l, 'b'));
  assert.deepEqual(G(R.root).tabs.map((t: any) => t.id), ['e', 'a', 'b']);
  R = run(L, (l) => M.closeOthers(l, 'c'));
  assert.deepEqual(G(R.root).tabs.map((t: any) => t.id), ['e', 'c']);
});

test('resize and equalize: normalised, no-op returns the same object', () => {
  let L = three();
  L = run(L, (l) => M.resize(l, 's1', [3, 1]));
  assert.deepEqual(S(L.root).sizes, [0.75, 0.25]);
  assert.equal(M.resize(L, 's1', [0.75, 0.25]), L);
  assert.equal(M.resize(L, 's1', [1, 0]), L, 'zero size rejected');
  L = run(L, (l) => M.equalize(l, 's1'));
  assert.deepEqual(S(L.root).sizes, [0.5, 0.5]);
});

test('maximise and restore; adding a group restores', () => {
  let L = three();
  assert.equal(M.maximize(M.emptyLayout(), 'g1').maximized, null, 'one group: nothing to maximise');
  L = run(L, (l) => M.maximize(l, 'g1'));
  assert.equal(L.maximized, 'g1');
  assert.equal(L.active, 'g1');
  L = run(L, (l) => M.restore(l));
  assert.equal(L.maximized, null);
  L = M.maximize(L, 'g1');
  L = run(L, (l) => M.splitTab(l, 'a', 'g1', 'bottom', 'g3', 's2'));
  assert.equal(L.maximized, null);
  L = M.maximize(L, 'g3');
  L = run(L, (l) => M.closeTab(l, 'd'));                  // g2 collapses: restores
  assert.equal(L.maximized, null);
});

test('structural sharing: an operation leaves untouched groups identical', () => {
  const L = three();
  const g2 = M.findNode(L, 'g2');
  const L2 = M.activateTab(L, 'b');
  assert.equal(M.findNode(L2, 'g2'), g2);
  const L3 = M.setState(L, 'a', { n: 'changed' });
  assert.equal(M.findNode(L3, 'g2'), g2);
  assert.notEqual(M.findNode(L3, 'g1'), M.findNode(L, 'g1'));
  assert.equal(M.activateTab(L, 'd'), L, 'already active: same object');
});

test('neighbours by geometry', () => {
  let L = three();
  L = M.splitTab(L, 'c', 'g2', 'bottom', 'g3', 's2');      // [g1 | [g2 / g3]]
  assert.equal(M.neighbour(L, 'g1', 'right'), 'g2');
  assert.equal(M.neighbour(L, 'g3', 'left'), 'g1');
  assert.equal(M.neighbour(L, 'g2', 'bottom'), 'g3');
  assert.equal(M.neighbour(L, 'g3', 'top'), 'g2');
  assert.equal(M.neighbour(L, 'g1', 'left'), null);
});

test('cycle and shift', () => {
  let L = M.emptyLayout('g1');
  for (const t of ['a', 'b', 'c']) L = M.openTab(L, tab(t));
  L = run(L, (l) => M.cycleTab(l, 1));
  assert.equal(G(L.root).active, 'a');
  L = run(L, (l) => M.cycleTab(l, -1));
  assert.equal(G(L.root).active, 'c');
  L = run(L, (l) => M.shiftTab(l, 'c', -1));
  assert.deepEqual(G(L.root).tabs.map((t: any) => t.id), ['a', 'c', 'b']);
  L = run(L, (l) => M.shiftTab(l, 'a', 1));
  assert.deepEqual(G(L.root).tabs.map((t: any) => t.id), ['c', 'a', 'b']);
  assert.equal(M.shiftTab(L, 'c', -1), L);
});

test('replaceTab: the home tab becomes a document in place', () => {
  let L = M.openTab(M.emptyLayout('g1'), { id: 't1', view: 'home', state: {} });
  L = run(L, (l) => M.replaceTab(l, 't1', { view: 'document', state: { doc: 'x' } }));
  assert.deepEqual(M.findTab(L, 't1'), { id: 't1', view: 'document', state: { doc: 'x' } });
});

test('persistence: a round trip is exact; broken layouts are refused', () => {
  let L = three();
  L = M.splitTab(L, 'c', 'g2', 'bottom', 'g3', 's2');
  L = M.pin(L, 'a');
  L = M.resize(L, 's1', [2, 1]);
  L = M.openTab(L, { id: 'u', view: 'not-registered', state: { keep: [1, 2] } });
  const back = M.deserialize(M.serialize(L));
  assert.deepEqual(back, L);
  assert.throws(() => M.deserialize('{"v":1,"root":{"kind":"split","id":"s","dir":"row","sizes":[1],"children":[]},"active":"x"}'));
  assert.equal(M.maxId(L, 'g'), 3);
});

test('random operation sequences keep every invariant (seeded fuzz, 3000 steps)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  let L = M.emptyLayout('g0'), n = 0;
  for (let step = 0; step < 3000; step++) {
    const tabs = M.allTabs(L).map((t: any) => t.id), gs = M.groups(L).map((g: any) => g.id);
    const splits: string[] = []; M.walk(L.root, (x: any) => { if (x.kind === 'split') splits.push(x.id); });
    const k = rnd();
    const prev = L;
    freeze(prev);
    const snap = JSON.stringify(prev);
    if (k < 0.25 || !tabs.length) L = M.openTab(L, tab(`t${++n}`), { group: pick(gs), preview: rnd() < 0.15 });
    else if (k < 0.37) L = M.closeTab(L, pick(tabs));
    else if (k < 0.47) L = M.moveTab(L, pick(tabs), pick(gs), Math.floor(rnd() * 5));
    else if (k < 0.57) L = M.splitTab(L, pick(tabs), pick(gs), pick([...M.SIDES]), `g${++n}`, `s${++n}`);
    else if (k < 0.62 && splits.length) L = M.resize(L, pick(splits), [rnd() + 0.1, rnd() + 0.1, rnd() + 0.1].slice(0, (M.findNode(L, pick(splits)) as any)?.children?.length ?? 2));
    else if (k < 0.70) L = M.activateTab(L, pick(tabs));
    else if (k < 0.75) L = M.pin(L, pick(tabs), rnd() < 0.6);
    else if (k < 0.78) L = M.closeOthers(L, pick(tabs));
    else if (k < 0.80) L = M.closeRight(L, pick(tabs));
    else if (k < 0.84) L = M.toggleMaximize(L, pick(gs));
    else if (k < 0.88) L = M.focusGroup(L, pick(gs));
    else if (k < 0.92) L = M.shiftTab(L, pick(tabs), rnd() < 0.5 ? -1 : 1);
    else if (k < 0.95) L = M.keep(L, pick(tabs));
    else L = M.cycleTab(L, rnd() < 0.5 ? -1 : 1);
    assert.equal(JSON.stringify(prev), snap, `step ${step}: input mutated`);
    const errs = M.validate(L);
    assert.deepEqual(errs, [], `step ${step}: ${errs.join('; ')}`);
    assert.deepEqual(M.deserialize(M.serialize(L)), L);
  }
});

test('guard: the module imports only Preact, signals, htm, its own files and the kit\'s standalone files', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const KIT = new Set(['core.js', 'overlays.js', 'icon-set.ts'].map((k) => join(src, '../../app/src/design/ui', k)));   // (icon-set.ts: the icon registry)
  const bad: string[] = [];
  // every source file, in every directory of src/; a relative import must stay inside src/
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(js|ts)$/.test(e.name) ? [relative(src, join(d, e.name))] : []);
  const files = walk(src);
  assert.ok(files.length > 10, 'the walk finds the sources');
  for (const f of files) {
    for (const m of readFileSync(join(src, f), 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2];
      const inside = spec.startsWith('.') && /\.(js|ts)$/.test(spec) && !relative(src, join(src, dirname(f), spec)).startsWith('..');
      const ok = ['preact', 'preact/hooks', '@preact/signals', 'htm'].includes(spec) || inside || KIT.has(join(src, dirname(f), spec));
      if (!ok) bad.push(`${f}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
  // and the kit files it uses import only the kit (no editor modules)
  const kit = join(src, '../../app/src/design/ui');
  for (const f of ['core.js', 'overlays.js', 'controls.js', 'icons.ts', 'icon-set.ts', 'layers.js', 'view-box.ts']) {   // (view-box.ts: b304830, the kit's own TypeScript; icon-set.ts: the icon registry, Preact and Lucide)
    for (const m of readFileSync(join(kit, f), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(['preact', 'preact/hooks', 'htm'].includes(m[1]) || /^\.\/[\w-]+\.(js|ts)$/.test(m[1]) || /^\.\.\/(tokens|ui)\.css\.js$/.test(m[1]) || (f === 'icon-set.ts' && m[1] === 'lucide')
        || m[1] === '../../../../workbench/src/viewport.ts', `kit ${f}: ${m[1]}`);   // (the visible part of the window, a module that imports nothing)
    }
  }
});

test('split with a copy: the same view in a new group, its own state; works with a single tab', () => {
  let L = M.openTab(M.emptyLayout('g1'), { id: 'a', view: 'document', state: { doc: 'x', scroll: 10 }, pinned: true });
  L = run(L, (l) => M.splitTab(l, 'a', 'g1', 'right', 'g2', 's1', 'a2'));
  assert.deepEqual(M.groups(L).map((g: any) => g.tabs.map((t: any) => t.id)), [['a'], ['a2']]);
  const a = M.findTab(L, 'a'), a2 = M.findTab(L, 'a2');
  assert.deepEqual(a2, { id: 'a2', view: 'document', state: { doc: 'x', scroll: 10 } }, 'a copy: same view and state, not pinned');
  assert.notEqual(a2!.state, a!.state, 'its own state object');
  L = run(L, (l) => M.setState(l, 'a2', { doc: 'x', scroll: 99 }));
  assert.equal(M.findTab(L, 'a')!.state.scroll, 10, 'view states are independent');
  assert.equal(L.active, 'g2');
  assert.equal(M.splitTab(L, 'a', 'g1', 'right', 'g3', 's2', 'a2'), L, 'a copy id in use: no-op');
});

test('sidebars: a column is a stack of panel groups (the groups\' split tree, column splits only); add, move, split above and below, collapse, resize, round trip', () => {
  // a column as text: its groups top to bottom, each its panels (the active one starred), and the sizes
  const col = (L: any, side: string) => M.sideGroups(L.sides[side]).map((g: any) => g.panels.map((p: string) => p === g.active ? `${p}*` : p).join()).join(' | ');
  const sizes = (L: any, side: string) => { const r = L.sides[side].root; return r.kind === 'split' ? r.sizes.map((x: number) => +x.toFixed(4)) : [1]; };
  const gid = (L: any, side: string, i: number) => M.sideGroups(L.sides[side])[i].id;
  let L = M.emptyLayout('g1');
  assert.deepEqual(M.sideGroups(M.sides(L).left).map((g: any) => g.panels), [[]], 'an empty column: one empty group (its root)');
  L = run(L, (l) => M.addPanel(l, 'outline', 'left'));
  L = run(L, (l) => M.addPanel(l, 'problems', 'left'));
  L = run(L, (l) => M.addPanel(l, 'refs', 'right'));
  assert.equal(M.addPanel(L, 'outline', 'right'), L, 'docked already: no-op');
  assert.equal(col(L, 'left'), 'outline*,problems');
  // three stacked groups by splitting below, then the middle one split again
  L = run(L, (l) => M.splitPanel(l, 'problems', 'left', gid(l, 'left', 0), 'bottom', 'p2', 'ps1'));
  assert.equal(col(L, 'left'), 'outline* | problems*');
  L = run(L, (l) => M.addPanel(l, 'files', 'left', null, 'p2'));
  L = run(L, (l) => M.splitPanel(l, 'files', 'left', 'p2', 'bottom', 'p3', 'ps2'));
  assert.equal(col(L, 'left'), 'outline* | problems* | files*');
  assert.deepEqual(sizes(L, 'left'), [0.5, 0.25, 0.25], 'a sibling in the stack: the target\'s share halved');
  assert.equal(L.sides!.left.root.id, 'ps1', 'one split: the stack is flat (no nested column split)');
  L = run(L, (l) => M.addPanel(l, 'search', 'left', 0, 'p2'));
  L = run(L, (l) => M.splitPanel(l, 'search', 'left', 'p2', 'top', 'p4', 'ps3'));
  assert.equal(col(L, 'left'), 'outline* | search* | problems* | files*', 'the middle group split: the new one above it');
  assert.deepEqual(sizes(L, 'left'), [0.5, 0.125, 0.125, 0.25]);
  assert.deepEqual(M.dockOf(L, 'search'), { side: 'left', group: 'p4' });
  assert.equal(M.splitPanel(L, 'search', 'left', 'p4', 'bottom', 'p9', 'ps9'), L, 'splitting a group by its only panel: no-op');
  assert.equal(M.splitPanel(L, 'search', 'left', 'p4', 'left' as 'top', 'p9', 'ps9'), L, 'no side-by-side groups in a column');
  // an empty group collapses: its share goes to its neighbours (the sizes renormalised)
  L = run(L, (l) => M.movePanel(l, 'search', 'left', null, 'p2'));
  assert.equal(col(L, 'left'), 'outline* | problems,search* | files*', 'moved into an existing group (active there); its emptied group collapsed');
  assert.deepEqual(sizes(L, 'left'), [0.5714, 0.1429, 0.2857]);
  // within its group: reorder; the same place: no-op
  L = run(L, (l) => M.movePanel(l, 'search', 'left', 0, 'p2'));
  assert.equal(col(L, 'left'), 'outline* | search*,problems | files*');
  assert.equal(M.movePanel(L, 'search', 'left', 0, 'p2'), L);
  // to the other column: into its group, or as a new group below (the emptied group here collapses)
  L = run(L, (l) => M.splitPanel(l, 'files', 'right', null, 'bottom', 'p5', 'ps5'));
  assert.equal(col(L, 'left'), 'outline* | search*,problems');
  assert.equal(col(L, 'right'), 'refs* | files*');
  L = run(L, (l) => M.movePanel(l, 'files', 'right', 1, gid(l, 'right', 0)));
  assert.equal(col(L, 'right'), 'refs,files*', 'the emptied bottom group collapsed: one group takes the column');
  assert.equal(L.sides!.right.root.kind, 'group');
  // an emptied column keeps its root group (empty); a split into an empty column takes it over
  L = run(L, (l) => M.movePanel(l, 'refs', 'left', null, null));
  L = run(L, (l) => M.movePanel(l, 'files', 'left', null, null));
  assert.equal(col(L, 'right'), '');
  assert.deepEqual(M.sidePanels(L.sides!.right), []);
  L = run(L, (l) => M.splitPanel(l, 'files', 'right', null, 'top', 'p6', 'ps6'));
  assert.equal(col(L, 'right'), 'files*', 'the empty root group collapsed under the new one');
  assert.equal(L.sides!.right.root.id, 'p6');
  // activate, collapse, resize the column and its stack
  L = run(L, (l) => M.collapseSide(l, 'right', true));
  L = run(L, (l) => M.activatePanel(l, 'files'));
  assert.equal(L.sides!.right.collapsed, false, 'showing a panel shows its column');
  L = run(L, (l) => M.collapseSide(l, 'right', true));
  L = run(L, (l) => M.splitPanel(l, 'refs', 'right', null, 'bottom', 'p7', 'ps7'));
  assert.equal(L.sides!.right.collapsed, false, 'a drop into a hidden column shows it');
  L = run(L, (l) => M.resizeSide(l, 'right', 333.4));
  assert.equal(L.sides!.right.size, 333);
  L = run(L, (l) => M.resize(l, 'ps7', [3, 1]));
  assert.deepEqual(sizes(L, 'right'), [0.75, 0.25], 'resize: the same operation as the groups\' splits');
  L = run(L, (l) => M.equalize(l, 'ps7'));
  assert.deepEqual(sizes(L, 'right'), [0.5, 0.5]);
  assert.equal(M.resize(L, 'ps7', [1, 0]), L, 'a size of 0 is refused');
  assert.equal(L.root.kind, 'group', 'the document groups are untouched');
  // persistence: the stacks, sizes, panels and active panels
  L = run(L, (l) => M.setPanelState(l, 'refs', { q: 'x' }));
  assert.deepEqual(M.deserialize(M.serialize(L)), L, 'round trip');
  assert.equal(M.maxId(L, 'p'), 7, 'the column groups\' ids count for the store\'s numbering');
  assert.ok(!M.sameShape(L, M.resize(L, 'ps7', [2, 1])), 'the columns are part of the shape');
  assert.ok(M.sameShape(L, M.splitPanel(M.removePanel(L, 'refs'), 'refs', 'right', null, 'bottom', 'p8', 'ps8')), 'ids aside');
  // invalid columns are refused
  const bad = (sd: any) => () => M.deserialize({ ...L, sides: { ...L.sides, left: { ...L.sides!.left, ...sd } } });
  assert.throws(bad({ root: { kind: 'split', id: 'x', dir: 'row', sizes: [0.5, 0.5], children: [M.panelGroup('x1', ['a']), M.panelGroup('x2', ['b'])] } }), /not a stack/);
  assert.throws(bad({ root: { kind: 'split', id: 'x', dir: 'column', sizes: [0.5, 0.5], children: [M.panelGroup('x1', ['a']), M.panelGroup('x2', [])] } }), /empty group x2/);
  assert.throws(() => M.deserialize({ ...L, sides: { ...L.sides, left: { top: { panels: ['a'], active: 'a' }, bottom: { panels: [], active: null }, split: 0.5, collapsed: false, size: 256 } } }), /side left missing/, 'an old two-slot column: refused (the store starts anew)');
});


test('barGroup: the group spanning the whole top edge (the root group; the top of vertical stacks, recursively); none when the top is split side by side', () => {
  const g = (id: string) => ({ kind: 'group', id, tabs: [], active: null });
  const L = (root: any) => ({ root, active: 'a' }) as any;
  assert.equal(M.barGroup(L(g('a')))?.id, 'a');
  assert.equal(M.barGroup(L({ kind: 'split', id: 's', dir: 'column', sizes: [1, 1], children: [g('a'), g('b')] }))?.id, 'a');
  assert.equal(M.barGroup(L({ kind: 'split', id: 's', dir: 'column', sizes: [1, 1], children: [{ kind: 'split', id: 't', dir: 'column', sizes: [1, 1], children: [g('a'), g('c')] }, g('b')] }))?.id, 'a');
  assert.equal(M.barGroup(L({ kind: 'split', id: 's', dir: 'row', sizes: [1, 1], children: [g('a'), g('b')] })), null);
  assert.equal(M.barGroup(L({ kind: 'split', id: 's', dir: 'column', sizes: [1, 1], children: [{ kind: 'split', id: 't', dir: 'row', sizes: [1, 1], children: [g('a'), g('c')] }, g('b')] })), null);
});

test('sameShape: ids aside, the same tree, sizes, tabs and active tabs', () => {
  const t = (id: string) => ({ id, view: 'document', state: { doc: id } });
  const L1 = { active: 'g1', root: { kind: 'split', id: 's1', dir: 'row', sizes: [0.5, 0.5], children: [{ kind: 'group', id: 'g1', tabs: [t('a')], active: 'a' }, { kind: 'group', id: 'g2', tabs: [t('b')], active: 'b' }] } } as any;
  const L2 = { active: 'g9', root: { kind: 'split', id: 's7', dir: 'row', sizes: [0.5, 0.5], children: [{ kind: 'group', id: 'g1', tabs: [t('a')], active: 'a' }, { kind: 'group', id: 'g9', tabs: [t('b')], active: 'b' }] } } as any;
  assert.ok(M.sameShape(L1, L2));
  assert.ok(!M.sameShape(L1, { ...L2, root: { ...L2.root, sizes: [0.4, 0.6] } }));
  assert.ok(!M.sameShape(L1, { ...L2, root: { ...L2.root, dir: 'column' } }));
  assert.ok(!M.sameShape(L1, { ...L2, root: { ...L2.root, children: [...L2.root.children].reverse() } }));
});

test('stripRow: groups whose boxes share a top edge and touch side by side, transitively; within the px tolerances; only the shown ones', () => {
  // [ a | b | (c over d) ]: a, b and c share the top edge; d is below c
  let L: M.Layout = M.openTab(M.emptyLayout('a'), tab('ta'));
  L = M.openTab(L, tab('tb')); L = M.splitTab(L, 'tb', 'a', 'right', 'b', 's1');
  L = M.openTab(L, tab('tc'), { group: 'b' }); L = M.splitTab(L, 'tc', 'b', 'right', 'c', 's2');
  L = M.openTab(L, tab('td'), { group: 'c' }); L = M.splitTab(L, 'td', 'c', 'bottom', 'd', 's3');
  const all = new Set(['a', 'b', 'c', 'd']);
  assert.deepEqual(M.stripRow(L, 'a', 1200, 800, all), ['a', 'b', 'c']);
  assert.deepEqual(M.stripRow(L, 'c', 1200, 800, all), ['a', 'b', 'c'], 'the same row from any member');
  assert.deepEqual(M.stripRow(L, 'd', 1200, 800, all), ['d'], 'a group below decides on its own');
  assert.deepEqual(M.stripRow(L, 'a', 1200, 800, new Set(['a', 'c', 'd'])), ['a'], 'a hidden strip between them breaks the row');
  assert.deepEqual(M.stripRow(L, 'b', 1200, 800, new Set(['a', 'c'])), [], 'a hidden strip has no row');
  // two columns stacked alike, their middle edges a fraction of a pixel apart: one row (the tolerance)
  let K: M.Layout = M.openTab(M.emptyLayout('p'), tab('tp'));
  K = M.openTab(K, tab('tq')); K = M.splitTab(K, 'tq', 'p', 'right', 'q', 'k1');
  K = M.openTab(K, tab('tr'), { group: 'p' }); K = M.splitTab(K, 'tr', 'p', 'bottom', 'r', 'k2');
  K = M.openTab(K, tab('ts'), { group: 'q' }); K = M.splitTab(K, 'ts', 'q', 'bottom', 's', 'k3');
  K = M.resize(K, 'k3', [0.5005, 0.4995]);
  const four = new Set(['p', 'q', 'r', 's']);
  assert.deepEqual(M.stripRow(K, 'r', 1200, 800, four), ['r', 's'], '0.4 px apart at 800 px: one row');
  assert.deepEqual(M.stripRow(K, 'r', 1200, 8000, four), ['r'], '4 px apart: two rows');
});

test('memoised walks (W14): groups, groupOf and findTab are read once per layout root; a changed layout reads afresh', () => {
  let L: M.Layout = M.emptyLayout('g1');
  for (let i = 0; i < 200; i++) L = M.openTab(L, tab(`t${i}`));
  L = M.splitTab(L, 't199', 'g1', 'right', 'g2', 's1');
  assert.equal(M.groups(L), M.groups(L), 'the same array for the same layout');
  assert.equal(M.groupOf(L, 't5')!.id, 'g1');
  assert.equal(M.groupOf(L, 't199')!.id, 'g2');
  assert.equal(M.findTab(L, 't42')!.id, 't42');
  assert.equal(M.findTab(L, 'nope'), null);
  const K = M.moveTab(L, 't5', 'g2', 0);
  assert.notEqual(M.groups(K), M.groups(L), 'a new root: new groups');
  assert.equal(M.groupOf(K, 't5')!.id, 'g2', 'the moved tab found in its new group');
  assert.equal(M.groupOf(L, 't5')!.id, 'g1', 'the old layout still answers for itself');
  const K2 = M.setState(K, 't6', { n: 'changed' });
  assert.deepEqual(M.findTab(K2, 't6')!.state, { n: 'changed' }, 'a state change: a new root, the new tab object');
  // 200 tabs, every lookup of every tab: one walk per root, not one per call
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) for (let i = 0; i < 200; i++) { M.groupOf(K2, `t${i}`); M.findTab(K2, `t${i}`); }
  assert.ok(performance.now() - t0 < 200, 'lookups are map reads');
});

test('the side column\'s CSS width before it is sized is the model\'s SIDE_SIZE (one number)', async () => {
  const CSS = (await import('../src/css.ts')).default;
  const fallbacks = [...CSS.matchAll(/var\(--wb-side-w,\s*([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(fallbacks.length >= 2, 'the column and the overlay column');
  assert.deepEqual([...new Set(fallbacks)], [`${M.SIDE_SIZE}px`]);
});
