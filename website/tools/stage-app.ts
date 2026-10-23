// SPDX-License-Identifier: AGPL-3.0-or-later
// Puts a release of the editor and its TeX Live tree into the site, at static/app/, replacing what is there:
//
//   node tools/stage-app.ts <release dir> <tree dir>
//
//   <release dir>  the multi-file release, as `node scripts/build.ts` writes it (dist/reflowtex-editor/: index.html,
//                  manifest.json, app.webmanifest and the files named by their content)
//   <tree dir>     the TeX Live tree, as scripts/fetch-engine.ts installs it from the engine's release
//                  (build/resources/www/texlive/2022/: texmf-dist/ with its ls-R, tlpkg/tlpobj/, the licence notes)
//
// The site then has static/app/ (the release; "Open ReflowEd" links it) and static/app/texlive/2022/ (the tree): the
// release looks for the tree beside its page, at texlive/2022/, so both are served from the same directory, as on any
// other server. static/app/texlive/README, written here from the tree's package records, says what the tree is and
// where its licences are. Hugo copies static/ as it is.
//
// It checks before it copies: every file the release's manifest lists is there with its size, the release has no
// source maps, and the tree has its ls-R and package records. Nothing is changed when a check fails.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(SITE, 'static/app');
const TREE_AT = 'texlive/2022';

const [release, tree] = process.argv.slice(2).map((p) => resolve(p));
if (!release || !tree) {
  console.error('usage: node tools/stage-app.ts <release dir> <tree dir (…/texlive/2022)>');
  process.exit(2);
}

function filesUnder(d: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    for (const n of readdirSync(x)) {
      const p = join(x, n);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(d);
  return out;
}
const MB = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const problems: string[] = [];

// ── the release ──────────────────────────────────────────────────────────────
interface ManifestFile { path: string; bytes: number }
function readManifest(file: string): ManifestFile[] {
  const j: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const files = (j as { files?: unknown }).files;
  if (!Array.isArray(files)) throw new Error(`${file}: no "files" list`);
  return files.map((f: unknown, i) => {
    const { path, bytes } = (f ?? {}) as { path?: unknown; bytes?: unknown };
    if (typeof path !== 'string' || typeof bytes !== 'number') throw new Error(`${file}: files[${i}] has no path or bytes`);
    return { path, bytes };
  });
}
for (const f of ['index.html', 'manifest.json', 'app.webmanifest'])
  if (!existsSync(join(release, f))) problems.push(`the release has no ${f} (${release})`);
const releaseFiles = existsSync(release) ? filesUnder(release) : [];
if (!problems.length) {
  for (const f of readManifest(join(release, 'manifest.json'))) {
    const p = join(release, f.path);
    if (!existsSync(p)) problems.push(`the release's manifest lists ${f.path}, which is not there`);
    else if (statSync(p).size !== f.bytes) problems.push(`${f.path}: ${statSync(p).size} bytes, not the ${f.bytes} the manifest says`);
  }
  for (const p of releaseFiles) {
    const rel = relative(release, p);
    if (/\.map$/.test(rel)) problems.push(`the release has a source map: ${rel}`);
    else if (/\.(js|css|html)$/.test(rel) && /sourceMappingURL=/.test(readFileSync(p, 'utf8'))) problems.push(`${rel} names a source map`);
  }
  if (releaseFiles.some((p) => relative(release, p).startsWith('texlive/'))) problems.push('the release has a texlive/ of its own');
}

// ── the tree ─────────────────────────────────────────────────────────────────
const TLPOBJ = join(tree, 'tlpkg/tlpobj');
if (!existsSync(join(tree, 'texmf-dist/ls-R'))) problems.push(`the tree has no texmf-dist/ls-R (${tree})`);
if (!existsSync(TLPOBJ)) problems.push(`the tree has no tlpkg/tlpobj/ (${tree})`);
if (problems.length) {
  for (const p of problems) console.error(`stage-app: ${p}`);
  process.exit(1);
}

/** a package's TeX Live record: its name, category and licence (catalogue-license) */
interface Pkg { name: string; category: string; licence: string }
const packages: Pkg[] = readdirSync(TLPOBJ).filter((n) => n.endsWith('.tlpobj')).sort().map((n) => {
  const field = (t: string, k: string) => t.match(new RegExp(`^${k} (.*)$`, 'm'))?.[1].trim() ?? '';
  const t = readFileSync(join(TLPOBJ, n), 'utf8');
  return { name: field(t, 'name') || n.replace(/\.tlpobj$/, ''), category: field(t, 'category'), licence: field(t, 'catalogue-license') };
});
const year = TREE_AT.split('/')[1];
const has = (f: string) => existsSync(join(tree, f));
const licences = new Map<string, number>();
for (const p of packages) if (p.licence) licences.set(p.licence, (licences.get(p.licence) ?? 0) + 1);
const wrap = (words: string[], width = 100) => {
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + w.length + 2 > width) { lines.push(`${line},`); line = w; } else line = line ? `${line}, ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l) => `  ${l}`).join('\n');
};
const readme = `TeX Live ${year}: the packages the editor reads beside it

What this is
  ${TREE_AT}/ is a subset of TeX Live ${year}'s texmf-dist, laid out as TeX Live installs it. The editor (the page one
  directory up) reads a package, class or font from here when a document needs one that the editor does not carry
  itself. These files are TeX Live's, not the editor's, and they are not changed.

Where it comes from
  The packages are TeX Live ${year}'s (https://tug.org/texlive/), as tlmgr installs them from TeX Live's network
  archive: each package's runfiles, its record in tlpkg/tlpobj/, and its licence files from its documentation (no
  other documentation, no sources). The files' bytes are those of TeX Live ${year} as released (the snapshot the
  editor's engine was built from); a file added to a package later in that year is left out.
  texmf-dist/ls-R is the file list kpathsea writes: the only index the editor reads.${has('README.txt') ? '\n  README.txt, inside the tree, says the same in more detail.' : ''}

The packages (${packages.length}, with what they depend on)
${wrap(packages.map((p) => p.name))}

Licences
  Every package keeps its own licence: most are under the LaTeX Project Public Licence (LPPL), others under the GPL,
  the SIL Open Font Licence (OFL), the Knuth licence, MIT, public domain and other free licences, as TeX Live and CTAN
  distribute them. Each package's licence is in its record, tlpkg/tlpobj/<package>.tlpobj (catalogue-license), and
  the licence files it ships are under texmf-dist/doc/.${has('LICENCES.txt') ? ' LICENCES.txt lists both for every package.' : ''}
  Where a package has no separate licence file, the headers of its files state the terms.${has('LICENSE.TL') ? '\n  TeX Live\'s own notices are LICENSE.TL and LICENSE.CTAN.' : ''}

  By licence (catalogue-license, ${packages.filter((p) => p.licence).length} of ${packages.length} packages; the rest are TeX Live's own
  infrastructure, collections and schemes):
${wrap([...licences].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `${l} ${n}`))}
`;

// ── copy: into a new directory beside static/app/, then swap ─────────────────
const next = `${APP}.staging`;
rmSync(next, { recursive: true, force: true });
mkdirSync(join(next, TREE_AT), { recursive: true });
cpSync(release, next, { recursive: true, dereference: true });
cpSync(tree, join(next, TREE_AT), { recursive: true, dereference: true });
writeFileSync(join(next, 'texlive/README'), readme);
rmSync(APP, { recursive: true, force: true });
renameSync(next, APP);

const sum = (fs: string[]) => fs.reduce((s, f) => s + statSync(f).size, 0);
const all = filesUnder(APP), treeFiles = filesUnder(join(APP, TREE_AT));
const largest = all.reduce((a, f) => (statSync(f).size > statSync(a).size ? f : a));
console.log(`stage-app: ${relative(SITE, APP)}/: the release (${releaseFiles.length} files, ${MB(sum(releaseFiles))}) and ${TREE_AT}/ `
  + `(${packages.length} packages, ${treeFiles.length} files, ${MB(sum(treeFiles))}); ${all.length} files, ${MB(sum(all))} in all; `
  + `the largest ${relative(APP, largest)} (${MB(statSync(largest).size)})`);
