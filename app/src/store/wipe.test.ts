// store/wipe.js on a fake origin: "Reset local data" deletes ReflowEd's databases and localStorage keys and leaves
// every other page's alone (one origin may serve several sites: github.io, a university's ~user pages). What is
// ReflowEd's goes by its naming rules (OWN_DATABASE, OWN_KEY), and every database and key the code names follows them:
// a new one named otherwise would outlive a reset (the source is read for them below).
//   node app/src/store/wipe.test.ts      (Node; exit 1 on a failure)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore: a JS module
import { wipeLocalData, KNOWN_DATABASES, OWN_DATABASE, OWN_KEY } from './wipe.js';

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

const idb = fakeIdb([...KNOWN_DATABASES, 'rtx-a-later-cache', 'another-site-db']);
idb.blocked.add('rtx-engine-cache');
const storage = fakeStorage({ 'rtx-editor.view': '{}', 'rtx-editor.workbench': '{}', 'rtx:policy': '{}', 'rtx-blocks.doc': '{}',
  'reflowtex-a11y-mode': 'spoken', 'another-site.key': '1', 'rtx-editorial': 'not ours' });
const session = fakeStorage({ 'rtx-editor.a-session-key': '1', 'another-site.key': '1' });
const blocked: string[] = [];
const r = await wipeLocalData({ idb, storage, session, onBlocked: (n: string) => blocked.push(n) });

check("ReflowEd's databases deleted, a later one by its name too", KNOWN_DATABASES.every((n: string) => !idb.dbs.has(n)) && !idb.dbs.has('rtx-a-later-cache'), [...idb.dbs]);
check("another page's database kept", idb.dbs.has('another-site-db') && idb.dbs.size === 1, [...idb.dbs]);
check('the deleted ones reported', JSON.stringify(r.databases) === JSON.stringify([...KNOWN_DATABASES, 'rtx-a-later-cache'].sort()), r.databases);
check('a blocked delete reported', JSON.stringify(blocked) === JSON.stringify(['rtx-engine-cache']), blocked);
check("ReflowEd's keys removed, every other kept",
  JSON.stringify([...storage.m.keys()].sort()) === JSON.stringify(['another-site.key', 'reflowtex-a11y-mode', 'rtx-editorial']), [...storage.m.keys()]);
check("… in session storage too", JSON.stringify([...session.m.keys()]) === '["another-site.key"]', [...session.m.keys()]);

// only some of ours there: those are reported, the rest are deleted all the same (nothing happens)
const idb2 = fakeIdb(['reflowtex-editor', 'x']);
const r2 = await wipeLocalData({ idb: idb2, storage: fakeStorage({}), session: fakeStorage({}) });
check('only the databases that were there reported', JSON.stringify(r2.databases) === JSON.stringify(['reflowtex-editor']), r2.databases);
check('the other kept', idb2.dbs.has('x') && idb2.dbs.size === 1, [...idb2.dbs]);

// a browser that cannot list the databases: the known ones go
const idb3 = fakeIdb([...KNOWN_DATABASES, 'y']);
const r3 = await wipeLocalData({ idb: { deleteDatabase: idb3.deleteDatabase }, storage: fakeStorage({}), session: fakeStorage({}) });
check('no listing: the known databases deleted and reported, the other kept', JSON.stringify([...idb3.dbs]) === '["y"]' && JSON.stringify(r3.databases) === JSON.stringify(KNOWN_DATABASES), [...idb3.dbs]);

// every database and storage key the code names is ReflowEd's by the rules (the viewer's reflowtex-… reading
// preferences excepted: shared with the other ReflowTeX pages of the origin, so a reset keeps them)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (e === 'node_modules' || e === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(e) && !/\.(test|suite)\.ts$/.test(e)) files.push(p);
  }
};
for (const d of ['app/src', 'engine/web', 'engine/src', 'loading']) walk(join(ROOT, d));
const keys = new Map<string, string>(), dbs = new Map<string, string>(), unnamed: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8'), at = relative(ROOT, f);
  // a key in a storage call, a …KEY… constant, a helper's call (safeGet / safeSet), a key made of a prefix and an id
  for (const re of [/(?:local|session)Storage\??\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`$]+)/g, /\b\w*KEY\w*\s*=\s*['"`]([^'"`$]+)/g, /\bsafe(?:Get|Set)\(\s*['"`]([^'"`$]+)/g])
    for (const m of src.matchAll(re)) keys.set(m[1], at);
  if (/Storage|safe(?:Get|Set)/.test(src)) for (const m of src.matchAll(/`((?:rtx|reflow)[^`$\s]*)\$\{/g)) keys.set(m[1], at);
  // a database: the name its opener defaults to, in each file that opens one
  if (/\b(?:indexedDB|factory|idb)\.open\(/.test(src)) {
    const found = [...src.matchAll(/\b(?:\w*DB\w*|name)\s*(?::\s*\w+\s*)?=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (!found.length) unnamed.push(at);
    for (const n of found) dbs.set(n, at);
  }
}
const VIEWER_KEY = /^reflowtex-/;
const strayKeys = [...keys].filter(([k]) => !OWN_KEY.test(k) && !VIEWER_KEY.test(k)).map(([k, at]) => `${k} (${at})`);
check(`every local or session storage key the code names is ReflowEd's by OWN_KEY (${keys.size}), so a reset forgets it`, keys.size >= 10 && strayKeys.length === 0, strayKeys);
const strayDbs = [...dbs].filter(([n]) => !OWN_DATABASE.test(n) || !KNOWN_DATABASES.includes(n)).map(([n, at]) => `${n} (${at})`);
check(`every IndexedDB database the code opens is ReflowEd's by OWN_DATABASE and known (${[...dbs.keys()].join(', ')})`,
  dbs.size === KNOWN_DATABASES.length && strayDbs.length === 0 && unnamed.length === 0, { strayDbs, unnamed });

if (bad) { console.log(`${bad} failed`); process.exit(1); }
