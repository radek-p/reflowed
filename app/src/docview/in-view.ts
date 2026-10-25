// THE SECTION IN VIEW of a pane, from where its headings are: the one rule the crumbs and the Outline's active row
// share (docview/pane-bar.js measures the headings and keeps the answer as the pane's section, panes/pane-state.js;
// the crumbs and the Outline draw that signal). Pure: positions in, an outline index out.
//
//   sectionInView({ tops, line, target }) -> k (an index into tops), -1: no heading shown
//     tops    each outline item's heading top in viewport px, in document order; null: not shown in the pane
//     line    the reading line: the last heading at or above it is the section read. Every heading can reach it, the
//             last ones too: below the document's end each pane has one pane height of empty space (app.css, wb/css.ts)
//     target  a jump's target (the Outline's click, a section menu's row): k, and its heading's top where the jump
//             left it (null: the jump is still going). It is the section in view until the reader scrolls (its heading
//             moved): while a far jump glides past the headings before it, and where it lands, under the pane's top,
//             with a heading close below it (a section's first subsection) already at the line
// Before the first heading at the line: the first heading shown.
export interface InView {
  tops: readonly (number | null)[];
  line: number;
  target?: { k: number; top: number | null } | null;
}

/** how far a target's heading may move (sub-pixel layout, a rounding) before the reader is taken to have scrolled */
const MOVED = 1.5;

export function sectionInView({ tops, line, target = null }: InView): number {
  const t = target ? tops[target.k] : null;
  if (target && t != null && (target.top == null || Math.abs(t - target.top) <= MOVED)) return target.k;
  let cur = -1, first = -1;
  for (let k = 0; k < tops.length; k++) {
    const top = tops[k];
    if (top == null) continue;
    if (first < 0) first = k;
    if (top <= line) cur = k; else break;
  }
  return cur >= 0 ? cur : first;
}
