// A stored result is used only while the document's files its runs read are as they were (web/backend.js
// filesHold): the worker's record of what a block opened (Result.files: a figure a macro places too), the signature
// each file had then (fileSigs), checked against the document's when the result is asked for again: in this page, on
// a later page from the persistent cache, and for a name the run looked for in vain that the document has now.
// Node, no browser: backend.js on a stand-in worker that answers as the real one does.
//   node engine/tests/file-deps.test.ts      (exit 1 on a failure)
import { createBackend } from '../web/backend.js';

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (ok) pass++; else fail++;
};

// the page's parts the backend touches (the font hook)
(globalThis as any).document ??= { head: { appendChild: (n: unknown) => n }, baseURI: 'http://localhost/' };

type Asset = { name: string; mime: string; hash: string; bytes: Uint8Array };
type Block = { id: string; key?: string; source: string; fresh?: boolean };
/** the stand-in worker: \shot{name} opens name, then name.png (graphicx's tries, as the engine reports them) */
function fakeWorker(log: { compiled: { id: string; fresh: boolean; had: string | null }[] }) {
  const has = new Map<string, string>();               // name -> the hash of the file the worker holds
  const w: any = {
    onmessage: null,
    terminate() {},
    postMessage({ id, cmd, args }: { id: number; cmd: string; args: any }) {
      const answer = (result: unknown) => queueMicrotask(() => w.onmessage?.({ data: { id, result } }));
      if (cmd === 'init') return answer({ build: 'B1', files: 0 });
      if (cmd === 'engine') return answer({ ms: 0 });
      if (cmd === 'setPreamble') return answer({ ok: true, errors: [], warnings: [], adapted: [], ms: 0, pkey: 'p', missing: [], files: ['lipics-logo-bw.pdf'] });
      if (cmd === 'setAssets') { for (const a of args.assets) has.set(a.name, new TextDecoder().decode(a.bytes)); return answer({}); }
      if (cmd === 'fonts') return answer({ fonts: {}, fontFiles: {} });
      if (cmd === 'compile') {
        const blocks: Record<string, unknown> = {};
        for (const b of args.blocks as Block[]) {
          const fig = /\\shot\{([^}]+)\}/.exec(b.source)?.[1] ?? null;
          const files = fig ? [fig, `${fig}.png`] : [];
          const had = fig ? has.get(`${fig}.png`) ?? null : null;
          log.compiled.push({ id: b.id, fresh: !!b.fresh, had });
          blocks[b.id] = { key: b.key, status: 'ok', errors: [], warnings: [], nodelist: 'AAAA', files, missing: fig && !had ? [`${fig}.png`] : [], ms: 1, timing: {}, cached: false };
        }
        return answer({ blocks, fonts: {}, fontFiles: {}, stats: {} });
      }
      answer({});
    },
  };
  return w;
}

const memCache = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: unknown) => { m.set(k, structuredClone(v)); }, delete: async (k: string) => { m.delete(k); } }; };
const P = '\\documentclass{article}\n\\newcommand{\\shot}[1]{\\includegraphics{#1}}';
const enc = new TextEncoder();
const png = (name: string, hash: string): Asset => ({ name, mime: 'image/png', hash, bytes: enc.encode(hash) });

function page(cache: ReturnType<typeof memCache>, files: Map<string, Asset>) {
  const log = { compiled: [] as { id: string; fresh: boolean; had: string | null }[] };
  const be: any = createBackend({ standalone: { build: 'B1', createWorker: () => fakeWorker(log), initArgs: () => ({}), engineArgs: () => ({}) }, cache, resourceStore: null, figures: false, timeoutMs: 5000 });
  be.setAssets(async (name: string) => files.get(name) ?? null);
  const one = async (id: string, source: string) => (await be.compile({ preamble: P, keep: [], blocks: [{ id, source }] })).blocks[id];
  return { be, log, one };
}

const cache = memCache();
const files = new Map<string, Asset>([['figures/x.png', png('figures/x.png', 'h1')]]);
{
  const { be, log, one } = page(cache, files);
  const r = await one('f', 'A \\shot{figures/x}.');
  // (the first run misses the file, which no \includegraphics names: the backend finds it in the document and runs again)
  check('first compile: the result records what the run read, with the file\'s signature', r.status === 'ok' && JSON.stringify(r.files) === '["figures/x","figures/x.png"]' && r.fileSigs?.['figures/x.png'] === 'h1+' && log.compiled.at(-1)!.had === 'h1', { r, log });
  const runs = log.compiled.length;
  const r2 = await one('f', 'A \\shot{figures/x}.');
  check('asked again, the file as it was: this page\'s result, nothing typeset', r2.cached && log.compiled.length === runs, log);
  files.set('figures/x.png', png('figures/x.png', 'h2'));
  const r3 = await one('f', 'A \\shot{figures/x}.');
  check('the figure replaced in place (a macro places it, no key names it): typeset again, fresh, with the new file', !r3.cached && log.compiled.length === runs + 1 && log.compiled.at(-1)!.fresh && log.compiled.at(-1)!.had === 'h2' && r3.fileSigs?.['figures/x.png'] === 'h2+', log);
  check('… the same key (keys stay functions of their inputs)', r3.key === r.key);
  const st = be.stats();
  check('… counted as a stale result', st.staleFiles === 1, st);
  const res = await be.compile({ preamble: P, keep: [], blocks: [{ id: 'g', source: 'Text.' }] });
  check('the preamble\'s answer says what its warm read', JSON.stringify(res.preamble.files) === '["lipics-logo-bw.pdf"]', res.preamble);
}
{
  const { log, one } = page(cache, files);
  const r = await one('f', 'A \\shot{figures/x}.');
  check('a later page, the file unchanged: the persistent cache\'s result, nothing typeset', r.cached && log.compiled.length === 0, log);
}
{
  files.set('figures/x.png', png('figures/x.png', 'h3'));
  const { log, one } = page(cache, files);
  const r = await one('f', 'A \\shot{figures/x}.');
  check('a later page, the file changed meanwhile: the stored result is not used', !r.cached && log.compiled.length === 1 && log.compiled[0]!.fresh && r.fileSigs?.['figures/x.png'] === 'h3+', { log, r });
}
{
  const { log, one } = page(cache, files);
  const r = await one('m', 'B \\shot{figures/y}.');
  check('a figure the document lacks: the names looked for are recorded, no signature', JSON.stringify(r.files) === '["figures/y","figures/y.png"]' && Object.keys(r.fileSigs ?? {}).length === 0, r);
  files.set('figures/y.png', png('figures/y.png', 'hy'));
  const r2 = await one('m', 'B \\shot{figures/y}.');
  check('… added to the document later: the block typesets again, with it', !r2.cached && log.compiled.length >= 2 && log.compiled.at(-1)!.had === 'hy', log);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
