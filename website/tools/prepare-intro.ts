// SPDX-License-Identifier: AGPL-3.0-or-later
// The intro document (samples/intro/source) made ready for the site's build, without changing it:
//
//   node tools/prepare-intro.ts <source dir> <out dir> <images dir>
//
// <out dir> gets a copy of the source, with three changes to its main.tex:
// - the website's version of it (samples/intro/variants.ts): lines from "%% site:" to "%% end" kept, from
//   "%% editor:" to "%% end" left out, and every line that starts with %% gone, so the page describes ReflowEd
//   rather than speaking as the editor;
// - the editor's notes package (tex/rtx-notes.sty, copied beside it) is loaded before \begin{document}: on the web
//   every \todo becomes a widget of kind rtxnote with its text as a part, which the site's browser/notes.ts draws as
//   the editor does (a chip in the line that opens to the note). In print the package does nothing. The line carries
//   a hash of the package, so a change to it compiles the intro again.
// - \bibliography{name} reads name.bbl, the bibliography as BibTeX made it and the source keeps it: LaTeX itself
//   would look for <jobname>.bbl, and the pipeline runs no BibTeX.
// <images dir> gets the figures as they are, for the feature pages (static/images/intro/).
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { versionOf } from '../../samples/intro/variants.ts';

const [src, out, images] = process.argv.slice(2).map((p) => resolve(p));
if (!src || !out || !images) {
  console.error('usage: node tools/prepare-intro.ts <source dir> <out dir> <images dir>');
  process.exit(2);
}
const main = join(out, 'main.tex');
if (!existsSync(join(src, 'main.tex'))) {
  console.error(`prepare-intro: ${src}/main.tex not found`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true, preserveTimestamps: true });
let tex = versionOf(readFileSync(main, 'utf8'), 'site');

// The notes package, and the line that loads it.
const notesSty = new URL('../../tex/rtx-notes.sty', import.meta.url);
if (existsSync(notesSty)) {
  const sty = readFileSync(notesSty);
  writeFileSync(join(out, 'rtx-notes.sty'), sty);
  const at = tex.indexOf('\\begin{document}');
  const hash = createHash('sha256').update(sty).digest('hex').slice(0, 12);
  if (at >= 0) tex = `${tex.slice(0, at)}\\usepackage{rtx-notes}% ${hash}\n${tex.slice(at)}`;
} else {
  console.warn(`prepare-intro: ${notesSty.pathname} not found: the notes are drawn by todonotes`);
}

// The bibliography from the source's own .bbl.
tex = tex.replace(/\\bibliography\{([^}]+)\}/g, (all, names: string) => {
  const bbl = names.split(',').map((n) => `${n.trim()}.bbl`).filter((f) => existsSync(join(out, f)));
  if (!bbl.length) { console.error(`prepare-intro: no .bbl for ${all}: every \\cite would show [?]`); process.exit(1); }
  return bbl.map((f) => `\\input{${f}}`).join('');
});
writeFileSync(main, tex);

const figures = join(out, 'figures');
const shots = existsSync(figures) ? readdirSync(figures).filter((f) => /\.(png|jpe?g)$/i.test(f)) : [];
mkdirSync(images, { recursive: true });
for (const f of shots) copyFileSync(join(figures, f), join(images, f));
console.log(`prepare-intro: ${shots.length} figures, images in ${images}`);
