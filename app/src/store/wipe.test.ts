// store/wipe.js on a fake origin: "Reset local data" deletes ReflowEd's databases and localStorage keys and leaves
// every other page's alone (one origin may serve several sites: github.io, a university's ~user pages).
//   node app/src/store/wipe.test.ts      (Node; exit 1 on a failure)
// @ts-ignore: a JS module
import { wipeLocalData, KNOWN_DATABASES } from './wipe.js';

let bad = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

function fakeIdb(names: string[]) {
  const dbs = new Set(names), blocked = new Set<string>();
  return {
    dbs, blocked,
    databases: async () => [...dbs].map((name) => ({ name, version: 1 })),
    deleteDatabase(name: string) {
      const r: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      setTimeout(() => { if (blocked.has(name)) r.onblocked?.(); dbs.delete(name); r.onsuccess?.(); }, 0);
      return r;
    },
  };
}
function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

const idb = fakeIdb([...KNOWN_DATABASES, 'another-site-db']);
idb.blocked.add('rtx-engine-cache');
const storage = fakeStorage({ 'rtx-editor.view': '{}', 'rtx-editor.workbench': '{}', 'rtx:policy': '{}', 'rtx-blocks.doc': '{}',
  'reflowtex-a11y-mode': 'spoken', 'another-site.key': '1', 'rtx-editorial': 'not ours' });
const blocked: string[] = [];
const r = await wipeLocalData({ idb, storage, onBlocked: (n: string) => blocked.push(n) });

check("ReflowEd's databases deleted", KNOWN_DATABASES.every((n: string) => !idb.dbs.has(n)), [...idb.dbs]);
check("another page's database kept", idb.dbs.has('another-site-db'));
check('the deleted ones reported', JSON.stringify(r.databases) === JSON.stringify(KNOWN_DATABASES), r.databases);
check('a blocked delete reported', JSON.stringify(blocked) === JSON.stringify(['rtx-engine-cache']), blocked);
check("ReflowEd's keys removed, every other kept",
  JSON.stringify([...storage.m.keys()].sort()) === JSON.stringify(['another-site.key', 'reflowtex-a11y-mode', 'rtx-editorial']), [...storage.m.keys()]);

// only some of ours there: those are reported, the rest are deleted all the same (nothing happens)
const idb2 = fakeIdb(['reflowtex-editor', 'x']);
const r2 = await wipeLocalData({ idb: idb2, storage: fakeStorage({}) });
check('only the databases that were there reported', JSON.stringify(r2.databases) === JSON.stringify(['reflowtex-editor']), r2.databases);
check('the other kept', idb2.dbs.has('x') && idb2.dbs.size === 1, [...idb2.dbs]);

if (bad) { console.log(`${bad} failed`); process.exit(1); }
