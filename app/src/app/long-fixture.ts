// The tests' long document (?seed=long, #/doc/long): the introduction (samples/intro, seed/intro.json) repeated, as
// a seed file of its own, for the suites that need a long document (scroll, motion, widths, anchor, far, performance
// budgets; they were calibrated on a 230-block paper). Copy k > 0 gets its labels and references suffixed (-c<k>), so
// every label is unique and every reference resolves; the title and the bibliography are kept once (copy 0's title,
// the last copy's bibliography). Its own fixed doc id and block ids (seeded): rebuilding gives the same document.
// Dev and tests only: created when asked for (?seed=long), never by default.
//
//   longSeed(introSeedJson, copies = 6) -> a seed file (io/seed.ts SeedFile) with about 6 × 39 blocks
import { seededUlid } from '../store/ulid.ts';
import { reassignIds } from '../nesting/model.ts';

interface SeedBlock { id?: string; kind?: string; source: string; parentId?: string | null }
interface SeedLike { format: string; version: number; id: string; init: { title?: string; blocks?: SeedBlock[]; meta?: { tags?: string[] }; [k: string]: unknown } }

export const LONG = Object.freeze({ tag: 'long', copies: 6 });

const LABELLED = /\\(label|ref|eqref|cref|Cref|autoref|pageref)\{([^}]*)\}/g;
/** the source with every label and reference key suffixed */
export function suffixLabels(src: string, suffix: string): string {
  return src.replace(LABELLED, (_m, cmd: string, keys: string) => `\\${cmd}{${keys.split(',').map((k) => `${k.trim()}${suffix}`).join(',')}}`);
}

export function longSeed(intro: SeedLike | string, copies: number = LONG.copies): SeedLike {
  const seed: SeedLike = typeof intro === 'string' ? JSON.parse(intro) : intro;
  const blocks = seed.init.blocks ?? [];
  const isBib = (b: SeedBlock) => b.kind === 'bibliography' || /\\begin\{thebibliography\}/.test(b.source);
  const body = blocks.filter((b) => b.kind !== 'title' && !isBib(b));
  const out: SeedBlock[] = blocks.filter((b) => b.kind === 'title');
  for (let k = 0; k < copies; k++) {
    const sfx = k ? `-c${k}` : '';
    // block ids are reassigned below; a copy's parent links point inside the copy
    out.push(...body.map((b) => ({ ...b, id: b.id ? `${b.id}${sfx}` : b.id, parentId: b.parentId ? `${b.parentId}${sfx}` : b.parentId, source: k ? suffixLabels(b.source, sfx) : b.source })));
  }
  out.push(...blocks.filter(isBib));
  const ids = seededUlid(2026_1019);
  const id = ids();
  const { seedHash: _h, seedVersion: _v, builtAt: _b, build: _x, ...rest } = seed as SeedLike & Record<string, unknown>;
  return { ...rest, id, init: { ...seed.init, title: `${seed.init.title ?? 'Introduction'} (long, ×${copies})`,
    meta: { ...seed.init.meta, tags: [LONG.tag] }, blocks: reassignIds(out as never[], ids) as SeedBlock[], snapshotLabel: 'Seed: the long test document' } };
}
