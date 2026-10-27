// The characters TeX could not set, read from a block's log (src/missing-chars.ts) in the public serializer's shape,
// and the public encoder's warnings made from them (missing-char), as the viewer's log gets them. Node only.
//   node engine/tests/missing-chars.test.ts      (exit 1 on a failure)
import { missingChars } from '../src/missing-chars.ts';
import { publicRepo } from '../../scripts/lib/public-repo.ts';

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (ok) pass++; else fail++;
};

const log = [
  'Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--4',
  'Missing character: There is no ł (U+0142) in font [lmroman10-regular]:mapping=tex-text;!',
  'Missing character: There is no ł (U+0142) in font [lmroman10-regular]:mapping=tex-text;!',
  'Missing character: There is no ^^c5 in font cmr10!',
  'Missing character: There is no ^^M in font cmr10!',
  'Missing character: There is no ═ (U+2550) in font "Latin Modern Roman/OT:script=latn;"!',
].join('\n');
const m = missingChars(log);
// a line TeX wrapped at max_print_line (79 characters) is read whole
const long = 'Missing character: There is no ł (U+0142) in font [lmroman10-regular]:mapping=tex-text;!';
const wrapped = missingChars(`${long.slice(0, 79)}\n${long.slice(79)}`);
check('a wrapped line read whole', wrapped.length === 1 && wrapped[0].font === 'lmroman10-regular' && wrapped[0].char === 0x142, wrapped);
check('each font and character once, counted, in the order first met',
  JSON.stringify(m.map((x) => [x.font, x.char, x.count])) === JSON.stringify([['lmroman10-regular', 0x142, 2], ['cmr10', 0xc5, 1], ['cmr10', 13, 1], ['Latin Modern Roman', 0x2550, 1]]), m);
check('no places known from the log', m.every((x) => Array.isArray(x.where) && x.where.length === 0));
check('a log with none: none', missingChars('Overfull \\hbox\nMissing number, treated as zero.').length === 0);
const { missingCharWarnings } = await import(`${publicRepo()}/src/pipeline/warnings.ts`);
const w = missingCharWarnings(m) as { code: string; message: string; details: Record<string, string> }[];
check('the public warnings: missing-char, one per font and character, with its count',
  w.length === 4 && w.every((x) => x.code === 'missing-char') && /There is no ł \(U\+0142\) in font lmroman10-regular/.test(w[0].message) && w[0].details.count === '2', w);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
