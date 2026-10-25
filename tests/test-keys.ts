// The result keys, memoised (engine/web/keys.js), Node only:
//  - byte-identical to the old keys (the formula backend.js had before, copied below) for every
//    block of both seed documents, with and without sent files, after asset and preamble changes;
//  - opened() runs once per distinct text: one call per preamble change, not one per block;
//    re-keying every block again costs no scan at all.
//   node tests/test-keys.ts
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p: string) => import(pathToFileURL(join(HERE, p)).href);
const { opened } = await imp('engine/web/opened.js');
const { createKeys, VersionedMap } = await imp('engine/web/keys.js');
const { preambleKey, blockKey } = await imp('engine/web/key.js');

let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

function oldKeys(sent: Map<string, string | null>) {
  const sigOf = (src: string) => opened(src).map(([nm]: [string]) => nm).filter((nm: string, i: number, all: string[]) => all.indexOf(nm) === i && sent.get(nm)).sort()
    .map((nm: string) => `${nm}:${sent.get(nm)}`).join(',');
  const pkey = (preamble: string | null, bbl: string) => preambleKey(preamble ?? '', `${bbl}\u0000${sigOf(preamble ?? '')}`);
  const keyOf = (build: string, preamble: string | null, bbl: string, b: any) => { const sig = sigOf(`${b.context ?? ''}\n${b.source}`); return blockKey(build, pkey(preamble, bbl), b.source, sig ? `${b.context ?? ''}\u0000${sig}` : b.context ?? ''); };
  return { pkey, keyOf };
}

interface Doc { name: string, preamble: string, bbl: string, blocks: { id: string, source: string, context?: string }[] }
const docs: Doc[] = [];
for (const f of ['app/seed/intro.json']) {
  const p = join(HERE, f);
  if (!existsSync(p)) { console.log(`(no ${f}: node scripts/seed.ts, w3-build --assets; synthetic blocks only)`); continue; }
  const init = JSON.parse(readFileSync(p, 'utf8')).init;
  docs.push({ name: f, preamble: init.preamble, bbl: init.bib?.kind === 'bbl' ? init.bib.source : '', blocks: init.blocks.map((b: any) => ({ id: b.id, source: b.source })) });
}
// a synthetic document that names files (always there, so the test means something without the seeds)
docs.push({
  name: 'synthetic', bbl: 'bbl text',
  preamble: '\\documentclass{lipics-v2021}\n\\usepackage{mine,other}\n% \\usepackage{commented}\n\\input{macros}\n\\DeclareFontShape{U}{seg}{m}{n}{<-> s*[0.9] SegmentSymbol}{}\n',
  blocks: [
    { id: 'a', source: 'Text \\includegraphics[width=3cm]{fig1} and \\includegraphics{fig2.pdf}.' },
    { id: 'b', source: '\\input{table} $x$', context: '\\noindent' },
    { id: 'c', source: 'No files here.' },
    { id: 'd', source: '\\includegraphics{fig1}\\includegraphics{fig1}', context: '\\includegraphics{ctxfig}' },
    { id: 'e', source: '% \\includegraphics{hidden}\nvisible' },
  ],
});
// some blocks get a context (the app gives them one; the seeds have none)
for (const d of docs) d.blocks.forEach((b, i) => { if (i % 3 === 1 && b.context == null) b.context = `\\setcounter{section}{${i}}`; });

const BUILD = 'testbuild';
for (const d of docs) {
  const sent = new VersionedMap();
  let calls = 0;
  const keys = createKeys({ opened: (s: string) => { calls++; return opened(s); }, sent });
  const old = oldKeys(sent);
  let pre = d.preamble;
  const all = () => d.blocks.map((b) => keys.keyOf(BUILD, keys.pkey(pre, d.bbl), b));
  const allOld = () => d.blocks.map((b) => old.keyOf(BUILD, pre, d.bbl, b));
  const same = (what: string) => {
    const a = all(), b = allOld();
    const bad = a.findIndex((k, i) => k !== b[i]);
    check(`${d.name}: ${what}: every key equals the old one (${a.length})`, bad < 0 && keys.pkey(pre, d.bbl) === old.pkey(pre, d.bbl), bad >= 0 ? `block ${d.blocks[bad].id}: ${a[bad]} vs ${b[bad]}` : '');
  };
  same('no files sent');
  const c0 = calls;
  all(); all(); all();
  check(`${d.name}: keying every block again scans nothing`, calls === c0, `${calls - c0} opened() calls`);
  // files sent: every name any source opens gets a hash (some null: looked up, none)
  const names = new Set<string>();
  for (const s of [pre, ...d.blocks.map((b) => `${b.context ?? ''}\n${b.source}`)]) for (const [nm] of opened(s)) names.add(nm);
  [...names].forEach((nm, i) => sent.set(nm, i % 4 === 3 ? null : `h${i}+`));
  const c1 = calls;
  same(`${names.size} names sent`);
  check(`${d.name}: an asset change scans nothing`, calls === c1, `${calls - c1} opened() calls`);
  // one file changes (a figure edited): only that is new, still identical
  const first = [...names][0];
  if (first) { sent.set(first, 'changed+r'); same(`${first} changed`); sent.delete(first); same(`${first} forgotten`); }
  // the preamble changes: exactly one scan (of the new preamble), not one per block
  const c2 = calls;
  pre = `${pre}\n\\usepackage{added}`;
  all();
  check(`${d.name}: a preamble change: one opened() call (not one per block)`, calls - c2 === 1, `${calls - c2} calls for ${d.blocks.length} blocks`);
  same('after the preamble change');
  // the bbl changes: no scan
  const c3 = calls;
  d.bbl += ' more';
  same('after a bbl change');
  check(`${d.name}: a bbl change scans nothing`, calls === c3, `${calls - c3} calls`);
  // an edited block: one scan for its new text
  const c4 = calls;
  d.blocks[0] = { ...d.blocks[0], source: `${d.blocks[0].source} edited \\includegraphics{new}` };
  same('after a block edit');
  check(`${d.name}: a block edit: one opened() call`, calls - c4 === 1, `${calls - c4} calls`);
  sent.clear();
  same('after the engine restarted (sent cleared)');
}

// a mutation through the map's own methods always bumps the version; a set to the same value does not
{
  const m = new VersionedMap();
  const v0 = m.version; m.set('a', 'x'); const v1 = m.version; m.set('a', 'x'); const v2 = m.version; m.set('a', null); m.delete('a'); m.delete('zz'); m.clear();
  check('VersionedMap: new value bumps, same value does not, delete bumps, a missing delete and an empty clear do not', v1 === v0 + 1 && v2 === v1 && m.version === v1 + 2);
}

// a long typing session: every keystroke is a new text; the memos stay within their character budget
// (they held every text up to 20,000 entries: tens of MB), and their keys are still the fresh ones
{
  const sent = new VersionedMap();
  const keys = createKeys({ opened, sent });
  const para = 'word '.repeat(400);                             // 2,000 characters
  let last = '', peak = 0;
  for (let i = 0; i < 5000; i++) {                              // 10 million characters typed
    last = keys.keyOf('b', 'p', { id: 'x', source: `${para}${i}`, context: '' });
    keys.opened(`${para}${i}`);
    const st = keys.stats();
    peak = Math.max(peak, st.scannedChars, st.blockChars);
  }
  const fresh = createKeys({ opened, sent }).keyOf('b', 'p', { id: 'x', source: `${para}4999`, context: '' });
  check('memos: 10 M characters typed, at most 4 M kept in either memo; the last key is the one a fresh memo gives', peak <= 4_000_000 + para.length + 8 && last === fresh, `peak ${peak}`);
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
