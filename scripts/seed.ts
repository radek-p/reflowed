// The seed documents, imported with the editor's own importer, each one JSON file the build inlines and the app
// loads with io's loadSeed(store, json):
//   build/seed/intro.json     the introduction to ReflowEd (samples/intro/seed-intro.ts; a default document)
//   build/seed/example.json   the example: an optional example document (samples/paper2/seed-example.ts; sources from
//                             samples/paper2/fetch.sh, skipped with a note when they are not there)
//
// Each file carries seedHash (its content) and builtAt; the app replaces an
// unedited stored copy when the version changes (app/src/io/seeds.ts).
//
//   node scripts/seed.ts [--out-dir build/seed] [--no-example]      (the intro is always built)
//
// Ids are deterministic (seeded generators, fixed doc ids), so rebuilding
// gives the same doc and block ids and the prebuilt cache stays valid.
// Also writes <out-dir>/example-report.json and intro-report.json (the import reports).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  // the example document (samples/paper2/: not in every checkout)
  const exampleScript = resolve(EDITOR, 'samples/paper2/seed-example.ts');
  const exMod = !process.argv.includes('--no-example') && existsSync(exampleScript) ? await import(exampleScript) : null;
  if (process.argv.includes('--no-example')) { /* skipped */ }
  else if (!exMod) console.log('example.json: skipped (no samples/paper2/ in this checkout)');
  else if (!exMod.exampleSourcesPresent()) console.log('example.json: skipped (no paper2/source/: run paper2/fetch.sh)');
  else {
    const ex = await exMod.buildExampleSeed();
    const json = JSON.stringify(await stampSeed(ex.seed));
    writeFileSync(resolve(dir, 'example.json'), json);
    writeFileSync(resolve(dir, 'example-report.json'), JSON.stringify(ex.report, null, 1));
    const er = ex.report as { blocks: number; assets: unknown[]; bib: { entries: number } };
    console.log(`${resolve(dir, 'example.json')}: ${kb(json)} · "${ex.seed.init.title}" · ${er.blocks} blocks · ${er.assets.length} assets · ${er.bib.entries} bbl entries · doc id ${ex.seed.id}`);
  }
}
