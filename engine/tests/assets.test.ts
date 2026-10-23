// The picture shim's SVGs (src/assets.ts): a rendition nested and stretched
// to the box (single- or double-quoted attributes: pictures/src/picture.ts
// writes single quotes), an image as <image>, a missing asset as a frame,
// all in the shape the public rewritePictureSvg reads; TikZ placeholders
// and pdf:image boxes become pic records (src/pictures.ts).
//   node tests/assets.test.ts
import { assetSvg } from '../src/assets.ts';
import { markPictures } from '../src/pictures.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicRepo } from '../../scripts/lib/public-repo.ts';
const { rewritePictureSvg } = await import(pathToFileURL(join(publicRepo(), 'src/pipeline/pictures.ts')).href);

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : '  ' + detail}`); if (!ok) fail++; };
for (const q of ["'", '"']) {
  const inner = `<svg xmlns=${q}http://www.w3.org/2000/svg${q} width=${q}258.6pt${q} height=${q}91.9pt${q} viewBox=${q}0 0 258.6 91.9${q}><path d='M0 0L1 1'/></svg>`;
  const s = assetSvg({ name: 'f.pdf', svg: inner }, 'f.pdf', 235.1, 83.5);
  const nested = /<svg[^>]*>(<svg[^>]*>)/.exec(s)?.[1] ?? '';
  check(`rendition (${q}): one width, the box's, stretched`, (nested.match(/\swidth=/g) ?? []).length === 1 && nested.includes("width='235.100'") && nested.includes("preserveAspectRatio='none'") && nested.includes('viewBox'), nested);
  check(`rendition (${q}): rewritePictureSvg reads it`, (() => { try { const p = rewritePictureSvg(s, 'x-'); return p.vb_w === 235.1 && p.vb_h === 83.5; } catch { return false; } })());
}
const img = assetSvg({ name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, 'a.png', 100, 50);
check('image: <image> with a data: URL', /<image [^>]*href="data:image\/png;base64,AQID"/.test(img));
check('missing: a framed placeholder with the name', /<rect/.test(assetSvg(undefined, 'figures/x.pdf', 100, 50)) && /x\.pdf/.test(assetSvg(undefined, 'figures/x.pdf', 100, 50)));
const st = '{"t":"flow","n":{"t":"h","w":100,"h":20,"d":0,"c":[{"t":"x","s":"rtx:pic 3"}]}}\n{"t":"par","n":[{"t":"h","w":6883909,"h":2964793,"d":0,"c":[{"t":"h","w":6883909,"h":2964793,"d":0,"c":[{"t":"x","s":"pdf:image bbox 0 0 697.6 300.4 clip 0 width 105.04012pt (LOGO_ERC-FLAG_EU.png) "}]}]}]}';
const m = markPictures(st);
check('TikZ placeholder → pic record', m.ids.join() === '3' && m.stream.includes('"path":"rtx-picture:3"'), m.stream);
check('pdf:image box → pic record naming the file', m.images.join() === 'LOGO_ERC-FLAG_EU.png' && m.stream.includes('"path":"LOGO_ERC-FLAG_EU.png"'), m.stream);
// an SVG figure: graphicx's eps rule (%%BoundingBox from the file) places it with a PSfile special
const ps = markPictures('{"t":"par","n":[{"t":"h","w":14209241,"h":7104620,"d":0,"c":[{"t":"x","s":"PSfile=\\"figures/universe.svg\\" urx=216 ury=108 rwi=1944 rhi=972 "}]}]}');
check('PSfile box (an .svg by the eps rule) → pic record naming the file', ps.images.join() === 'figures/universe.svg'
  && ps.stream.includes('{"t":"pic","k":0,"w":14209241,"h":7104620,"d":0,') && ps.stream.includes('"path":"figures/universe.svg"'), ps.stream);
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
