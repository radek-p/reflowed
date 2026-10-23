// io/latex-text.ts searchKey / foldText: the document list's search folds text as the References search does.
//   node app/src/io/latex-text.test.ts      (Node; exit 1 on a failure)
import { searchKey, foldText } from './latex-text.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };

check('Łódź folds to lodz', searchKey('Łódź') === foldText('lodz') && searchKey('Łódź') === 'lodz', searchKey('Łódź'));
check('TeX accents resolved first',searchKey("{\\L}\\'od\\'z") === 'lodz', searchKey("{\\L}\\'od\\'z"));
check('ø, ß, æ', searchKey('Søren Straße Æsir') === 'soren strasse aesir', searchKey('Søren Straße Æsir'));
check('one char per char for single letters (the marks rely on it)', [...'Łódź'].map((c) => searchKey(c)[0]).join('') === 'lodz');

console.log(`\n${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);
