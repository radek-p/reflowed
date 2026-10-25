// Classic (TFM + Type 1) fonts through the whole worker under Node: the editor's compile worker
// (dist/editor-worker.js, build-worker.ts) in a Node thread with ONLY the embedded TeX set (the dev
// pack, tests/integration/tex-pack.ts: what a document typesets offline), each glyph checked in the
// font file the worker serves for it: the glyph TeX set is the one drawn.
//   * \usepackage{lmodern} maths: lmmi/lmsy/lmex are Type 1 outlines read through the encodings
//     pdftex.map names (lm-mathit.enc, lm-mathsy.enc, lm-mathex.enc; their own vectors are standard
//     ones), and those encodings are in the embedded set.
//   node tests/classic-fonts.test.ts      (after node scripts/build-worker.ts)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnWorker } from '../../scripts/node-engine.ts';
import { texPack } from '../../tests/integration/tex-pack.ts';
import { publicRepo } from '../../scripts/lib/public-repo.ts';
import { TC, ENGINE, FORMAT } from './node-host.ts';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };

type Font = { charToGlyph(c: string): { name: string } };
const opentype = createRequire(ENGINE + 'encode/package.json')('opentype.js') as { parse(b: ArrayBuffer): Font };
const { messageType } = await import(`${publicRepo()}/src/pipeline/schema.ts`);
const DocType = messageType('Document');
const WORKER = ENGINE + 'dist/editor-worker.js';
if (!existsSync(WORKER)) { console.log(`FAIL no worker: build it first (node scripts/build-worker.ts)`); process.exit(1); }

const { getIndex, getFile } = await import(TC + 'engine/server/bundle.ts');
const pack = await texPack({ index: await getIndex(), getFile, bundleId: 'classic-fonts' }).built();
const w = spawnWorker(readFileSync(WORKER, 'utf8'));
await w.call('init', { packBytes: new Uint8Array(pack.raw) });
await w.call('engine', { format: readFileSync(FORMAT), wasm: readFileSync(ENGINE + 'dist/async/tectonic_wasm.wasm') });

const files = new Map<string, Font>();
/** One block in a document: [font name, glyph name the served file draws] for each glyph, and its problems. */
async function glyphs(preamble: string, source: string, assets: { name: string; bytes: Uint8Array }[] = []) {
  await w.call('setAssets', { replace: true, assets });
  const pre = await w.call('setPreamble', { preamble });
  const r = await w.call('compile', { blocks: [{ id: 'b', source }] });
  for (const [name, bytes] of Object.entries(r.fontFiles as Record<string, Uint8Array>)) {
    const b = Buffer.from(bytes);
    files.set(name, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer));
  }
  const res = r.blocks.b;
  const problems = [...pre.errors, ...res.errors].map((p: { message: string }) => p.message);
  if (!res.nodelist) return { drawn: [] as [string, string][], problems };
  const doc = DocType.toObject(DocType.decode(Buffer.from(res.nodelist, 'base64')), { defaults: false, arrays: true, enums: String, longs: Number });
  const fonts = new Map<number, { name: string; filename: string }>((doc.fonts ?? []).map((f: { id: number; name: string; filename: string }) => [f.id, f]));
  const drawn: [string, string][] = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const n = o as { type?: string; font?: number; char?: number };
    if (n.type === 'glyph') {
      const f = fonts.get(n.font ?? -1);
      const file = f && files.get((r.fonts as Record<string, string>)[f.filename] ?? f.filename);
      drawn.push([f?.name ?? '?', file ? file.charToGlyph(String.fromCodePoint(n.char ?? 0)).name : `no file (${f?.filename})`]);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(doc.paragraphs);
  return { drawn, problems };
}

// ── lmodern maths ───────────────────────────────────────────────────────────
{
  const { drawn, problems } = await glyphs('\\documentclass{article}\n\\usepackage{lmodern}', 'Let $\\alpha+\\sum_i x_i \\leq \\infty$.');
  check('lmodern: the block compiles', problems.length === 0, problems.join(' | '));
  const maths = drawn.filter(([f]) => /^lm(mi|sy|ex)/.test(f));
  const want = [['lmmi10', 'alpha'], ['lmex10', 'summationtext'], ['lmmi7', 'i'], ['lmmi10', 'x'], ['lmmi7', 'i'], ['lmsy10', 'lessequal'], ['lmsy10', 'infinity']];
  check('lmodern: every maths glyph is the one TeX set', JSON.stringify(maths) === JSON.stringify(want), JSON.stringify(maths));
  const lacking = drawn.filter(([, g]) => g === '.notdef' || g.startsWith('no file'));
  check('lmodern: no glyph without a font file or drawn as .notdef', lacking.length === 0, JSON.stringify(lacking));
}

await w.terminate();
console.log(`\n${fail ? `${fail} FAILED` : 'ALL PASS'}`);
process.exit(fail ? 1 : 0);
