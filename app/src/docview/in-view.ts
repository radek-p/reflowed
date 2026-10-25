// THE SECTION IN VIEW of a pane, from where its headings are: the one rule the crumbs and the Outline's active row
// share (docview/pane-bar.js measures the headings and keeps the answer as the pane's section, panes/pane-state.js;
// the crumbs and the Outline draw that signal). Pure: positions in, an outline index out.
//
//   sectionInView({ tops, line, atEnd, end, target }) -> k (an index into tops), -1: no heading shown
//     tops    each outline item's heading top in viewport px, in document order; null: not shown in the pane
//     line    the reading line: the last heading at or above it is the section read
//     atEnd   the pane cannot scroll further down: the line is `end` (near the pane's bottom) instead, so the last
//             sections, which never reach the top, can be in view
//     target  a jump's target (the Outline's click, a section menu's row): k, and its heading's top where the jump
//             left it (null: the jump is still going). It is the section in view until the reader scrolls (its heading
//             moved): a jump to one of the last sections ends at the end of the scroll, where the line would name a
//             later one
// Before the first heading at the line: the first heading shown.
export interface InView {
  tops: readonly (number | null)[];
  line: number;
  atEnd?: boolean;
  end?: number;
  target?: { k: number; top: number | null } | null;
}

/** how far a target's heading may move (sub-pixel layout, a rounding) before the reader is taken to have scrolled */
const MOVED = 1.5;

export function sectionInView({ tops, line, atEnd = false, end = line, target = null }: InView): number {
  const t = target ? tops[target.k] : null;
  if (target && t != null && (target.top == null || Math.abs(t - target.top) <= MOVED)) return target.k;
  const y = atEnd ? end : line;
  let cur = -1, first = -1;
  for (let k = 0; k < tops.length; k++) {
    const top = tops[k];
    if (top == null) continue;
    if (first < 0) first = k;
    if (top <= y) cur = k; else break;
  }
  return cur >= 0 ? cur : first;
}
