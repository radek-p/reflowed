// The tab status's progress: p = (1 − ε₂)·[k/n + (1/n)(1 − ε)(1 − 1/(1 + c·t))].
//   node --test workbench/tests/progress.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progress, gapShare, C, EPS, EPS2, MIN_GAP_PX } from '../src/progress.ts';

const near = (a: number, b: number, d = 1e-9) => assert.ok(Math.abs(a - b) <= d, `${a} ≈ ${b}`);

test('the values: k/n at t = 0, half the creep at t = 1/c, the constants', () => {
  assert.equal(C, 1 / 0.7); assert.equal(EPS, 0.15); assert.equal(EPS2, 0.07);
  near(progress(0, 10, 0), 0);
  near(progress(3, 10, 0), (1 - EPS2) * 0.3);
  near(progress(3, 10, 1 / C), (1 - EPS2) * (0.3 + 0.1 * (1 - EPS) * 0.5));
  near(progress(0, 1, 1 / C), (1 - EPS2) * (1 - EPS) * 0.5);
});

test('the creep never fills its block: below (k + 1)/n of the capped bar for every t, its gap at least ε of a block', () => {
  for (const n of [1, 2, 5, 12, 40]) for (let k = 0; k < n; k++) for (const t of [0, 0.1, 0.7, 2, 10, 1e3, 1e9]) {
    const p = progress(k, n, t), next = (1 - EPS2) * ((k + 1) / n);
    assert.ok(p < next, `k ${k} n ${n} t ${t}: ${p} < ${next}`);
    assert.ok(next - p >= (1 - EPS2) * (EPS / n) - 1e-12, `the gap at least ε of a block`);
  }
});

test('the whole bar stays short of the pill until done: p < 1 − ε₂ for every k < n and t, and k = n gives exactly 1 − ε₂', () => {
  for (const n of [1, 3, 9, 50]) for (let k = 0; k < n; k++) for (const t of [0, 1, 100, 1e12]) assert.ok(progress(k, n, t) < 1 - EPS2);
  near(progress(7, 7, 5), 1 - EPS2);
});

test('monotonic: in t for a fixed k, and across a new k (k + 1 at t = 0 is past k at any t)', () => {
  for (const n of [4, 10]) for (let k = 0; k < n; k++) {
    let last = -1;
    for (let t = 0; t < 30; t += 0.05) { const p = progress(k, n, t); assert.ok(p >= last); last = p; }
    if (k + 1 <= n) assert.ok(progress(k + 1, n, 0) > progress(k, n, 1e9));
  }
});

test('the visible gap: at least MIN_GAP_PX on a pill (narrow pills or many blocks widen ε)', () => {
  for (const [n, w] of [[10, 280], [40, 280], [100, 150], [3, 600]]) {
    const block = (w * (1 - EPS2)) / n, gap = block * gapShare(n, w);
    assert.ok(gap >= Math.min(block, MIN_GAP_PX) - 1e-9 && gapShare(n, w) >= EPS, `n ${n} w ${w}: ${gap} px`);
    const p = progress(0, n, 1e9, { width: w }) * w;
    assert.ok(block - p >= Math.min(block, MIN_GAP_PX) - 1e-9);
  }
});

test('reduced motion: steps only, no creep', () => {
  near(progress(2, 5, 0, { reduced: true }), progress(2, 5, 1e6, { reduced: true }));
  near(progress(2, 5, 3, { reduced: true }), (1 - EPS2) * 0.4);
});
