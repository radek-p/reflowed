// The section in view of a pane (docview/in-view.ts): the rule the crumbs and the Outline's active row share. One
// rule all the way down: the last heading at or above the reading line, at the end of the document too (the pane's
// end space lets every heading reach the line); a jump's target stands until the reader scrolls.
//   node app/src/docview/in-view.test.ts      (Node; exit 1 on a failure)
import { sectionInView } from './in-view.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };

// headings: 0 Abstract, 1 Intro, 2 Prelims, 3 Functors, 4 A Omitted proofs, 5 References (viewport tops)
const LINE = 120;
check('the last heading at or above the reading line', sectionInView({ tops: [-900, -400, 60, 300, 700, 820], line: LINE }) === 2);
check('a heading exactly at the line is the one read', sectionInView({ tops: [-900, 120, 300], line: LINE }) === 1);
check('before the first heading: the first one shown', sectionInView({ tops: [null, 400, 900], line: LINE }) === 1);
check('no heading shown: none', sectionInView({ tops: [null, null], line: LINE }) === -1);
check('a heading not shown (hidden) is skipped', sectionInView({ tops: [-100, null, 80, 500], line: LINE }) === 2);

// the end of the document: the same rule, no other line (4: the last section, section 8 of the intro; 5: References)
check('at the end of the document: the last heading at the line is the section read', sectionInView({ tops: [-2000, -1500, -900, -300, 70, 900], line: LINE }) === 4);
check('References is not the section while the last section\'s heading is above the line and References\' below it', sectionInView({ tops: [-2000, -1500, -900, -300, -150, 260], line: LINE }) === 4);
check('References is the section once its heading is at or above the line (the last section almost gone)', sectionInView({ tops: [-2000, -1500, -900, -300, -150, 118], line: LINE }) === 5);
check('the last heading at the pane\'s top, the end of the scroll: it is the section', sectionInView({ tops: [-2900, -2400, -1800, -1200, -700, 8], line: LINE }) === 5);

// a jump's target: the section in view while the jump goes on and where it lands, until the reader scrolls
check('a jump\'s target is the section in view while the jump goes on', sectionInView({ tops: [-2000, -1500, 90, 400, 900, 1300], line: LINE, target: { k: 4, top: null } }) === 4);
check('a jump\'s target stands where the jump left it (a heading close below it at the line)', sectionInView({ tops: [-2000, -1500, -900, -300, 8, 60], line: LINE, target: { k: 4, top: 8 } }) === 4);
check('a sub-pixel shift is not the reader scrolling', sectionInView({ tops: [-2000, -1500, -900, -300, 8.6, 60.6], line: LINE, target: { k: 4, top: 8 } }) === 4);
check('the reader scrolled (its heading moved): the line\'s rule again', sectionInView({ tops: [-1900, -1400, -800, 100, 630, 850], line: LINE, target: { k: 4, top: 560 } }) === 3);
check('the target not shown any more: the line\'s rule', sectionInView({ tops: [-900, -400, 60, 300, null, 820], line: LINE, target: { k: 4, top: 560 } }) === 2);
check('a jump in the middle: the target at the top is the line\'s answer too', sectionInView({ tops: [-900, -400, 72, 600, 1400, 2000], line: LINE, target: { k: 2, top: 72 } }) === 2);

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
