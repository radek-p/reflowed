// The seed documents, imported with the editor's own importer, each one JSON file the build inlines and the app
// loads with io's loadSeed(store, json):
//   build/seed/intro.json     the introduction to ReflowEd (samples/intro/seed-intro.ts; the default document)
//
// Each file carries seedHash (its content) and builtAt; the app replaces an
// unedited stored copy when the version changes (app/src/io/seeds.ts).
//
//   node scripts/seed.ts [--out-dir build/seed]
//
// Ids are deterministic (seeded generators, fixed doc ids), so rebuilding
// gives the same doc and block ids and the prebuilt cache stays valid.
// Also writes <out-dir>/intro-report.json (the import report).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedFile } from '../app/src/io/seed.ts';
import { seedHashOf } from '../app/src/io/seeds.ts';
import { buildIntroSeed } from '../samples/intro/seed-intro.ts';

/** (seed versioning) seedHash = the content hash, builtAt = now; the build (scripts/build.ts)
 *  adds seedVersion = hash(seedHash + engine build id) and build = { engine, date }. */
export async function stampSeed(seed: SeedFile): Promise<SeedFile> {
  return { ...seed, seedHash: await seedHashOf(seed), builtAt: new Date().toISOString() };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR = resolve(HERE, '..');

/** an editor addition to a seed's preamble: microtype's protrusion (punctuation and hyphens hang
 *  into the margin). Expansion off explicitly: XeTeX has none. engine/tests/protrusion.test.ts uses it. */
export const MICROTYPE = '\\usepackage[protrusion=true,expansion=false]{microtype} % editor addition (not in the source): margin protrusion';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = resolve(arg('--out-dir') ?? resolve(EDITOR, 'build/seed'));
  mkdirSync(dir, { recursive: true });
  const kb = (s: string) => `${(s.length / 1024).toFixed(0)} KB`;
  // the introduction to ReflowEd (samples/intro/source/): always
  {
    const intro = await buildIntroSeed();
    const json = JSON.stringify(await stampSeed(intro.seed));
    writeFileSync(resolve(dir, 'intro.json'), json);
    writeFileSync(resolve(dir, 'intro-report.json'), JSON.stringify(intro.report, null, 1));
    const r = intro.report as { blocks: number; assets: unknown[] };
    console.log(`${resolve(dir, 'intro.json')}: ${kb(json)} · "${intro.seed.init.title}" · ${r.blocks} blocks · ${r.assets.length} assets · doc id ${intro.seed.id}`);
  }
}
