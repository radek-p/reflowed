// variants.ts, the intro's two versions from one source, and the editor's side of it (seed-intro.ts):
// - the selection on small sources: shared lines kept, the other version's passages and every %% line gone, the
//   mistakes (nested, unclosed, a stray %% end, a marker misspelt) refused;
// - source/main.tex: it has passages of both kinds, each version has no %% line, and a line of one version's
//   passages that the other does not share is not in the other;
// - the seed (buildIntroSeed): no block, nor the preamble, holds a %% line or a line of the site's passages, and
//   the editor's passages are there;
// - the bibliography: each \bibliography{name} has its name.bbl in git (the pipeline runs no BibTeX, and the site is
//   built from a clone: without it every \cite shows [?]).
// The website's side is website/tools/prepare-intro.test.ts.
//   node samples/intro/variants.test.ts      (Node; exit 1 on a failure)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { passagesOf, versionOf } from './variants.ts';
import { buildIntroSeed, INTRO_SOURCE } from './seed-intro.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d).slice(0, 600)}` : ''}`); };
const throws = (tex: string): string | null => { try { versionOf(tex, 'editor'); return null; } catch (e) { return (e as Error).message; } };

const SMALL = ['%% a comment about the versions', 'Shared.', '', '%% editor:', 'Click here.', '%% end', '  %% site:', 'In the editor, a click.', '%% end', 'More, 50\\%% off.', ''].join('\n');
check('editor: shared lines and its own passage; no %% line', versionOf(SMALL, 'editor') === 'Shared.\n\nClick here.\nMore, 50\\%% off.\n', versionOf(SMALL, 'editor'));
check('site: shared lines and its own passage (an indented marker too)', versionOf(SMALL, 'site') === 'Shared.\n\nIn the editor, a click.\nMore, 50\\%% off.\n', versionOf(SMALL, 'site'));
check('no markers: the source as it is', versionOf('a\n% a TeX comment\nb', 'site') === 'a\n% a TeX comment\nb');
check('passagesOf', JSON.stringify(passagesOf(SMALL)) === JSON.stringify({ editor: ['Click here.'], site: ['In the editor, a click.'] }), passagesOf(SMALL));
check('refused: a passage inside a passage', /inside the passage opened at line 1/.test(throws('%% editor:\n%% site:\nx\n%% end\n%% end') ?? ''), throws('%% editor:\n%% site:\n'));
check('refused: a passage never closed', /never closed/.test(throws('%% site:\nx') ?? ''));
check('refused: %% end with nothing open', /no passage open/.test(throws('x\n%% end') ?? ''));
for (const typo of ['%% editor', '%% Site:', '%% End', '%%site', '%% end:']) check(`refused: a misspelt marker ${JSON.stringify(typo)}`, /is not a marker/.test(throws(`${typo}\nx\n%% end`) ?? ''), throws(`${typo}\nx\n%% end`));

// the intro itself
const MAIN = readFileSync(join(INTRO_SOURCE, 'main.tex'), 'utf8');
const P = passagesOf(MAIN);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const only = { editor: P.editor.filter((l) => !P.site.includes(l)), site: P.site.filter((l) => !P.editor.includes(l)) };
check('main.tex has passages of both kinds', only.editor.length >= 5 && only.site.length >= 5, { editor: only.editor.length, site: only.site.length });
for (const v of ['editor', 'site'] as const) {
  const text = versionOf(MAIN, v), other = v === 'editor' ? 'site' : 'editor';
  check(`main.tex, the ${v}'s version: no %% line`, !/^\s*%%/m.test(text));
  const leaked = only[other].filter((l) => norm(text).includes(norm(l)));
  check(`main.tex, the ${v}'s version: none of the ${other}'s own lines`, !leaked.length, leaked);
  const missing = only[v].filter((l) => !norm(text).includes(norm(l)));
  check(`main.tex, the ${v}'s version: every line of its own passages`, !missing.length, missing);
}

// the seed the editor ships
const { seed } = await buildIntroSeed();
const init = seed.init as { preamble?: string; blocks?: Array<{ source?: string; children?: unknown }> };
const sources: string[] = [];
const walk = (bs: unknown) => { for (const b of (Array.isArray(bs) ? bs : []) as Array<{ source?: string; children?: unknown }>) { if (typeof b.source === 'string') sources.push(b.source); walk(b.children); } };
walk(init.blocks);
const all = norm([init.preamble ?? '', ...sources].join('\n'));   // the document: its preamble and its blocks
check('the seed has blocks', sources.length > 20, sources.length);
check('the seed: no block holds a %% line', !sources.some((s) => /^\s*%%/m.test(s)), sources.filter((s) => /^\s*%%/m.test(s)));
check('the seed: its preamble holds no %% line', !/^\s*%%/m.test(init.preamble ?? ''), init.preamble);
const leaked = only.site.filter((l) => all.includes(norm(l)));
check('the seed: no line of the site\'s passages', !leaked.length && !all.includes('\\href{app/}'), leaked);
const missing = only.editor.filter((l) => !all.includes(norm(l)));
check('the seed: every line of the editor\'s passages', !missing.length, missing);

// the bibliography
const tracked = execFileSync('git', ['ls-files'], { cwd: INTRO_SOURCE, encoding: 'utf8' }).split('\n');
for (const m of MAIN.matchAll(/\\bibliography\{([^}]+)\}/g)) {
  for (const name of m[1].split(',').map((s) => s.trim())) check(`\\bibliography{${name}}: ${name}.bbl is in git`, tracked.includes(`${name}.bbl`), tracked);
}

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
