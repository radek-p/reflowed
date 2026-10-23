// Tab stops: a list of numbered entries at nesting depths (a table of contents: the section menu, the editor's
// Outline panel) lined up on one tab stop per depth. Its CSS is the kit's (kit/css.ts, "tab stops"); no JS measures.
//   .wb-ts                 the list: a grid, columns [pad] n0 [gap] n1 [gap] n2 [gap] n3 [gap] name [pad]
//   .wb-ts-sub             a row, and any box between it and its cells (a gridcell, a button): a subgrid of the list
//   data-ts-depth="0…3"    on a row: its depth (tsDepth(d): clamped)
//   <TabMark num class?>   the row's number, right-aligned to end at its depth's tab (.wb-ts-num), or, with no number,
//                          a bullet in its place (.wb-ts-bul): the depth reads from the mark
//   .wb-ts-name            the name: from its depth's tab to the end, ellipsised there
//   .wb-ts-main            a row's main control (or the cell holding it), in the row's first grid row
//   .wb-ts-acts            a row's buttons, at its right: no room of their own, they overlay the end of the name while
//                          shown (the list says when: hover, focus); the name then ellipsises before them. On the row:
//                          --wb-ts-acts, how many (each --wb-btn-h wide)
// Each number column is as wide as its depth's widest number (the grid sizes it), so all names of a depth start at
// one x, and depth d+1's numbers start at depth d's name tab.
import { html } from '../html.ts';
import { cx } from './popover.ts';

/** the depths the columns hold (a deeper row takes the last) */
export const TS_DEPTHS = 4;
export const tsDepth = (d = 0): string => String(Math.max(0, Math.min(TS_DEPTHS - 1, Math.floor(d))));
/** a row's number, or a bullet where it has none */
export function TabMark({ num, class: c = '' }: { num?: string | null; class?: string }) {
  return num ? html`<span class=${cx('wb-ts-num', c)}>${num}</span>` : html`<span class="wb-ts-bul" aria-hidden="true"></span>`;
}
