// Bundle a workbench entry (the demo, a test page) with esbuild from app/node_modules: one IIFE, no files written.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { VIEWPORT_CSS } from '../src/viewport.ts';

export const WB = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(WB, '..');
const req = createRequire(join(REPO, 'app/package.json'));
const esbuild = req('esbuild');

export async function bundle(entry: string, { minify = false } = {}): Promise<string> {
  const out = await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', target: 'es2022', write: false, minify, sourcemap: 'inline',
    nodePaths: [join(REPO, 'app/node_modules')], logLevel: 'warning', loader: { '.svg': 'text' },     // the wordmark's SVG files, inlined as text
  });
  return out.outputFiles[0].text;
}

/** The demo page: demo/index.html with its empty <style id="wb-viewport-css"> filled from src/viewport.ts (one text,
 *  in the head: the page is clipped from its first frame, before demo.js runs; ownViewport() adopts it). */
export function demoHtml(): string {
  const page = readFileSync(join(WB, 'demo/index.html'), 'utf8');
  const out = page.replace('<style id="wb-viewport-css"></style>', `<style id="wb-viewport-css">${VIEWPORT_CSS}</style>`);
  if (out === page) throw new Error('demo/index.html: no empty <style id="wb-viewport-css"></style> to fill');
  return out;
}
