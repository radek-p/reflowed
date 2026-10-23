// @ts-check
// Where the editing popover goes, decided BEFORE anything is shown: the scroll that puts it in its final
// place, computed once from the layout with the editor mounted (measured, not yet painted). Pure: numbers in,
// a scroll out (test-motion-units).
//
// Coordinates are client px in the NEW layout (the editor mounted, nothing scrolled yet); the answer is dy, what
// the pane scrolls by (content moves up by dy). The rules, in order of priority:
//   1. the edited block stays where the reader saw it (base: the scroll that undoes any move of the block in the
//      new layout, e.g. another editor above it closed);
//   2. the caret's line is visible, below the top of the pane;
//   3. the popover is not over the caret's line; with a result taller than the window the popover floats
//      (sticky at the pane's bottom) and the caret is kept in the upper half (the same rule as
//      view/edit-layout.js keepCaretInView, so nothing corrects it a frame later);
//   4. the popover is whole on screen (its bottom above the pane's bottom, its top below the pane's top), and
//      the whole block with it when both fit in the pane;
//   5. the pane cannot scroll past its ends.
// A conflict between 2–3 and 4 (a block and its popover taller than the window): the caret wins.

// (mobile-chrome) the popover's shadow reaches POP_SHADOW px below it (view/style.js draws it from this: its
// largest layer's offset plus its blur), and the pane clips what is below its bottom (with a keyboard up, the frame's
// bottom: on a phone the shadow was cut). So the popover's bottom keeps that room from the pane's bottom, floating
// (style.js: sticky bottom) or in the flow, and in every place that brings it into view (edit/session.js). One value
// (was 10 floating, 16 in the flow, 8 and 10 in the session).
export const POP_SHADOW_Y = 6, POP_SHADOW_BLUR = 18;
export const POP_SHADOW = POP_SHADOW_Y + POP_SHADOW_BLUR;
export const POP_MARGIN = POP_SHADOW;   // a floating popover's bottom from the pane's bottom
export const FLOW_MARGIN = POP_SHADOW;  // a popover in the flow: its bottom from the pane's bottom
export const TOP_MARGIN = 8;    // a block shown whole: its top from the pane's top
export const CARET_TOP = 14;    // the caret's line from the pane's top
export const CARET_GAP = 8;     // the caret's line above a floating popover

/**
 * @typedef {{ top: number, bottom: number }} Span
 * @param {{
 *   box: { top: number, bottom: number, origin?: number },   the pane's visible box (origin: where its room starts)
 *   pop: Span,                     the popover's rect (in flow: below the result)
 *   render: Span,                  the result's rect
 *   caret: Span | null,            the mirrored caret's rect (null: unknown; the result's first line stands in)
 *   float: boolean,                the popover floats (sticky at the pane's bottom)
 *   base?: number,                 rule 1's scroll
 *   range: { min: number, max: number },   how far the pane can scroll each way (min <= 0 <= max)
 * }} o
 * @returns {number} dy
 */
export function place(o) {
  const { box, pop, render, float, range } = o;
  const base = o.base ?? 0;
  const origin = box.origin ?? box.top, room = box.bottom - origin;
  const caret = o.caret ?? { top: render.top, bottom: Math.min(render.bottom, render.top + 20) };
  const h = pop.bottom - pop.top;
  const gap = Math.max(0, pop.top - render.bottom);
  const clamp = (v) => Math.min(range.max, Math.max(range.min, v));
  if (float) {
    // the popover at the pane's bottom, or under the result when the result ends above that
    const popTop = (dy) => Math.min(render.bottom - dy + gap, box.bottom - POP_MARGIN - h);
    const ok = (dy) => caret.top - dy >= box.top && caret.bottom - dy <= Math.min(origin + room / 2, popTop(dy) - CARET_GAP);
    if (ok(base)) return clamp(base);
    return clamp(caret.top - (origin + room * 0.3));
  }
  // in flow: the popover under the result, both move together
  const lo = pop.bottom - (box.bottom - FLOW_MARGIN);                         // its bottom on screen
  let hi = Math.min(caret.top - (box.top + CARET_TOP), pop.top - box.top);    // the caret, and the popover's top, on screen
  if (pop.bottom - render.top + TOP_MARGIN + FLOW_MARGIN <= box.bottom - box.top) hi = Math.min(hi, render.top - (box.top + TOP_MARGIN));   // the block whole
  let dy = base;
  if (dy < lo) dy = lo;
  if (dy > hi) dy = hi;                                                        // the caret wins
  return clamp(dy);
}

export const EQUAL = 1;        // A + B and D within 1 px count as equal (heights are fractional, scrolls whole px)

/**
 * The editor closes: which part of the pane keeps its place. The heights in the pane's visible
 * area, each clipped to the pane:
 *   A  the pane's top edge to the top of the edited block's preview;
 *   B  the edited preview, the part seen above the popover (what the popover covers does not count);
 *   C  the code popover;
 *   D  the popover's bottom edge to the pane's bottom edge.
 * The popover goes and its space is filled: the top part (A + B) moves down ONLY IF A + B < D (the page scrolls so
 * that what is below the popover keeps its place); otherwise (equal too, within EQUAL px) the top stays and what is
 * below comes up.
 * Not for typing (edit/session.js holdPopover: the popover holds still).
 * @param {{ box: { top: number, bottom: number }, render: { top: number, bottom: number } | null, pop: { top: number, bottom: number } }} o
 *   render null: the block shows no preview (B = 0; A ends at the popover's top)
 * @returns {'above' | 'below'}   above: the top stays; below: what is below the popover stays
 */
export function closeAnchor({ box, render, pop }) {
  const clip = (y) => Math.min(box.bottom, Math.max(box.top, y));
  const top = render ? render.top : pop.top;
  const a = clip(top) - box.top;
  const b = render ? Math.max(0, clip(Math.min(render.bottom, pop.top)) - clip(render.top)) : 0;
  const d = box.bottom - clip(pop.bottom);
  return a + b < d - EQUAL ? 'below' : 'above';
}
