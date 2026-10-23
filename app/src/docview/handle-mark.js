// What the handle moves: while a block's drag handle (.g-handle) is hovered or focused, the block it
// belongs to is marked (.handle-mark: the selection's background, softer; app.css). A container has
// no row: its paragraphs are marked, in the pane of the handle. Background and box-shadow only, no layout.
// One delegated set of listeners on the document, installed once (mountBlockShell calls it): it holds no editor's
// state (only the handle under the pointer or the focus, and what it marked), so every editor on the page shares it.
let installed = false;
let hovered = null, focused = null;
const marked = new Set();

/** the elements a handle marks: its block, or a container's paragraphs (nested ones too) in the same list */
function targets(handle) {
  const blk = handle?.closest('.blk');
  if (!blk) return [];
  if (!blk.classList.contains('nest-head')) return [blk];
  const col = blk.parentElement, out = [], ids = new Set([blk.dataset.id]);
  for (const el of col ? col.querySelectorAll(':scope > .blk.nest-child') : []) {
    if (ids.has(el.dataset.parent)) { ids.add(el.dataset.id); if (!el.classList.contains('nest-head')) out.push(el); }
  }
  return out;
}

function update() {
  const want = new Set([...targets(hovered), ...targets(focused)]);
  for (const el of marked) if (!want.has(el)) { el.classList.remove('handle-mark'); marked.delete(el); }
  for (const el of want) { el.classList.add('handle-mark'); marked.add(el); }
}

const handleOf = (t) => (t instanceof Element ? t.closest('.g-handle') : null);

export function installHandleMark() {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerover', (e) => {
    const h = handleOf(e.target);
    if (h && h !== hovered) { hovered = h; update(); }
  });
  document.addEventListener('pointerout', (e) => {
    const h = handleOf(e.target);
    if (h && h === hovered && handleOf(e.relatedTarget) !== h) { hovered = null; update(); }
  });
  document.addEventListener('focusin', (e) => {
    const h = handleOf(e.target);
    if (h !== focused) { focused = h; update(); }
  });
  document.addEventListener('focusout', (e) => {
    if (handleOf(e.target) && handleOf(e.relatedTarget) !== focused) { focused = null; update(); }
  });
}
