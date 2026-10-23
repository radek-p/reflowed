// loading/ (index.ts): both trees' indexes, the base from a page in a subdirectory, URLs, the cache key, the checks
// and reasons both front ends share, the status store fed by a synchronous fetch (the worker's) and an asynchronous one
// (the boot loader's), its fractions (never back, never past 100 %), the body reader. Node, no browser, no server.
//   node loading/loading.test.ts      (exit 1 on a failure)
import { treeBase, urlOf, accept, fetchSync, fetchAsync, readBody, TreeError, type Tree, type Got, type FetchEvent } from './tree.ts';
import { manifestIndex, moduleName, type Manifest } from './manifest.ts';
import { lsR, lsRIndex } from './ls-r.ts';
import { createFilesStatus, filesStatus, percent } from './status.ts';
import { cacheKey } from './cache.ts';
import { packRaw, readPack } from './pack.ts';
import { httpProvider, texRequires } from './http.ts';
import { commentStart, stripComments } from './tex-comment.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(d)}`}`); };
const enc = new TextEncoder();

// ── base resolution: the same for both trees, from the page's URL ──
const PAGE = 'https://www.example.org/~u/reflowEd/index.html#/doc/x';
check('the release tree beside a page in a subdirectory', treeBase('./', PAGE) === 'https://www.example.org/~u/reflowEd/', treeBase('./', PAGE));
check('the TeX tree beside the same page', treeBase('texlive/2022/', PAGE) === 'https://www.example.org/~u/reflowEd/texlive/2022/');
check('a page given as its directory (…/reflowEd/)', treeBase('texlive/2022', 'https://h/~u/reflowEd/') === 'https://h/~u/reflowEd/texlive/2022/');
check('nothing to resolve against: empty', treeBase('x/', 'not a url') === '');

// ── the two indexes behind one interface ──
const manifest: Manifest = { version: 'v', build: 'b', stamp: 's', files: [
  { id: 'app', path: 'app/app-ABCDEFGH.js', bytes: 10, group: 'essential', type: 'module' },
  { id: 'pack:texmf', path: 'engine/texmf-0123456789.bin', bytes: 30, group: 'rest', type: 'pack' },
] };
const mi = manifestIndex(manifest);
check('manifest index: path, size, group by id', mi.path('app') === 'app/app-ABCDEFGH.js' && mi.size('pack:texmf') === 30 && mi.group('pack:texmf') === 'rest' && mi.count === 2);
check('manifest index: an unknown id', mi.path('x') === null && mi.size('x') === null);
const li = lsRIndex(lsR(['tex/latex/siunitx/siunitx.sty', 'tex/latex/my pkg/odd name.sty']));
check('ls-R index: the path under texmf-dist/, no size, group tex', li.path('siunitx.sty') === 'texmf-dist/tex/latex/siunitx/siunitx.sty' && li.size('siunitx.sty') === null && li.group('x') === 'tex' && li.count === 2);
const tex: Tree = { id: 'tex', base: treeBase('texlive/2022/', PAGE), index: li };
check('URLs: each segment encoded', urlOf(tex, li.path('odd name.sty')!) === 'https://www.example.org/~u/reflowEd/texlive/2022/texmf-dist/tex/latex/my%20pkg/odd%20name.sty');

// ── the cache key ──
check('cache key: the tree (its year in its address) and the name', cacheKey(tex.base, 'siunitx.sty') === `${tex.base}\u0000siunitx.sty`);
check('cache key: with a hash when the index has one', cacheKey('b/', 'n', 'h1') !== cacheKey('b/', 'n', 'h2') && cacheKey('b/', 'n', 'h1').startsWith(cacheKey('b/', 'n')));

// ── the checks and reasons both front ends give ──
check('accept: a 200 with the bytes', 'bytes' in accept({ status: 200, bytes: enc.encode('x') }, 'a.sty'));
const why = (g: Got, size: number | null = null) => { const r = accept(g, 'a.sty', size); return 'reason' in r ? r.reason : ''; };
check('accept: an HTTP status', why({ status: 404, bytes: null }) === 'HTTP 404');
check('accept: no answer', /^no answer \(NetworkError\)/.test(why({ status: 0, bytes: null, error: 'NetworkError' })));
check('accept: a web page for a TeX file', /web page/.test(why({ status: 200, bytes: enc.encode('<html>'), type: 'text/html' })));
check('accept: another length than the index says', /3 bytes, not the 5/.test(why({ status: 200, bytes: enc.encode('abc') }, 5)));

// ── the store, fed by a synchronous fetch (the worker) ──
{
  const s = createFilesStatus();
  const asked: string[] = [];
  const ev: FetchEvent[] = [];
  const get = (u: string): Got => { asked.push(u); return u.endsWith('siunitx.sty') ? { status: 200, bytes: enc.encode('%s') } : { status: 404, bytes: null }; };
  const report = (e: FetchEvent) => { ev.push(e); s.report(e); };
  const ok = fetchSync(tex, 'siunitx.sty', get, report);
  check('sync: the file, from its URL', 'bytes' in ok && asked[0] === `${tex.base}texmf-dist/tex/latex/siunitx/siunitx.sty`, asked);
  check('sync: start then done reported, group tex', ev.map((e) => e.kind).join() === 'start,done' && ev[0].kind === 'start' && ev[0].group === 'tex', ev);
  check('sync: the store has it done, nothing busy', s.files().some((f) => f.name === 'siunitx.sty' && f.state === 'done') && !s.busy('tex'));
  const no = fetchSync(tex, 'odd name.sty', get, report);
  check('sync: a failure has the same reason as the page\'s', 'reason' in no && no.reason === 'HTTP 404', no);
  check('sync: the store lists the failure with its reason', s.failures().some((f) => f.name === 'odd name.sty' && f.reason === 'HTTP 404'), s.failures());
  const quiet: Tree = { ...tex, quiet: true };
  fetchSync(quiet, 'ls-R', get, (e) => s.report(e), 'texmf-dist/ls-R');
  check('sync: an assumed tree\'s failure is kept but not listed', !s.failures().some((f) => f.name === 'ls-R') && s.files().some((f) => f.name === 'ls-R' && f.state === 'failed'));
  check('sync: a name not in the index is not asked for', 'reason' in fetchSync(tex, 'nothere.sty', get, report) && asked.length === 3, asked);
}

// ── the store, fed by an asynchronous fetch (the boot loader) ──
const chunked = (parts: number[], headers: Record<string, string> = {}) => new Response(new ReadableStream<Uint8Array>({
  start(c) { for (const k of parts) c.enqueue(new Uint8Array(k).fill(7)); c.close(); },
}), { headers });
{
  const s = createFilesStatus();
  const release: Tree = { id: 'release', base: treeBase('./', PAGE), index: mi };
  s.expect('release', manifest.files.map((f) => ({ name: f.id, group: f.group, total: f.bytes })));
  check('async: expected files count at once (0 % of their bytes)', s.fraction('essential') === 0 && s.busy('essential') && s.busy('rest'));
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return chunked(u.endsWith('.js') ? [4, 6] : [10, 10, 10]); }) as unknown as typeof fetch;
  const seen: number[] = [];
  const off = s.subscribe(() => seen.push(s.fraction('essential')));
  const b = await fetchAsync(release, 'app', (e) => s.report(e), f);
  off();
  check('async: the body, from its URL beside the page', b.length === 10 && urls[0] === 'https://www.example.org/~u/reflowEd/app/app-ABCDEFGH.js', urls);
  check('async: each chunk moves the fraction, never back, to exactly 1', JSON.stringify(seen) === '[0,0.4,1,1]' && s.fraction('essential') === 1, seen);
  check('async: the rest is counted apart', s.fraction('rest') === 0 && s.busy('rest'));
  await fetchAsync(release, 'pack:texmf', (e) => s.report(e), f);
  check('async: all in: nothing busy', !s.busy() && s.fraction('rest') === 1);
  const html = (async () => chunked([10], { 'content-type': 'text/html' })) as unknown as typeof fetch;
  const e1 = await fetchAsync(release, 'app', (e) => s.report(e), html).then(() => null, (e: TreeError) => e);
  check('async: a web page instead: a TreeError with the same reason as the worker\'s', e1 instanceof TreeError && e1.reason === 'the server sent a web page instead of the file', e1?.message);
  const short = (async () => chunked([4])) as unknown as typeof fetch;
  const e2 = await fetchAsync(release, 'app', (e) => s.report(e), short).then(() => null, (e: TreeError) => e);
  check('async: a short body: an error naming both lengths, listed in the store', !!e2 && /4 bytes, not the 10/.test(e2.reason) && s.failures().some((x) => x.name === 'app'), e2?.reason);
  check('async: the fraction never goes back after a failure', s.fraction('essential') === 1);
}
{
  const e = await readBody(chunked([50, 50]), 60, () => {}).then(() => null, (x: Error) => x.message);
  check('readBody: a longer body is an error', !!e && /more than the 60 bytes/.test(e), e);
  const got: number[] = [];
  const b = await readBody(chunked([3, 4]), null, (k) => got.push(k));
  check('readBody: no size known: the whole body, every chunk reported', b.length === 7 && got.join() === '3,4');
}
check('percent: whole, rounded down, 100 only at 1', percent(0) === 0 && percent(0.999) === 99 && percent(1) === 100 && percent(1.2) === 100);
check('filesStatus(): one store per page (globalThis)', filesStatus() === filesStatus() && (globalThis as { __rtxFiles?: unknown }).__rtxFiles === filesStatus());

check('the app\'s modules by bare names (the loader\'s import map): @rtx/<file name>', moduleName('app:chunk-AB12.js') === '@rtx/chunk-AB12.js' && moduleName('app-X.js') === '@rtx/app-X.js');

// ── the pack: many files as one request ──
{
  const raw = packRaw([["texmf/a.sty", enc.encode("A")], ["texmf/empty.cfg", new Uint8Array(0)], ["texmf/b é.tex", enc.encode("BB")]]);
  const m = readPack(raw);
  check("pack: every file back, in order, empty ones and odd names too", [...m.keys()].join() === "texmf/a.sty,texmf/empty.cfg,texmf/b é.tex" && new TextDecoder().decode(m.get("texmf/b é.tex")) === "BB" && m.get("texmf/empty.cfg")!.length === 0);
  const inner = new Uint8Array(raw.length + 8); inner.set(raw, 8);
  check("pack: read from a view into a larger buffer (fzstd gives one)", new TextDecoder().decode(readPack(inner.subarray(8)).get("texmf/a.sty")) === "A");
  let cut = "";
  try { readPack(raw.subarray(0, raw.length - 1)); } catch (e) { cut = (e as Error).message; }
  check("pack: a cut-off pack says so", /cut off/.test(cut), cut);
}

// ── a package from the TeX tree in one round of parallel requests (http.ts prefetch) ──
check('texRequires: classes, packages, lists, options, comments', texRequires('\\documentclass[a4paper]{article}\n\\usepackage[binary-units]{siunitx}\n\\usepackage{a, b}%\\usepackage{c}\n% \\usepackage{d}\n\\RequirePackage{e}\\LoadClass{book}\\usepackage{\\x}').join() === 'article.cls,siunitx.sty,a.sty,b.sty,e.sty,book.cls',
  texRequires('\\usepackage{a, b}%\\usepackage{c}\n\\RequirePackage{e}'));

// ── the comment rule (tex-comment.ts): escapes are read as pairs ──
check('comments: \\\\% is a line break, then a comment', stripComments(String.raw`a \\% c`) === String.raw`a \\`, stripComments(String.raw`a \\% c`));
check('comments: \\% is a percent sign, kept', stripComments(String.raw`50\% off`) === String.raw`50\% off`, stripComments(String.raw`50\% off`));
check('comments: a comment goes, its line kept', stripComments('% x\ny') === '\ny' && commentStart('% x') === 0 && commentStart('y') === 1);
check('texRequires: a package after \\\\% is in a comment', texRequires('\\usepackage{a}\\\\%\\usepackage{b}').join() === 'a.sty', texRequires('\\usepackage{a}\\\\%\\usepackage{b}'));
{
  const TREE: Record<string, string> = {
    'tex/latex/siunitx/siunitx.sty': '\\RequirePackage{translations}\\RequirePackage{embedded}', 'tex/latex/siunitx/siunitx-abbreviations.cfg': 'x', 'tex/latex/siunitx/siunitx-v2.sty': 'old',
    'tex/latex/translations/translations.sty': '\\RequirePackage{deep}', 'tex/latex/translations/translations-basic-dictionary-english.trsl': 'en',
    'tex/latex/deep/deep.sty': '', 'tex/latex/zz-other/siunitx-abbreviations.cfg': 'later',
    'tex/latex/siunitx/siunitx-binary.cfg': 'mine', 'tex/latex/siunitx/a-driver.def': 'not siunitx\'s', 'tex/latex/aaa/siunitx-binary.cfg': 'found first', 'tex/latex/embedded/embedded.sty': '',
  };
  const lsrText = lsR(Object.keys(TREE));
  const urls: string[] = [];
  let inFlight = 0, most = 0;
  const fakeFetch = (async (u: string) => {
    urls.push(u); inFlight++; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const p = decodeURIComponent(u.replace(/^.*?\/texlive\/2022\/texmf-dist\//, ''));
    return TREE[p] == null ? new Response('no', { status: 404 }) : new Response(enc.encode(TREE[p]));
  }) as unknown as typeof fetch;
  const gets: string[] = [];
  const fetched: string[] = [];
  const p = httpProvider({ base: 'https://h/texlive/2022/', get: (u) => { gets.push(u); return /ls-R$/.test(u) ? { status: 200, bytes: enc.encode(lsrText) } : { status: 404, bytes: null }; }, onFetched: (nm) => fetched.push(nm) });
  const r = await p.prefetch(texRequires('\\usepackage{siunitx}'), { skip: (nm) => nm === 'embedded.sty', fetch: fakeFetch });
  check('prefetch: the package, its directory\'s support files, then what it requires, round by round; not other packages\' files, not what another provider has', r.rounds === 3 && fetched.sort().join() === 'deep.sty,siunitx-abbreviations.cfg,siunitx.sty,translations.sty', { r, fetched, urls });
  check('prefetch: a round\'s files are asked for at once (in parallel)', most >= 2, most);
  check('prefetch: only ls-R synchronously', gets.length === 1 && /ls-R$/.test(gets[0]), gets);
  check('prefetch: then TeX\'s reads are hits (no request)', p.resolve('siunitx-abbreviations.cfg') != null && gets.length === 1 && p.stats.prefetched === 4);
    check('prefetch: a sibling whose name kpathsea finds in another directory first is not fetched as the directory\'s', !fetched.includes('siunitx-binary.cfg') && new TextDecoder().decode(p.resolve('siunitx-abbreviations.cfg') ?? new Uint8Array()) === 'x');
  const again = await p.prefetch(['siunitx.sty'], { fetch: fakeFetch });
  check('prefetch: what it has is not asked for again', again.rounds === 0 && urls.length === 4, { again, urls: urls.length });
  const none = httpProvider({ base: 'https://h/texlive/2022/', get: () => ({ status: 0, bytes: null, error: 'off' }), quiet: true });
  check('prefetch: no tree (ls-R not there): nothing, no error', (await none.prefetch(['siunitx.sty'], { fetch: fakeFetch })).rounds === 0);
}

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
