// DRAGGING A BLOCK BY ITS HANDLE, in a pane and between the panes of its document (out of app.js dragging()).
//
// Past the threshold the block (a container with its paragraphs) stays where it is, dimmed in every pane
// (.dragging), and its PREVIEW (docview/drag-preview.ts: a copy of the block as its pane draws it, fading out from
// its upper left) follows the pointer in the drag's layer on <body>, above the workbench: across panes, splitters
// and side columns, the point grabbed under the pointer. The DROP LINE is drawn in the pane under the pointer
// (drag-rules.ts paneUnder: a pane of THIS document, the point inside its band below the glass), at the place
// nearest the pointer among that pane's places the reader sees (nesting/app.js dragTargets, from that pane's
// elements: between blocks, inside a container where the pointer is indented); the block's own place shows none.
// Near the band's top or bottom edge that pane scrolls (drag-rules.ts edgeSpeed, once a frame), once the pointer has
// stayed there a moment (dwell: crossing a zone on the way to another pane scrolls nothing), and the line keeps up:
// any scroll during the drag (a wheel too) places it again.
// A release on a line moves the block there (one document's order: every pane shows it); every pane keeps its
// reading point (its topmost row in view that is not the block's; in the drop pane, when the place is above it, the
// dropped block at the line), scrolled for what changed above it; then every row of every pane glides from
// where it was drawn to its new place, the dropped block in the drop pane from where its preview was
// (nesting/drag-motion.ts). A release with no line (the block's own place, a side column, the tab strip, the
// bar, another document's pane), Escape, a lost pointer or a blur cancel: nothing changes, and the preview glides
// back onto the block (fades where it is when the block is out of its pane's view). The cursor says which: grabbing,
// or no-drop where a release cancels; it is the handle's, which holds the pointer (one element restyled, not the page).
// Nothing the drag set survives it: the dimming, the cursor, the root's hold and the layer (line and preview) go
// when it ends (a cancelled drag's once its preview has landed; a new press finishes that landing first); the glide
// clears the rows' transforms. Per move only transforms are written (the preview's, the line's); the places are
// read once a frame, before anything is written.
//
//   const drag = createBlockDrag(host)
//   host: { root, nest, leaveAll(), openMenu(handle, id), panes() -> the panes' ids, paneOf(el) -> pane | null,
//           box(pane) -> its .blocks, scroller(pane) -> element | null (the window), elementIn(pane, id),
//           hold(pane, dy) (a correction scroll its keeper holds from) }
//   drag.attach(handle, id) -> detach() · drag.settled() (the last drag's glide or landing)
// every pane's handles the same (a pane's view of the block: panes/block-view.js, its detach on dispose);
// the line and the preview are in one kit layer (design/ui/layers.js openLayer) for the drag's lifetime, the line
// over the preview (the place is never hidden under the block that goes there).
import { snapshot, glide, type Spot } from '../nesting/drag-motion.ts';
import { html } from '../design/ui/core.js';
import { openLayer } from '../design/ui/layers.js';
import { viewBox } from '../design/ui/view-box.ts';
import { pointerSession } from '../../../workbench/src/drag.ts';
import { createPreview, type Preview } from './drag-preview.ts';
import { paneUnder, edgeSpeed, dwell, inBand, landing, type Band } from './drag-rules.ts';
import type { EditorRoot } from '../app/editor-root.ts';

/** a place a dragged block can land (nesting/app.js dragTargets): its line's y (client px), where it goes */
export interface DropTarget { y: number; index: number; parentId: string | null; indent: boolean }
export interface BlockDragHost {
  root: Pick<EditorRoot, 'hold'>;
  nest: {
    unit(id: string): string[];
    dragTargets(id: string, elOf: (id: string) => HTMLElement | null): DropTarget[];
    pickTarget(targets: DropTarget[], x: number, y: number, colLeft: number): DropTarget | null;
    moves(id: string, t: DropTarget): boolean;
    drop(id: string, t: DropTarget): boolean;
  };
  leaveAll(): void;
  openMenu(handle: HTMLElement, id: string): void;
  panes(): string[];
  paneOf(el: Node): string | null;
  box(pane: string): HTMLElement | null;
  scroller(pane: string): HTMLElement | null;
  elementIn(pane: string, id: string): HTMLElement | null;
  /** scroll pane by dy as a correction for a change of the page (its keeper holds from there: panes/pane.ts scrollBy hold) */
  hold(pane: string, dy: number): void;
}
export interface BlockDrag { attach(handle: HTMLElement, id: string): () => void; settled(): Promise<unknown> }

const INDENT = 22;   // px: the line of a place inside a container starts this far in

export function createBlockDrag(host: BlockDragHost): BlockDrag {
  let settledP: Promise<unknown> = Promise.resolve();
  let finishLanding: (() => void) | null = null;       // a cancelled drag's preview still landing

  /** the band of pane `p` the reader sees (below its glass strip; client px) */
  const bandOf = (p: string): Band | null => {
    const el = host.scroller(p) ?? host.box(p);
    return el ? viewBox(el) : null;
  };
  /** the pane of this document under (x, y), or null (drag-rules.ts paneUnder) */
  const under = (x: number, y: number): string | null => paneUnder(x, y, {
    hit: document.elementFromPoint(x, y),
    paneOf: (el) => { const p = host.paneOf(el); return p && host.panes().includes(p) ? p : null; },
    bandOf,
  });

  /** a drag past the threshold: from the press `e0` on `handle` (block `id`, in pane `from`) */
  function begin(handle: HTMLElement, id: string, from: string, e0: PointerEvent) {
    const press = { x: e0.clientX, y: e0.clientY };
    const unit = host.nest.unit(id);
    const rowsIn = (p: string) => unit.map((u) => host.elementIn(p, u)).filter((r): r is HTMLElement => !!r);
    const layer = openLayer(() => html`<div class="blk-drag-layer"></div><div id="drop-line" aria-hidden="true"></div>`);
    const line = layer.el.querySelector<HTMLElement>('#drop-line')!;
    const preview: Preview | null = createPreview(rowsIn(from), layer.el.querySelector<HTMLElement>('.blk-drag-layer')!);
    const dimmed = host.panes().flatMap(rowsIn);
    for (const r of dimmed) r.classList.add('dragging');
    host.root.hold('dragging', handle, true);
    handle.style.cursor = 'grabbing';
    let pt = { ...press }, target: (DropTarget & { pane: string }) | null = null;
    let raf = 0, last = 0, rest = 0, dirty = true, ended = false;

    /** the cursor: grabbing over a pane of the document, no-drop where a release cancels */
    const cursor = (over: boolean) => { handle.style.cursor = over ? 'grabbing' : 'no-drop'; };
    /** the drop line on target `t` in a pane whose blocks' column is `col` (none: hidden) */
    let lineW = -1;
    const showLine = (t: DropTarget | null, col: DOMRect | null) => {
      if (!t || !col) { line.style.visibility = 'hidden'; return; }
      const indent = t.indent ? INDENT : 0;
      line.classList.toggle('nest-inside', t.indent);
      if (col.width - indent !== lineW) { lineW = col.width - indent; line.style.width = `${lineW}px`; }
      line.style.transform = `translate(${col.left + indent}px, ${t.y - 1}px)`;
      line.style.visibility = 'visible';
    };
    /** read the places of the pane under the pointer, then draw the line (reads first, then writes) */
    function place() {
      const p = under(pt.x, pt.y);
      const box = p ? host.box(p) : null, band = p ? bandOf(p) : null;
      if (!p || !box || !band) { target = null; showLine(null, null); cursor(false); return p; }
      const col = box.getBoundingClientRect();
      const places = host.nest.dragTargets(id, (u) => host.elementIn(p, u)).filter((t) => inBand(t.y, band));
      const t = host.nest.pickTarget(places, pt.x, pt.y, col.left);
      target = t && host.nest.moves(id, t) ? { ...t, pane: p } : null;   // its own place: no line, a release changes nothing
      showLine(target, col);
      cursor(true);
      return p;
    }
    /** once a frame: the pane under the pointer scrolls near its band's edges, once the pointer has stayed there
     *  (drag-rules.ts dwell); the line placed again when anything moved */
    let zone: { p: string; up: boolean; since: number } | null = null;
    function frame(t: number) {
      raf = 0;
      const dt = last ? Math.min(t - last, 50) : 16;
      last = t;
      const p = dirty ? place() : under(pt.x, pt.y);
      dirty = false;
      const band = p ? bandOf(p) : null;
      const edge = p && band ? edgeSpeed(pt.y, band.top, band.bottom) : 0;
      if (!edge || !p) zone = null;
      else if (zone?.p !== p || zone.up !== edge < 0) zone = { p, up: edge < 0, since: t };
      let go = !!zone;
      const v = zone ? edge * dwell(t - zone.since) : 0;
      if (v && p) {
        rest += (v * dt) / 1000;
        const step = Math.trunc(rest);
        rest -= step;
        const sc = host.scroller(p) ?? document.scrollingElement;
        if (step && sc) { const t0 = sc.scrollTop; sc.scrollTop = t0 + step; if (sc.scrollTop !== t0) place(); else go = false; }   // at its end: nothing more to do
      } else rest = 0;
      if (go && !raf) raf = requestAnimationFrame(frame); else if (!go) last = 0;
    }
    const kick = () => { dirty = true; if (!raf) raf = requestAnimationFrame(frame); };
    addEventListener('scroll', kick, { capture: true, passive: true });

    /** everything the drag set, gone (idempotent) */
    function end() {
      if (ended) return;
      ended = true;
      if (finishLanding === end) finishLanding = null;
      cancelAnimationFrame(raf);
      removeEventListener('scroll', kick, { capture: true });
      preview?.remove();
      layer.close();
      for (const r of dimmed) r.classList.remove('dragging');
      host.root.hold('dragging', handle, false);
      handle.style.cursor = '';
    }
    function move(x: number, y: number) {
      pt = { x, y };
      preview?.move(x - press.x, y - press.y);
      kick();
    }
    function drop(x: number, y: number) {
      pt = { x, y };
      cancelAnimationFrame(raf); raf = 0;
      place();                                          // the release's own place
      const t = target;
      if (!t) { cancel(); return; }
      // every row of every pane glides from where it is drawn to its new place (FLIP); the dropped block's rows in
      // the drop pane from where the preview draws them
      const before = host.panes().map((p) => { const b = host.box(p); return [p, b ? snapshot(b) : null] as const; });
      const snap = before.find(([p]) => p === t.pane)?.[1];
      if (snap && preview) for (const u of unit) { const s: Spot | null = preview.spot(u); if (s && snap.has(u)) snap.set(u, s); }
      const reading = host.panes().map((p) => readingPoint(p, t));
      end();
      host.nest.drop(id, t);
      // every pane's reading point where it was: the block left from above it, or came in above it, scrolled for
      // (as a correction of the page: the pane's keeper holds from there), before the rows glide
      for (const r of reading) {
        if (!r?.el.isConnected) continue;
        const dy = r.el.getBoundingClientRect().top - r.top;
        if (Math.abs(dy) >= 0.5) host.hold(r.p, dy);
      }
      settledP = Promise.all(before.map(([p, s]) => { const b = host.box(p); return b && s ? glide(b, s) : Promise.resolve(); }));
    }
    /** pane p's reading point before the drop on `t`: the topmost row in view (across its reading top, else the first
     *  below it) that is not the block's: what is above both changes stays; in the drop pane, when the place is above
     *  that row, the dropped block at the line */
    function readingPoint(p: string, t: DropTarget & { pane: string }): { p: string; el: HTMLElement; top: number } | null {
      const box = host.box(p), band = bandOf(p);
      if (!box || !band) return null;
      let row: { el: HTMLElement; top: number } | null = null;
      for (const el of box.children as HTMLCollectionOf<HTMLElement>) {
        if (!el.classList.contains('blk') || el.classList.contains('nest-head') || unit.includes(el.dataset.id ?? '') || !el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom > band.top) { row = { el, top: r.top }; break; }
      }
      if (p === t.pane && (!row || t.y < row.top)) { const own = host.elementIn(p, unit[0]!); return own ? { p, el: own, top: t.y } : null; }
      return row ? { p, ...row } : null;
    }
    function cancel() {
      cancelAnimationFrame(raf); raf = 0;
      removeEventListener('scroll', kick, { capture: true });
      target = null;
      showLine(null, null);
      const home = preview?.home() ?? null;
      const to = landing(home, bandOf(from)) === 'fly' ? home : null;
      finishLanding = end;
      settledP = (preview ? preview.land(to) : Promise.resolve()).then(end);
    }
    return { move, drop, cancel };
  }

  function attach(handle: HTMLElement, id: string): () => void {
    const down = (e: PointerEvent) => {
      const from = host.paneOf(handle);                 // the pane whose view the handle is in
      if (e.button !== 0 || !from) return;
      e.preventDefault();
      finishLanding?.();                                // the last drag's preview, still landing: done now
      host.leaveAll();
      let drag: ReturnType<typeof begin> | null = null;
      pointerSession(e, {
        target: handle,
        onClick: () => host.openMenu(handle, id),
        onStart: () => { drag = begin(handle, id, from, e); },
        onMove: (ev) => drag?.move(ev.clientX, ev.clientY),
        onDrop: (ev) => drag?.drop(ev.clientX, ev.clientY),
        onCancel: () => drag?.cancel(),
      });
    };
    handle.addEventListener('pointerdown', down);
    return () => handle.removeEventListener('pointerdown', down);
  }

  return { attach, settled: () => settledP };
}
