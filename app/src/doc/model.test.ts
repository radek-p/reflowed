// doc/model.js's lookups by id (blockById, indexOf): right after any in-place change of the list (the list is still
// written from many modules), and O(1) per lookup, not a scan.
//   node app/src/doc/model.test.ts      (Node; exit 1 on a failure)
import { createModel } from './model.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${JSON.stringify(d)}` : ''}`); };

const blocks = Array.from({ length: 600 }, (_, i) => ({ id: `b${i}`, source: `P${i}` }));
let reads = 0;
// the list as the model sees it: every element read counted
const list = new Proxy(blocks, { get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) reads++; return Reflect.get(t, k, r); } });
const d = { id: 'd', blocks: list };
const m = createModel({ ids: { ulid: () => 'x', keyBetween: () => 'k' }, persist: {}, doc: () => d });

m.indexOf('b0');                                   // the first lookup builds the map
reads = 0;
let right = true;
for (let k = 0; k < 600; k++) { const i = (k * 7) % 600; if (m.indexOf(`b${i}`) !== i || m.blockById(`b${i}`)?.source !== `P${i}`) right = false; }
check('600 lookups after the first: right, and a few element reads each (not a scan)', right && reads / 600 < 5, { perLookup: reads / 600 });

// in-place changes, as the app's modules make them: each lookup is right at once
list.splice(10, 1);                                // b10 taken out
check('a block taken out: not found; the next one found at its new index', m.indexOf('b10') === -1 && m.indexOf('b11') === 10 && m.blockById('b10') === undefined);
list.splice(0, 0, { id: 'new', source: 'N' });     // a block put in at the top
check('a block put in: found, and the others shifted', m.indexOf('new') === 0 && m.indexOf('b11') === 11 && m.blockById('new')?.source === 'N');
list.reverse();                                    // a reorder
check('a reorder: every block found at its new place', m.indexOf('new') === list.length - 1 && m.indexOf('b0') === list.length - 2);
d.blocks = [{ id: 'only', source: 'O' }] as any;   // the list replaced
check('the list replaced: the new list answers', m.indexOf('only') === 0 && m.indexOf('b0') === -1);

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
