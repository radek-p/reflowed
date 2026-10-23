// The splitter: a group's snapped box, the separators of every split and THE Separator, shared by the
// document groups (ui.ts) and a side column's stack (sides.ts): pointer, keys, double-click, one commit per drag.
import { useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { html } from './html.ts';
import * as M from './model.ts';
import { pointerSession } from './drag.ts';
import { splitterKey } from './ui-keys.ts';
export { splitterKey };
import type { Workbench } from './workbench.ts';
import type { Box, Dir, Group, Layout, Tree, TreeNode, Split } from './model.ts';

const pct = (f: number) => `${+(f * 100).toFixed(6)}%`;
export const EPS = M.EPS;
/** A group's box: its four edges snapped to whole pixels the same way for every group, so neighbours meet exactly and
 *  the last one ends at the window's edge (no width rounded on its own). */
const snap = (f: number) => (f <= 0 ? '0px' : `round(nearest, ${pct(f)}, 1px)`);
// the far edges from the same rounding as the near ones (100% minus the rounded edge): a boundary at .5 px is one
// pixel for both neighbours (rounding the distance from the far side instead left a 1 px gap between them)
const snapEnd = (f: number) => (f >= 1 - EPS ? '0px' : `calc(100% - round(nearest, ${pct(f)}, 1px))`);
export type BoxStyle = { left?: string; top?: string; right?: string; bottom?: string; width?: string; height?: string };
export function groupStyle(b: Box): BoxStyle { return { left: snap(b.x), top: snap(b.y), right: snapEnd(b.x + b.w), bottom: snapEnd(b.y + b.h) }; }
/** A splitter between two children of a split: where it is drawn, its value (the first child's share), what it controls. */
export type SeparatorSpec = { key: string; split: string; index: number; dir: Dir; style: BoxStyle; value: number; controls: string };
/** The separators of every split: { key, split, index, dir, style, value, controls }. */
export function separators<G extends { id: string }>(L: Tree<G>, B: Map<string, Box> = M.boxes(L)): SeparatorSpec[] {
  const out: SeparatorSpec[] = [];
  M.walk(L.root, (n) => {
    if (!M.isSplit(n)) return;
    const b = B.get(n.id)!;
    let at = 0;
    for (let i = 0; i < n.children.length - 1; i++) {
      at += n.sizes[i]!;
      const style = n.dir === 'row'
        ? { left: snap(b.x + at * b.w), top: pct(b.y), height: pct(b.h) }     // snapped as the groups' edges: the line on the boundary
        : { top: snap(b.y + at * b.h), left: pct(b.x), width: pct(b.w) };
      const first = n.children[i]!;
      out.push({ key: `${n.id}:${i}`, split: n.id, index: i, dir: n.dir, style,
        value: Math.round((n.sizes[i]! / (n.sizes[i]! + n.sizes[i + 1]!)) * 100),
        controls: (M.isSplit(first) ? M.groups({ root: first })[0]! : first).id });
    }
  });
  return out;
}
const applyStyle = (el: HTMLElement, s: BoxStyle) => { for (const k of ['left', 'top', 'right', 'bottom', 'width', 'height'] as const) el.style[k] = s[k] ?? ''; };
/** The minimum size in px of a node along `axis` ('row' = width). */
function minPx<G>(n: TreeNode<G>, axis: Dir, MIN: number): number {
  if (!M.isSplit(n)) return MIN;
  const m = n.children.map((c) => minPx(c, axis, MIN));
  return n.dir === axis ? m.reduce((a, b) => a + b, 0) : Math.max(...m);
}

// ── separators: pointer and keyboard resizing ──
/** THE splitter: the document groups' (tree: the layout's root) and a side column's stack (tree: that column's root,
 *  its groups [data-pgroup], min: a panel group's least height) alike: snapped boxes, pointer, keys, double-click. */
/** A tree the splitter works on: where its root is in a layout, its groups' attribute, a group's least size (null: wb.minSize). */
/** A splitter's pointer drag (both splitters): the focus on it, no threshold, the drag look on it and the resizing
 *  cursor on the root; `move` with the offset at each pointer move, `paint` once a frame, then `drop` or (Escape,
 *  a lost pointer) `cancel`. */
export function splitterDrag(e: PointerEvent, sep: HTMLElement, root: HTMLElement, dir: Dir, { start, move, paint, drop, cancel }: {
  start(): void; move(dx: number, dy: number): void; paint(): void; drop(): void; cancel(): void;
}): void {
  if (e.button !== 0) return;
  e.preventDefault();
  sep.focus({ preventScroll: true });
  const x0 = e.clientX, y0 = e.clientY, cls = ['wb-root--resizing', dir === 'row' ? 'wb-root--resizing-col' : 'wb-root--resizing-row'];
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; sep.classList.remove('wb-sep--drag'); root.classList.remove(...cls); };
  pointerSession(e, {
    threshold: 0, target: sep,
    onStart() { start(); sep.classList.add('wb-sep--drag'); root.classList.add(...cls); },
    onMove(ev) { move(ev.clientX - x0, ev.clientY - y0); if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); },
    onDrop() { stop(); drop(); },
    onCancel() { stop(); cancel(); },
  });
}
export type SplitTree<G> = { of(L: Layout): TreeNode<G>; attr: string; min: number | null };
const DOC_TREE: SplitTree<Group> = { of: (L) => L.root, attr: 'data-group', min: null };
type SepCtx<G> = { L: Layout; n: Split<G>; extent: number; minA: number; minB: number; gs: Set<string> };
export function Separator<G extends { id: string }>({ wb, s, root, tree = DOC_TREE as unknown as SplitTree<G>, label = 'Resize groups' }: { wb: Workbench; s: SeparatorSpec; root: RefObject<HTMLElement>; tree?: SplitTree<G>; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const keyState = useRef<SepCtx<G> | null>(null);
  const ctxFor = (split: string): SepCtx<G> => {
    const L = wb.layout.peek(), T: Tree<G> = { root: tree.of(L) }, n = M.findNode(T, split) as Split<G>;
    const R = root.current!.getBoundingClientRect(), b = M.boxes(T).get(split)!;
    const extent = n.dir === 'row' ? b.w * R.width : b.h * R.height;
    const a = n.children[s.index]!, c = n.children[s.index + 1]!, min = tree.min ?? wb.minSize;
    const minA = minPx(a, n.dir, min), minB = minPx(c, n.dir, min);
    const gs = new Set([...M.groups<G>({ root: a }), ...M.groups<G>({ root: c })].map((x) => x.id));
    return { L, n, extent, minA, minB, gs };
  };
  const sizesAt = (c: SepCtx<G>, deltaPx: number): number[] => {
    const sz = [...c.n.sizes], i = s.index, total = sz[i]! + sz[i + 1]!;
    const lo = c.minA / c.extent, hi = total - c.minB / c.extent;
    const a = lo > hi ? total / 2 : Math.max(lo, Math.min(hi, sz[i]! + deltaPx / c.extent));
    sz[i] = a; sz[i + 1] = total - a;
    return sz;
  };
  const begin = (c: SepCtx<G>, how: string) => {
    for (const [, h] of wb.hosts) { const gid = h.ctx.groupId.peek(); if (h.ctx.visible.peek() && gid && c.gs.has(gid)) h.ctx.resizing.value = true; }
    wb.resizing.value = { split: s.split, groups: c.gs };
    wb.emit('resizestart', { split: s.split, groups: [...c.gs], how });
  };
  const finish = (c: SepCtx<G>, how: string) => {
    for (const [, h] of wb.hosts) if (h.ctx.resizing.peek()) h.ctx.resizing.value = false;
    wb.resizing.value = null;
    wb.emit('resizeend', { split: s.split, groups: [...c.gs], how, sizes: (M.findNode<G>({ root: tree.of(wb.layout.peek()) }, s.split) as Split<G> | null)?.sizes });
  };
  const paint = (L2: Layout) => {
    const T: Tree<G> = { root: tree.of(L2) }, B = M.boxes(T), r = root.current!;
    for (const g of M.groups(T)) { const el = r.querySelector<HTMLElement>(`[${tree.attr}="${CSS.escape(g.id)}"]`); if (el) applyStyle(el, groupStyle(B.get(g.id)!)); }
    for (const x of separators(T, B)) { const el = r.querySelector<HTMLElement>(`[data-sep="${CSS.escape(x.key)}"]`); if (el) applyStyle(el, x.style); }
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const c = ctxFor(s.split);
    let sizes = c.n.sizes;
    splitterDrag(e, ref.current!, root.current!, c.n.dir, {
      start: () => begin(c, 'pointer'),
      move: (dx, dy) => { sizes = sizesAt(c, c.n.dir === 'row' ? dx : dy); },
      paint: () => paint(M.resize(c.L, s.split, sizes)),
      drop: () => { wb.resize(s.split, sizes); finish(c, 'pointer'); },
      cancel: () => { paint(c.L); finish(c, 'pointer'); },
    });
  };
  const key = (e: KeyboardEvent) => {
    const k = splitterKey(e, s.dir);
    if (k === 'reset') { e.preventDefault(); const c = ctxFor(s.split); begin(c, 'keyboard'); wb.equalize(s.split); finish(c, 'keyboard'); return; }
    if (k == null) return;
    const delta = k === 'start' ? -1e6 : k === 'end' ? 1e6 : k;
    e.preventDefault(); e.stopPropagation();
    const c = ctxFor(s.split);
    if (!keyState.current) { keyState.current = c; begin(c, 'keyboard'); }
    wb.resize(s.split, sizesAt(c, delta));
  };
  const keyup = () => { const c = keyState.current; if (c) { keyState.current = null; finish(c, 'keyboard'); } };
  const dbl = () => { const c = ctxFor(s.split); begin(c, 'equalize'); wb.equalize(s.split); finish(c, 'equalize'); };
  return html`<div ref=${ref} class="wb-sep" role="separator" tabindex="0" data-sep=${s.key} data-split=${s.split}
    aria-orientation=${s.dir === 'row' ? 'vertical' : 'horizontal'} aria-valuenow=${s.value} aria-valuemin="0" aria-valuemax="100"
    aria-controls=${`wbg-${s.controls}`} aria-label=${label} style=${s.style}
    onPointerDown=${down} onKeyDown=${key} onKeyUp=${keyup} onBlur=${keyup} onDblClick=${dbl}></div>`;
}
