// Making the single file's TeX pack smaller without changing what it typesets
// (scripts/build.ts; --no-minify turns it off).
//
//   TeX sources (.sty .cls .def .cfg .fd .clo .ldf .tex): comments go, the `%`
//     stays. A `%` starts a comment when an even number of backslashes stands
//     before it (`\%` is a percent sign, `\\%` a comment). A line that is only
//     a comment becomes `%` (the line stays: line numbers in messages do not
//     move); `code % text` becomes `code %` (the `%` still eats the line end).
//     Spaces at a line's end go (TeX drops them when it reads the line). Not
//     touched: .dtx/.ins, a file that changes %'s catcode or holds verbatim,
//     docstrip or filecontents material, a line with \verb or ^^ in it.
//   Font maps (.map): only the lines for fonts whose .tfm is in the pack.
//   Identical files: counted (the pack stores each name; a duplicate costs
//     nothing once compressed).
//
// Proof (prove()): every document scripts/record-docs.ts lists (both papers,
// the samples, templates, tier documents) is compiled by the file's own worker
// in Node threads, once with the plain pack and once with the minified one;
// every block's result (nodelist, errors, warnings, capture data) and the fonts
// the worker made must be byte-identical. A document that differs sends every
// minified file it opened back to its original bytes, and the proof runs again.
import { createHash } from 'node:crypto';
import { spawnWorker } from './node-engine.ts';
import type { Doc } from './record-docs.ts';
import { packRaw } from '../loading/pack.ts';
/** the worker's pack layout (loading/pack.ts) */
export { packRaw };

const TEX_EXT = /\.(sty|cls|def|cfg|fd|clo|ldf|tex)$/i;
const NEVER = /\.(dtx|ins)$/i;
// %'s catcode changed, verbatim / docstrip / filecontents material: the whole file stays as it is
const RISKY = /\\catcode\s*`?\s*\\?%|\\catcode\s*=?\s*37\b|\\catcode\s*"25|\\@makeother\s*\\%|\\makeother\s*\\%|\\dospecials|\\@sanitize|\\obeylines|\\obeyspaces|\\endlinechar|filecontents|\\begin\s*\{(?:verbatim|lstlisting|comment)\}|\\verbatim@|\\docstrip|\\lst@|\\@percentchar|\\ExplSyntaxOff\s*\\catcode/;

export type StripResult = { bytes: Uint8Array; saved: number } | { skip: string };

/** One TeX file's comments out (see the head of this file). Latin-1 in and out: bytes kept. */
export function stripTeX(name: string, bytes: Uint8Array): StripResult {
  if (NEVER.test(name)) return { skip: 'dtx/ins' };
  if (!TEX_EXT.test(name)) return { skip: 'not a TeX source' };
  const text = Buffer.from(bytes).toString('latin1');
  const m = RISKY.exec(text);
  if (m) return { skip: `risky: ${m[0].slice(0, 30)}` };
  const lines = text.split('\n');
  for (let k = 0; k < lines.length; k++) {
    let line = lines[k];
    const cr = line.endsWith('\r');
    if (cr) line = line.slice(0, -1);
    if (/\\verb|\^\^/.test(line)) continue;
    let at = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '%') continue;
      let bs = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) bs++;
      if (bs % 2 === 0) { at = i; break; }
    }
    if (at >= 0) line = /^[ \t]*$/.test(line.slice(0, at)) ? '%' : line.slice(0, at + 1);
    else line = line.replace(/ +$/, '');
    lines[k] = cr ? line + '\r' : line;
  }
  const out = Buffer.from(lines.join('\n'), 'latin1');
  return { bytes: new Uint8Array(out), saved: bytes.length - out.length };
}

/** A font map with the lines for fonts the pack has a TFM for. */
export function trimMap(bytes: Uint8Array, tfms: Set<string>): Uint8Array {
  const keep = Buffer.from(bytes).toString('latin1').split('\n').filter((l) => {
    const f = /^\s*([^\s%#]+)/.exec(l)?.[1];
    return !!f && tfms.has(f);
  });
  return new Uint8Array(Buffer.from(keep.join('\n') + '\n', 'latin1'));
}

export interface MinifyReport { files: number; stripped: number; savedTex: number; savedMaps: number; skipped: Record<string, string>; excluded: string[]; duplicates: number }

/** The pack's entries minified; `exclude`: names kept as they are (the proof's exclusions). */
export function minifyEntries(entries: [string, Uint8Array][], exclude = new Set<string>()): { entries: [string, Uint8Array][]; report: MinifyReport; changed: Set<string> } {
  const tfms = new Set(entries.map(([n]) => n.replace(/^texmf\//, '')).filter((n) => n.endsWith('.tfm')).map((n) => n.slice(0, -4)));
  const report: MinifyReport = { files: entries.length, stripped: 0, savedTex: 0, savedMaps: 0, skipped: {}, excluded: [...exclude].sort(), duplicates: 0 };
  const changed = new Set<string>();
  const seen = new Map<string, string>();
  const out = entries.map(([n, b]): [string, Uint8Array] => {
    const name = n.replace(/^texmf\//, '');
    const h = createHash('sha1').update(b).digest('hex');
    if (seen.has(h)) report.duplicates++; else seen.set(h, name);
    if (!n.startsWith('texmf/') || exclude.has(name)) return [n, b];
    if (name.endsWith('.map')) {
      const t = trimMap(b, tfms);
      report.savedMaps += b.length - t.length; changed.add(name);
      return [n, t];
    }
    if (!TEX_EXT.test(name)) return [n, b];
    const r = stripTeX(name, b);
    if ('skip' in r) { report.skipped[name] = r.skip; return [n, b]; }
    if (r.saved <= 0) return [n, b];
    report.stripped++; report.savedTex += r.saved; changed.add(name);
    return [n, r.bytes];
  });
  return { entries: out, report, changed };
}

type Run = { results: Record<string, string>; fonts: string; files: Record<string, string[]>; ms: number };
const clean = (r: any) => { const { timing: _t, cached: _c, ms: _m, ...rest } = r ?? {}; return JSON.stringify(rest); };

/** Every document through one worker thread with this pack (gzip level 1: the worker's own unpack). */
async function runAll(workerJs: string, packGz: Uint8Array, docs: Doc[], log: (s: string) => void): Promise<Run> {
  const t0 = performance.now();
  const w = spawnWorker(workerJs);
  try {
    await w.call('init', { packBytes: packGz });
    await w.call('engine', {});        // the engine from the pack init kept (worker.ts 'engine')
    const results: Record<string, string> = {}, files: Record<string, string[]> = {};
    let before = new Set<string>((await w.call('usage')).files);
    for (const d of docs) {
      await w.call('setAssets', { replace: true, assets: (d.assets ?? []).map((a) => ({ name: a.name, mime: a.mime, bytes: new Uint8Array(Buffer.from(a.b64, 'base64')) })) });
      const pre = await w.call('setPreamble', { preamble: d.preamble, bbl: d.bbl ?? '' });
      results[`${d.name}#pre`] = JSON.stringify({ ok: pre.ok, errors: pre.errors, warnings: pre.warnings });
      for (const [i, b] of d.blocks.entries()) {
        const r = await w.call('compile', { blocks: [{ id: `b${i}`, key: `k${i}`, source: b.source, context: b.context ?? '' }] }).catch((e: Error) => ({ blocks: { [`b${i}`]: { error: e.message } } }));
        results[`${d.name}#${i}`] = clean(r.blocks[`b${i}`]);
      }
      const now = new Set<string>((await w.call('usage')).files);
      files[d.name] = [...now].filter((f) => !before.has(f));
      // what a document opens again later is still its: every file it could have read, from the log of opens so far
      files[d.name].push(...[...before]);
      before = now;
    }
    const f = await w.call('dumpFonts');
    const fonts = JSON.stringify({ reqs: f.reqs, served: f.served, files: Object.fromEntries(Object.entries(f.files as Record<string, Uint8Array>).map(([k, v]) => [k, Buffer.from(v).toString('base64')])) });
    log(`  proof run: ${docs.length} documents, ${Object.keys(results).length} results, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    return { results, fonts, files, ms: performance.now() - t0 };
  } finally { await w.terminate(); }
}

/** Plain vs minified pack over every document: identical results and fonts, or the files to keep as they are. */
export async function prove(o: { workerJs: string; entries: [string, Uint8Array][]; docs: Doc[]; gzip: (b: Uint8Array) => Uint8Array; log?: (s: string) => void; exclude?: Set<string>; maxRounds?: number }) {
  const log = o.log ?? console.log;
  const exclude = new Set(o.exclude ?? []);
  const plain = await runAll(o.workerJs, o.gzip(packRaw(o.entries)), o.docs, log);
  for (let round = 1; round <= (o.maxRounds ?? 4); round++) {
    const min = minifyEntries(o.entries, exclude);
    const mine = await runAll(o.workerJs, o.gzip(packRaw(min.entries)), o.docs, log);
    const diffs = Object.keys(plain.results).filter((k) => plain.results[k] !== mine.results[k]);
    const fontsSame = plain.fonts === mine.fonts;
    log(`  proof round ${round}: ${min.changed.size} files minified, ${diffs.length} results differ${fontsSame ? '' : ', fonts differ'}`);
    if (!diffs.length && fontsSame) return { ok: true, exclude, report: min.report, diffs: [] as string[], plainMs: plain.ms, minMs: mine.ms };
    for (const k of diffs.slice(0, 6)) {
      const a = plain.results[k], b = mine.results[k] ?? '';
      let i = 0; while (i < a.length && a[i] === b[i]) i++;
      log(`  proof: ${k} differs at ${i}: …${a.slice(Math.max(0, i - 60), i + 60)}… vs …${b.slice(Math.max(0, i - 60), i + 60)}…`);
    }
    const blame = new Set<string>();
    // each differing result: the files it could have read, narrowed by group testing (one block, fresh workers)
    for (const k of diffs.slice(0, 8)) {
      const [dn, bi] = k.split('#');
      const d = o.docs.find((x) => x.name === dn)!;
      const cand = (plain.files[dn] ?? []).filter((f) => min.changed.has(f) && !exclude.has(f));
      const found = await culprits(o, d, bi, plain.results[k], cand, exclude, log);
      log(`  proof: ${k}: ${found.length} of ${cand.length} candidate files make the difference: ${found.slice(0, 10).join(', ')}`);
      for (const f of found) blame.add(f);
    }
    if (!fontsSame) for (const f of min.changed) if (/\.(map|fd)$/.test(f)) blame.add(f);
    if (!blame.size) return { ok: false, exclude, report: min.report, diffs, plainMs: plain.ms, minMs: mine.ms };
    for (const f of blame) exclude.add(f);
  }
  return { ok: false, exclude, report: minifyEntries(o.entries, exclude).report, diffs: ['rounds exhausted'], plainMs: plain.ms, minMs: 0 };
}

/** One result (a document's preamble or block) with the files in `on` minified, the rest original. */
async function oneResult(o: { workerJs: string; entries: [string, Uint8Array][]; gzip: (b: Uint8Array) => Uint8Array }, d: Doc, bi: string, on: Set<string>, exclude: Set<string>): Promise<string> {
  const all = minifyEntries(o.entries, exclude);
  const byName = new Map(all.entries.map(([n, b]) => [n, b]));
  const entries = o.entries.map(([n, b]): [string, Uint8Array] => (on.has(n.replace(/^texmf\//, '')) ? [n, byName.get(n)!] : [n, b]));
  const w = spawnWorker(o.workerJs);
  try {
    await w.call('init', { packBytes: o.gzip(packRaw(entries)) });
    await w.call('engine', {});
    await w.call('setAssets', { replace: true, assets: (d.assets ?? []).map((a) => ({ name: a.name, mime: a.mime, bytes: new Uint8Array(Buffer.from(a.b64, 'base64')) })) });
    const pre = await w.call('setPreamble', { preamble: d.preamble, bbl: d.bbl ?? '' });
    if (bi === 'pre') return JSON.stringify({ ok: pre.ok, errors: pre.errors, warnings: pre.warnings });
    const i = +bi, b = d.blocks[i];
    const r = await w.call('compile', { blocks: [{ id: `b${i}`, key: `k${i}`, source: b.source, context: b.context ?? '' }] }).catch((e: Error) => ({ blocks: { [`b${i}`]: { error: e.message } } }));
    return clean(r.blocks[`b${i}`]);
  } finally { await w.terminate(); }
}
/** Group testing: the files among `cand` whose minified bytes change this result (all of a group whose parts do not, alone). */
async function culprits(o: any, d: Doc, bi: string, want: string, cand: string[], exclude: Set<string>, log: (s: string) => void): Promise<string[]> {
  const differs = async (set: string[]) => (await oneResult(o, d, bi, new Set(set), exclude)) !== want;
  // a block run alone can differ from the same block in the full run (the fonts, what came before): check the baseline first
  if (await differs([])) { log(`  proof: ${d.name}#${bi} differs even unminified when run alone: all ${cand.length} candidates kept original`); return cand; }
  const go = async (set: string[]): Promise<string[]> => {
    if (!set.length || !(await differs(set))) return [];
    if (set.length === 1) return set;
    const h = set.length >> 1;
    const a = await go(set.slice(0, h)), b = await go(set.slice(h));
    return a.length || b.length ? [...a, ...b] : set;
  };
  return go(cand);
}
