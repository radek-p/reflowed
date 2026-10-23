// Route 2's samples (displays.ts): the block run again with the measure
// wider, converted exactly as compile.ts capture() converts the real run
// The real run's outputs have all been read by then (capture reads the
// stream, the XDV and the notes first; WarmEngine.file copies), and the next
// block restores the warm snapshot anyway, so the sample runs clobber
// nothing.
//
// The worker makes one per block:
//   capture(eng, getFile, 'input', { resample: resampler(eng, (pre) => blockFile(source, joinContext(context, pre)).text, getFile) })
import { convert } from '../../build/engine-api-src/convert.ts';
import { applySlots } from '../../slots/convert-slots.ts';
import { markPictures } from '../pictures.ts';
import type { Resample } from '../displays.ts';

type J = Record<string, any>;
interface Engine {
  runBlock(block: string): { status: number; trap?: string; runMs?: number; restoreMs?: number };
  file(name: string): Uint8Array | null;
  text(name: string): string;
}

/** TeX that makes the rest of the block `deltaSp` wider: every length a
 *  display or a box set to the measure reads (\displaywidth comes from
 *  \hsize, or \linewidth through a list's \parshape). */
export const widen = (deltaSp: number) =>
  `\\advance\\hsize ${deltaSp}sp\\relax\\advance\\textwidth ${deltaSp}sp\\relax\\advance\\linewidth ${deltaSp}sp\\relax\\advance\\columnwidth ${deltaSp}sp\\relax`;

/** The context prefix with the widening after it (on its own line). */
export const joinContext = (context: string, prefix: string) => (context ? `${context.replace(/\n?$/, '\n')}${prefix}` : prefix);

export interface Resampler extends Resample {
  /** runs made, engine ms, the trap if a sample run crashed the engine (the worker must recover
   *  before the next block), and why samples were not made (the time budget) */
  info: { runs: number; ms: number; trap?: string; skipped?: string };
}

/** What the samples may cost a block, in engine ms (both runs together). A
 *  sample run costs about what the block's own run cost, so a slow block
 *  (a TikZ-heavy paragraph: 4.7 s under Node, 10+ s in a browser) is not run
 *  twice more: its displays keep the fixed-width fallback (route 1 or none)
 *  instead of timing the block out. */
export const SAMPLE_BUDGET_MS = 2500;

/** `blockText(prefix)`: the block file with `prefix` (TeX) before the block's source. */
/** o.runMs: the block's own run (the first sample's predicted cost); o.budgetMs: SAMPLE_BUDGET_MS. */
export function resampler(e: Engine, blockText: (prefix: string) => string, readFile: (n: string) => Uint8Array | null,
  o: { runMs?: number; budgetMs?: number } = {}): Resampler {
  const info: Resampler['info'] = { runs: 0, ms: 0 };
  const budget = o.budgetMs ?? SAMPLE_BUDGET_MS;
  let last = o.runMs ?? 0;                                // the cost of the next run, predicted by the last one
  const fn = ((deltaSp: number): J | null => {
    if (info.trap || info.skipped) return null;
    if (info.ms + last > budget) { info.skipped = `time budget (a run takes ~${Math.round(last)} ms, the samples may take ${budget} ms)`; return null; }
    const t0 = performance.now();
    try {
      const r = e.runBlock(blockText(widen(deltaSp)));
      info.runs++;
      if (r.trap) { info.trap = r.trap; return null; }
      if (r.status > 1) return null;
      const bytes = e.file('input.rtxc.jsonl');
      if (!bytes) return null;
      const stream = markPictures(new TextDecoder().decode(bytes)).stream;
      const output = convert({ stream, readFile: (n) => e.file(n) ?? readFile(n), hyphenation: 'luatex', attrs: true });
      applySlots(output, { lua: e.file('input.rtxlua') ? e.text('input.rtxlua') : null, aux: e.file('input.aux') ? e.text('input.aux') : null });
      stripSource(output);
      return output;
    } catch { return null; }
    finally { last = performance.now() - t0; info.ms += last; }
  }) as Resampler;
  fn.info = info;
  return fn;
}

/** Source positions are not geometry: the widening line moves them. The
 *  samples serve only for geometry, so drop them (the model compares node
 *  identity across runs). */
function stripSource(x: unknown): void {
  if (!x || typeof x !== 'object') return;
  if (Array.isArray(x)) { for (const y of x) stripSource(y); return; }
  const o = x as J;
  if ('src' in o) delete o.src;
  for (const v of Object.values(o)) if (v && typeof v === 'object') stripSource(v);
}
