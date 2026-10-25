// The sample documents the tests use, and whether this machine has them:
//   intro: build/seed/intro.json, built from samples/intro/source (in git): node scripts/seed.ts (or
//     samples/intro/seed-intro.ts) makes it anywhere, no network.
//   introBuilt() -> boolean
//   docsHere(['long', 'intro']) -> the ones this machine has (says which it left out); long: the tests' long
//     document (?seed=long: the intro repeated, app/src/app/long-fixture.ts), there when the intro is
//   seedQuery(doc) -> 'seed=long&' for the long document (created only when asked for), '' otherwise
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SEED_DIR = join(ROOT, 'build/seed');
export const introBuilt = (): boolean => existsSync(join(SEED_DIR, 'intro.json'));

export function docsHere(docs: string[]): string[] {
  const have = (d: string) => (d === 'intro' || d === 'long' ? introBuilt() : true);
  const gone = docs.filter((d) => !have(d));
  if (gone.length) console.log(`skip: ${gone.join(', ')} not on this machine (node scripts/seed.ts): their runs are left out`);
  return docs.filter(have);
}

export const seedQuery = (doc: string): string => (doc === 'long' ? 'seed=long&' : '');
