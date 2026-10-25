// tex/links.ts: \url and \href in a block's source, and where the caret goes for a drawn link.
//   node app/src/tex/links.test.ts      (Node; exit 1 on a failure)
import { linkCalls, addressKey, linkCaret } from './links.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

const src = 'See \\url{https://example.org/a} and \\href{https://example.org/b}{the notes}, % \\url{https://example.org/c}\n'
  + 'or \\href[pdfnewwindow]{mailto:x@y.org}{write}; again \\url{https://example.org/a}.';
const calls = linkCalls(src);
check('every \\url and \\href outside comments, in source order', calls.map((c) => c.address).join(' ') === 'https://example.org/a https://example.org/b mailto:x@y.org https://example.org/a', calls);
check('the commands named', calls.map((c) => c.cmd).join() === 'url,href,href,url');
check('at: the address argument\'s start', calls.every((c) => src.slice(c.at, c.at + c.address.length) === c.address), calls.map((c) => src.slice(c.at, c.at + 8)));

// the caret: the index-th link to that address
const a0 = linkCaret(src, 'https://example.org/a', 0), a1 = linkCaret(src, 'https://example.org/a', 1);
check('the first \\url to an address', a0 === src.indexOf('https://example.org/a'), a0);
check('the second \\url to the same address', a1 === src.lastIndexOf('https://example.org/a'), a1);
check('\\href: in its address, not its text', linkCaret(src, 'https://example.org/b', 0) === src.indexOf('https://example.org/b'));
check('\\href with options', linkCaret(src, 'mailto:x@y.org', 0) === src.indexOf('mailto:x@y.org'));
check('an index past the calls: the first', linkCaret(src, 'https://example.org/b', 3) === src.indexOf('https://example.org/b'));
check('an address the source does not have (a generated bibliography): null', linkCaret(src, 'https://example.org/c', 0) === null);

// addresses as compared: TeX's escapes and percent-escapes
check('addressKey: \\# \\% \\& \\_ \\~ read as characters', addressKey('https://x.org/a\\_b\\~c?d=1\\&e=2\\#f') === 'https://x.org/a_b~c?d=1&e=2#f', addressKey('https://x.org/a\\_b\\~c?d=1\\&e=2\\#f'));
check('addressKey: percent-escapes decoded', addressKey('https://x.org/a%20b') === addressKey('https://x.org/a b'));
check('the caret for an escaped address', linkCaret('\\href{https://x.org/a\\_b}{t}', 'https://x.org/a_b', 0) === 6);

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
