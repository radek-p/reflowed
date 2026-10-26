// The block drag's rules as plain functions (docview/drag.ts uses them; drag-rules.test.ts checks them in Node).
//
//   paneUnder(x, y, { hit, paneOf, bandOf })   the pane a drop at (x, y) goes to: the pane of THIS document whose
//       element is the one under the point (hit: the topmost element there; the preview and the drop line catch no
//       pointer) and whose visible band (below its glass strip) holds the point; null anywhere else: a side column,
//       the tab strip, the window bar, another document's pane. No pane is "the" pane: one pane alone is not
//       picked for a point outside it.
//   edgeSpeed(y, top, bottom)   the autoscroll's speed (px/s; negative: up) near a band's top or bottom edge: 0 outside
//       the edge zones, growing with the square of the depth into the zone to MAX at the edge; the zones shrink
//       for a short band so the middle never scrolls.
//   dwell(ms)                   how much of that speed applies after the pointer has been in an edge zone `ms`: none
//       for DWELL ms (a pointer crossing a zone on its way to another pane, over a shared edge, scrolls nothing),
//       then rising to all of it over RAMP ms (no jolt when it starts)
//   inBand(y, band)             a drop place the reader sees (a place under the glass is never offered)
//   landing(spot, band)         where a cancelled drag's preview goes: back to the block's place when that is in its
//       pane's band ('fly'), else it fades where it is ('fade')
export interface Band { left: number; top: number; right: number; bottom: number }

export function paneUnder<P>(x: number, y: number, o: { hit: Element | null; paneOf(el: Element): P | null; bandOf(p: P): Band | null }): P | null {
  if (!o.hit) return null;
  const p = o.paneOf(o.hit);
  if (p == null) return null;
  const b = o.bandOf(p);
  return b && x >= b.left && x < b.right && y >= b.top && y < b.bottom ? p : null;
}

export const EDGE = 64;          // px: the zone at each edge that scrolls
export const MAX_SPEED = 1400;   // px/s at the edge
export function edgeSpeed(y: number, top: number, bottom: number): number {
  const zone = Math.min(EDGE, (bottom - top) / 4);
  if (zone <= 0 || y < top || y > bottom) return 0;
  const up = (top + zone - y) / zone, down = (y - (bottom - zone)) / zone;
  if (up > 0) return -MAX_SPEED * Math.min(1, up) ** 2;
  if (down > 0) return MAX_SPEED * Math.min(1, down) ** 2;
  return 0;
}

export const DWELL = 200, RAMP = 300;   // ms
export const dwell = (ms: number): number => Math.max(0, Math.min(1, (ms - DWELL) / RAMP));

export const inBand = (y: number, band: Band): boolean => y >= band.top && y <= band.bottom;

export function landing(spot: { top: number; bottom: number } | null, band: Band | null): 'fly' | 'fade' {
  return spot && band && spot.bottom > band.top && spot.top < band.bottom ? 'fly' : 'fade';
}
