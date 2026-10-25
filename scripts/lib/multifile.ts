// The multi-file release: the same parts as the single file, as
// static files beside a small index.html, for a plain static server in any directory (reflowEd/ with
// the TeX tree beside it at texlive/2022/). scripts/build.ts writes it next to each single file it emits, under the
// same name without .html (dist/reflowtex-editor/ beside dist/reflowtex-editor.html).
//
//   const r = writeMultiFile(dir, parts)         → { files: ManifestFile[], bytes, index }   dir is replaced
//   appOutputs(result, outdir)                    esbuild's split build (appBuildOptions({ split })) as MultiParts.app
//   zstdCached(raw, cacheDir)                     zstd -19 of raw, kept by its hash (a pack that did not change is not
//                                                 compressed again: three packs at -19 take a minute)
//   LAZY                                          the app's parts loaded only when used (dynamic import entries)
//   webManifest(icons, colour)                    the web app manifest's text (app.webmanifest)
//
// ADD TO HOME SCREEN (mobile-chrome): app.webmanifest beside index.html (index.html links it), its URLs
// relative to it, so it works from any directory: start_url and scope "./" (the release's directory), display standalone,
// the light theme's page colour as theme and background (the head's script and setTheme recolour the bars after that),
// the icons scripts/icons.ts renders (icons/, named by content). Not in the release manifest (the loader never fetches
// them); the browser does, once it reads the link. The single file has no manifest (a data: manifest has an opaque
// origin: its start_url cannot be the page's), only the head's meta tags (apple-mobile-web-app-capable and the rest).
//
// Every file but index.html, manifest.json and app.webmanifest is named by its content (name-<hash>.ext: cached for good, a new
// release never meets an old copy). What loads when (loading/manifest.ts groups; loading/page-loader.ts):
//   essential  index.html's loader fetches these before the UI, with the overlay's 0 → 100 %: one file, the start
//              file app/start-<hash>.bin (one request, gzip -9 here,
//              unpacked by the loader whatever the server does), a pack (loading/pack.ts) of the two style sheets, the
//              protobuf runtime and the viewer, the app's entry and the parts it imports, the default documents (the app
//              syncs them before it draws: app/seeds.ts); the manifest lists them as its parts. The app's modules
//              import each other by bare names, @rtx/<file name> (loading/manifest.ts moduleName), which the loader's
//              import map resolves: the start file's parts from memory, the lazy parts from their files
//   rest       fetched right after, while the app starts; the status line shows them once the UI is up: the worker,
//              the engine's packs (the wasm, the format, the TeX files: three files, so a release that changes one does
//              not make a reader fetch the others again), the seed cache, the licence texts, the app's lazy parts
//              (prefetched, so a first use does not wait)
// Paths are relative (index.html's directory), and nothing depends on the server's MIME types or Content-Length.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as zlib from 'node:zlib';
import { moduleName, type FileType, type Group, type Manifest, type ManifestFile, type StartPart } from '../../loading/manifest.ts';
import { packRaw } from '../../loading/pack.ts';
import { APP_ICONS, APP_ICON_DIR } from '../icons.ts';
import { resolveTheme } from '../../workbench/src/themes.ts';

/** the web app manifest (Add to Home Screen): every URL relative to its own (the release's directory) */
export function webManifest(icons: readonly { src: string; size: number; purpose: string }[], colour: string): string {
  return JSON.stringify({
    name: 'ReflowEd', short_name: 'ReflowEd', id: './', start_url: './', scope: './', display: 'standalone',
    theme_color: colour, background_color: colour,
    icons: icons.map((i) => ({ src: i.src, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose })),
  }, null, 1);
}

/** dynamic-import entries the app needs only when a feature is used (their own chunks; anything else it imports is
 *  essential): the SVG figure editor (svgfig/index.js opens it), the Ipe figures (the backend asks for them), the
 *  inspector (app/services.ts, outside a release only: a release never fetches it) */
export const LAZY = ['app/src/svgfig/editor.js', 'app/src/figures/index.js', 'app/src/inspector/index.js'];

export interface AppOutput { path: string; text: string; entry: boolean; imports: { path: string; kind: string }[]; entryPoint?: string }
export interface MultiParts {
  /** index.html as the single file has it before its parts go in: minified, the schema and the head's meta filled */
  html: string;
  notice: string;
  version: string; build: string; stamp: string;
  css: { id: string; text: string }[];
  scripts: { id: string; text: string }[];
  /** esbuild's outputs for the split app (paths relative to its outdir) */
  app: AppOutput[];
  seeds: Record<string, string>;
  worker: string;
  packs: { id: string; bytes: Uint8Array }[];
  seedCacheGz: Uint8Array | null;
  licences: string;
  licencesJson: string;
  /** the boot loader (loading/page-loader.ts) built as one IIFE */
  loader: string;
}

const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex').slice(0, 10);
const bytesOf = (x: Uint8Array | string) => (typeof x === 'string' ? Buffer.from(x) : x);
function inlineJs(js: string, what: string): string {
  const out = js.replace(/<(\/script|!--)/gi, '\\x3C$1');
  if (/<\/script|<!--/i.test(out)) throw new Error(`${what}: could not make it safe to inline`);
  return out;
}

export function zstdCached(raw: Uint8Array, cacheDir: string): Uint8Array {
  mkdirSync(cacheDir, { recursive: true });
  const f = join(cacheDir, `${createHash('sha256').update(raw).digest('hex').slice(0, 24)}.zst`);
  if (existsSync(f)) return readFileSync(f);
  const z = zlib.zstdCompressSync(raw, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19, [zlib.constants.ZSTD_c_windowLog]: 26 } });
  writeFileSync(f, z);
  return z;
}

interface SplitResult { outputFiles?: { path: string; text: string }[]; metafile?: { outputs: Record<string, { imports: { path: string; kind: string }[]; entryPoint?: string }> } }
/** the split app's files, with paths relative to outdir (the metafile's are relative to the working directory) */
export function appOutputs(r: SplitResult, outdir: string, cwd: string): AppOutput[] {
  const rel = (p: string) => relative(outdir, resolve(cwd, p)).split(sep).join('/');
  const text = new Map((r.outputFiles ?? []).map((o) => [rel(o.path), o.text]));
  return Object.entries(r.metafile?.outputs ?? {}).filter(([k]) => k.endsWith('.js')).map(([k, o]) => {
    const path = rel(k);
    const t = text.get(path);
    if (t == null) throw new Error(`multi-file: no output text for ${path}`);
    return { path, text: t, entry: !!o.entryPoint && /app\/src\/main\.js$/.test(o.entryPoint), entryPoint: o.entryPoint, imports: o.imports.map((i) => ({ kind: i.kind, path: rel(i.path) })) };
  });
}

/** the overlay before anything loads: the page's own tokens (index.html's theme preamble), inherited, no colour of its own */
const OVERLAY_CSS = '#boot{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:inherit;'
  + 'color:color-mix(in srgb,currentColor 72%,transparent);font:500 14px/1.4 system-ui,sans-serif;transition:opacity .18s ease-out}'
  + '#boot[data-leaving]{opacity:0;pointer-events:none}'
  + '.rtx-load{display:grid;justify-items:center;gap:10px;width:min(220px,calc(100vw - 32px))}'
  + '.rtx-load-track{width:100%;height:3px;border-radius:2px;overflow:hidden;background:color-mix(in srgb,currentColor 16%,transparent)}'
  + '.rtx-load-fill{height:100%;transform-origin:left;transform:scaleX(0);background:currentColor;transition:transform .12s linear}'
  + '.rtx-load-pct{font-size:12px;font-variant-numeric:tabular-nums}'
  + '.rtx-load-error{display:grid;gap:12px;justify-items:center;max-width:min(480px,calc(100vw - 32px));text-align:center}'
  + '.rtx-load-error button{font:inherit;padding:4px 14px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:transparent;color:inherit;cursor:pointer}'
  + '@media (prefers-reduced-motion:reduce){#boot,.rtx-load-fill{transition:none}}';
const OVERLAY = '<div id="boot"><div class="rtx-load" role="progressbar" aria-label="Loading ReflowEd" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-load-where="overlay" data-load-percent="0">'
  + '<div class="rtx-load-label">Loading ReflowEd</div><div class="rtx-load-track"><div class="rtx-load-fill"></div></div><div class="rtx-load-pct">0\u202F%</div></div></div>';

export function writeMultiFile(dir: string, p: MultiParts): Promise<{ files: ManifestFile[]; bytes: number; index: number }> {
  const tmp = `${dir}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const files: ManifestFile[] = [];
  const put = (rel: string, data: Uint8Array | string) => { const f = join(tmp, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };
  const add = (id: string, name: string, ext: string, data: Uint8Array | string, group: Group, type: FileType) => {
    const b = bytesOf(data);
    const path = `${name}-${hash(b)}${ext}`;
    put(path, b);
    files.push({ id, path, bytes: b.length, group, type });
  };
  // what every start needs is one file: a gzip pack of its parts
  const start: [StartPart, Uint8Array][] = [];
  const part = (id: string, type: FileType, data: Uint8Array | string) => start.push([{ id, type }, bytesOf(data)]);
  for (const c of p.css) part(c.id, 'css', c.text);
  for (const s of p.scripts) part(s.id, 'script', s.text);

  // the app: its entry and every part it reaches by static imports, or by a dynamic import that is not LAZY
  const byPath = new Map(p.app.map((o) => [o.path, o]));
  const essential = new Set<string>();
  const lazyEntry = (o: AppOutput) => !!o.entryPoint && LAZY.some((l) => o.entryPoint!.endsWith(l));
  const visit = (path: string) => {
    if (essential.has(path)) return;
    const o = byPath.get(path);
    if (!o) return;
    essential.add(path);
    for (const i of o.imports) {
      const t = byPath.get(i.path);
      if (t && (i.kind === 'import-statement' || (i.kind === 'dynamic-import' && !lazyEntry(t)))) visit(i.path);
    }
  };
  const entry = p.app.find((o) => o.entry);
  if (!entry) throw new Error('multi-file: the app has no entry');
  visit(entry.path);
  for (const lazy of LAZY) if (!p.app.some((o) => o.entryPoint?.endsWith(lazy))) throw new Error(`multi-file: ${lazy} is not a part of its own (still imported statically?)`);
  // the parts import each other by bare names (the loader's import map: the start file's parts from memory, the lazy ones
  // from their files), so a lazy part and the start share one instance of each module
  const names = new Set(p.app.map((o) => o.path));
  const bare = (o: AppOutput) => o.text.replace(/(["'`])\.\/([^"'`/]+\.js)\1/g, (m, q: string, n: string) => (names.has(n) ? `${q}${moduleName(n)}${q}` : m));
  for (const o of p.app) {
    const text = bare(o);
    for (const n of names) if (text.includes(`./${n}`)) throw new Error(`multi-file: ${o.path} still imports ./${n} by a relative path`);
    if (essential.has(o.path)) { part(`app:${o.path}`, o === entry ? 'module' : 'chunk', text); continue; }
    put(`app/${o.path}`, text);
    files.push({ id: `app:${o.path}`, path: `app/${o.path}`, bytes: Buffer.byteLength(text), group: 'rest', type: 'chunk' });
  }
  for (const [n, t] of Object.entries(p.seeds)) part(`seed:${n}`, 'seed', t);
  {
    const gz = zlib.gzipSync(packRaw(start.map(([s, b]) => [s.id, b])), { level: 9 });
    const path = `app/start-${hash(gz)}.bin`;
    put(path, gz);
    files.unshift({ id: 'start', path, bytes: gz.length, group: 'essential', type: 'start', parts: start.map(([s]) => s) });
  }

  add('worker', 'engine/worker', '.js', p.worker, 'rest', 'worker');
  for (const k of p.packs) add(`pack:${k.id}`, `engine/${k.id}`, '.bin', k.bytes, 'rest', 'pack');
  if (p.seedCacheGz) add('seed-cache', 'seed/results', '.bin', p.seedCacheGz, 'rest', 'seedcache');
  add('licences', 'licences', '.txt', p.licences, 'rest', 'licences');
  add('licences-index', 'licences', '.json', p.licencesJson, 'rest', 'licences-index');

  const manifest: Manifest = { version: p.version, build: p.build, stamp: p.stamp, files };
  let html = p.html;
  const swap = (from: RegExp, to: string) => {
    if (!from.test(html)) throw new Error(`index.html: ${from} not found – the page changed; update scripts/lib/multifile.ts`);
    html = html.replace(from, () => to);
  };
  swap(/<link rel="stylesheet" href="lib\/companion\/companion\.css">\s*<link rel="stylesheet" href="app\.css">/, `<style>${OVERLAY_CSS}</style>`);
  swap(/<div id="boot"[^>]*>[^<]*<\/div><style>#boot:has[^<]*<\/style>/, OVERLAY);
  swap(/<script src="lib\/viewer\/protobuf\.min\.js"><\/script>\s*<script src="lib\/viewer\/latex-viewer\.js"><\/script>\s*<script type="module" src="lib\/app\.js"><\/script>/,
    `<script type="application/json" id="rtx-manifest">${JSON.stringify(manifest).replace(/</g, '\\u003c')}</script>\n<script>${inlineJs(p.loader, 'loader')}</script>`);
  // Add to Home Screen: the manifest and its icons (see the header), linked after the head's theme-color
  const icons = APP_ICONS.map((a) => { const b = readFileSync(join(APP_ICON_DIR, a.file)); const src = `icons/${a.file.replace(/\.png$/, '')}-${hash(b)}.png`; put(src, b); return { src, size: a.size, purpose: a.purpose }; });
  put('app.webmanifest', webManifest(icons, resolveTheme('light')?.colors.pageBackground ?? '#ffffff'));
  const tc = /<meta name="?theme-color"? content="?[^">]*"?>/;
  swap(tc, `${tc.exec(html)?.[0] ?? ''}<link rel="manifest" href="app.webmanifest">`);
  html = `<!--\n${p.notice}\nThird-party components, the example documents and their licences: licences-*.txt beside this file (and About · Licence in the app).\n-->\n${html}`;
  put('index.html', html);
  put('manifest.json', JSON.stringify(manifest, null, 1));
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  const index = Buffer.byteLength(html);
  return { files, bytes: index + files.reduce((a, f) => a + f.bytes, 0), index };
}
