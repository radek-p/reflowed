// Blocks of LaTeX body under one preamble, compiled by the public LuaLaTeX pipeline.
//
//   compile(preamble, blocks: [{ id, source }], keep: [key])
//     -> { blocks: { <id>: BlockResult }, preamble: { errors, warnings }, fonts, stats }
//   BlockResult = { key, status 'ok'|'error', cached, errors, warnings,
//                   nodelist (base64 protobuf, the viewer's data-nodelist-b64) | null,
//                   ms (the run it was built in), batch (blocks in that run) }
//
// A block is cached by (toolchain, preamble, source): only blocks not built
// before compile. Those compile together as ONE LuaLaTeX document
// (Pipeline.compileBatch: joined by \reflowtexbatchpart, the result split per
// block). When that run has a TeX error, the blocks its errors are on are
// compiled again each on its own (an error may come from an earlier block
// that left a group open), and the rest again as one batch; a failure there
// too falls back to one run per block. So an error stays on its block.
//
// Fonts: every block of the document shares one set of served fonts. After a
// compile, the fonts for all the document's blocks (the new ones and `keep`)
// are patched together (Pipeline.useCached + finishFonts, not subset), so a
// patched font covers every block, and its files are copied into a store
// that only grows (build/fonts/: content-hashed names never collide). The
// page is told original -> served; /fonts/<original> answers the newest.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

interface Problem { severity: string; message: string; line: number | null; context: string | null; detail: string; endLine?: number | null }
export interface BlockDeps {
  Pipeline: any; contentKey: (c: string, p?: string) => string; parseLog: (log: string) => Problem[];
  build: string; salt: string; pMark: number;
}
type Todo = { id: string; key: string; source: string };

// \ref and friends need the .aux round trip (site.ts passesFor)
const REF_RE = /\\(?:(?:eq|auto|c|C|name|page)?ref\*?\{|tableofcontents|listof(?:figures|tables)|cite)/;

export function blockCompiler(d: BlockDeps) {
  const BLOCKS = join(d.build, 'blocks'), RUNS = join(d.build, 'runs'), FONTWORK = join(d.build, 'font-work'), FONTS = join(d.build, 'fonts');
  for (const p of [BLOCKS, RUNS, FONTWORK, FONTS]) mkdirSync(p, { recursive: true });
  const KEEP = 500;
  const stats = { requests: 0, runs: 0, partsCompiled: 0, partsCached: 0, fontFinishes: 0 };
  /** original font file -> newest served file (for /fonts/<original>) */
  const latest = new Map<string, string>();

  const keyOf = (source: string, preamble: string) => d.contentKey(`${d.salt}\n${source}`, preamble);

  /** A run's problems, sorted to the preamble or to the part (by index) whose
   *  lines they are on, lines made the part's own (1 = its first line). */
  function attribute(inputTex: string, log: string, preamble: string, parts: string[]) {
    const lineAt = (i: number) => inputTex.slice(0, i).split('\n').length;
    const starts = parts.map((_, i) => {
      const mark = `\\reflowtexbatchpart{${i + 1}}\n`;
      const k = inputTex.indexOf(mark);
      return k < 0 ? -1 : lineAt(k + mark.length);
    });
    const nPre = preamble.split('\n').length;
    const pre: Problem[] = [], per: Problem[][] = parts.map(() => []), other: Problem[] = [];
    for (const p of d.parseLog(log)) {
      const n = p.line;
      if (n != null && n >= d.pMark && n < d.pMark + nPre) { pre.push({ ...p, line: n - d.pMark + 1 }); continue; }
      let hit = -1;
      for (let i = 0; i < parts.length; i++) {
        if (starts[i] < 0 || n == null) continue;
        if (n >= starts[i] && n < starts[i] + parts[i].split('\n').length) hit = i;
      }
      if (hit >= 0) per[hit].push({ ...p, line: n! - starts[hit] + 1, endLine: p.endLine != null ? p.endLine - starts[hit] + 1 : null });
      else other.push({ ...p, line: null });
    }
    return { pre, per, other };
  }

  /** One LuaLaTeX run of these blocks: per block its bytes, or null (the run failed). */
  async function run(preamble: string, blocks: Todo[]) {
    stats.runs++;
    const lines: string[] = [];
    const pipe = new d.Pipeline({ buildRoot: RUNS, fontsDir: FONTWORK, log: (s: string) => lines.push(s) });
    const batchKey = d.contentKey(`batch\n${blocks.map((c) => c.key).join(',')}`, preamble);
    const passes = blocks.some((b) => REF_RE.test(b.source)) ? 3 : 1;
    const t0 = performance.now();
    let blobs: Map<string, Uint8Array> | null = null, failure: Error | null = null;
    try {
      blobs = await pipe.compileBatch(blocks.map((c) => ({ key: c.key, content: c.source })), preamble, { key: batchKey, name: 'blocks', passes });
    } catch (e) { failure = e as Error; }
    const ms = performance.now() - t0;
    const dir = join(RUNS, batchKey);
    const log = existsSync(join(dir, 'input.log')) ? readFileSync(join(dir, 'input.log'), 'utf8') : '';
    const inputTex = existsSync(join(dir, 'input.tex')) ? readFileSync(join(dir, 'input.tex'), 'utf8') : '';
    const where = attribute(inputTex, log, preamble, blocks.map((c) => c.source));
    if (failure && !where.pre.length && !where.per.some((p) => p.length)) console.error(`run ${batchKey}: ${failure.message}\n${lines.join('\n')}`);
    return { blobs, failure, ms, where };
  }

  let chainTail: Promise<unknown> = Promise.resolve();
  function compile(preamble: string, blocks: { id: string; source: string }[], keep: string[]) {
    const job = chainTail.then(() => compileNow(preamble, blocks, keep));
    chainTail = job.catch(() => {});
    return job;
  }

  async function compileNow(preamble: string, blocks: { id: string; source: string }[], keep: string[]) {
    stats.requests++;
    const t0 = performance.now();
    const out: Record<string, any> = {};
    const todo: Todo[] = [];
    const twins: [string, string][] = [];         // [id, id of the same source in todo]
    for (const c of blocks) {
      const key = keyOf(c.source, preamble);
      const twin = todo.find((t) => t.key === key);
      if (twin) { twins.push([c.id, twin.id]); continue; }   // one part per distinct source
      const f = join(BLOCKS, key, 'result.json');
      if (existsSync(f)) {
        out[c.id] = { ...JSON.parse(readFileSync(f, 'utf8')), cached: true };
        touch(key);
        stats.partsCached++;
      } else todo.push({ id: c.id, key, source: c.source });
    }
    let preambleProblems: Problem[] = [];
    let runs = 0;
    const finish = (c: Todo, r: Awaited<ReturnType<typeof run>>, i: number, batch: number) => {
      const bytes = r.blobs?.get(c.key) ?? null;
      const problems = [...r.where.per[i]];
      if (!bytes && !problems.some((p) => p.severity === 'error')) {
        problems.unshift(r.where.pre.some((p) => p.severity === 'error')
          ? { severity: 'error', message: 'the preamble has errors', line: null, context: null, detail: '' }
          : { severity: 'error', message: firstLine(r.failure?.message ?? 'the build failed'), line: null, context: null,
              detail: [...r.where.other.filter((p) => p.severity === 'error').map((p) => p.message), r.failure?.message ?? ''].join('\n') });
      }
      const res = {
        key: c.key, status: bytes ? 'ok' : 'error',
        errors: problems.filter((p) => p.severity === 'error'),
        warnings: problems.filter((p) => p.severity !== 'error'),
        nodelist: bytes ? Buffer.from(bytes).toString('base64') : null,
        ms: Math.round(r.ms), batch,
      };
      if (bytes) {
        mkdirSync(join(BLOCKS, c.key), { recursive: true });
        copyFileSync(join(RUNS, c.key, 'output.json'), join(BLOCKS, c.key, 'output.json'));
        writeFileSync(join(BLOCKS, c.key, 'result.json'), JSON.stringify(res));
        touch(c.key);
      }
      out[c.id] = { ...res, cached: false };
    };
    const alone = async (c: Todo) => { const r = await run(preamble, [c]); runs++; finish(c, r, 0, 1); };
    if (todo.length) {
      stats.partsCompiled += todo.length;
      const r = await run(preamble, todo); runs++;
      preambleProblems = r.where.pre;
      if (r.blobs || todo.length === 1 || preambleProblems.some((p) => p.severity === 'error')) {
        todo.forEach((c, i) => finish(c, r, i, todo.length));
      } else {
        // an error somewhere: the blocks it is on each alone, the rest together
        const bad = todo.filter((_, i) => r.where.per[i].some((p) => p.severity === 'error'));
        const good = todo.filter((c) => !bad.includes(c));
        for (const c of bad) await alone(c);
        if (bad.length && good.length > 1) {
          const r2 = await run(preamble, good); runs++;
          if (r2.blobs) good.forEach((c, i) => finish(c, r2, i, good.length));
          else for (const c of good) await alone(c);
        } else for (const c of good) await alone(c);
      }
    }
    for (const [id, twin] of twins) out[id] = { ...out[twin], cached: true };
    // the fonts of the whole document
    const docKeys = [...new Set([...keep, ...Object.values(out).filter((r) => r.status === 'ok').map((r) => r.key as string)])];
    const fonts = await finishFonts(docKeys);
    clean();
    return {
      preamble: { errors: preambleProblems.filter((p) => p.severity === 'error'), warnings: preambleProblems.filter((p) => p.severity !== 'error') },
      blocks: out, fonts,
      stats: { ms: Math.round(performance.now() - t0), compiled: todo.length, cached: blocks.length - todo.length, runs },
    };
  }

  let lastFonts: { sig: string; map: Record<string, string> } | null = null;
  async function finishFonts(keys: string[]): Promise<Record<string, string>> {
    const present = keys.filter((k) => /^[0-9a-f]{16}$/.test(k) && existsSync(join(BLOCKS, k, 'output.json'))).sort();
    const sig = createHash('sha256').update(present.join(',')).digest('hex');
    if (lastFonts?.sig === sig) return lastFonts.map;
    stats.fontFinishes++;
    const lines: string[] = [];
    const pipe = new d.Pipeline({ buildRoot: BLOCKS, fontsDir: FONTWORK, log: (s: string) => lines.push(s) });
    for (const k of present) pipe.useCached(k);
    try {
      await pipe.finishFonts({ subset: false });
    } catch (e) {
      // a font that cannot be served for every glyph: say so, serve what there is
      console.error(`fonts: ${(e as Error).message}`);
    }
    const map: Record<string, string> = pipe.fontMap();
    for (const [orig, served] of Object.entries(map)) {
      const src = join(FONTWORK, served), dst = join(FONTS, served);
      if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
      if (existsSync(dst)) latest.set(orig, served);
    }
    lastFonts = { sig, map };
    return map;
  }

  /** The file for /fonts/<name>: the store's own, else the newest served for that original. */
  function fontFile(name: string): string | null {
    if (!/^[\w.+-]+\.(otf|ttf)$/i.test(name)) return null;
    const own = join(FONTS, name);
    if (existsSync(own)) return own;
    const s = latest.get(name);
    return s && existsSync(join(FONTS, s)) ? join(FONTS, s) : null;
  }

  const touch = (key: string) => { try { writeFileSync(join(BLOCKS, key, '.used'), String(Date.now())); } catch { /* gone */ } };
  function clean() {
    const used = (k: string) => { try { return Number(readFileSync(join(BLOCKS, k, '.used'), 'utf8')); } catch { return 0; } };
    const keys = readdirSync(BLOCKS).sort((a, b) => used(b) - used(a));
    for (const k of keys.slice(KEEP)) rmSync(join(BLOCKS, k), { recursive: true, force: true });
    // the runs are work files: keep the newest few for looking into
    const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
    const runs = readdirSync(RUNS).map((k) => [k, mtime(join(RUNS, k))] as const).sort((a, b) => b[1] - a[1]);
    for (const [k] of runs.slice(80)) rmSync(join(RUNS, k), { recursive: true, force: true });
  }

  return { compile, fontFile, stats };
}

const firstLine = (s: string) => s.split('\n')[0].replace(/^blocks \([0-9a-f]+\): /, '');
