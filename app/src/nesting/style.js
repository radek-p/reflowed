// the look of nested blocks (injected once; uses the kit's tokens).
// A container has no row of its own: its element is out of the flow, laid over its
// paragraphs by app.js layoutHeads (top, height), and lives in an outer gutter column left of the
// paragraphs' own + and handle: a bracket along the paragraphs, its handle at the top, a fold toggle.
// The text column and the vertical rhythm are the paper's (no header row, no added space).
const CSS = `
.blk.nest-head { position: absolute; left: 0; right: 0; margin: 0 !important; padding: 0; z-index: 2; pointer-events: none; }
.blk.nest-head > .blk-main { display: none; }
.blk.nest-head > .gutter { left: -100px; top: 4px; pointer-events: auto; }
.blk.nest-head > .gutter .g-add { display: none; }
.blk.nest-head.nest-active > .gutter, .blk.nest-head.selected > .gutter { opacity: 1; }
.blk.nest-head.selected { background: none; }
/* the bracket: a hairline [ along the paragraphs, in the outer column (hover target: its 12 px strip) */
.nest-bracket { position: absolute; left: -76px; top: 3px; bottom: 3px; width: 10px; pointer-events: auto; }
.nest-bracket::before { content: ''; position: absolute; left: 4px; top: 0; bottom: 0; width: 4px; border: 1px solid var(--ui-border); border-right: 0;
  border-radius: 3px 0 0 3px; transition: border-color var(--ui-fast) var(--ui-ease-out); }
.blk.nest-head.nest-active .nest-bracket::before, .blk.nest-head.selected .nest-bracket::before { border-color: var(--ui-border-strong); }
.blk.nest-head.selected .nest-bracket::before { border-color: var(--ui-accent-border); }
/* the fold toggle: left of the handle; shown with the handle, and always when folded (the fold mark) */
.nest-toggle { position: absolute; left: -122px; top: 6px; width: 20px; height: 20px; border: 0; padding: 0; background: none; border-radius: var(--ui-r-sm);
  color: var(--ui-ink-3); cursor: pointer; display: grid; place-items: center; pointer-events: auto; opacity: 0; transition: opacity var(--ui-fast) var(--ui-ease-out); }
.nest-toggle:hover { background: var(--ui-hover); color: var(--ui-ink); }
.nest-toggle:focus-visible { opacity: 1; box-shadow: var(--ui-ring); outline: none; }
.blk.nest-head.nest-active .nest-toggle, .blk.nest-head.selected .nest-toggle, .nest-toggle.nest-fold { opacity: 1; }
.nest-toggle.nest-fold { color: var(--ui-ink-2); }
.nest-toggle svg { transition: transform var(--ui-fast) var(--ui-ease-out); }
.nest-toggle.nest-fold svg { transform: rotate(-90deg); }
.blk.nest-head.nest-collapsed .nest-bracket { display: none; }
.blk.nest-head.editing { position: relative; pointer-events: auto; }
.blk.nest-head.editing > .blk-main { display: block; }
.blk.nest-head.editing > .nest-bracket, .blk.nest-head.editing > .nest-toggle { display: none; }
/* a child's handle: on hover of its paragraph (app.css), or with all its siblings (bracket hovered, container selected) */
.blk.nest-child.nest-show > .gutter { opacity: 1; }
.blk.nest-child.nest-selected:not(.editing) > .blk-main { background: var(--sel); border-radius: 4px; box-shadow: 0 0 0 4px var(--sel); }
/* folded: the first paragraph shows its first line */
.blk.nest-folded > .blk-main > .blk-render { max-height: var(--nest-line, 1.6em); overflow: hidden; }
.blk.nest-hidden { display: none; }
/* a dragged block: lifted (full strength, a soft shadow), above the others */
.blk.dragging.lifted { opacity: 1; z-index: 25; background: var(--bg, #fff); border-radius: 6px;
  box-shadow: 0 1px 2px rgba(15, 15, 15, 0.06), 0 6px 18px rgba(15, 15, 15, 0.12); cursor: grabbing; }
.blk.dragging.lifted > .gutter { opacity: 0 !important; }
.blk.nest-head.dragging .nest-bracket, .blk.nest-head.dragging .nest-toggle { visibility: hidden; }
#drop-line.nest-inside { border-radius: 2px; }
.rtx-editor[data-dragging] .nest-toggle { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .nest-toggle svg, .nest-toggle, .nest-bracket::before { transition: none; } }
`;

let done = false;
export function installStyle() {
  if (done || typeof document === 'undefined') return;
  done = true;
  const el = document.createElement('style');
  el.id = 'rtx-nesting-style';
  el.textContent = CSS;
  document.head.append(el);
}
