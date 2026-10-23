// What the editor compiles for each block of a (possibly nested) document, outside the app: the same
// rule as app.js computeContexts + nesting/app.js compileSource/extraContext. For Node tests and scripts
// that compile a seed block by block (engine/tests/embedded-set.test.ts).
//   compileJobs(blocks, { bbl }) -> [{ i, block, source, context }]   containers left out (they are not compiled)
import { contextFor, type ContextOptions } from '../refs/context.ts';
import { isContainer, roles, compileParts, type NestBlock } from './model.ts';

export interface CompileJob<T> { i: number; block: T; source: string; context: string }

export function compileJobs<T extends NestBlock & { kind?: string; source: string }>(blocks: T[], opts: ContextOptions = {}): CompileJob<T>[] {
  const plain = blocks.filter((b) => !isContainer(b));
  const role = roles(blocks);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return plain.map((b, k) => {
    const r = b.id ? role.get(b.id) : undefined;
    const c = r ? byId.get(r.parent) : undefined;
    const parts = c && r ? compileParts(c, r) : null;
    let context = contextFor(plain, k, opts) ?? '';
    if (parts) context = context ? `${context}\n${parts.prefix}` : parts.prefix;
    return { i: blocks.indexOf(b), block: b, source: b.source.trim() + (parts?.suffix ?? ''), context };
  });
}
