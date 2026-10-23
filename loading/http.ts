// The TeX Live tree as an engine provider: a thin adapter of the TeX tree (tree.ts: its base, its
// URLs, the checks and reasons, fetchSync) with ls-R as its index (ls-r.ts lsRIndex). Nothing is asked of the server
// until TeX wants a file the embedded set lacks; then ls-R once, and each file once (synchronous: the engine's I/O is
// synchronous inside the worker, which blocks; the page does not). Files kept from earlier pages (the cache, cache.ts)
// come in `cached` and answer without a request, also when the server is off. Every request is reported (`report`:
// the worker posts it to the page's status store, status.ts).
//
//   const p = httpProvider({ base: 'http://127.0.0.1:8197/texlive/2022/', get: xhrGetSync(), cached, onFetched, report });
//   p.resolve('siunitx.sty');  p.status();  p.why('nothere.sty')
//   await p.prefetch(texRequires(preamble), { skip }) before TeX
//        runs (asynchronous: the worker is not blocked yet): the packages a text names, each with its own support files
//        (in its directory, named after it: siunitx-abbreviations.cfg), fetched in parallel, then the packages those
//        name, round by round; what TeX then opens is a hit. What it was not told of still comes one by one (resolve)
//   httpProvider({ …, quiet: true })   the tree assumed beside the page: ls-R asked at most once, quietly off without it

import { lsRIndex } from './ls-r.ts';
import { stripComments } from './tex-comment.ts';
import type { ResourceProvider } from './provider.ts';
import { fetchAsync, fetchSync, type GetSync, type Report, type Tree } from './tree.ts';
export { xhrGetSync, type Got, type GetSync } from './tree.ts';

export interface HttpOptions {
  /** the TeX Live root on the server (…/texlive/2022/) */
  base: string;
  get: GetSync;
  /** name -> bytes fetched on an earlier page */
  cached?: Map<string, Uint8Array>;
  /** a file fetched now (the backend keeps it) */
  onFetched?: (name: string, path: string, bytes: Uint8Array) => void;
  /** every request's start, end or failure (the page's status store) */
  report?: Report;
  /** after a failed ls-R, when to try again (ms; 60 s) */
  retryMs?: number;
  /** an address the page assumed, not one that was set: a failed
   *  ls-R is never asked again, and the problems do not mention a server that may not exist */
  quiet?: boolean;
  now?: () => number;
}

export interface HttpProvider extends ResourceProvider {
  base: string;
  quiet: boolean;
  /** 'idle' (nothing asked yet), 'ready' (ls-R read), 'unreachable' (ls-R could not be read: `error` says why) */
  status(): { state: 'idle' | 'ready' | 'unreachable'; error?: string; files?: number };
  /** why a name could not be given ('' when it was) */
  why(name: string): string;
  /** whether it gave this name (fetched now or kept from an earlier page) */
  gave(name: string): boolean;
  stats: { requests: number; fetched: number; bytes: number; ms: number; failed: number; prefetched: number; rounds: number };
  /** the files these names need, fetched in parallel before TeX runs (skip: names another provider has) */
  prefetch(names: string[], o?: { skip?: (name: string) => boolean; fetch?: typeof fetch; rounds?: number }): Promise<{ rounds: number; fetched: number }>;
}

/** the packages and classes a TeX text loads: \documentclass, \LoadClass (.cls), \usepackage, \RequirePackage (.sty) */
export function texRequires(text: string): string[] {
  const out = new Set<string>();
  const re = /\\(documentclass|LoadClass(?:WithOptions)?|usepackage|RequirePackage(?:WithOptions)?)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
  for (const m of stripComments(text).matchAll(re)) {
    const ext = /class/i.test(m[1]) ? '.cls' : '.sty';
    for (const n of m[2].split(',')) { const t = n.trim(); if (/^[A-Za-z0-9][\w.@-]*$/.test(t)) out.add(t + ext); }
  }
  return [...out];
}
/** a package's own support files, fetched with it: in its directory, named after it (siunitx-abbreviations.cfg), of the
 *  kinds packages read besides themselves; not other packages, drivers or fonts (graphics/ holds epsfig.sty and a dozen
 *  driver .def files) */
const SUPPORT = /\.(cfg|def|fd|clo|ldf|code\.tex|cnf|dat)$/i;
const supportOf = (name: string, sibling: string) => SUPPORT.test(sibling) && sibling.startsWith(name.replace(/\.[^.]+$/, ''));

/** names a run asks for that are never TeX Live files: the job's own (input.aux, rtx-block.tex), and names with no
 *  extension TeX tries first (\input foo looks for foo.tex after foo) */
const TEXLIVE_NAME = /^(?!input\.|rtx-block\.)[^/]*\.(sty|cls|clo|tex|def|fd|cfg|ldf|ltx|dtx|code\.tex|lua|tfm|vf|pfb|pfa|otf|ttf|ttc|afm|enc|map|bst|bbx|cbx|lbx|dbx|ist|sfd|cmap|cid|pro|ini|dat|cnf|lbx|txt|mkii|mkiv|pdf|png|jpg|eps)$/i;
const LSR = 'texmf-dist/ls-R';

export function httpProvider(o: HttpOptions): HttpProvider {
  const tree: Tree = { id: 'tex', base: o.base.endsWith('/') ? o.base : `${o.base}/`, index: null, quiet: !!o.quiet };
  const cached = o.cached ?? new Map<string, Uint8Array>();
  const now = o.now ?? (() => Date.now());
  const quiet = !!o.quiet;
  const failed = new Map<string, string>();
  let state: 'idle' | 'ready' | 'unreachable' = 'idle', error = '', triedAt = -Infinity;
  const stats = { requests: 0, fetched: 0, bytes: 0, ms: 0, failed: 0, prefetched: 0, rounds: 0 };

  function index() {
    if (tree.index) return tree.index;
    if (state === 'unreachable' && (quiet || now() - triedAt < (o.retryMs ?? 60000))) return null;
    triedAt = now();
    const t0 = now();
    const r = fetchSync(tree, 'ls-R', o.get, o.report, LSR);
    stats.requests++; stats.ms += now() - t0;
    if ('bytes' in r) {
      tree.index = lsRIndex(new TextDecoder().decode(r.bytes));
      state = 'ready'; error = '';
      return tree.index;
    }
    state = 'unreachable';
    error = /^HTTP/.test(r.reason) ? `${r.reason} for its file list (${LSR})` : r.reason;
    return null;
  }

  const p: HttpProvider = {
    id: 'server', base: tree.base, quiet, stats,
    has(name) {
      if (cached.has(name)) return true;
      if (!TEXLIVE_NAME.test(name)) return false;
      return !!index()?.path(name);
    },
    resolve(name) {
      const hit = cached.get(name);
      if (hit) return hit;
      if (failed.has(name)) return null;
      const path = index()?.path(name);
      if (!path) return null;
      const t0 = now();
      const r = fetchSync(tree, name, o.get, o.report);
      stats.requests++; stats.ms += now() - t0;
      if (!('bytes' in r)) { failed.set(name, r.reason); stats.failed++; return null; }
      cached.set(name, r.bytes);
      stats.fetched++; stats.bytes += r.bytes.length;
      o.onFetched?.(name, path.replace(/^texmf-dist\//, ''), r.bytes);
      return r.bytes;
    },
    gave: (name) => cached.has(name),
    async prefetch(names, po = {}) {
      const idx = names.length ? index() : null;
      if (!idx) return { rounds: 0, fetched: 0 };
      const skip = po.skip ?? (() => false);
      const seen = new Set<string>();
      const wanted = (n: string) => !seen.has(n) && !cached.has(n) && !failed.has(n) && TEXLIVE_NAME.test(n) && !skip(n) && !!idx.path(n);
      let want = names, rounds = 0, fetched = 0;
      const t0 = now();
      while (want.length && rounds < (po.rounds ?? 4)) {
        const batch: string[] = [];
        for (const n of want) {
          if (!wanted(n)) { seen.add(n); continue; }
          seen.add(n);
          batch.push(n);
          for (const s of idx.siblings?.(n) ?? []) if (supportOf(n, s) && wanted(s)) { seen.add(s); batch.push(s); }
        }
        if (!batch.length) break;
        rounds++;
        const got = await Promise.all(batch.map((n) => fetchAsync(tree, n, o.report, po.fetch ?? fetch, { cache: 'force-cache' }).then((b) => [n, b] as const, () => null)));
        const next: string[] = [];
        for (const g of got) {
          stats.requests++;
          if (!g) continue;
          const [n, b] = g;
          cached.set(n, b);
          stats.fetched++; stats.prefetched++; stats.bytes += b.length; fetched++;
          o.onFetched?.(n, idx.path(n)!.replace(/^texmf-dist\//, ''), b);
          if (/\.(sty|cls)$/i.test(n)) next.push(...texRequires(new TextDecoder().decode(b)));
        }
        want = next;
      }
      stats.rounds += rounds; stats.ms += now() - t0;
      return { rounds, fetched };
    },
    status: () => ({ state, ...(error ? { error } : {}), ...(tree.index ? { files: tree.index.count } : {}) }),
    why(name) {
      if (cached.has(name)) return '';
      if (failed.has(name)) return `the TeX resource server could not send it (${failed.get(name)})`;
      if (state === 'unreachable') return quiet ? '' : `the TeX resource server could not be reached: ${error}`;
      return 'not on the TeX resource server either';
    },
  };
  return p;
}
