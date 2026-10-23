// The picture shim's asset hook: an \includegraphics picture (XeTeX's pic
// node: the file TeX opened, its box) gets an SVG before the encoder's
// picture step (../../encode-browser/src/shims/pictures.ts takes `svg` from
// the node, so no dvisvgm is needed):
//   PNG / JPEG / GIF / SVG   the image itself, stretched to the box
//   a PDF with a rendition   the rendition's SVG (Ipe → TikZ → SVG, the worker's setAssets draws a
//                            vector-only PDF itself, pdf-svg.ts)
//   any other PDF            a sized placeholder (the file name in a frame): text, images other than JPEG,
//                            shadings (the build's acceptance fails on one in the default documents)
// TeX reads the image's own bytes for its size (graphicx/xetex.def), so an
// asset's bytes are answered to the engine too (worker getFile).
// (a plain deep walk, not the public forEachNode: this file also runs in Node tests without the @pub alias)
type SerializerOutput = unknown;
function forEachNode(data: unknown, fn: (n: Record<string, unknown>) => void): void {
  const seen = new Set<unknown>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    const o = x as Record<string, unknown>;
    if (typeof o.type === 'string') fn(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(data instanceof Map ? [...data.values()] : data);
}

export interface AssetEntry { name: string; mime?: string; bytes?: Uint8Array; svg?: string }

const SP_PER_BP = 65781.76;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const mimeOf = (name: string, m?: string) => m || (/\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg'
  : /\.gif$/i.test(name) ? 'image/gif' : /\.svg$/i.test(name) ? 'image/svg+xml' : /\.pdf$/i.test(name) ? 'application/pdf' : 'application/octet-stream');

/** The asset TeX opened as `file` (as written, or with the extension TeX added). */
export function findAsset(assets: Map<string, AssetEntry>, file: string): AssetEntry | undefined {
  const f = file.replace(/^\.\//, '');
  return assets.get(f) ?? [...assets.values()].find((a) => a.name === f || a.name.endsWith('/' + f) || f.endsWith('/' + a.name));
}

/** An SVG document for an asset at a box of w × h bp. */
export function assetSvg(a: AssetEntry | undefined, file: string, w: number, h: number): string {
  const vb = `0 0 ${w.toFixed(3)} ${h.toFixed(3)}`;
  // single quotes: the public picture step (rewritePictureSvg) parses dvisvgm's form
  const open = `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${w.toFixed(3)}pt' height='${h.toFixed(3)}pt' viewBox='${vb}'>`;
  if (a?.svg) {
    // a rendition: nested, stretched to the box (its own viewBox kept)
    const inner = a.svg.replace(/^[\s\S]*?<svg\b/, '<svg').replace(/<svg\b([^>]*)>/, (_m, attrs: string) =>
      `<svg${attrs.replace(/\s(width|height|x|y|preserveAspectRatio)=(["'])[^"']*\2/g, '')} x='0' y='0' width='${w.toFixed(3)}' height='${h.toFixed(3)}' preserveAspectRatio='none'>`);
    return `${open}${inner}</svg>`;
  }
  const mime = mimeOf(a?.name ?? file, a?.mime);
  if (a?.bytes && mime.startsWith('image/')) {
    return `${open}<image x="0" y="0" width="${w.toFixed(3)}" height="${h.toFixed(3)}" preserveAspectRatio="none" xlink:href="data:${mime};base64,${b64(a.bytes)}"/></svg>`;
  }
  const label = esc((a?.name ?? file).replace(/^.*\//, ''));
  return `${open}<rect x="0.5" y="0.5" width="${Math.max(0, w - 1).toFixed(3)}" height="${Math.max(0, h - 1).toFixed(3)}" fill="#f4f4f4" stroke="#999" stroke-width="0.5" stroke-dasharray="3 2"/>`
    + `<text x="${(w / 2).toFixed(3)}" y="${(h / 2).toFixed(3)}" font-family="sans-serif" font-size="${Math.min(10, Math.max(4, h / 6)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#666">${label}</text></svg>`;
}

/** Give every \includegraphics picture of `data` its SVG. Returns how many. */
export function attachAssetPictures(data: SerializerOutput, assets: Map<string, AssetEntry>,
  tikz?: (id: number, w: number, h: number, d: number) => string | null): number {
  let n = 0;
  forEachNode(data, (node) => {
    const p = node as Record<string, any>;
    if (p.type !== 'picture' || typeof p.svg === 'string' || typeof p.file !== 'string' || !p.file) return;
    const m = /^rtx-picture:(\d+)$/.exec(p.file);
    if (m) {
      // a TikZ picture of this run (src/pictures.ts); an empty box when its page is missing
      p.svg = tikz?.(Number(m[1]), p.width ?? 0, p.height ?? 0, p.depth ?? 0) ?? assetSvg(undefined, '(picture)', Math.max((p.width ?? 0) / SP_PER_BP, 0.01), Math.max(((p.height ?? 0) + (p.depth ?? 0)) / SP_PER_BP, 0.01));
      delete p.file; delete p.page;
      n++;
      return;
    }
    const w = (p.width ?? 0) / SP_PER_BP, h = ((p.height ?? 0) + (p.depth ?? 0)) / SP_PER_BP;
    p.svg = assetSvg(findAsset(assets, p.file), p.file, Math.max(w, 0.01), Math.max(h, 0.01));
    delete p.file; delete p.page;
    n++;
  });
  return n;
}
