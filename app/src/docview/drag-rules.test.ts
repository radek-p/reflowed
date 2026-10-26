// The block drag's rules (docview/drag-rules.ts): which pane a drop goes to, the autoscroll's speed and its dwell, the places
// offered, where a cancelled drag's preview goes.
//   node app/src/docview/drag-rules.test.ts      (Node; exit 1 on a failure)
import { paneUnder, edgeSpeed, dwell, inBand, landing, EDGE, MAX_SPEED, DWELL, RAMP, type Band } from './drag-rules.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || d === '' ? '' : ` — ${JSON.stringify(d)}`}`); };

// ── the target pane ──
// two panes of this document side by side, below a 88 px glass strip; a side column left of them
const el = (name: string) => ({ name }) as unknown as Element;
const A = el('a-text'), B = el('b-text'), SIDE = el('side'), OTHER = el('other-doc'), STRIP = el('strip');
const owner = new Map<Element, string>([[A, 'a'], [B, 'b']]);
const bands: Record<string, Band> = { a: { left: 256, top: 88, right: 928, bottom: 900 }, b: { left: 928, top: 88, right: 1600, bottom: 900 } };
const o = (hit: Element | null) => ({ hit, paneOf: (e: Element) => owner.get(e) ?? null, bandOf: (p: string) => bands[p] ?? null });
check('a point on pane A\'s text: pane A', paneUnder(500, 400, o(A)) === 'a');
check('a point on pane B\'s text: pane B', paneUnder(1200, 400, o(B)) === 'b');
check('a side column: no pane', paneUnder(100, 400, o(SIDE)) === null);
check('another document\'s pane: no pane (its element is not this document\'s)', paneUnder(1200, 400, o(OTHER)) === null);
check('the tab strip over a pane: no pane', paneUnder(500, 60, o(STRIP)) === null);
check('a pane\'s own element under its glass (above its band): no pane', paneUnder(500, 60, o(A)) === null);
check('nothing under the point (outside the window): no pane', paneUnder(-5, 400, o(null)) === null);
// one pane alone is not "the" pane: a point outside it (the rule removed: one pane took every point)
const one = (hit: Element | null) => ({ hit, paneOf: (e: Element) => (e === A ? 'a' : null), bandOf: () => bands.a! });
check('one pane: a point on another document beside it is no pane', paneUnder(1200, 400, one(OTHER)) === null);
check('one pane: a point on it is that pane', paneUnder(400, 400, one(A)) === 'a');

// ── the autoscroll's speed ──
const T = 88, Bo = 900;
check('the middle of the band does not scroll', edgeSpeed(500, T, Bo) === 0);
check('at the zone\'s inner edge: still 0', edgeSpeed(T + EDGE, T, Bo) === 0 && edgeSpeed(Bo - EDGE, T, Bo) === 0);
check('near the top: up (negative), near the bottom: down', edgeSpeed(T + 10, T, Bo) < 0 && edgeSpeed(Bo - 10, T, Bo) > 0);
check('at the edge: the full speed', edgeSpeed(T, T, Bo) === -MAX_SPEED && edgeSpeed(Bo, T, Bo) === MAX_SPEED);
{
  const s = [60, 48, 32, 16, 4, 0].map((d) => edgeSpeed(Bo - d, T, Bo));
  check('the speed grows with the depth into the zone, smoothly (no step)', s.every((v, i) => i === 0 || v > s[i - 1]!) && s[0]! < MAX_SPEED * 0.01, s);
  check('symmetric at both edges', [4, 20, 40].every((d) => edgeSpeed(T + d, T, Bo) === -edgeSpeed(Bo - d, T, Bo)));
}
check('outside the band: 0 (over the glass, below the pane)', edgeSpeed(T - 5, T, Bo) === 0 && edgeSpeed(Bo + 5, T, Bo) === 0);
check('a short band: the zones shrink, its middle never scrolls', edgeSpeed(150, 100, 200) === 0 && edgeSpeed(102, 100, 200) < 0 && edgeSpeed(126, 100, 200) === 0);

// ── the dwell: a zone crossed on the way to another pane scrolls nothing ──
check('a pointer that just came into an edge zone: no speed yet', dwell(0) === 0 && dwell(120) === 0 && dwell(DWELL) === 0);
check('held there: the speed comes in gradually, then all of it', dwell(DWELL + RAMP / 2) > 0.4 && dwell(DWELL + RAMP / 2) < 0.6 && dwell(DWELL + RAMP) === 1 && dwell(5000) === 1);
{
  const s = [0, 100, 200, 260, 320, 380, 440, 500, 600].map(dwell);
  check('the dwell never goes back while the pointer stays', s.every((v, i) => i === 0 || v >= s[i - 1]!), s);
}

// ── the places offered: the ones the reader sees ──
check('a place inside the band is offered, one under the glass is not', inBand(400, bands.a!) && !inBand(60, bands.a!) && !inBand(905, bands.a!));

// ── a cancelled drag's preview ──
check('the block in view: the preview flies back', landing({ top: 300, bottom: 400 }, bands.a!) === 'fly');
check('the block partly in view: flies back', landing({ top: 850, bottom: 1000 }, bands.a!) === 'fly');
check('the block scrolled out of view (autoscrolled away): the preview fades', landing({ top: -900, bottom: -800 }, bands.a!) === 'fade' && landing({ top: 2000, bottom: 2100 }, bands.a!) === 'fade');
check('the block under the glass only: fades', landing({ top: 20, bottom: 80 }, bands.a!) === 'fade');
check('no block drawn (or no pane): fades', landing(null, bands.a!) === 'fade' && landing({ top: 300, bottom: 400 }, null) === 'fade');

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
