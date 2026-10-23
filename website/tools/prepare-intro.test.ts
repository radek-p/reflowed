// SPDX-License-Identifier: AGPL-3.0-or-later
// prepare-intro.ts on the intro (samples/intro/source), into a temporary directory: its main.tex is the website's
// version (samples/intro/variants.ts) with no %% line, none of the editor's own lines and none of the sentences that
// speak as the editor, every line of the site's passages; the notes package loaded, the bibliography read from
// refs.bbl; the same sections, labels and figures as the source; the figures copied for the feature pages.
//   node website/tools/prepare-intro.test.ts      (Node; exit 1 on a failure)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { passagesOf } from '../../samples/intro/variants.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok ? ` — ${JSON.stringify(d).slice(0, 600)}` : ''}`); };

const SRC = fileURLToPath(new URL('../../samples/intro/source', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'prepare-intro-'));
const out = join(tmp, 'src'), images = join(tmp, 'images');
const run = spawnSync(process.execPath, [fileURLToPath(new URL('prepare-intro.ts', import.meta.url)), SRC, out, images], { encoding: 'utf8' });
check('prepare-intro runs', run.status === 0, run.stderr);
const tex = readFileSync(join(out, 'main.tex'), 'utf8');
const source = readFileSync(join(SRC, 'main.tex'), 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

check('no %% line', !/^\s*%%/m.test(tex));
const P = passagesOf(source);
const editorOnly = P.editor.filter((l) => !P.site.includes(l));
const leaked = editorOnly.filter((l) => norm(tex).includes(norm(l)));
check('none of the editor\'s own lines', editorOnly.length > 0 && !leaked.length, leaked);
const missing = P.site.filter((l) => !norm(tex).includes(norm(l)));
check('every line of the site\'s passages', P.site.length > 0 && !missing.length, missing);
// the wording that speaks as the editor, whatever the markers say
const EDITOR_WORDS = [/itself a ReflowEd document/i, /in front of you/i, /^\s*Click on/m, /\. Click on/, /Hover over/i, /Press Escape/i, /^The engine runs/m];
const said = EDITOR_WORDS.filter((re) => re.test(tex)).map(String);
check('no sentence that speaks as the editor', !said.length, said);

// the structure the feature pages refer to: the same sections, labels, figures (where each is placed, not the
// versions' own \shot definitions) and captions as the source
const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[0]).join('\n');
for (const [what, re] of [['sections', /\\section\{[^}]*\}/g], ['labels', /\\label\{[^}]*\}/g], ['figures', /\\(?:shot|includegraphics(?:\[[^\]]*\])?)\{[^#}][^}]*\}/g], ['captions', /\\caption\{[^\n]*/g]] as const) {
  check(`the same ${what} as the source`, all(re, tex) === all(re, source) && all(re, tex).length > 0, all(re, tex));
}

// what prepare-intro did before the versions, still done
check('the notes package loaded before \\begin{document}', /\\usepackage\{rtx-notes\}%[^\n]*\n\\begin\{document\}/.test(tex) && existsSync(join(out, 'rtx-notes.sty')));
check('the bibliography from refs.bbl', tex.includes('\\input{refs.bbl}') && !tex.includes('\\bibliography{'));
check('the figures copied for the feature pages', existsSync(join(images, 'shot-split-view.png')) && existsSync(join(images, 'shot-themes.png')));
check('the source is unchanged', readFileSync(join(SRC, 'main.tex'), 'utf8') === source);

rmSync(tmp, { recursive: true, force: true });
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
