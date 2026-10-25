// rule.ts: one click rule for every unit (a reference, a citation, a link), the card's hint, which addresses open.
//   node app/src/refnav/rule.test.ts      (Node; exit 1 on a failure)
import { clickAction, cardHint, openable, linkTitle } from './rule.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// the click: edit by default, navigation with ⌘/Ctrl or in a card, the card where nothing can be edited
check('a plain click edits', clickAction({ mod: false, inCard: false, editable: true }) === 'edit');
check('⌘/Ctrl-click follows the unit', clickAction({ mod: true, inCard: false, editable: true }) === 'go');
check('a click in a card follows the unit', clickAction({ mod: false, inCard: true, editable: false }) === 'go');
check('a plain click in a read-only document shows the card', clickAction({ mod: false, inCard: false, editable: false }) === 'card');
check('⌘/Ctrl-click in a read-only document still follows', clickAction({ mod: true, inCard: false, editable: false }) === 'go');

// the hint: what ⌘/Ctrl-click does, and that a click edits where it does
check('hint: a reference', cardHint({ go: ' to jump', editable: true, noun: 'reference', mod: '⌘' }) === '⌘-click to jump · click to edit');
check('hint: a citation', cardHint({ go: ': the reference list', editable: true, noun: 'citation', mod: 'Ctrl' }) === 'Ctrl-click: the reference list · click to edit');
check('hint: a link', cardHint({ go: ' to open', editable: true, noun: 'link', mod: '⌘' }) === '⌘-click to open · click to edit');
check('hint: read-only leaves the edit out', cardHint({ go: ' to open', editable: false, noun: 'link', mod: '⌘' }) === '⌘-click to open');
check('hint: nowhere to go', cardHint({ go: null, editable: true, noun: 'reference', mod: '⌘' }) === 'Click to edit the reference');
check('hint: nowhere to go, read-only: none', cardHint({ go: null, editable: false, noun: 'reference', mod: '⌘' }) === '');

// which addresses open in a new tab
check('openable: https', openable('https://example.org/a?b=1#c') === 'https://example.org/a?b=1#c');
check('openable: http, spaces trimmed', openable('  http://example.org ') === 'http://example.org/');
check('openable: mailto', openable('mailto:a@b.org') === 'mailto:a@b.org');
check('openable: ftp, tel', !!openable('ftp://ftp.example.org/x') && !!openable('tel:+48123'));
check('openable: a relative address against the page', openable('app/', 'https://x.org/ed/index.html') === 'https://x.org/ed/app/', openable('app/', 'https://x.org/ed/index.html'));
check('openable: a page served from a file opens no relative address', openable('app/', 'file:///home/a/editor.html') === null);
check('openable: an absolute address ignores the base', openable('https://example.org/', 'https://x.org/') === 'https://example.org/');
for (const h of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'paper.pdf', '#sec:intro', ''])
  check(`openable: not ${JSON.stringify(h)}`, openable(h) === null, openable(h));

// a link card's title
check('title: a web address names its host', linkTitle('https://www.example.org/x') === 'Link to example.org');
check('title: an email address', linkTitle('mailto:a@c.org') === 'Email a@c.org', linkTitle('mailto:a@c.org'));
check('title: anything else', linkTitle('paper.pdf') === 'Link');

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
