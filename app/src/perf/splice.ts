// the single file with the app rebuilt from the current src/ (the
// engine, the pack, the viewer and the seed docs as in the given build).
// For measuring app changes in the file:// page without full build.
//
//   node web/src/perf/splice.ts <in.html> <out.html> [--no-seed-cache] [--no-minify]
//
// The app script is the last <script type="module"> of the page (build.ts
// emits it last); it is bundled here exactly as build.ts bundles it.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appBuildOptions } from '../../../scripts/lib/app-bundle.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '../../..');     // the repository root
const WEB = join(HERE, 'app'), SRC = join(WEB, 'src');
const PUB = process.env.REFLOWTEX ?? '/reflowtex';
const [inPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noSeedCache = process.argv.includes('--no-seed-cache');
const minify = !process.argv.includes('--no-minify');             // names kept: long-animation-frame attribution
if (!inPath || !outPath) { console.error('usage: splice.ts <in.html> <out.html> [--no-seed-cache] [--no-minify]'); process.exit(2); }
const esbuild = createRequire(join(HERE, 'engine/package.json'))('esbuild');

// scripts/lib/app-bundle.ts: exactly as build.ts bundles it
const { options, which } = appBuildOptions({ minify, keepNames: !minify, allowStubs: process.argv.includes('--allow-stubs'), pub: PUB });
const app = await esbuild.build(options);
const appJs: string = app.outputFiles[0].text.replace(/<(\/script|!--)/gi, '\\x3C$1');
let html = readFileSync(inPath, 'utf8');
const open = '<script type="module">';
const at = html.lastIndexOf(open);
const end = html.indexOf('</script>', at);
if (at < 0 || end < 0) throw new Error('no app script in the page');
html = html.slice(0, at + open.length) + appJs + html.slice(end);
if (noSeedCache) html = html.replace(/<script id="rtx-seed-cache"[^>]*>[^<]*<\/script>\n?/, '');
// the app's css too (app.css is inlined as a <style> by build.ts: not replaced here)
writeFileSync(outPath, html);
console.log(`${outPath}: app ${(appJs.length / 1024).toFixed(0)} KB (${Object.entries(which).map(([k, v]) => `${k}:${v}`).join(' ')})`);
