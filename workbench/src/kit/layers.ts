// The overlay layers (popovers, menus, tooltips): one stack. Escape closes the top one (the focus back to its opener);
// a press outside the top one closes it, except a press on its anchor (the anchor is its toggle). As the editor's
// kit (app/src/design/ui/layers.js), smaller: no modal tiers (the workbench has no dialogs).
/** An overlay on the stack: its element, its anchor (a press on it is its toggle), where the focus goes back. */
export type Layer = { el: Element; anchor?: { contains(n: Node | null): boolean } | null; returnFocus?: { focus(o?: FocusOptions): void } | null; onDismiss?: (reason: 'outside' | 'escape') => void };
const stack: Layer[] = [];
let installed = false, lastInput: 'key' | 'pointer' = 'pointer';
/** How the last input came: 'key' or 'pointer' (a focus a menu gives on opening is keyboard focus only after a key). */
export const modality = (): 'key' | 'pointer' => lastInput;
function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', () => { lastInput = 'key'; }, true);
  document.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  document.addEventListener('pointerdown', (e) => {
    const top = stack.at(-1);
    if (!top || top.el.contains(e.target as Node) || top.anchor?.contains?.(e.target as Node)) return;
    top.onDismiss?.('outside');
  }, true);
  document.addEventListener('keydown', (e) => {
    const top = stack.at(-1);
    if (!top || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault(); e.stopPropagation();
    top.onDismiss?.('escape');
    top.returnFocus?.focus?.({ preventScroll: true });
  }, true);
}
/** { el, anchor?, returnFocus?, onDismiss(reason) } → { remove() } */
export function pushLayer(layer: Layer): { remove(): void } {
  install();
  stack.push(layer);
  return { remove() { const i = stack.indexOf(layer); if (i >= 0) stack.splice(i, 1); } };
}
if (typeof document !== 'undefined') install();
export const openLayers = (): number => stack.length;
