// a block's wide displays keep their sideways scroll when a new result of the block replaces the
// old one (each live preview while typing, a recompile). The viewer makes a new scroller per mount: it
// started at 0, so a display the reader had panned jumped back, its fade and (macOS) scrollbar flashing.
//
//   carryDisplayScroll(fromEl, toEl)   the .latex-block mounts; displays matched by their index among the
//                                      block's top-level displays (the same block, an edit later: the same
//                                      displays in the same order, or as near as the edit leaves them)
const displaysOf = (el) => (el ? [...el.querySelectorAll('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display')) : []);

export function carryDisplayScroll(fromEl, toEl) {
  const from = displaysOf(fromEl), to = displaysOf(toEl);
  let n = 0;
  for (let i = 0; i < Math.min(from.length, to.length); i++) {
    const x = from[i].scrollLeft;
    if (x <= 0 || to[i].scrollLeft === x) continue;
    to[i].scrollLeft = x;
    // the viewer's fade cue follows scroll events; one is not sent before the next frame: set it now
    const max = to[i].scrollWidth - to[i].clientWidth;
    to[i].classList.toggle('latex-overflow-left', to[i].scrollLeft > 1);
    to[i].classList.toggle('latex-overflow-right', to[i].scrollLeft < max - 1);
    n++;
  }
  return n;
}
