// A click in a block's own frame just beside its render: the block's padding (8 px each side), where a
// full stop that hangs into the margin (protrusion) ends. It counts as a click on the render at that height, so
// the text editor's rule (view/edit-layout.js offsetAt: past a line's last glyph, the line's end) applies there
// too, not "nothing happens". Only the frame itself (the block's root, .blk-main), never a control in it, and
// only within the render's height and a padding's width of its sides.
export const FRAME_SLACK = 12;

export function besideRender(render, root, main, e) {
  if (!render || (e.target !== root && e.target !== main) || render.hidden) return false;
  const r = render.getBoundingClientRect();
  return r.width > 0 && e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left - FRAME_SLACK && e.clientX <= r.right + FRAME_SLACK;
}
