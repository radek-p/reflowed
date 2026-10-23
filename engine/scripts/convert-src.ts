// engine-api's converter with patch (slots/patches/convert-attrs.patch:
// `attrs: true` keeps the attribute tuples and hyperref's links for
// slots/convert-slots.ts), as a copy the editor imports: build/engine-api-src/.
// Run before the tests
// and the worker build (build-worker.ts and test-w1.ts call ensureConvertSrc).
//     node scripts/convert-src.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');     // engine/
const SRC = join(HERE, 'api/src');                   // engine/api/src (was engine-api/src)
const PATCH = join(HERE, 'slots/patches/convert-attrs.patch');
// every slots/patches/convert-*.patch, in name order (attrs first: the others' context is after it)
const PATCHES = () => [PATCH, ...readdirSync(join(HERE, 'slots/patches')).filter((n) => /^convert-.*\.patch$/.test(n) && n !== 'convert-attrs.patch').sort().map((n) => join(HERE, 'slots/patches', n))];
export const CONVERT_DIR = join(HERE, 'build/engine-api-src');

/** Apply a unified diff to one file's text (context must match exactly; hunks may drift). */
export function applyUnified(text: string, diff: string, name = 'convert-attrs.patch'): string {
  const lines = text.split('\n');
  const hunks = diff.split('\n@@').slice(1).map((h) => h.split('\n').slice(1).filter((l, i, a) => !(i === a.length - 1 && l === '')));
  let drift = 0;
  const start = diff.split('\n@@').slice(1).map((h) => Number(/^ -(\d+)/.exec(h)![1]) - 1);
  hunks.forEach((h, k) => {
    const old = h.filter((l) => l[0] === ' ' || l[0] === '-').map((l) => l.slice(1));
    const neu = h.filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1));
    const want = start[k] + drift;
    const at = (i: number) => i >= 0 && old.every((l, j) => lines[i + j] === l);
    let pos = -1;
    for (let d = 0; d < 400 && pos < 0; d++) { if (at(want + d)) pos = want + d; else if (at(want - d)) pos = want - d; }
    if (pos < 0) throw new Error(`${name}: hunk ${k + 1} does not apply (near line ${want + 1})`);
    lines.splice(pos, old.length, ...neu);
    drift = pos - start[k] + neu.length - old.length;
  });
  return lines.join('\n');
}

export function ensureConvertSrc(): string {
  const target = join(CONVERT_DIR, 'convert.ts');
  // every engine-api source (sourcemap.ts, sourcemap-guard.ts, … are copied too), not only convert.ts
  const newest = Math.max(...readdirSync(SRC, { recursive: true }).map((f) => statSync(join(SRC, String(f))).mtimeMs), ...PATCHES().map((p) => statSync(p).mtimeMs), statSync(fileURLToPath(import.meta.url)).mtimeMs);
  if (existsSync(target) && statSync(target).mtimeMs >= newest) return CONVERT_DIR;
  rmSync(CONVERT_DIR, { recursive: true, force: true });
  mkdirSync(CONVERT_DIR, { recursive: true });
  cpSync(SRC, CONVERT_DIR, { recursive: true });
  let text = readFileSync(join(SRC, 'convert.ts'), 'utf8');
  // a patch that does not apply leaves no copy behind (a plain copy newer than its sources would pass as patched)
  try {
    for (const p of PATCHES()) text = applyUnified(text, readFileSync(p, 'utf8'), p.split('/').pop());
  } catch (e) {
    rmSync(CONVERT_DIR, { recursive: true, force: true });
    throw e;
  }
  writeFileSync(target, text);
  return CONVERT_DIR;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`${ensureConvertSrc()}: engine-api/src + ${PATCHES().map((p) => p.split('/').pop()).join(' + ')}`);
