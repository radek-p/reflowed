// The box a floating thing anchored in a document may use: a popover, a card or a menu anchored
// at a node in a document view is placed inside that view, below the glass of its strip and the window bar (its
// scroll padding), never over a neighbouring group, the bar or a side column. Anchored anywhere else (the bar, a tab,
// a side panel): the window, its visible part (above an on-screen keyboard: workbench/src/viewport.ts visibleBox).
//
//   viewBox(node) -> { left, top, right, bottom }   (viewport px)
import { visibleBox } from '../../../../workbench/src/viewport.ts';
export interface Box { left: number; top: number; right: number; bottom: number }

/** the document view a node is in: its pane, the scroller with the glass inset */
const viewOf = (node: Element | null | undefined): HTMLElement | null => (node?.closest?.('main[data-pane]') as HTMLElement | null) ?? null;

export function viewBox(node: Element | null | undefined): Box {
  const v = viewOf(node);
  const seen = visibleBox();
  if (!v) return { left: 0, top: seen.top, right: innerWidth, bottom: seen.bottom };
  const r = v.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(v).scrollPaddingTop) || 0;
  return { left: Math.max(0, r.left), top: Math.max(0, r.top + inset), right: Math.min(innerWidth, r.right), bottom: Math.min(seen.bottom, r.bottom) };
}
