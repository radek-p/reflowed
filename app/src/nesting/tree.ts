// The nesting tree of a block list, memoised: containers' children, the children's roles and
// their parents, and a revision that changes when any of them can. Every block's compile key asks for it (app.js ck →
// derived contextOf → nest.treeSig, and compileSource). A call compares the list with the last one element by element
// (the same block objects, parent ids and typeset flags), with no allocation, and builds again only when one differs:
// O(n) a call, so a pass over the document asks once (nesting/app.js pass), not once or twice per block (O(n²)).
//
//   const tree = createTree()
//   tree.of(list) -> { list, rev, kids: Map(container id -> children), roles: Map(child id -> Role), parent: Map(child id -> container id) }
//   tree.builds() -> how many times it was built (tests)
import { childrenOf, roles as rolesOf, isTypeset, isContainer, type NestBlock, type Role } from './model.ts';

export interface Tree<T extends NestBlock> { list: T[] | null; rev: number; kids: Map<string, T[]>; roles: Map<string, Role>; parent: Map<string, string> }

export function createTree<T extends NestBlock & { parentId?: string | null }>() {
  // isTypeset scans the whole source: remembered per block while its container flag, kind and source stay the same
  const typesetMemo = new WeakMap<T, { source: string; kind: string | undefined; c: boolean; v: boolean }>();
  const typeset = (b: T): boolean => {
    const m = typesetMemo.get(b), c = isContainer(b);
    if (m && m.source === b.source && m.kind === b.kind && m.c === c) return m.v;
    const v = isTypeset(b);
    typesetMemo.set(b, { source: b.source, kind: b.kind, c, v });
    return v;
  };
  let rev = 0, builds = 0;
  let cache: Tree<T> = { list: null, rev, kids: new Map(), roles: new Map(), parent: new Map() };
  // the list as last seen: the blocks, and what the tree depends on in each (its parent; whether it typesets, which
  // depends on its kind, source and container flag). A call first compares the cheap parts (the same objects, parent
  // ids, kinds and source strings); only when one differs are the typeset flags read again, and the tree is built
  // (and its revision moved) only when the parents, the order or a typeset flag changed: typing in a block changes its
  // source, not the tree.
  let seen: { blocks: T[]; parents: (string | null)[]; kinds: (string | undefined)[]; sources: string[]; containers: boolean[]; typeset: boolean[] } =
    { blocks: [], parents: [], kinds: [], sources: [], containers: [], typeset: [] };
  const cheapSame = (list: T[]): boolean => {
    const s = seen, n = list.length;
    if (s.blocks.length !== n) return false;
    for (let i = 0; i < n; i++) {
      const b = list[i]!;
      if (b !== s.blocks[i] || (b.parentId ?? null) !== s.parents[i] || b.source !== s.sources[i] || b.kind !== s.kinds[i] || isContainer(b) !== s.containers[i]) return false;
    }
    return true;
  };
  const snapshot = (list: T[]) => ({ blocks: [...list], parents: list.map((b) => b.parentId ?? null), kinds: list.map((b) => b.kind), sources: list.map((b) => b.source),
    containers: list.map((b) => isContainer(b)), typeset: list.map(typeset) });
  const sameTree = (a: typeof seen, b: typeof seen): boolean => a.blocks.length === b.blocks.length
    && a.blocks.every((x, i) => x === b.blocks[i] && a.parents[i] === b.parents[i] && a.typeset[i] === b.typeset[i]);
  function of(list: T[]): Tree<T> {
    if (cache.list === list && cheapSame(list)) return cache;
    const next = snapshot(list);
    if (cache.list && sameTree(seen, next)) { seen = next; if (cache.list !== list) cache = { ...cache, list }; return cache; }
    builds++;
    seen = next;
    const kids = childrenOf(list);
    const parent = new Map<string, string>();
    for (const [pid, ks] of kids) for (const k of ks) parent.set(k.id!, pid);
    cache = { list, rev: ++rev, kids, roles: rolesOf(list), parent };
    return cache;
  }
  return { of, builds: () => builds };
}
