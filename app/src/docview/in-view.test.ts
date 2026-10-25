// The section in view of a pane (docview/in-view.ts): the rule the crumbs and the Outline's active row share. A
// click on one of the last sections ends at the end of the scroll, where the reading line names a later heading: the
// Outline marked "3 Functors…", the crumb said "References" and the clicked heading was the target. The target
// stands until the reader scrolls.
//   node app/src/docview/in-view.test.ts      (Node; exit 1 on a failure)
import { sectionInView } from './in-view.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };

// headings: 0 Abstract, 1 Intro, 2 Prelims, 3 Functors, 4 A Omitted proofs, 5 References (viewport tops)
const LINE = 120, END = 852;
check('the last heading at or above the reading line', sectionInView({ tops: [-900, -400, 60, 300, 700, 820], line: LINE }) === 2);
check('a heading exactly at the line is the one read', sectionInView({ tops: [-900, 120, 300], line: LINE }) === 1);
check('before the first heading: the first one shown', sectionInView({ tops: [null, 400, 900], line: LINE }) === 1);
check('no heading shown: none', sectionInView({ tops: [null, null], line: LINE }) === -1);
check('a heading not shown (hidden) is skipped', sectionInView({ tops: [-100, null, 80, 500], line: LINE }) === 2);
check('at the end of the scroll: the last heading above the bottom line', sectionInView({ tops: [-2000, -1500, -900, 300, 560, 780], line: LINE, atEnd: true, end: END }) === 5);

// the bug: a jump to "A Omitted proofs" cannot bring it to the top (the page ends); it stands where the jump left it
const atEnd = { tops: [-2000, -1500, -900, 30, 560, 780], line: LINE, atEnd: true, end: END };
check('a jump\'s target is the section in view while the jump goes on', sectionInView({ ...atEnd, target: { k: 4, top: null } }) === 4);
check('a jump\'s target stands where the jump left it, at the end of the scroll', sectionInView({ ...atEnd, target: { k: 4, top: 560 } }) === 4);
check('a sub-pixel shift is not the reader scrolling', sectionInView({ ...atEnd, tops: [-2000, -1500, -900, 30, 560.6, 780], target: { k: 4, top: 560 } }) === 4);
check('the reader scrolled (its heading moved): the line\'s rule again', sectionInView({ tops: [-1900, -1400, -800, 100, 630, 850], line: LINE, target: { k: 4, top: 560 } }) === 3);
check('the target not shown any more: the line\'s rule', sectionInView({ tops: [-900, -400, 60, 300, null, 820], line: LINE, target: { k: 4, top: 560 } }) === 2);
check('a jump in the middle: the target at the top is the line\'s answer too', sectionInView({ tops: [-900, -400, 72, 600, 1400, 2000], line: LINE, target: { k: 2, top: 72 } }) === 2);

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
