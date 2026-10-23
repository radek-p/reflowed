// The op log replayed: a snapshot's document plus the ops logged
// since it should give the stored document. Where it does not, the op log is incomplete (an edit the app
// stored but did not log), and history built on it would lose that edit.
// The op log is disposable (store/policy.ts): it holds between drops, from a snapshot taken after the last one.
//
//   replay(snapDoc, ops) -> ReplayState          applies insert, delete, move, edit (whole or splices), meta
//   stateOf(openDoc)     -> ReplayState          the same shape from a stored document
//   diffStates(a, b)     -> string[]             what differs (empty: the invariant holds)
//
// Compared: the title, the preamble source, and every block's id, position, parent and source; kinds and
// attrs are not in every op yet (reported separately by the caller when wanted).
import type { Op } from './types.ts';

export interface ReplayBlock { id: string; pos: string; parentId: string | null; source: string }
export interface ReplayState { title: string; preamble: string; blocks: ReplayBlock[] }

const blockOf = (b: any): ReplayBlock => ({ id: b.id, pos: b.pos, parentId: b.parentId ?? null, source: b.source ?? '' });
const sorted = (bs: ReplayBlock[]) => [...bs].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1));

export function stateOf(doc: { title?: string; preamble?: { source: string } | string; blocks: any[] }): ReplayState {
  const pre = typeof doc.preamble === 'string' ? doc.preamble : doc.preamble?.source ?? '';
  return { title: doc.title ?? '', preamble: pre, blocks: sorted(doc.blocks.map(blockOf)) };
}

export function replay(snapDoc: Parameters<typeof stateOf>[0], ops: Op[]): ReplayState {
  const s = stateOf(snapDoc);
  const byId = new Map(s.blocks.map((b) => [b.id, b]));
  for (const o of [...ops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const p: any = o.payload ?? {};
    const b = o.blockId ? byId.get(o.blockId) : undefined;
    switch (o.t) {
      case 'insert': byId.set(p.block.id, blockOf(p.block)); break;
      case 'delete': byId.delete(o.blockId ?? p.block?.id); break;
      case 'move': if (b) { b.pos = p.to; if ('parentId' in p) b.parentId = p.parentId ?? null; } break;
      case 'edit':
        if (!b) break;
        if (typeof p.to === 'string') b.source = p.to;
        else for (const [from, to, text] of p.changes ?? []) b.source = b.source.slice(0, from) + text + b.source.slice(to);
        break;
      case 'meta':
        if (typeof p.title === 'string') s.title = p.title;
        if (p.preamble !== undefined) s.preamble = typeof p.preamble === 'string' ? p.preamble : p.preamble.source;
        break;
    }
  }
  return { ...s, blocks: sorted([...byId.values()]) };
}

export function diffStates(a: ReplayState, b: ReplayState): string[] {
  const out: string[] = [];
  if (a.title !== b.title) out.push(`title: ${JSON.stringify(a.title)} ≠ ${JSON.stringify(b.title)}`);
  if (a.preamble !== b.preamble) out.push('preamble differs');
  const A = new Map(a.blocks.map((x) => [x.id, x])), B = new Map(b.blocks.map((x) => [x.id, x]));
  for (const [id, x] of A) {
    const y = B.get(id);
    if (!y) { out.push(`block ${id}: only in the replay`); continue; }
    for (const k of ['pos', 'parentId', 'source'] as const) if (x[k] !== y[k]) out.push(`block ${id}: ${k} ${JSON.stringify(x[k]).slice(0, 60)} ≠ ${JSON.stringify(y[k]).slice(0, 60)}`);
  }
  for (const id of B.keys()) if (!A.has(id)) out.push(`block ${id}: only in the stored document`);
  return out;
}
