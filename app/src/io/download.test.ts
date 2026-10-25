// io/download.ts fileName: one file-name rule for every export (letters folded as search folds them, case kept,
// characters file systems refuse replaced, a fallback and a cap); and download's one revoke delay.
//   node app/src/io/download.test.ts      (Node; exit 1 on a failure)
import { download, fileName, NAME_MAX } from './download.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const is = (title: string | undefined, want: string) => check(`${JSON.stringify(title)} -> ${want}`, fileName(title) === want, fileName(title));

is('Zürich Notes', 'Zurich-Notes');
is('Über die Theorie', 'Uber-die-Theorie');
is('Łódź', 'Lodz');
is('Straße', 'Strasse');
is('Søren and Æsir', 'Soren-and-AEsir');
is('Phở Việt', 'Pho-Viet');
is('My Paper: Draft 2', 'My-Paper-Draft-2');
is('a/b:c', 'a-b-c');
is('x\\y*z?"<w>|v', 'x-y-z-w-v');
is('tab\tand\nnew line\u0007bell', 'tab-and-new-line-bell');
is('  spaced   out  ', 'spaced-out');
is('--- .hidden. ---', 'hidden');
is('Notes (edited)', 'Notes-(edited)');
is('Ελληνικά ά', 'Ελληνικά-ά');        // only Latin letters lose their accents; other scripts stay whole
is('한국어 제목', '한국어-제목');          // Hangul survives the NFD round trip
is('', 'document');
is(undefined, 'document');
is(' :/?* ', 'document');
{
  const long = fileName('x'.repeat(300));
  check(`a 300-character title is capped at ${NAME_MAX}`, long === 'x'.repeat(NAME_MAX), long.length);
  const cut = fileName(`${'a'.repeat(NAME_MAX - 1)} b`);
  check('no dash left at the cut', cut === 'a'.repeat(NAME_MAX - 1), cut);
  const emoji = fileName('😀'.repeat(200));
  check('the cap counts characters, never splits one', Array.from(emoji).length === NAME_MAX && emoji === '😀'.repeat(NAME_MAX), emoji.length);
}

// download: the link carries the name, the Blob the type; the URL is revoked once, after the long delay
{
  const g = globalThis as unknown as Record<string, unknown>;
  const clicked: { name: string; type: string }[] = [], revoked: unknown[] = [], delays: number[] = [];
  g.document = { createElement: () => ({ click() {}, remove() {} }), body: { append: (a: { download: string; href: { type: string } }) => clicked.push({ name: a.download, type: a.href.type }) } };
  const realTimeout = globalThis.setTimeout;
  g.setTimeout = (f: () => void, ms: number) => { delays.push(ms); f(); return 0; };
  g.URL = Object.assign(URL, { createObjectURL: (b: Blob) => ({ type: b.type }), revokeObjectURL: (u: unknown) => revoked.push(u) });
  download('Zurich-Notes.tex', '\\documentclass{article}', 'text/x-tex');
  download('x.zip', new Blob(['z'], { type: 'application/zip' }));
  g.setTimeout = realTimeout;
  check('download: name and type as given', JSON.stringify(clicked) === JSON.stringify([{ name: 'Zurich-Notes.tex', type: 'text/x-tex' }, { name: 'x.zip', type: 'application/zip' }]), clicked);
  check('download: each URL revoked once, after 10 s', revoked.length === 2 && delays.every((d) => d === 10_000), { revoked, delays });
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
