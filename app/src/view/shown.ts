// The typeset element a block view shows: one definition. Ten sites found it themselves, as
// "the .latex-block that is not .incoming"; none left out the widths cross-fade's ghost (a clone laid over the block
// while its new lines fade in), which is the shown one's twin during a swap.
//   shownBlock(el) -> HTMLElement | null   el: a .blk-render (its child), or anything holding one (the first render's)
const SHOWN = '.latex-block:not(.incoming):not(.rtx-w-ghost)';

export function shownBlock(el: Element | null | undefined): HTMLElement | null {
  if (!el) return null;
  return el.querySelector<HTMLElement>(`:scope > ${SHOWN}`) ?? el.querySelector<HTMLElement>(`.blk-render > ${SHOWN}`);
}
