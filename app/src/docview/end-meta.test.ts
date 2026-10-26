// The end space's foot as text (docview/end-meta.ts): the title, then the words, the blocks and the day of the last edit.
//   node app/src/docview/end-meta.test.ts      (Node; exit 1 on a failure)
import { endMeta, editedOn } from './end-meta.ts';
import { shortDate } from '../home/text.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(d)}`}`); };

const NOW = new Date(2026, 9, 26, 15, 30).getTime();          // 26 Oct 2026, 15:30 (local time)
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const full = endMeta({ title: 'An Introduction to ReflowEd', words: 693, blocks: 41, edited: at(2026, 9, 26, 9) }, NOW);
check('the title, then words, blocks and the day', full.title === 'An Introduction to ReflowEd' && full.line === '693 words · 41 blocks · edited today', full);
check('thousands as the word count footer writes them', endMeta({ title: 'T', words: 12345, blocks: 1200, edited: 0 }, NOW).line === '12,345 words · 1,200 blocks');
check('one word, one block: singular', endMeta({ title: 'T', words: 1, blocks: 1, edited: 0 }, NOW).line === '1 word · 1 block');
check('no words: 0 words', endMeta({ title: 'T', words: 0, blocks: 1, edited: 0 }, NOW).line === '0 words · 1 block');
check('no title: Untitled', endMeta({ title: '  ', words: 3, blocks: 2, edited: 0 }, NOW).title === 'Untitled' && endMeta({ title: null, words: 3, blocks: 2, edited: 0 }, NOW).title === 'Untitled');
check('not counted yet: the day alone', endMeta({ title: 'T', words: null, blocks: null, edited: at(2026, 9, 25) }, NOW).line === 'edited yesterday');
check('nothing known: an empty line', endMeta({ title: 'T', words: null, blocks: undefined, edited: 0 }, NOW).line === '');
check('no document open: nothing', JSON.stringify(endMeta({ open: false, title: 'T', words: 3, blocks: 2, edited: NOW }, NOW)) === JSON.stringify({ title: '', line: '' }));

check('today: just after midnight', editedOn(at(2026, 9, 26, 0), NOW) === 'today');
check('yesterday: late in the evening', editedOn(at(2026, 9, 25, 23), NOW) === 'yesterday');
check('yesterday across a month', editedOn(at(2026, 8, 30, 20), new Date(2026, 9, 1, 8).getTime()) === 'yesterday');
check('two days ago: the date, as the Documents view writes it', editedOn(at(2026, 9, 24), NOW) === shortDate(at(2026, 9, 24), NOW) && !/\d{4}/.test(editedOn(at(2026, 9, 24), NOW)), editedOn(at(2026, 9, 24), NOW));
check('another year: the date with its year', /2025/.test(editedOn(at(2025, 11, 30), NOW)), editedOn(at(2025, 11, 30), NOW));
check('a time a little ahead of this clock (another tab\'s): today', editedOn(NOW + 5000, NOW) === 'today');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
