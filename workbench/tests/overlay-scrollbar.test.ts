// The workbench's own overlay scrollbar: the thumb's geometry (pure). The bar in a browser: tests/e2e/looks.ts.
//   node --test workbench/tests/overlay-scrollbar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbGeometry, scrollPerPixel, pageDirection, MIN_THUMB } from '../src/overlay-scrollbar.ts';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('nothing to scroll (or no track): no thumb', () => {
  assert.equal(thumbGeometry(500, 600, 600, 0), null);
  assert.equal(thumbGeometry(500, 600, 600.5, 0), null);     // less than a pixel
  assert.equal(thumbGeometry(500, 600, 400, 0), null);
  assert.equal(thumbGeometry(0, 600, 1200, 0), null);
  assert.equal(thumbGeometry(500, 0, 1200, 0), null);
});

test('the thumb is the visible fraction of the track, placed by the scroll\'s fraction of the room left', () => {
  // a 600 px view over 1200 px of content, its track 540 px (the header's 60 px taken off)
  const top = thumbGeometry(540, 600, 1200, 0)!, mid = thumbGeometry(540, 600, 1200, 300)!, end = thumbGeometry(540, 600, 1200, 600)!;
  assert.ok(near(top.size, 270) && near(top.offset, 0), JSON.stringify(top));
  assert.ok(near(mid.size, 270) && near(mid.offset, 135), JSON.stringify(mid));
  assert.ok(near(end.offset, 270) && near(end.offset + end.size, 540), JSON.stringify(end));
});

test('a long document: the thumb keeps its least length and still spans the track end to end', () => {
  const t0 = thumbGeometry(500, 600, 600_000, 0)!, t1 = thumbGeometry(500, 600, 600_000, 599_400)!;
  assert.equal(t0.size, MIN_THUMB);
  assert.ok(near(t1.offset + t1.size, 500));
  // a track shorter than the least length: the thumb fills it, never past it
  const short = thumbGeometry(16, 600, 6000, 100)!;
  assert.ok(near(short.size, 16) && near(short.offset, 0), JSON.stringify(short));
});

test('overscroll (a rubber band) never puts the thumb past its track', () => {
  assert.ok(near(thumbGeometry(540, 600, 1200, -80)!.offset, 0));
  const t = thumbGeometry(540, 600, 1200, 700)!;
  assert.ok(near(t.offset + t.size, 540));
});

test('a drag: the thumb follows the pointer exactly (scroll per pixel), none when the thumb fills its track', () => {
  const k = scrollPerPixel(540, 600, 1200);
  assert.ok(near(k, 600 / 270));
  // dragging the thumb by d px moves it by d px on the track
  const d = 37, a = thumbGeometry(540, 600, 1200, 100)!, b = thumbGeometry(540, 600, 1200, 100 + d * k)!;
  assert.ok(near(b.offset - a.offset, d, 1e-6));
  assert.equal(scrollPerPixel(16, 600, 6000), 0);
  assert.equal(scrollPerPixel(540, 600, 600), 0);
});

test('a press on the track pages towards it; on the thumb it does not', () => {
  const t = { size: 100, offset: 200 };
  assert.equal(pageDirection(50, t), -1);
  assert.equal(pageDirection(250, t), 0);
  assert.equal(pageDirection(200, t), 0);
  assert.equal(pageDirection(300, t), 0);
  assert.equal(pageDirection(301, t), 1);
});
