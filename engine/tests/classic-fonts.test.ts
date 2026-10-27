// Classic (TFM + Type 1) fonts through the whole worker under Node: the editor's compile worker
// (dist/editor-worker.js, build-worker.ts) in a Node thread with ONLY the embedded TeX set (the dev
// pack, tests/integration/tex-pack.ts: what a document typesets offline), each glyph checked in the
// font file the worker serves for it: the glyph TeX set is the one drawn.
//   * \usepackage{lmodern} maths: lmmi/lmsy/lmex are Type 1 outlines read through the encodings
//     pdftex.map names (lm-mathit.enc, lm-mathsy.enc, lm-mathex.enc; their own vectors are standard
//     ones), and those encodings are in the embedded set;
//   * a document's own face, declared by a map line naming an outline and an encoding
//     (\pdfmapline{+face PSName "… ReEncodeFont" <enc.enc <outline.pfb}, doc-fonts.ts): drawn
//     through that encoding;
//   * virtual fonts (newtx's maths, ae's T1 over Computer Modern; fidelity/virtual-fonts.ts): each glyph drawn
//     from the font its packet names; an accented letter drawn as a letter and an accent reads as the letter. Their files are not in the embedded set: the document gets them as the
//     TeX resource server would give them (here as its files: what TeX, the converter and the encoder read).
//   node tests/classic-fonts.test.ts      (after node scripts/build-worker.ts)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnWorker } from '../../scripts/node-engine.ts';
import { texPack } from '../../tests/integration/tex-pack.ts';
import { publicRepo } from '../../scripts/lib/public-repo.ts';
import { TC, ENGINE, FORMAT, EXTRA, engine, fetchSync, used } from './node-host.ts';
import { buildHost, blockFile, capture } from '../src/compile.ts';

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
  if (!res.nodelist) return { drawn: [] as [string, string][], texts: [] as string[], problems };
  const doc = DocType.toObject(DocType.decode(Buffer.from(res.nodelist, 'base64')), { defaults: false, arrays: true, enums: String, longs: Number });
  const fonts = new Map<number, { name: string; filename: string }>((doc.fonts ?? []).map((f: { id: number; name: string; filename: string }) => [f.id, f]));
  const drawn: [string, string][] = [], texts: string[] = [];
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const n = o as { type?: string; font?: number; char?: number; actual_text?: string };
    if (n.actual_text !== undefined) texts.push(n.actual_text);
    if (n.type === 'glyph') {
      const f = fonts.get(n.font ?? -1);
      const file = f && files.get((r.fonts as Record<string, string>)[f.filename] ?? f.filename);
      drawn.push([f?.name ?? '?', file ? file.charToGlyph(String.fromCodePoint(n.char ?? 0)).name : `no file (${f?.filename})`]);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(doc.paragraphs);
  return { drawn, texts, problems };
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

// ── a document's own face through its own map line ──────────────────────────
{
  const tfm = (await getFile('lmmi10.tfm'))!.data as Uint8Array;
  const preamble = String.raw`\documentclass{article}
\pdfmapline{+docmi LMMathItalic10-Regular "enclmmathit ReEncodeFont" <lm-mathit.enc <lmmi10.pfb}
\DeclareFontFamily{U}{docmi}{}\DeclareFontShape{U}{docmi}{m}{n}{<-> docmi}{}`;
  const { drawn, problems } = await glyphs(preamble, 'A {\\usefont{U}{docmi}{m}{n}\\char11\\char12} B.', [{ name: 'docmi.tfm', bytes: new Uint8Array(tfm) }]);
  check('own map line: the block compiles', problems.length === 0, problems.join(' | '));
  const own = drawn.filter(([f]) => f === 'docmi');
  check('own map line: the face is drawn through the encoding the line names (alpha, beta)', JSON.stringify(own) === JSON.stringify([['docmi', 'alpha'], ['docmi', 'beta']]), JSON.stringify(drawn));
}

// ── virtual fonts, their files given ────────────────────────────────────────
/** The files a block reads beyond the embedded set: TeX's and the converter's (a run on the whole bundle), and
 *  the outlines and encodings the font map names for its classic faces. */
const { parseMapLines } = await import(`${publicRepo()}/src/pipeline/fonts/type1.ts`);
const fontMap = parseMapLines(new TextDecoder('latin1').decode(fetchSync(0, 'pdftex.map')!).split('\n'));
const tex = await engine('async');
tex.setExtraFiles(EXTRA);
function filesFor(preamble: string, source: string): { name: string; bytes: Uint8Array }[] {
  used.clear();
  tex.reset(); tex.addFile('input.tex', buildHost(preamble).main);
  tex.warm('input.tex');
  tex.runBlock(blockFile(source).text);
  const out = capture(tex, (n) => fetchSync(0, n)).output;
  const names = new Set(used);
  for (const f of Object.values(out.fonts as Record<string, { name: string; face: { kind: string } }>)) {
    if (f.face.kind !== 'tfm') continue;                  // a classic font (the converter's CapturedFace)
    for (const n of fontMap.get(f.name) ?? []) if (n && fetchSync(0, n)) names.add(n);
  }
  return [...names].map((name) => ({ name, bytes: fetchSync(0, name)! }));
}
for (const [what, preamble, source, want, read] of [
  ['newtx maths', '\\documentclass{article}\n\\usepackage{newtxtext,newtxmath}', 'Let $\\alpha+\\sum_i x_i \\leq \\infty$.',
    [['NewTXMI', 'u1D6FC'], ['txsys', 'plus'], ['txexs', 'summationtext.1'], ['NewTXMI7', 'u1D456'], ['NewTXMI', 'u1D465'], ['NewTXMI7', 'u1D456'], ['txsys', 'lessequal'], ['txsys', 'infinity']], []],
  ['ae', '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\usepackage{ae}', 'Caf\\\'e.',
    [['cmr10', 'C'], ['cmr10', 'a'], ['cmr10', 'f'], ['cmr10', 'acute'], ['cmr10', 'e'], ['cmr10', 'period']], ['é']],
] as const) {
  const { drawn, texts, problems } = await glyphs(preamble, source, filesFor(preamble, source));
  check(`${what}: the block compiles`, problems.length === 0, problems.join(' | '));
  // an accented letter, drawn as a letter and an accent, reads as the one character (the box's actual_text)
  check(`${what}: each accented letter reads as one character`, JSON.stringify(texts) === JSON.stringify(read), JSON.stringify(texts));
  const got = drawn.filter(([f]) => !/^TeXGyreTermesX/.test(f));
  check(`${what}: every glyph is drawn from the font its packet names`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}

await w.terminate();
console.log(`\n${fail ? `${fail} FAILED` : 'ALL PASS'}`);
process.exit(fail ? 1 : 0);
