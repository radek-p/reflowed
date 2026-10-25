// The workbench's layout model: a tree of splits and tab groups, as plain JSON data.
// Every operation is a pure function op(layout, ...) → layout: no mutation, structural sharing (untouched
// subtrees keep their identity), and a no-op returns the same object. Ids are passed in, so results are
// deterministic. No DOM, no signals: unit-tested in Node (tests/model.test.ts).

/** A view's own state: plain JSON (it is saved with the layout). A view type narrows it (ViewType<S>). */
export type ViewState = { readonly [key: string]: unknown };
export type Tab = { id: string; view: string; state: ViewState; pinned?: boolean; preview?: boolean };
/** A document group: its tabs in strip order, the active one, most recently used last. */
export type Group = { kind: 'group'; id: string; tabs: Tab[]; active: string | null; mru: string[] };
/** A side column's panel group: registered panel views (one instance each), the active one. */
export type PanelGroup = { kind: 'group'; id: string; panels: string[]; active: string | null };
export type Dir = 'row' | 'column';
/** A split over nodes of one tree (document groups, or a column's panel groups). */
export type Split<G> = { kind: 'split'; id: string; dir: Dir; sizes: number[]; children: TreeNode<G>[] };
export type TreeNode<G> = G | Split<G>;
/** Any tree: a layout is one (its document groups), so is { root } of a side column's stack. */
export type Tree<G> = { root: TreeNode<G> };
export type DocNode = TreeNode<Group>;
export type PanelNode = TreeNode<PanelGroup>;
export type SideName = 'left' | 'right';
export type Side = 'left' | 'right' | 'top' | 'bottom';
/** A side column: a stack of panel groups (a group, or one 'column' split over groups), hidden or shown, and the width
 *  the user gave it (px; none: its default, sideWidth). */
export type Column = { root: PanelNode; collapsed: boolean; size?: number };
export type Sides = Record<SideName, Column>;
export type Layout = {
  v: 1; root: DocNode; active: string; maximized: string | null;
  sides?: Sides; panelState?: { readonly [viewId: string]: ViewState };
};
export type Box = { x: number; y: number; w: number; h: number };
type AnyGroup = Group | PanelGroup;

export const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
export const EPS = 1e-9;     // the tolerance for comparing layout fractions

// ── constructors ──
export const group = (id: string, tabs: Tab[] = [], active: string | null = tabs.at(-1)?.id ?? null): Group =>
  ({ kind: 'group', id, tabs, active, mru: active ? [...tabs.map((t) => t.id).filter((t) => t !== active), active] : tabs.map((t) => t.id) });
export const split = <G>(id: string, dir: Dir, children: TreeNode<G>[], sizes: number[] = children.map(() => 1 / children.length)): Split<G> =>
  ({ kind: 'split', id, dir, sizes, children });
export const layout = (root: DocNode, active: string = firstGroup(root).id): Layout => ({ v: 1, root, active, maximized: null });
export const emptyLayout = (groupId = 'g1'): Layout => layout(group(groupId));

// ── queries ──
function firstGroup<G>(n: TreeNode<G>): G { return isSplit(n) ? firstGroup(n.children[0]!) : n; }
function lastGroup<G>(n: TreeNode<G>): G { return isSplit(n) ? lastGroup(n.children.at(-1)!) : n; }
export const isSplit = <G>(n: TreeNode<G>): n is Split<G> => (n as { kind: string }).kind === 'split';
// mutated, so a root's walk holds while it lives (WeakMap: dropped with it). What they return is shared: read-only.
const groupsOf = new WeakMap<object, readonly unknown[]>();
const tabIndex = new WeakMap<object, Map<string, { tab: Tab; group: Group }>>();
/** The groups in tree order (left to right, top to bottom). */
export function groups<G>(L: Tree<G>): readonly G[] {
  const key = L.root as object;
  let out = groupsOf.get(key) as readonly G[] | undefined;
  if (!out) { const gs: G[] = []; walk(L.root, (n) => { if (!isSplit(n)) gs.push(n); }); groupsOf.set(key, out = gs); }
  return out;
}
/** Each tab of the layout and its group, by tab id (memoised per root). */
function tabsById(L: Layout): Map<string, { tab: Tab; group: Group }> {
  let m = tabIndex.get(L.root);
  if (!m) { m = new Map(); for (const g of groups(L)) for (const tab of g.tabs) if (!m.has(tab.id)) m.set(tab.id, { tab, group: g }); tabIndex.set(L.root, m); }
  return m;
}
export function walk<G>(n: TreeNode<G>, f: (n: TreeNode<G>, parent: Split<G> | null) => void, parent: Split<G> | null = null): void {
  f(n, parent);
  if (isSplit(n)) for (const c of n.children) walk(c, f, n);
}
const idOf = <G>(n: TreeNode<G>) => (n as { id: string }).id;
export function findNode<G>(L: Tree<G>, id: string | null): TreeNode<G> | null { let r: TreeNode<G> | null = null; walk(L.root, (n) => { if (idOf(n) === id) r = n; }); return r; }
/** A group of the tree by id (null: none, or a split has that id). */
export function findGroup<G>(L: Tree<G>, id: string | null): G | null { const n = findNode(L, id); return n && !isSplit(n) ? n : null; }
export function parentOf<G>(L: Tree<G>, id: string): Split<G> | null { let r: Split<G> | null = null; walk(L.root, (n, p) => { if (idOf(n) === id) r = p; }); return r; }
/** The layout's shape, ignoring group and split ids: the tree (split directions and sizes), each group's tabs in
 *  order (ids, views, states, pins) and its active tab. Two layouts with the same shape look and behave the same. */
export function shape(L: Layout): string {
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  const n = (x: DocNode): unknown => isSplit(x) ? ['s', x.dir, x.sizes.map(r), x.children.map(n)]
    : ['g', x.tabs.map((t) => [t.id, t.view, JSON.stringify(t.state ?? null), !!t.pinned, !!t.preview]), x.active];
  const S = L.sides && sides(L);
  const t = (x: PanelNode): unknown => isSplit(x) ? ['s', x.sizes.map(r), x.children.map(t)] : ['g', x.panels, x.active];
  const col = (sd: Column) => [sd.collapsed, sd.size ?? null, t(sd.root)];
  return JSON.stringify([n(L.root), S ? SIDEBARS.map((k) => col(S[k])) : null]);
}
export const sameShape = (a: Layout, b: Layout): boolean => shape(a) === shape(b);
/** The group whose strip may sit in the top bar: the one group spanning the whole top edge (the root group, or the
 *  top of a vertical stack, recursively); none when the top edge is shared by groups side by side. */
export function barGroup(L: Layout): Group | null {
  let n: DocNode | undefined = L.root;
  while (n && isSplit(n)) { if (n.dir !== 'column') return null; n = n.children[0]; }
  return n ?? null;
}
export function groupOf(L: Layout, tabId: string): Group | null { return tabsById(L).get(tabId)?.group ?? null; }
export function findTab(L: Layout, tabId: string): Tab | null { return tabsById(L).get(tabId)?.tab ?? null; }
export const activeGroup = (L: Layout): Group => findGroup(L, L.active) ?? groups(L)[0]!;
export const allTabs = (L: Layout): Tab[] => groups(L).flatMap((g) => g.tabs);

/** Every node's rectangle in the unit square (splits and groups; the maximised group is not special here). */
export function boxes<G>(L: Tree<G>): Map<string, Box> {
  const out = new Map<string, Box>();
  const go = (n: TreeNode<G>, x: number, y: number, w: number, h: number) => {
    out.set(idOf(n), { x, y, w, h });
    if (!isSplit(n)) return;
    let at = 0;
    n.children.forEach((c, i) => {
      const s = n.sizes[i]!;
      if (n.dir === 'row') go(c, x + at * w, y, s * w, h); else go(c, x, y + at * h, w, s * h);
      at += s;
    });
  };
  go(L.root, 0, 0, 1, 1);
  return out;
}
/** The groups' rectangles in the unit square (for neighbour lookups). */
export function rects(L: Layout): Map<string, Box> {
  const B = boxes(L), out = new Map<string, Box>();
  for (const g of groups(L)) out.set(g.id, B.get(g.id)!);
  return out;
}
/**
 * The strip row of group `id` (ui.ts useHybridForm): the groups among `among` whose boxes share its top edge and touch
 * side by side, transitively, in px of a `w` × `h` area (the top edges within `top` px, the touching sides within `side`
 * px: the snapped boxes' rounding). Pure: from the layout's boxes, no DOM. In tree order.
 */
export function stripRow(L: Layout, id: string, w: number, h: number, among: ReadonlySet<string>, { top = 1, side = 2 }: { top?: number; side?: number } = {}): string[] {
  const B = boxes(L), me = B.get(id);
  if (!me || !among.has(id)) return [];
  const all = groups(L).filter((g) => among.has(g.id)).map((g) => ({ id: g.id, b: B.get(g.id)! })).filter((x) => Math.abs(x.b.y - me.y) * h <= top);
  const seen = new Set([id]), queue = all.filter((x) => x.id === id), out: string[] = [];
  while (queue.length) {
    const x = queue.shift()!; out.push(x.id);
    for (const y of all) if (!seen.has(y.id) && (Math.abs(y.b.x - (x.b.x + x.b.w)) * w <= side || Math.abs(x.b.x - (y.b.x + y.b.w)) * w <= side)) { seen.add(y.id); queue.push(y); }
  }
  return groups(L).map((g) => g.id).filter((g) => out.includes(g));
}
/** The nearest group on side `side` of group `id` (overlapping on the other axis), or null. */
export function neighbour(L: Layout, id: string, side: Side): string | null {
  const R = rects(L), a = R.get(id);
  if (!a) return null;
  let best: string | null = null, bestD = Infinity;
  const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
  for (const [gid, b] of R) {
    if (gid === id) continue;
    let ok: boolean, d: number;
    if (side === 'left') { ok = Math.abs(b.x + b.w - a.x) < EPS * 1e3 && b.y < a.y + a.h - EPS && b.y + b.h > a.y + EPS; d = Math.abs(b.y + b.h / 2 - cy); }
    else if (side === 'right') { ok = Math.abs(a.x + a.w - b.x) < EPS * 1e3 && b.y < a.y + a.h - EPS && b.y + b.h > a.y + EPS; d = Math.abs(b.y + b.h / 2 - cy); }
    else if (side === 'top') { ok = Math.abs(b.y + b.h - a.y) < EPS * 1e3 && b.x < a.x + a.w - EPS && b.x + b.w > a.x + EPS; d = Math.abs(b.x + b.w / 2 - cx); }
    else { ok = Math.abs(a.y + a.h - b.y) < EPS * 1e3 && b.x < a.x + a.w - EPS && b.x + b.w > a.x + EPS; d = Math.abs(b.x + b.w / 2 - cx); }
    if (ok && d < bestD) { best = gid; bestD = d; }
  }
  return best;
}

// ── validation ──
/** The invariants' violations of `input` (any JSON: a saved layout is checked before it is trusted); [] when valid. */
export function validate(input: unknown): string[] {
  const errs: string[] = [], ids = new Set<string>();
  const seen = (id: string) => { if (ids.has(id)) errs.push(`duplicate id ${id}`); ids.add(id); };
  const L = input as Layout | null;
  if (!L || L.v !== 1 || !L.root) return ['not a layout'];
  /** a split (either tree): ≥ 2 children, sizes > 0 summing to 1, a direction, never the parent's */
  const splitOk = <G>(n: Split<G>, parent: Split<G> | null) => {
    if (n.children.length < 2) errs.push(`split ${n.id} has ${n.children.length} children`);
    if (n.sizes.length !== n.children.length) errs.push(`split ${n.id} sizes/children`);
    if (n.sizes.some((s) => !(s > 0))) errs.push(`split ${n.id} size ≤ 0`);
    const sum = n.sizes.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-6) errs.push(`split ${n.id} sizes sum ${sum}`);
    if (n.dir !== 'row' && n.dir !== 'column') errs.push(`split ${n.id} dir`);
    if (parent && parent.dir === n.dir) errs.push(`split ${n.id} same dir as parent`);
  };
  const go = (n: DocNode, parent: Split<Group> | null) => {
    seen(n.id);
    if (n.kind === 'split') {
      splitOk(n, parent);
      for (const c of n.children) go(c, n);
    } else if (n.kind === 'group') {
      if (!n.tabs.length && parent) errs.push(`empty group ${n.id} not collapsed`);
      for (const t of n.tabs) seen(t.id);
      if (n.tabs.length && !n.tabs.some((t) => t.id === n.active)) errs.push(`group ${n.id} active ${n.active}`);
      if (!n.tabs.length && n.active != null) errs.push(`empty group ${n.id} has active`);
      const m = [...n.mru].sort().join(), t = n.tabs.map((x) => x.id).sort().join();
      if (m !== t) errs.push(`group ${n.id} mru`);
      if (n.tabs.length && n.mru.at(-1) !== n.active) errs.push(`group ${n.id} mru top`);
      let unpinned = false;
      for (const x of n.tabs) { if (!x.pinned) unpinned = true; else if (unpinned) errs.push(`group ${n.id} pinned after unpinned`); }
      if (n.tabs.filter((x) => x.preview).length > 1) errs.push(`group ${n.id} two previews`);
    } else errs.push(`unknown node ${(n as { kind?: unknown }).kind}`);
  };
  go(L.root, null);
  const g = findNode(L, L.active);
  if (!g || g.kind !== 'group') errs.push(`active ${L.active}`);
  if (L.maximized != null) { const m = findNode(L, L.maximized); if (!m || m.kind !== 'group') errs.push(`maximized ${L.maximized}`); }
  if (L.sides != null) {
    // a column: a stack of panel groups (a group, or one split of dir 'column' over groups); an empty group only as the
    // column's root (an empty column)
    const pids = new Set<string>();
    for (const side of SIDEBARS) {
      const sd = L.sides[side] as Column | undefined;
      if (!sd?.root) { errs.push(`side ${side} missing`); continue; }
      walk(sd.root, (n, parent) => {
        seen(n.id);
        if (n.kind === 'split') {
          splitOk(n, parent);
          if (n.dir !== 'column') errs.push(`side ${side}: split ${n.id} is not a stack (dir ${n.dir})`);
        } else if (n.kind === 'group' && Array.isArray(n.panels)) {
          if (!n.panels.length && parent) errs.push(`side ${side}: empty group ${n.id} not collapsed`);
          for (const p of n.panels) { if (pids.has(p)) errs.push(`panel ${p} twice`); pids.add(p); }
          if (n.panels.length ? !n.panels.includes(n.active!) : n.active != null) errs.push(`side ${side}: group ${n.id} active ${n.active}`);
        } else errs.push(`side ${side}: node ${idOf(n)}`);
      });
      if (sd.size != null && !(sd.size > 0)) errs.push(`side ${side} size`);
      if (typeof sd.collapsed !== 'boolean') errs.push(`side ${side} collapsed`);
    }
  }
  return errs;
}

// ── tree rewriting ──
/** Replace node `id` by f(node) (f may return null: removed), then normalise the path. */
function mapNode<G>(n: TreeNode<G>, id: string, f: (n: TreeNode<G>) => TreeNode<G> | null): TreeNode<G> | null {
  if (idOf(n) === id) return f(n);
  if (!isSplit(n)) return n;
  let changed = false;
  const kids: TreeNode<G>[] = [], sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = mapNode(c, id, f);
    if (r !== c) changed = true;
    if (r) { kids.push(r); sizes.push(n.sizes[i]!); }
  });
  if (!changed) return n;
  return normSplit({ ...n, children: kids, sizes });
}
/** mapNode on a tree whose root is never removed (f never returns null for it). */
const mapRoot = <G>(n: TreeNode<G>, id: string, f: (n: TreeNode<G>) => TreeNode<G> | null): TreeNode<G> => mapNode(n, id, f) ?? n;
/** A group's node replaced by f(group) (a split with that id is left alone). */
const mapGroup = <G>(n: TreeNode<G>, id: string, f: (g: G) => TreeNode<G> | null) => mapRoot(n, id, (x) => (isSplit(x) ? x : f(x)));
/** A split with ≥ 2 children, sizes summing to 1, children of the same dir flattened; a single child replaces it. */
function normSplit<G>(s: Split<G>): TreeNode<G> | null {
  if (!s.children.length) return null;
  if (s.children.length === 1) return s.children[0]!;
  const kids: TreeNode<G>[] = [], sizes: number[] = [];
  s.children.forEach((c, i) => {
    if (isSplit(c) && c.dir === s.dir) c.children.forEach((cc, j) => { kids.push(cc); sizes.push(s.sizes[i]! * c.sizes[j]!); });
    else { kids.push(c); sizes.push(s.sizes[i]!); }
  });
  return { ...s, children: kids, sizes: normSizes(sizes) };
}
function normSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sum > 0 ? sizes.map((x) => x / sum) : sizes.map(() => 1 / sizes.length);
}
function withRoot(L: Layout, root: DocNode | null): Layout {
  if (root === L.root) return L;
  if (!root) root = group(firstGroup(L.root).id);   // never happens (the root group is never removed)
  let active = L.active;
  const gs: string[] = []; walk(root, (n) => { if (!isSplit(n)) gs.push(n.id); });
  if (!gs.includes(active)) active = gs[0]!;
  const maximized = L.maximized && gs.includes(L.maximized) && gs.length === groupsCount(L) ? L.maximized : null;
  return { ...L, root, active, maximized };
}
function groupsCount(L: Layout): number { return groups(L).length; }
const updGroup = (L: Layout, gid: string, f: (g: Group) => Group) => withRoot(L, mapNode(L.root, gid, (n) => (isSplit(n) ? n : f(n))));

/** A group with tabs `tabs`, `active` and an mru fixed up: removed ids dropped, new ones added, active on top. */
function fixGroup(g: Group, tabs: Tab[], active: string | null): Group {
  const ids = new Set(tabs.map((t) => t.id));
  let mru = g.mru.filter((id) => ids.has(id));
  for (const t of tabs) if (!mru.includes(t.id)) mru.unshift(t.id);
  if (active == null || !ids.has(active)) active = mru.at(-1) ?? null;
  if (active) mru = [...mru.filter((x) => x !== active), active];
  return { ...g, tabs, active, mru };
}
/** Clamp an insertion index into the tab's block (pinned tabs among pinned, others after them). */
function clampIndex(tabs: Tab[], tab: Tab, index: number | null): number {
  const np = tabs.filter((t) => t.pinned).length;
  if (index == null) index = tabs.length;
  return tab.pinned ? Math.max(0, Math.min(index, np)) : Math.max(np, Math.min(index, tabs.length));
}
/** Drop an emptied non-root group: the empty group collapses (its sibling takes its space). */
function collapse(L: Layout, gid: string): Layout {
  const g = findGroup(L, gid);
  if (!g || g.tabs.length || L.root.id === gid) return L;
  const wasActive = L.active === gid;
  const parent = parentOf(L, gid)!;
  const idx = parent.children.findIndex((c) => c.id === gid);
  let next = withRoot(L, mapNode(L.root, gid, () => null));
  if (wasActive) {
    // the group that took its place: the previous sibling (or the next), its nearest group
    const sib = parent.children[idx > 0 ? idx - 1 : idx + 1]!;
    const target = isSplit(sib) ? (idx > 0 ? lastGroup(sib) : firstGroup(sib)).id : sib.id;
    next = { ...next, active: target };
  }
  return next;
}

// ── operations ──
export type OpenOptions = { group?: string; index?: number | null; activate?: boolean; preview?: boolean };
/** Add `tab` ({ id, view, state }) to a group (default the active one), after its active tab. */
export function openTab(L: Layout, tab: { id: string; view: string; state?: ViewState; pinned?: boolean }, { group: gid = L.active, index = null, activate = true, preview = false }: OpenOptions = {}): Layout {
  const g = findGroup(L, gid);
  if (!g || findTab(L, tab.id)) return L;
  const t: Tab = { ...tab, state: tab.state ?? {} };
  if (preview) t.preview = true; else delete t.preview;
  let tabs = g.tabs;
  let at = index ?? (g.active ? tabs.findIndex((x) => x.id === g.active) + 1 : tabs.length);
  if (preview) {
    const old = tabs.findIndex((x) => x.preview);
    if (old >= 0) { tabs = tabs.filter((_, i) => i !== old); if (index == null) at = old; else if (old < at) at--; }
  }
  at = clampIndex(tabs, t, at);
  tabs = [...tabs.slice(0, at), t, ...tabs.slice(at)];
  let next = updGroup(L, gid, (n) => fixGroup(n, tabs, activate || !n.active ? t.id : n.active));
  if (activate) next = { ...next, active: gid };
  return next;
}

export function closeTab(L: Layout, tabId: string): Layout {
  const g = groupOf(L, tabId);
  if (!g) return L;
  const tabs = g.tabs.filter((t) => t.id !== tabId);
  const next = updGroup(L, g.id, (n) => fixGroup(n, tabs, n.active === tabId ? null : n.active));
  return collapse(next, g.id);
}
export function closeTabs(L: Layout, ids: readonly string[]): Layout { let n = L; for (const id of ids) n = closeTab(n, id); return n; }
export function closeOthers(L: Layout, tabId: string): Layout {
  const g = groupOf(L, tabId);
  if (!g) return L;
  return closeTabs(L, g.tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id));
}
export function closeRight(L: Layout, tabId: string): Layout {
  const g = groupOf(L, tabId);
  if (!g) return L;
  const i = g.tabs.findIndex((t) => t.id === tabId);
  return closeTabs(L, g.tabs.slice(i + 1).filter((t) => !t.pinned).map((t) => t.id));
}

export function activateTab(L: Layout, tabId: string): Layout {
  const g = groupOf(L, tabId);
  if (!g) return L;
  if (g.active === tabId && L.active === g.id) return L;
  const next = g.active === tabId ? L : updGroup(L, g.id, (n) => fixGroup(n, n.tabs, tabId));
  return next.active === g.id ? next : { ...next, active: g.id };
}
export function focusGroup(L: Layout, gid: string): Layout {
  const g = findGroup(L, gid);
  if (!g || L.active === gid) return L;
  return { ...L, active: gid, maximized: L.maximized && L.maximized !== gid ? null : L.maximized };
}

/** Move a tab to group `toGroup` at `index` (an index in the target's tab list as it is before the move). */
export function moveTab(L: Layout, tabId: string, toGroup: string, index: number | null = null): Layout {
  const from = groupOf(L, tabId), to = findGroup(L, toGroup);
  if (!from || !to) return L;
  const tab = from.tabs.find((t) => t.id === tabId)!;
  if (from.id === toGroup) {
    const i = from.tabs.indexOf(tab);
    let at = index ?? from.tabs.length;
    if (at > i) at--;
    const rest = from.tabs.filter((t) => t !== tab);
    at = clampIndex(rest, tab, at);
    if (at === i && from.active === tabId && L.active === from.id) return L;
    const tabs = [...rest.slice(0, at), tab, ...rest.slice(at)];
    const next = updGroup(L, from.id, (n) => fixGroup(n, tabs, tabId));
    return { ...next, active: from.id };
  }
  // into another group: a preview tab there is replaced by an incoming preview tab
  let toTabs = to.tabs;
  let at = index ?? toTabs.length;
  if (tab.preview) {
    const old = toTabs.findIndex((t) => t.preview);
    if (old >= 0) { toTabs = toTabs.filter((_, k) => k !== old); if (old < at) at--; }
  }
  at = clampIndex(toTabs, tab, at);
  let next = updGroup(L, from.id, (n) => fixGroup(n, n.tabs.filter((t) => t !== tab), n.active === tabId ? null : n.active));
  next = updGroup(next, toGroup, (n) => fixGroup(n, [...toTabs.slice(0, at), tab, ...toTabs.slice(at)], tabId));
  next = { ...next, active: toGroup };
  return restoreIfChanged(L, collapse(next, from.id));
}
function restoreIfChanged(L: Layout, next: Layout): Layout { return next.maximized && groupsCount(next) !== groupsCount(L) ? { ...next, maximized: null } : next; }

/**
 * Into a NEW group `newGroupId` on `side` of group `targetGroup`: move tab `tabId`, or, with `copyId`, open a copy
 * of it there (VS Code's Split Editor: the same document in both groups, each tab its own view state).
 */
export function splitTab(L: Layout, tabId: string, targetGroup: string, side: Side, newGroupId: string, newSplitId: string, copyId: string | null = null): Layout {
  const from = groupOf(L, tabId), target = findGroup(L, targetGroup);
  if (!from || !target || !SIDES.includes(side) || findNode(L, newGroupId)) return L;
  if (copyId && (findNode(L, copyId) || findTab(L, copyId))) return L;
  if (!copyId && from.id === targetGroup && from.tabs.length === 1) return L;
  const tab = from.tabs.find((t) => t.id === tabId)!;
  let t2: Tab = { ...tab };
  let next = L;
  if (copyId) {
    t2 = { id: copyId, view: tab.view, state: structuredClone(tab.state ?? {}) };
  } else next = updGroup(L, from.id, (n) => fixGroup(n, n.tabs.filter((t) => t !== tab), n.active === tabId ? null : n.active));
  next = withRoot(next, insertBeside(next.root, targetGroup, group(newGroupId, [t2], t2.id), side, newSplitId));
  next = collapse(next, from.id);
  return { ...next, active: newGroupId, maximized: null };
}

/** Node `node` beside node `targetId` of the tree `root` (on `side`): a sibling in a parent split of that direction (the
 *  target's share halved between them), else the target wrapped in a new split `newSplitId`. The document groups'
 *  splits and the side columns' stacks both grow this way. */
function insertBeside<G>(root: TreeNode<G>, targetId: string, node: TreeNode<G>, side: Side, newSplitId: string): TreeNode<G> {
  const dir: Dir = side === 'left' || side === 'right' ? 'row' : 'column';
  const before = side === 'left' || side === 'top';
  const parent = parentOf({ root }, targetId);
  if (parent && parent.dir === dir) {
    return mapRoot(root, parent.id, (p) => {
      const s = p as Split<G>, i = s.children.findIndex((c) => idOf(c) === targetId);
      const half = s.sizes[i]! / 2;
      const kids = [...s.children], sizes = [...s.sizes];
      sizes[i] = half;
      kids.splice(before ? i : i + 1, 0, node); sizes.splice(before ? i : i + 1, 0, half);
      return { ...s, children: kids, sizes };
    });
  }
  return mapRoot(root, targetId, (g) => split<G>(newSplitId, dir, before ? [node, g] : [g, node]));
}

/** The tree holding split `id`: the document groups' (side null) or a side column's. */
function treeOf(L: Layout, id: string): { side: null; root: DocNode } | { side: SideName; root: PanelNode } | null {
  if (findNode(L, id)) return { side: null, root: L.root };
  for (const side of SIDEBARS) { const root = L.sides?.[side]?.root; if (root && findNode({ root }, id)) return { side, root }; }
  return null;
}
/** A split's sizes (normalised); the document groups' splits and a side column's stack alike. */
export function resize(L: Layout, splitId: string, sizes: readonly number[]): Layout {
  const t = treeOf(L, splitId);
  if (!t) return L;
  const resized = <G>(root: TreeNode<G>): TreeNode<G> | null => {
    const s = findNode({ root }, splitId);
    if (!s || !isSplit(s) || sizes.length !== s.children.length || sizes.some((x) => !(x > 0))) return null;
    const n = normSizes([...sizes]);
    if (n.every((x, i) => Math.abs(x - s.sizes[i]!) < 1e-12)) return null;
    return mapRoot(root, splitId, (p) => ({ ...(p as Split<G>), sizes: n }));
  };
  if (t.side == null) { const root = resized(t.root); return root ? withRoot(L, root) : L; }
  const root = resized(t.root);
  return root ? setSide(L, t.side, (sd) => ({ ...sd, root })) : L;
}
export const equalize = (L: Layout, splitId: string): Layout => {
  const t = treeOf(L, splitId);
  if (!t) return L;
  const root: TreeNode<AnyGroup> = t.root, s = findNode({ root }, splitId);
  return s && isSplit(s) ? resize(L, splitId, s.children.map(() => 1)) : L;
};

export function maximize(L: Layout, gid: string = L.active): Layout {
  const g = findGroup(L, gid);
  if (!g || !isSplit(L.root) || L.maximized === gid) return L;
  return { ...L, maximized: gid, active: gid };
}
export const restore = (L: Layout): Layout => (L.maximized ? { ...L, maximized: null } : L);
export const toggleMaximize = (L: Layout, gid: string = L.active): Layout => (L.maximized ? restore(L) : maximize(L, gid));

export function pin(L: Layout, tabId: string, on = true): Layout {
  const g = groupOf(L, tabId);
  const t = g?.tabs.find((x) => x.id === tabId);
  if (!g || !t || !!t.pinned === on) return L;
  const nt = { ...t };
  if (on) { nt.pinned = true; delete nt.preview; } else delete nt.pinned;
  // pinning puts it at the end of the pinned block; unpinning at the start of the rest
  const rest = g.tabs.filter((x) => x !== t);
  const np = rest.filter((x) => x.pinned).length;
  const tabs = [...rest.slice(0, np), nt, ...rest.slice(np)];
  return updGroup(L, g.id, (n) => fixGroup(n, tabs, n.active));
}
/** A preview tab becomes a normal one. */
export function keep(L: Layout, tabId: string): Layout {
  const g = groupOf(L, tabId);
  const t = g?.tabs.find((x) => x.id === tabId);
  if (!g || !t?.preview) return L;
  const nt = { ...t }; delete nt.preview;
  return updGroup(L, g.id, (n) => fixGroup(n, n.tabs.map((x) => (x === t ? nt : x)), n.active));
}
export function setState(L: Layout, tabId: string, state: ViewState): Layout {
  const g = groupOf(L, tabId);
  const t = g?.tabs.find((x) => x.id === tabId);
  if (!g || !t || t.state === state) return L;
  return updGroup(L, g.id, (n) => ({ ...n, tabs: n.tabs.map((x) => (x === t ? { ...t, state } : x)) }));
}
/** The same tab id, another view (the home tab becomes a document in place). */
export function replaceTab(L: Layout, tabId: string, { view, state = {} }: { view: string; state?: ViewState }): Layout {
  const g = groupOf(L, tabId);
  const t = g?.tabs.find((x) => x.id === tabId);
  if (!g || !t) return L;
  return updGroup(L, g.id, (n) => ({ ...n, tabs: n.tabs.map((x) => (x === t ? { ...t, view, state } : x)) }));
}

/** Set a group's mru (Ctrl+Tab commits its order on release); its last entry becomes the active tab. */
export function setMru(L: Layout, gid: string, mru: readonly string[]): Layout {
  const g = findGroup(L, gid);
  if (!g || mru.length !== g.mru.length || mru.join() === g.mru.join()) return L;
  const ids = new Set(g.tabs.map((t) => t.id));
  if (!mru.every((id) => ids.has(id))) return L;
  return updGroup(L, gid, (n) => ({ ...n, mru: [...mru], active: mru.at(-1) ?? null }));
}
/** Next/previous tab in strip order (wraps). */
export function cycleTab(L: Layout, delta: number, gid: string = L.active): Layout {
  const g = findGroup(L, gid);
  if (!g?.tabs?.length) return L;
  const i = g.tabs.findIndex((t) => t.id === g.active);
  return activateTab(L, g.tabs[(i + delta + g.tabs.length) % g.tabs.length]!.id);
}
/** Move a tab one place left or right in its group. */
export function shiftTab(L: Layout, tabId: string, delta: number): Layout {
  const g = groupOf(L, tabId);
  if (!g) return L;
  const i = g.tabs.findIndex((t) => t.id === tabId);
  const j = i + delta;
  if (j < 0 || j >= g.tabs.length) return L;
  return moveTab(L, tabId, g.id, delta > 0 ? j + 1 : j);
}

// ── sidebars: panels (registered views, one instance each) docked in the left or the right column,
// apart from the groups. A column: { root, collapsed, size }; its root is a STACK of panel groups, the document groups'
// tree constrained to 'column' splits (so it is a group or one column split over groups: normSplit flattens the rest),
// split, resized and collapsed by the same code. A panel group: { kind: 'group', id, panels: [viewId], active }. An
// empty group collapses (its share goes to its neighbours), except the root of an empty column.
// A column's WIDTH: the one the user gave it (resizeSide; kept in the layout), else its default (sideWidth): the widest
// default width its panels' types give (PanelWidth: a share of the workbench's width, within px bounds), else SIDE_SIZE
// px. resetSide goes back to it.
export const SIDEBARS: readonly SideName[] = ['left', 'right'];
export const SIDE_MIN = 160;   // a column's least width in px (its edge's drag stops there; a default share is never narrower)
export const SIDE_SIZE = 256;   // a column's default width in px when none of its panels gives one (css.ts: the fallback of --wb-side-w)
export const panelGroup = (id: string, panels: string[] = [], active: string | null = panels[0] ?? null): PanelGroup => ({ kind: 'group', id, panels, active });
const emptySide = (side: SideName): Column => ({ root: panelGroup(`${side}-0`), collapsed: false });
/** The sides, filled in for a layout that has none yet. */
export const sides = (L: Layout): Sides => L.sides ?? { left: emptySide('left'), right: emptySide('right') };
/** A column's panel groups, top to bottom. */
export const sideGroups = (sd: Column): readonly PanelGroup[] => groups({ root: sd.root });
export const sidePanels = (sd: Column): string[] => sideGroups(sd).flatMap((g) => g.panels);
export type Dock = { side: SideName; group: string };
/** Where panel `id` is docked: { side, group } (the panel group's id) or null. */
export function dockOf(L: Layout, id: string): Dock | null {
  const S = sides(L);
  for (const side of SIDEBARS) for (const g of sideGroups(S[side])) if (g.panels.includes(id)) return { side, group: g.id };
  return null;
}
export function sideOf(L: Layout, id: string): SideName | null { return dockOf(L, id)?.side ?? null; }
function withSides(L: Layout, S: Sides): Layout { return { ...L, sides: S }; }
function setSide(L: Layout, side: SideName, f: (sd: Column) => Column): Layout { const S = sides(L); const n = f(S[side]); return n === S[side] ? L : withSides(L, { ...S, [side]: n }); }
const sideGroup = (L: Layout, side: SideName, gid: string | null) => sideGroups(sides(L)[side]).find((x) => x.id === gid) ?? null;
/** A column's group `gid` with `panels` and `active` (kept valid); then the column's empty groups collapse. */
function updPanels(L: Layout, side: SideName, gid: string, panels: string[], active: string | null): Layout {
  return setSide(L, side, (sd) => {
    const ids = new Set(panels);
    let root = mapGroup(sd.root, gid, (g) => ({ ...g, panels, active: active != null && ids.has(active) ? active : g.active != null && ids.has(g.active) ? g.active : panels[0] ?? null }));
    for (const g of sideGroups({ ...sd, root })) if (!g.panels.length && g.id !== root.id) root = mapRoot(root, g.id, () => null);
    return root === sd.root ? sd : { ...sd, root };
  });
}
/** The column's group a panel goes to when none is named: its first (top). */
const firstOf = (L: Layout, side: SideName) => sideGroups(sides(L)[side])[0]!.id;
/** Add panel `id` to group `gid` of `side` (default: its top group) at `index`; no-op if docked already. */
export function addPanel(L: Layout, id: string, side: SideName = 'left', index: number | null = null, gid: string | null = null): Layout {
  if (!SIDEBARS.includes(side) || dockOf(L, id)) return L;
  const g = sideGroup(L, side, gid ?? firstOf(L, side));
  if (!g) return L;
  const p = [...g.panels];
  p.splice(Math.max(0, Math.min(index ?? p.length, p.length)), 0, id);
  return updPanels(L, side, g.id, p, g.active ?? id);
}
export function removePanel(L: Layout, id: string): Layout {
  const d = dockOf(L, id);
  if (!d) return L;
  const g = sideGroup(L, d.side, d.group)!;
  const p = g.panels.filter((x) => x !== id);
  return updPanels(L, d.side, g.id, p, g.active === id ? p[Math.max(0, g.panels.indexOf(id) - 1)] ?? null : g.active);
}
/** Move a panel into group `gid` of `side` (default: its top group) at `index` (an index in that group before the
 *  move); it becomes active there and the column shows. */
export function movePanel(L: Layout, id: string, side: SideName, index: number | null = null, gid: string | null = null): Layout {
  const from = dockOf(L, id);
  if (!from || !SIDEBARS.includes(side)) return L;
  const to = gid ?? firstOf(L, side);
  if (from.side === side && from.group === to) {
    const g = sideGroup(L, side, to)!, i = g.panels.indexOf(id);
    let at = index ?? g.panels.length;
    if (at > i) at--;
    const rest = g.panels.filter((x) => x !== id);
    at = Math.max(0, Math.min(at, rest.length));
    if (at === i && g.active === id && !sides(L)[side].collapsed) return L;
    return show(updPanels(L, side, to, [...rest.slice(0, at), id, ...rest.slice(at)], id), side);
  }
  if (!sideGroup(L, side, to)) return L;
  return activatePanel(addPanel(removePanel(L, id), id, side, index, to), id);     // (the target is not the source: it stays)
}
/** Into a NEW group `newGroupId` above or below (`where`: 'top' | 'bottom') group `gid` of `side` (null: the column's
 *  top or bottom group): the panel's own group, as a tab dropped on a group's edge. A panel not docked yet is added
 *  so. Splitting a group by its only panel is a no-op. */
export function splitPanel(L: Layout, id: string, side: SideName, gid: string | null, where: 'top' | 'bottom', newGroupId: string, newSplitId: string): Layout {
  if (!SIDEBARS.includes(side) || (where !== 'top' && where !== 'bottom')) return L;
  const gs = sideGroups(sides(L)[side]);
  const target = gid == null ? (where === 'top' ? gs[0] : gs.at(-1)) : gs.find((x) => x.id === gid);
  if (!target) return L;
  const from = dockOf(L, id);
  if (from && from.side === side && from.group === target.id && target.panels.length === 1) return L;
  // the panel leaves its group (an emptied group collapses: not the target, which keeps its place meanwhile)
  let next = L;
  if (from) {
    const g = sideGroup(L, from.side, from.group)!, p = g.panels.filter((x) => x !== id);
    next = setSide(L, from.side, (sd) => ({ ...sd, root: mapGroup(sd.root, g.id, (n) => ({ ...n, panels: p, active: n.active === id ? p[Math.max(0, g.panels.indexOf(id) - 1)] ?? null : n.active })) }));
  }
  next = setSide(next, side, (sd) => ({ ...sd, root: insertBeside<PanelGroup>(sd.root, target.id, panelGroup(newGroupId, [id], id), where, newSplitId), collapsed: false }));
  for (const s of new Set([side, from?.side].filter((x): x is SideName => !!x))) {
    const empty = sideGroups(sides(next)[s]).find((g) => !g.panels.length);
    if (empty) next = updPanels(next, s, empty.id, [], null);
  }
  return next;
}
/** Show a panel: its group's active one, the column shown. */
export function activatePanel(L: Layout, id: string): Layout {
  const d = dockOf(L, id);
  if (!d) return L;
  const g = sideGroup(L, d.side, d.group)!;
  return show(g.active === id ? L : updPanels(L, d.side, g.id, g.panels, id), d.side);
}
const show = (L: Layout, side: SideName) => collapseSide(L, side, false);
export function collapseSide(L: Layout, side: SideName, collapsed: boolean = !sides(L)[side]?.collapsed): Layout {
  if (!SIDEBARS.includes(side)) return L;
  return setSide(L, side, (sd) => (sd.collapsed === collapsed ? sd : { ...sd, collapsed }));
}
export function resizeSide(L: Layout, side: SideName, size: number): Layout {
  if (!SIDEBARS.includes(side) || !(size > 0)) return L;
  const r = Math.round(size);
  return setSide(L, side, (sd) => (sd.size === r ? sd : { ...sd, size: r }));
}
/** The column back to its default width (the user's width forgotten). */
export function resetSide(L: Layout, side: SideName): Layout {
  if (!SIDEBARS.includes(side)) return L;
  return setSide(L, side, (sd) => { if (sd.size == null) return sd; const { size: _gone, ...rest } = sd; return rest; });
}
/** A panel's default width for its column (a view type's panel.width): `share` of the workbench's width (0 < share ≤ 1),
 *  at least `min` px, at most `max` px (both optional). */
export type PanelWidth = { share: number; min?: number; max?: number };
/** A column's width: { px } (the user's, or SIDE_SIZE), or a panel's default width (PanelWidth): of the column's panels,
 *  the one with the widest share (`width(id)`: its type's, or none; a share out of (0, 1] is none). */
export type SideWidth = { px: number; share?: undefined; min?: undefined; max?: undefined } | (PanelWidth & { px?: undefined });
export function sideWidth(sd: Column, width: (panelId: string) => PanelWidth | null | undefined): SideWidth {
  if (sd.size != null) return { px: sd.size };
  let best: PanelWidth | null = null;
  for (const id of sidePanels(sd)) { const w = width(id); if (w && w.share > 0 && w.share <= 1 && (!best || w.share > best.share)) best = w; }
  return best ? { ...best } : { px: SIDE_SIZE };
}
/** A column's width (sideWidth: the user's, or its panels' default) as CSS (--wb-side-w), and in px in an area
 *  `areaW` wide: a share within its bounds (min: at least SIDE_MIN px); in an overlay (`full`) a default share is the
 *  whole area. */
const bounds = (w: PanelWidth) => ({ lo: Math.max(SIDE_MIN, w.min ?? 0), hi: w.max ?? Infinity });
export function sideCss(w: SideWidth, full = false): string {
  if (w.share == null) return `${w.px}px`;
  if (full) return '100%';
  const { lo, hi } = bounds(w), pct = `${+(w.share * 100).toFixed(4)}%`;
  return hi < Infinity ? `clamp(${lo}px, ${pct}, ${Math.max(lo, hi)}px)` : `max(${lo}px, ${pct})`;
}
export function sidePx(w: SideWidth, areaW: number, full = false): number {
  if (w.share == null) return w.px;
  if (full) return Math.round(areaW);
  const { lo, hi } = bounds(w);
  return Math.round(Math.max(lo, Math.min(Math.max(lo, hi), w.share * areaW)));
}
export function setPanelState(L: Layout, id: string, state: ViewState): Layout {
  const cur = L.panelState?.[id];
  if (cur === state) return L;
  return { ...L, panelState: { ...(L.panelState ?? {}), [id]: state } };
}

// ── persistence ──
export function serialize(L: Layout): string { return JSON.stringify(L); }
/** Parse and check; throws on a layout that breaks the invariants. */
export function deserialize(json: string | object): Layout {
  const L: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  const errs = validate(L);
  if (errs.length) throw new Error(`workbench layout: ${errs.join('; ')}`);
  return L as Layout;
}
/** The largest numeric suffix used by ids with `prefix` (so a store can continue numbering after a load). */
export function maxId(L: Layout, prefix: string): number {
  let m = 0;
  const see = (id: string) => { if (id.startsWith(prefix)) { const k = Number(id.slice(prefix.length)); if (k > m) m = k; } };
  walk(L.root, (n) => { see(n.id); if (!isSplit(n)) n.tabs.forEach((t) => see(t.id)); });
  if (L.sides) for (const side of SIDEBARS) walk(sides(L)[side].root, (n) => see(n.id));
  return m;
}
