// ownViewport(): the scroll guard, the fit to the visible part (the on-screen keyboard) and a pinch zoom (Safari).
// A stub window and document, frames pumped by hand.
//   node --test workbench/tests/viewport.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownViewport, VIEWPORT_CSS, visibleBox, onVisible } from '../src/viewport.ts';

type Fn = (...a: unknown[]) => void;
function stub({ scale = 1, height = 800, inner = 800, headStyle = false } = {}) {
  const on = new Map<string, Set<Fn>>();
  const add = (t: string, f: Fn) => { if (!on.has(t)) on.set(t, new Set()); on.get(t)!.add(f); };
  const props: Record<string, string> = {};
  const el = () => ({ scrollTop: 0, scrollLeft: 0 });
  const vvOn = new Map<string, Set<Fn>>();
  const vv = { scale, height, offsetTop: 0,
    addEventListener: (t: string, f: Fn) => { if (!vvOn.has(t)) vvOn.set(t, new Set()); vvOn.get(t)!.add(f); },
    removeEventListener: (t: string, f: Fn) => vvOn.get(t)?.delete(f) };
  let frames: FrameRequestCallback[] = [];
  const win: any = { scrollX: 0, scrollY: 0, innerHeight: inner, visualViewport: vv,
    requestAnimationFrame: (f: FrameRequestCallback) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => { frames = []; },
    scrollTo(x: number, y: number) { win.scrollX = x; win.scrollY = y; }, addEventListener: add, removeEventListener: (t: string, f: Fn) => on.get(t)?.delete(f) };
  const html = { ...el(), clientHeight: inner, style: {} };
  const body = { ...el(), style: { setProperty: (k: string, v: string) => { props[k] = v; }, removeProperty: (k: string) => { delete props[k]; }, getPropertyValue: (k: string) => props[k] ?? '' },
    classList: { add: (c: string) => { props['.' + c] = 'on'; }, remove: (c: string) => { delete props['.' + c]; } } };
  const styles: any[] = headStyle ? [{ id: 'wb-viewport-css', textContent: 'static', removed: false, remove() { this.removed = true; } }] : [];
  const doc: any = { defaultView: win, documentElement: html, body, head: { append(e: any) { styles.push(e); } },
    createElement: () => ({ removed: false, remove() { this.removed = true; } }), getElementById: (id: string) => styles.find((e) => e.id === id && !e.removed) ?? null,
    addEventListener: add, removeEventListener: (t: string, f: Fn) => on.get(t)?.delete(f) };
  doc.scrollingElement = html;
  /** run the frames queued so far (n rounds) */
  const pump = (n = 4) => { for (let k = 0; k < n; k++) { const fs = frames; frames = []; fs.forEach((f) => f(0)); } };
  return { win, doc, vv, props, styles, pump, pending: () => frames.length,
    fire: (t: string) => on.get(t)?.forEach((f) => f({ target: doc })), vvFire: (t: string) => vvOn.get(t)?.forEach((f) => f()) };
}

test('at rest: a page scroll is put back; nothing is written on <body> (nothing restyles)', () => {
  const s = stub();
  const off = ownViewport(s.doc);
  assert.deepEqual(s.props, {});
  assert.deepEqual(visibleBox(), { top: 0, bottom: 800 });
  s.win.scrollY = 40; s.doc.scrollingElement.scrollTop = 40; s.fire('scroll');
  assert.equal(s.win.scrollY, 0); assert.equal(s.doc.scrollingElement.scrollTop, 0);
  off();
});

test('the keyboard (the visual viewport shrinks, the layout viewport does not): <body> fitted to it once it settles, listeners in phase order', () => {
  const s = stub();
  const off = ownViewport(s.doc);
  const seen: string[] = [];
  const a = onVisible((b) => seen.push(`reveal ${b.top}-${b.bottom}`), { phase: 'reveal' });
  const b = onVisible((b) => seen.push(`layout ${b.top}-${b.bottom}`));
  // Android: the keyboard's animation, a resize each frame
  for (const h of [760, 700, 620, 520]) { s.vv.height = h; s.vvFire('resize'); s.pump(1); }
  assert.deepEqual(s.props, {}, 'nothing applied while it moves');
  assert.deepEqual(seen, []);
  s.pump();                                           // two frames agree: applied once
  assert.deepEqual(s.props, { '--wb-vtop': '0px', '--wb-vh': '520px', '.wb-fitted': 'on' });
  assert.deepEqual(seen, ['layout 0-520', 'reveal 0-520'], 'the layout phase first, then the reveal phase');
  assert.deepEqual(visibleBox(), { top: 0, bottom: 520 });
  assert.equal(off.fits, 1);
  // a no-op: the same box reported again moves nothing
  s.vvFire('resize'); s.vvFire('scroll'); s.pump();
  assert.equal(seen.length, 2); assert.equal(off.fits, 1);
  // iOS: the visual viewport panned (offsetTop) with the keyboard up
  s.vv.offsetTop = 120; s.vvFire('scroll'); s.pump();
  assert.deepEqual(s.props, { '--wb-vtop': '120px', '--wb-vh': '520px', '.wb-fitted': 'on' });
  assert.deepEqual(visibleBox(), { top: 120, bottom: 640 });
  // the keyboard goes down: everything removed, the box is the window again
  s.vv.height = 800; s.vv.offsetTop = 0; s.vvFire('resize'); s.pump();
  assert.deepEqual(s.props, {});
  assert.deepEqual(visibleBox(), { top: 0, bottom: 800 });
  assert.deepEqual(seen.slice(-2), ['layout 0-800', 'reveal 0-800']);
  a(); b(); off();
});

test('a layout viewport that resizes itself (Android resizes-content): no fit, the box follows and listeners are told', () => {
  const s = stub();
  const off = ownViewport(s.doc);
  const seen: number[] = [];
  const o = onVisible((b) => seen.push(b.bottom));
  s.win.innerHeight = 500; s.doc.documentElement.clientHeight = 500; s.vv.height = 500; s.fire('resize'); s.pump();
  assert.deepEqual(s.props, {});
  assert.deepEqual(seen, [500]);
  o(); off();
});

test('pinch-zoomed (scale 2): no scroll reset (panning, zooming out) and no fit', () => {
  const s = stub();
  const off = ownViewport(s.doc);
  s.vv.scale = 2; s.vv.height = 400; s.vvFire('resize'); s.pump();   // the pinch halves the visual viewport
  assert.deepEqual(s.props, {}, 'a pinch never fits the layout to the zoomed area');
  s.win.scrollX = 300; s.win.scrollY = 200; s.fire('scroll');
  assert.deepEqual([s.win.scrollX, s.win.scrollY], [300, 200], 'Safari pans: left alone');
  assert.equal(off.resets, 0);
  s.vv.scale = 1; s.vv.height = 800; s.vvFire('resize'); s.pump();   // zoomed back out: the leftover scroll is put back
  assert.deepEqual([s.win.scrollX, s.win.scrollY], [0, 0]);
  assert.deepEqual(s.props, {});
  off();
});

test('a reload while Safari restores a pinch: nothing taken from it; at scale 1 the normal layout', () => {
  const z = stub({ scale: 2, height: 400 });
  const off = ownViewport(z.doc);
  assert.deepEqual(z.props, {}, 'not fitted to the zoomed area');
  off();
  const n = stub();
  const offN = ownViewport(n.doc);
  assert.deepEqual(n.props, {});
  offN();
});

test('off(): a fit is undone', () => {
  const s = stub();
  const off = ownViewport(s.doc);
  s.vv.height = 400; s.vvFire('resize'); s.pump();
  assert.equal(s.props['--wb-vh'], '400px');
  off();
  assert.deepEqual(s.props, {});
});

test('the viewport CSS: added when the page has none, adopted (not duplicated, not removed) when its head has it; body sized by the fit', () => {
  assert.match(VIEWPORT_CSS, /body \{[^}]*top: var\(--wb-vtop, 0px\); height: var\(--wb-vh, 100dvh\)/);
  const a = stub();
  const offA = ownViewport(a.doc);
  assert.equal(a.styles.length, 1); assert.equal(a.styles[0].textContent, VIEWPORT_CSS); assert.equal(a.styles[0].id, 'wb-viewport-css');
  offA(); assert.equal(a.styles[0].removed, true, 'off() removes the style it added');
  const h = stub({ headStyle: true });
  const offH = ownViewport(h.doc);
  assert.equal(h.styles.length, 1, 'the head\'s style is adopted: no second one');
  offH(); assert.equal(h.styles[0].removed, false, 'off() leaves the host\'s own style');
});
