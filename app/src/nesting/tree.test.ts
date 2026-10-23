// nesting/tree.ts: the nesting tree of a block list, right after every change that matters (a parent, a block that
// starts or stops typesetting, an order, a list replaced), and cheap to ask for again (every
// block's compile key asks for it; a signature string of every block was built on each call).
//   node app/src/nesting/tree.test.ts      (Node; exit 1 on a failure)
import { createTree } from './tree.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${JSON.stringify(d)}` : ''}`); };

type B = { id: string; kind?: string; source: string; parentId?: string | null; attrs?: Record<string, unknown> };
const container = (id: string): B => ({ id, kind: 'theorem', source: '\\begin{theorem}', attrs: { container: { env: 'theorem' } } });
const para = (id: string, source: string, parentId: string | null = null): B => ({ id, kind: 'paragraph', source, parentId });

let list: B[] = [para('p0', 'Intro.'), container('c'), para('k1', 'First.', 'c'), para('k2', 'Second.', 'c'), para('p1', 'After.')];
const T = createTree<B>();
const t0 = T.of(list);
check('children, parents and roles', t0.kids.get('c')?.map((b) => b.id).join() === 'k1,k2' && t0.parent.get('k2') === 'c' && t0.roles.get('k1')?.first === true && t0.roles.get('k2')?.last === true);
check('asked again: the same tree, not built again', T.of(list) === t0 && T.builds() === 1);
list[4]!.parentId = 'c';
const t1 = T.of(list);
check('a parent changed in place: built again, the revision moved', t1.rev !== t0.rev && t1.parent.get('p1') === 'c' && T.builds() === 2);
list[3]!.source = '';
const t2 = T.of(list);
check('a child stops typesetting (empty): built again; the roles follow', t2.rev !== t1.rev && t2.roles.get('k2') === undefined, [...t2.roles.keys()]);
list = [...list];
check('the same blocks in a new list: the tree kept (no build)', T.of(list).rev === t2.rev && T.builds() === 3);
list[0]!.source = 'Intro, typed into.';
check('typing in a block (its source, not the tree): the revision stays, nothing built', T.of(list).rev === t2.rev && T.builds() === 3);
list = [list[0]!, list[1]!, list[3]!, list[2]!, list[4]!];
check('an order changed: built again', T.of(list).rev !== t2.rev && T.builds() === 4);

// cost: a pass over 600 blocks asking twice per block (as the compile keys do) builds nothing and allocates no strings
const big: B[] = [];
for (let i = 0; i < 100; i++) { big.push(container(`c${i}`)); for (let k = 0; k < 5; k++) big.push(para(`c${i}-${k}`, `Line ${k} of ${i}.`, `c${i}`)); }
const B2 = createTree<B>();
B2.of(big);
const ref = () => big.map((b) => `${b.id}:${b.parentId ?? ''}:1`).join(',');   // what each call built before
let t = performance.now(); for (let i = 0; i < big.length * 2; i++) ref(); const before = performance.now() - t;
t = performance.now(); for (let i = 0; i < big.length * 2; i++) B2.of(big); const now = performance.now() - t;
check('a pass over 600 blocks (1,200 asks): no build, several times cheaper than building the signature', B2.builds() === 1 && now * 3 < before, { nowMs: Math.round(now), signatureMs: Math.round(before) });

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
