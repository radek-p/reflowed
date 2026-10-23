// app/feature.ts: the features composed as the editor asks them (the menus' contributions in the list's order, a
// document loaded, a sync, a duplicate taken by the first feature that does it, the export filters in a chain, the
// test probes merged), and a feature listed twice refused.
//   node app/src/app/feature.test.ts      (Node; exit 1 on a failure)
import { composeFeatures, type Feature } from './feature.ts';
import type { Item, MenuEntry } from './doc-menus.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const log: string[] = [];
const item: Item = (label, key) => ({ label, key, fn: () => {}, disabled: false, shortcut: '' });
const a: Feature = { id: 'a', blockItems: (id, it) => [it(`A ${id}`, 'a')], loaded: () => log.push('a loaded'), duplicate: () => false, forExport: (d) => ({ ...(d as object), a: true }) };
const b: Feature = { id: 'b', blockItems: (id, it) => [it(`B ${id}`, 'b')], docItems: (it) => [it('B doc', 'bd')], sync: () => log.push('b sync'),
  duplicate: (id) => { log.push(`b dup ${id}`); return true; }, forExport: (d) => ({ ...(d as object), b: true }), testApi: () => ({ probe: 1 }),
  slash: { kinds: (k) => [...k, { kind: 'drawn', label: 'Drawn' }], pick: (p) => (k) => { log.push('b pick'); p(k); } } };
const c: Feature = { id: 'c', duplicate: (id) => { log.push(`c dup ${id}`); return true; }, testApi: () => ({ other: 2 }) };
const all = composeFeatures([a, b, c]);

const entries = all.blockItems.flatMap((f) => f('x', item, null)) as (MenuEntry & { label: string })[];
check('block menu entries: each feature\'s, in the list\'s order', entries.map((e) => e.label).join('|') === 'A x|B x', entries);
check('document menu and slash contributions: only from the features that have them', all.docItems.length === 1 && all.slash.length === 1 && all.slash[0]!.kinds([]).length === 1);
all.loaded({}); all.sync();
check('loaded and sync reach the features that listen', log.join('|') === 'a loaded|b sync', log);
log.length = 0;
check('duplicate: the first feature that does it (and no later one)', all.duplicate('x') === true && log.join('|') === 'b dup x', log);
check('forExport: every filter, in order', JSON.stringify(all.forExport({ id: 1 })) === '{"id":1,"a":true,"b":true}');
check('testApi: the features\' probes merged', JSON.stringify(all.testApi()) === '{"probe":1,"other":2}');
let threw = false; try { composeFeatures([a, a]); } catch { threw = true; }
check('a feature listed twice is refused', threw);
check('no features: a duplicate is not taken, an export is the document', composeFeatures([]).duplicate('x') === false && JSON.stringify(composeFeatures([]).forExport({ k: 1 })) === '{"k":1}');

// the block shell's button: the first feature with one for this block; none: null
const run = () => {};
const withAction = composeFeatures([{ id: 'p', blockAction: () => null }, { id: 'q', blockAction: (b) => (b.source.includes('svg') ? { id: 'edit-figure', label: 'Edit figure', run } : null) }, { id: 'r', blockAction: () => ({ id: 'other', label: 'Other', run }) }]);
check('blockAction: the first feature that has one for the block; the others are not asked for it', withAction.blockAction({ id: 'b', source: 'x.svg' })?.id === 'edit-figure' && withAction.blockAction({ id: 'b', source: 'text' })?.id === 'other' && composeFeatures([]).blockAction({ id: 'b', source: '' }) === null);

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
