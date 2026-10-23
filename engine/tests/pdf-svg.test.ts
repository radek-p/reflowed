// engine/src/pdf-svg.ts: a PDF picture as SVG (Node). Synthetic PDFs written here (paths, colours, clipping,
// a form XObject, an object stream; text and images refused), and the seed's own PDFs when they are on disk
// (web/seed/example.json: orcid.pdf, cc-by.pdf, lipics-logo-bw.pdf are vector: drawn; eatcs.pdf has text: refused).
//   node tests/pdf-svg.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfToSvg } from '../src/pdf-svg.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0, failed = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 300)}` : ''}`); };

/** a PDF from object bodies (1-based numbers); streams as [dict, content, flate?] */
function pdf(objs: (string | [string, string, boolean?])[], root = 1, header = '%PDF-1.4'): Uint8Array {
  const parts: Buffer[] = [Buffer.from(`${header}\n`, 'latin1')];
  let off = parts[0].length;
  const xref: number[] = [];
  objs.forEach((o, i) => {
    xref.push(off);
    let body: Buffer;
    if (typeof o === 'string') body = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    else {
      const data = o[2] ? deflateSync(Buffer.from(o[1], 'latin1')) : Buffer.from(o[1], 'latin1');
      const dict = o[0].replace('>>', `/Length ${data.length}${o[2] ? '/Filter/FlateDecode' : ''}>>`);
      body = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${dict}\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    }
    parts.push(body); off += body.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size ${objs.length + 1}/Root ${root} 0 R>>\nstartxref\n${off}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}
const page = (content: string, res = '<<>>', extra = '') => pdf([
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R]/Count 1/MediaBox[0 0 200 100]>>',
  `<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources ${res}${extra}>>`,
  ['<<>>', content, true],
]);

{
  const s = await pdfToSvg(page('0 0 1 rg 10 10 50 30 re f 1 0 0 RG 2 w 1 J 0 0 m 100 50 l S'));
  check('a page: its box as the viewBox, y up flipped, in points', !!s && /viewBox="0 0 200 100"/.test(s) && /width="200pt"/.test(s) && /matrix\(1 0 0 -1 0 100\)/.test(s), s);
  check('a filled rectangle in its colour', !!s && /<path d="M10 10 L60 10 L60 40 L10 40 Z"[^>]*fill="rgb\(0,0,255\)"/.test(s), s);
  check('a stroke: colour, width, cap', !!s && /d="M0 0 L100 50"[^>]*fill="none" stroke="rgb\(255,0,0\)" stroke-width="2" stroke-linecap="round"/.test(s), s);
}
{
  const s = await pdfToSvg(page('q 2 0 0 2 10 5 cm 0 0 0 1 k 0 0 m 10 0 l 10 10 l h f* Q 0.5 g 0 0 m 1 1 2 2 3 3 c f'));
  check('cm as the path\'s transform; CMYK black; even-odd; q/Q restores the colour', !!s && /transform="matrix\(2 0 0 2 10 5\)" fill="rgb\(35,31,32\)" fill-rule="evenodd"/.test(s) && /fill="rgb\(128,128,128\)"/.test(s), s);
}
{
  const s = await pdfToSvg(page('q 0 0 100 50 re W n 1 0 0 rg 0 0 200 100 re f Q 0 1 0 rg 0 0 5 5 re f'));
  check('clipping: a clipPath and a group closed at Q', !!s && /<clipPath id="pdf[\w]+-c1"><path d="M0 0 L100 0 L100 50 L0 50 Z"/.test(s) && /<g clip-path="url\(#pdf\w+-c1\)"><path[^>]*rgb\(255,0,0\)[^>]*\/><\/g><path[^>]*rgb\(0,255,0\)/.test(s), s);
}
{
  const s = await pdfToSvg(page('/GS0 gs /Cs1 cs 0.2 0.4 0.6 scn 0 0 10 10 re f', '<</ExtGState<</GS0<</ca 0.5/CA 0.25>>>>/ColorSpace<</Cs1[/ICCBased 5 0 R]>>>>'));
  // object 5 missing: an ICC space whose stream is gone is refused, not guessed
  check('an ICC space that cannot be read: refused (null)', s === null, s);
  const t = await pdfToSvg(pdf([
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 20 20]/CropBox[5 5 15 15]/Contents 4 0 R/Resources<</ExtGState<</GS0<</ca 0.5>>>>/ColorSpace<</Cs1[/ICCBased 5 0 R]>>>>>>',
    ['<<>>', '/GS0 gs /Cs1 cs 0.2 0.4 0.6 scn 0 0 10 10 re f', true], ['<</N 3>>', 'icc', false]]));
  check('ICC-based RGB by its component count; fill opacity from ExtGState; the CropBox', !!t && /fill="rgb\(51,102,153\)" fill-opacity="0.5"/.test(t) && /viewBox="0 0 10 10"/.test(t) && /matrix\(1 0 0 -1 -5 15\)/.test(t), t);
}
{
  const s = await pdfToSvg(pdf([
    '<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 50 50]/Contents 4 0 R/Resources<</XObject<</Fm1 5 0 R>>>>>>',
    ['<<>>', 'q 1 0 0 1 10 10 cm /Fm1 Do Q', true],
    ['<</Type/XObject/Subtype/Form/BBox[0 0 20 20]/Matrix[1 0 0 1 2 3]>>', '1 0 0 rg 0 0 30 30 re f', true]]));
  check('a form XObject: its Matrix, clipped to its BBox', !!s && /<clipPath id="pdf\w+-c1"><rect x="0" y="0" width="20" height="20" transform="matrix\(1 0 0 1 12 13\)"/.test(s) && /transform="matrix\(1 0 0 1 12 13\)" fill="rgb\(255,0,0\)"/.test(s), s);
}
{
  check('text: refused (null, the caller keeps its placeholder)', await pdfToSvg(page('BT /F1 12 Tf (Hi) Tj ET')) === null);
  check('a shading: refused', await pdfToSvg(page('/Sh1 sh')) === null);
  check('not a PDF: null', await pdfToSvg(new TextEncoder().encode('hello')) === null);
}
{
  // an object stream (PDF 1.5): the page tree (objects 6 and 7) inside object 2
  const o3 = '<</Type/Pages/Kids[7 0 R]/Count 1/MediaBox[0 0 10 10]>>', o4 = '<</Type/Page/Parent 6 0 R/Contents 5 0 R>>';
  const head = `6 0 7 ${o3.length + 1} `;
  const s = await pdfToSvg(pdf(['<</Type/Catalog/Pages 6 0 R>>', ['<</Type/ObjStm/N 2/First ' + head.length + '>>', head + o3 + ' ' + o4, true], '<<>>', '<<>>', ['<<>>', '0 0 1 rg 0 0 4 4 re f', true]]));
  check('object streams: the page tree read from one', !!s && /viewBox="0 0 10 10"/.test(s) && /M0 0 L4 0 L4 4 L0 4 Z[^>]*rgb\(0,0,255\)/.test(s), s);
}

// WebKit: no Blob in the worker (a Blob read in a worker started from a blob: URL on a file:// page fails; the release's
// WebKit smoke saw 'Cannot load blob:null/…' after a preamble change)
check('the inflate writes into the stream, no Blob', !/new Blob\(/.test(readFileSync(join(HERE, '../src/pdf-svg.ts'), 'utf8')));

// the seed's own pictures (paper content: on disk, not in git)
const seed = join(HERE, '../../app/seed/example.json');
if (existsSync(seed)) {
  const assets: { name: string; base64: string }[] = JSON.parse(readFileSync(seed, 'utf8')).init.assets;
  const get = (n: string) => { const a = assets.find((x) => x.name === n); return a ? new Uint8Array(Buffer.from(a.base64, 'base64')) : null; };
  const orcid = get('orcid.pdf');
  if (orcid) {
    const s = await pdfToSvg(orcid);
    if (process.env.PDF_SVG_OUT && s) (await import('node:fs')).writeFileSync(process.env.PDF_SVG_OUT, s);
    check('example.json orcid.pdf: drawn (256 × 256 pt, the green disc and the white iD)', !!s && /viewBox="0 0 256 256"/.test(s) && /rgb\(144,210,60\)/.test(s) && /rgb\(255,255,255\)/.test(s) && (s.match(/<path/g) ?? []).length >= 4, s?.slice(0, 300));
  }
  for (const nm of ['cc-by.pdf', 'lipics-logo-bw.pdf']) { const b = get(nm); if (b) { const s = await pdfToSvg(b); check(`example.json ${nm}: drawn (vector)`, !!s && (s.match(/<path/g) ?? []).length > 3, s?.slice(0, 200)); } }
  const e = get('eatcs.pdf');
  if (e) check('example.json eatcs.pdf (text inside): refused', await pdfToSvg(e) === null);
} else console.log('(web/seed/example.json not on disk: the seed checks skipped)');

console.log(`\n${n - failed}/${n} checks passed`);
process.exit(failed ? 1 : 0);
