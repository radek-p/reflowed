// Every font of a block carries its face, as the public pipeline records it (src/shared/font-face.ts), from the
// capture to the wire; and the capture's own keys never reach the encoder. Node only, no engine: a synthetic
// capture stream through engine-api's converter (convert.ts), the public reader, the editor's key list
// (src/capture-keys.ts) and the public encoder, decoded again.
//   * the converter: a classic font (TFM) is a ClassicFace ({ kind: 'tfm' }: the pipeline's transform decides
//     its face), an OpenType font XeTeX loaded is { kind: 'opentype', file }; no 'filename' key, no 'unknown';
//   * the public reader keeps those faces;
//   * the encoder refuses the capture's own keys (tex_breaks, a display's id …) by name, and takes the block once
//     dropCaptureKeys has taken them off;
//   * on the wire every font has its kind (opentype with its file, boxes with the reason), and a font with no
//     face carries the block's warning (font-without-face), which the viewer adds to the page's log;
//   * the release build's check of the default documents' faces (tests/qa/lib/faces-check.ts).
//   node engine/tests/faces.test.ts      (exit 1 on a failure)
import { convert } from '../api/src/convert.ts';
import { dropCaptureKeys, CAPTURE_ONLY } from '../src/capture-keys.ts';
import { publicRepo } from '../../scripts/lib/public-repo.ts';

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (ok) pass++; else fail++;
};

const PUB = publicRepo();
const { readSerializerOutput } = await import(`${PUB}/src/pipeline/nodes.ts`);
const { encodeDocument } = await import(`${PUB}/src/pipeline/encode.ts`);
const { fontWarnings } = await import(`${PUB}/src/pipeline/fonts/fonts.ts`);
const { messageType } = await import(`${PUB}/src/pipeline/schema.ts`);

type J = Record<string, any>;
const P = [0, 0, 0, 0, 0, 0, 0];
const stream = [
  { t: 'font', id: 1, name: 'cmr10', size: 655360, params: P, hyphenchar: 45, g: [[65, 300000, 450000, 0, 0, 0, 0]] },
  { t: 'font', id: 2, name: 'lmroman', size: 655360, params: P, hyphenchar: 45, native: true, file: 'lmroman10-regular.otf', g: [[36, 300000, 450000, 0, 300000, 0, 0]] },
  { t: 'par', id: 1, n: [{ t: 'c', f: 1, c: 65 }, { t: 'G', f: 2, g: 36 }], hsize: 6553600, parindent: 0, leftskip: [0, 0, 0], rightskip: [0, 0, 0],
    baselineskip: [786432], lineskip: [65536], lineskiplimit: 0, protrude: 0, tag: 1, line: 1, endline: 1, nest: 1 },
  { t: 'brk', id: 1, lines: 1, demerits: 100, pass: 1, b: [] },
].map((r) => JSON.stringify(r)).join('\n');

// ── the converter ────────────────────────────────────────────────────────────
const out = convert({ stream, readFile: () => null }) as J;
const fonts = Object.values(out.fonts as Record<string, J>);
check('converter: the classic font is a ClassicFace (the pipeline decides its face)', JSON.stringify(out.fonts['1']?.face) === JSON.stringify({ kind: 'tfm' }), out.fonts['1']);
check('converter: the OpenType font is opentype, with the file XeTeX loaded', JSON.stringify(out.fonts['2']?.face) === JSON.stringify({ kind: 'opentype', file: 'lmroman10-regular.otf' }), out.fonts['2']);
check('converter: no font has a filename key, and nothing says \'unknown\'', fonts.every((f) => !('filename' in f)) && !JSON.stringify(out.fonts).includes('unknown'), out.fonts);
check('converter: the paragraph carries the capture\'s own keys (TeX\'s breaks, its source)', 'tex_breaks' in out.paragraphs[0] && 'source' in out.paragraphs[0], Object.keys(out.paragraphs[0]));

// ── the public reader, the encoder ───────────────────────────────────────────
const data = readSerializerOutput(JSON.stringify(out));
check('reader: the faces as the converter gave them', JSON.stringify([...data.fonts.values()].map((f: J) => f.face)) === JSON.stringify([{ kind: 'tfm' }, { kind: 'opentype', file: 'lmroman10-regular.otf' }]));
// what the transform decides for a classic font no producer can give a face (here by hand: no TeX installation)
data.fonts.get('1').face = { kind: 'boxes', reason: 'no Type 1 outline for cmr10' };
// a display as the capture leaves it, with its own keys, and its wide form
data.content.push({ kind: 'paragraph', para: 1 },
  { kind: 'display', display_width: 6553600, display_id: 3, display_row: 1, display_place: { eqno: false }, display_route1: true,
    box: { type: 'hlist', width: 0, height: 0, depth: 0, children: [] },
    display_wide: { kind: 'display', display_id: 3, display_sampled: true, box: { type: 'hlist', width: 0, height: 0, depth: 0, children: [] } } });
const encode = () => encodeDocument({ ...data, warnings: [...(data.warnings ?? []), ...fontWarnings(data)] });
let refused = '';
try { encode(); } catch (e) { refused = (e as Error).message; }
check('encoder: the capture\'s own keys are refused, by name', /has no field (tex_breaks|source|display_)/.test(refused), refused);
const n = dropCaptureKeys(data);
check('dropCaptureKeys: every named key taken off (2 of the paragraph, 4 of the display, 2 of its wide form)', n === 8, n);
let bytes: Uint8Array | null = null, err = '';
try { bytes = encode(); } catch (e) { err = (e as Error).message; }
check('encoder: the block encodes once they are off', !!bytes, err);
check('capture-keys: the list names only keys latex.proto has no field for', (() => {
  const P = messageType('Paragraph'), C = messageType('ContentItem');
  return CAPTURE_ONLY.Paragraph.every((k) => !P.fields[k]) && CAPTURE_ONLY.ContentItem.every((k) => !C.fields[k]);
})());

// ── on the wire ──────────────────────────────────────────────────────────────
if (bytes) {
  const Doc = messageType('Document');
  const doc = Doc.toObject(Doc.decode(bytes), { defaults: false, arrays: true, enums: String, longs: Number }) as J;
  const wire = (doc.fonts as J[]).map((f) => [f.name, f.kind, f.filename ?? f.reason ?? null]);
  check('wire: each font\'s kind (boxes with the reason, opentype with its file)', JSON.stringify(wire) === JSON.stringify([['cmr10', 'boxes', 'no Type 1 outline for cmr10'], ['lmroman10-regular.otf', 'opentype', 'lmroman10-regular.otf']]), wire);
  const w = (doc.warnings ?? []) as J[];
  check('wire: the font with no face carries the block\'s warning (font-without-face), for the viewer\'s log', w.some((x) => x.code === 'font-without-face' && /cmr10/.test(x.message)), w);
}

// ── the release build's check (tests/qa/lib/faces-check.ts) on these results ─────────────────────────────────────
{
  const { faceProblems } = await import('../../tests/qa/lib/faces-check.ts');
  const Doc = messageType('Document');
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const boxed = bytes ? faceProblems({ k: { nodelist: b64(bytes) } }, Doc) : null;
  check('faces-check: a font drawn as boxes is a problem', !!boxed && boxed.problems.length === 1 && /cmr10: no face, drawn as boxes/.test(boxed.problems[0]), boxed);
  data.fonts.get('1').face = { kind: 'type1', file: 'cmr10.reflowtex-0123abcd.otf' };
  const good = faceProblems({ k: { nodelist: b64(encodeDocument(data)) } }, Doc);
  check('faces-check: type1 and opentype faces with their files pass', good.problems.length === 0 && good.kinds.type1 === 1 && good.kinds.opentype === 1, good);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
