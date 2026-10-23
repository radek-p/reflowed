// The introduction to ReflowEd as a seed: source/ (main.tex, intro.bib, images/) read with the editor's own
// importer, as a folder upload, then the title in the title form's format (scripts/seed-title-form.ts), as the
// other seeds have it. scripts/seed.ts writes it as build/seed/intro.json (also alone: node samples/intro/seed-intro.ts).
// A default document: the app creates it on a first run (app/src/app/seeds.ts) and a release ships it
// (scripts/build.ts's default --seeds).
//
// Ids are deterministic (seeded generator, fixed doc id), so rebuilding gives the same doc and block ids.
// main.tex is the editor's version of it (variants.ts): its site-only passages and every %% line left out, so the
// document in the editor shows neither the website's wording nor the markers.
// The document is under the editor's licence, AGPL-3.0-or-later (scripts/licences.ts); its screenshots are of ReflowEd.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importUpload } from '../../app/src/io/import.ts';
import { toBase64, type SeedFile } from '../../app/src/io/seed.ts';
import { seededUlid } from '../../app/src/store/ulid.ts';
import { reassignIds } from '../../app/src/nesting/model.ts';
import { seedHashOf } from '../../app/src/io/seeds.ts';
import { withTitleForm } from '../../scripts/seed-title-form.ts';
import { versionOf } from './variants.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const INTRO_SOURCE = resolve(HERE, 'source');
export const INTRO_TAG = 'intro';

/** Every file under dir, as importer entries (paths relative to dir); main.tex in the editor's version. */
function entriesOf(dir: string): { path: string; data: Uint8Array }[] {
  const out: { path: string; data: Uint8Array }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      if (n.startsWith('.')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (relative(dir, p) === 'main.tex') out.push({ path: 'main.tex', data: new TextEncoder().encode(versionOf(readFileSync(p, 'utf8'), 'editor')) });
      else out.push({ path: relative(dir, p), data: new Uint8Array(readFileSync(p)) });
    }
  };
  walk(dir);
  return out;
}

export async function buildIntroSeed(src = INTRO_SOURCE): Promise<{ seed: SeedFile; report: unknown }> {
  const { init, report } = await importUpload('reflowed-intro', entriesOf(src));
  const ids = seededUlid(2026_1018);
  const id = ids();
  const blocks = reassignIds(init.blocks ?? [], ids);
  const assets = ((init.assets ?? []) as Array<{ name: string; mime: string; bytes: Uint8Array; ipe?: boolean }>)
    .map(({ bytes, ...a }) => ({ ...a, base64: toBase64(bytes) }));
  init.preamble = withTitleForm(init.preamble).preamble;
  const meta = { ...init.meta, tags: [...new Set([...(init.meta?.tags ?? []), INTRO_TAG])], importedFrom: 'samples/intro/source' } as typeof init.meta;
  const seed: SeedFile = { format: 'rtx-seed', version: 1, id, init: { ...init, meta, blocks, assets, snapshotLabel: 'Seed: introduction to ReflowEd' } };
  return { seed, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(HERE, '../../build/seed/intro.json');
  const { seed, report } = await buildIntroSeed();
  const json = JSON.stringify({ ...seed, seedHash: await seedHashOf(seed), builtAt: new Date().toISOString() });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  writeFileSync(resolve(dirname(out), 'intro-report.json'), JSON.stringify(report, null, 1));
  const r = report as { blocks: number; assets: unknown[] };
  console.log(`${out}: ${(json.length / 1024).toFixed(0)} KB · "${seed.init.title}" · ${r.blocks} blocks · ${r.assets.length} assets · doc id ${seed.id}`);
}
