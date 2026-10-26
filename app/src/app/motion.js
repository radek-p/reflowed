// morph(box, change, { after }): change what a box shows, easing its height
// from the old value to the new one and cross-fading the content, so the page
// below glides instead of jumping. Used for render <-> editor and old render
// -> new render (app.js).
//
// Layout is read three times, never interleaved with writes: before the
// change (the old height and the old content's box), after the change and
// after() (the new height), then only writes. The old content is shown by a
// static copy (a "ghost": cloned DOM, no viewer data) laid over the new one
// and faded out. The box clips while it animates (.morphing), so nothing
// overlaps the blocks around it. The height is animated with the Web
// Animations API: the viewer's inspect.idle() waits for running animations,
// so tests settle after them.
//
// prefers-reduced-motion: reduce -> the change only (after() still runs).
//
// staticCopy(el): that copy of one element (also a dragged block's preview, docview/drag-preview.ts).
import { reduced } from '../motion/reduced.ts';

export const DURATION = 180;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/** A static copy of a render (cloned DOM): what it shows, without the viewer's data, ids or an incoming render. The
 *  morph's ghost and a dragged block's preview (docview/drag-preview.ts). */
export function staticCopy(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.incoming').forEach((e) => e.remove());
  copy.querySelectorAll('[data-nodelist-b64]').forEach((e) => e.removeAttribute('data-nodelist-b64'));
  copy.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
  copy.removeAttribute('id');
  return copy;
}

export function morph(box, change, { after = null, fade = true } = {}) {
  box._morph?.finish();
  if (reduced() || !box.isConnected || !box.getClientRects().length) { change(); after?.(); return; }
  // read: the old state
  const old = box.getBoundingClientRect();
  const shown = [...box.children].filter((c) => !c.hidden && !c.classList.contains('morph-ghost') && c.getClientRects().length);
  const boxes = shown.map((c) => c.getBoundingClientRect());
  // the ghost: a copy of what is shown now (static; viewer data stripped)
  let ghost = null;
  if (fade && shown.length) {
    ghost = document.createElement('div');
    ghost.className = 'morph-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    shown.forEach((c, i) => {
      const copy = staticCopy(c);
      copy.style.cssText += `;position:absolute;margin:0;left:${boxes[i].left - old.left}px;top:${boxes[i].top - old.top}px;width:${boxes[i].width}px;`;
      ghost.append(copy);
    });
  }
  change();
  after?.();
  // read: the new state
  const now = box.getBoundingClientRect();
  if (Math.abs(now.height - old.height) < 0.5 && !ghost) return;
  // write
  if (ghost) {
    // the copies were placed against the old box; the box may have moved (margins)
    ghost.style.left = `${old.left - now.left}px`;
    ghost.style.top = `${old.top - now.top}px`;
    box.append(ghost);
  }
  box.classList.add('morphing');
  const opts = { duration: DURATION, easing: EASING };
  const anims = [box.animate([{ height: `${old.height}px` }, { height: `${now.height}px` }], opts)];
  if (ghost) {
    anims.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, duration: DURATION * 0.7, fill: 'forwards' }));
    for (const c of box.children) if (c !== ghost && !c.hidden) anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], opts));
  }
  const done = () => {
    if (box._morph !== handle) return;
    box._morph = null;
    ghost?.remove();
    box.classList.remove('morphing');
  };
  const handle = { finish() { for (const a of anims) { try { a.finish(); } catch { /* gone */ } } done(); } };
  box._morph = handle;
  anims[0].finished.then(done, done);
}
