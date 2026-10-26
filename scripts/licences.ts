// The single file's licence notice (scripts/build.ts): the author's notice for
// his own work, and every third-party component in the file with its licence:
// the npm packages bundled into the app and the worker (from esbuild's
// metafiles), the engine (reflow-tectonic: Tectonic/XeTeX and the C libraries in the wasm), each
// packed TeX file (its licence as the file states it), and the default documents
// (the introduction: AGPL-3.0-or-later, the editor's licence).
// withInspector(licences, header, roots): the same for a release that ships the public inspector too (the multi-file
// release): reflowtex's entry names it, and the packages its vendor bundle holds (its header names them) are listed.
import { createRequire } from 'node:module';
import type * as E from 'esbuild';
// esbuild lives in engine/node_modules
const esbuild = createRequire(new URL('../engine/package.json', import.meta.url))('esbuild') as typeof E;
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ReflowEd is free software under the AGPL (the public reflowtex's licence); SOURCE_URL: where its
// source is published (the notice, so the file's head and the About box, names it: the AGPL asks a program used over
// a network to offer its source), set once the repository is public
export const LICENCE_ID = 'AGPL-3.0-or-later';
export const SOURCE_URL = 'https://github.com/radek-p/reflowed';
export const NOTICE = 'ReflowEd. Copyright © 2026 Radosław Piórkowski. ReflowEd is free software: you can redistribute it and/or modify it '
  + 'under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the '
  + 'License, or (at your option) any later version (AGPL-3.0-or-later, https://www.gnu.org/licenses/agpl-3.0.html). It is distributed '
  + 'WITHOUT ANY WARRANTY. ' + (SOURCE_URL ? `Source code: ${SOURCE_URL}. ` : '')
  + "The third-party components and documents listed in the file's licence notice remain under their own licences.";

export interface Licences {
  notice: string;
  npm: { name: string; version: string; licence: string; text: string; where: string[] }[];
  engine: { name: string; licence: string; text: string; note?: string }[];
  tex: { file: string; licence: string }[];
  /** url: the licence's text, none for the author's own (the notice covers it); changes: none for the author's own */
  documents: { title: string; source: string; licence: string; url?: string; changes: string[] }[];
}


/** Packages under node_modules that an esbuild metafile's inputs come from. */
export function packagesOf(meta: E.Metafile): Set<string> {
  const out = new Set<string>();
  for (const f of Object.keys(meta.inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(f);
    if (m) out.add(m[1]);
  }
  return out;
}

/** The worker's packages: its entry bundled again for the metafile only (no output), with build-worker.ts's aliases. */
export async function workerPackages(engineDir: string, pub: string, tc: string): Promise<Set<string>> {
  const eb = join(tc, 'engine/encode');
  const shim = (f: string) => join(eb, 'src/shims', f);
  try {
    const r = await esbuild.build({
      entryPoints: [join(engineDir, 'src/worker.ts')], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', logLevel: 'silent',
      nodePaths: [join(eb, 'node_modules')], inject: [shim('globals.ts')],
      loader: { '.sty': 'text', '.proto': 'text', '.tex': 'text' }, external: ['module'],
      define: { ENGINE_BUILD: '""' },
      alias: {
        'node:fs': shim('fs.ts'), 'node:crypto': shim('crypto.ts'), 'node:child_process': shim('child_process.ts'),
        'node:url': shim('misc.ts'), 'node:os': shim('misc.ts'), 'node:util': shim('misc.ts'),
        'node:module': shim('misc.ts'), 'node:zlib': shim('misc.ts'), 'node:path': 'path-browserify',
        'speech-rule-engine': shim('sre-stub.ts'), 'protobufjs': shim('protobufjs.ts'),
      },
      plugins: [
        { name: 'pub', setup(b) { b.onResolve({ filter: /^@pub\// }, (a) => ({ path: join(pub, a.path.slice(5)) })); } },
        { name: 'virtual', setup(b) { b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'v' })); b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: 'export default ""', loader: 'js' })); } },
      ],
    });
    const s = packagesOf(r.metafile!);
    s.add('protobufjs');                       // shimmed: the viewer's protobuf.min.js runtime
    return s;
  } catch (e) {
    console.log(`licences: the worker's metafile failed (${(e as Error).message.split('\n')[0]}); its declared dependencies instead`);
    return new Set(['buffer', 'path-browserify', 'harfbuzzjs', 'opentype.js', 'protobufjs', 'fzstd', 'base64-js', 'ieee754']);
  }
}

function npmEntry(name: string, roots: string[], where: string[]) {
  const dir = roots.map((r) => join(r, name)).find((d) => existsSync(join(d, 'package.json')));
  if (!dir) return { name, version: '?', licence: 'unknown (package not found at build time)', text: '', where };
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lf = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'license.md', 'COPYING'].map((f) => join(dir, f)).find((f) => existsSync(f));
  const licence = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l: any) => l.type).join(' OR ') : 'see text');
  return { name, version: pj.version ?? '?', licence, text: lf ? readFileSync(lf, 'utf8').trim() : `${licence} (no licence file in the package)`, where };
}

/** What a TeX file says its licence is (its own header, or its font's embedded notice). */
export function texLicence(name: string, bytes: Uint8Array): string {
  let t = Buffer.from(bytes.subarray(0, 200000)).toString('latin1');
  if (/\.(otf|ttf)$/i.test(name)) t += Buffer.from(bytes).toString('latin1').replace(/\0/g, '');
  const has = (re: RegExp) => re.test(t);
  const out: string[] = [];
  if (has(/LaTeX Project Public Licen[cs]e|\bLPPL\b|lppl/)) out.push(`LPPL${/version 1\.3c|1\.3c/i.test(t) ? ' 1.3c' : /1\.3/.test(t) ? ' 1.3' : ''}`);
  if (has(/SIL Open Font Licen[cs]e|\bOFL\b/)) out.push('SIL Open Font Licence 1.1');
  if (has(/GUST Font Licen[cs]e/i)) out.push('GUST Font Licence');
  if (has(/GNU (?:Lesser|Library) General Public Licen[cs]e|\bLGPL/)) out.push('LGPL');
  else if (has(/GNU General Public Licen[cs]e|\bGPL\b/)) out.push('GPL');
  if (has(/Apache Licen[cs]e/)) out.push('Apache 2.0');
  if (has(/public domain/i)) out.push('public domain');
  if (has(/MIT licen[cs]e|Permission is hereby granted, free of charge/i)) out.push('MIT');
  if (!out.length && /\.(tfm|pfb|afm)$/i.test(name) && /^(cm|msa|msb|eu[frs]|eurm|lasy|cmex|rsfs|wasy)/.test(name)) out.push('SIL Open Font Licence 1.1 (AMS / Blue Sky Type 1 fonts), metrics: Knuth / AMS, free');
  if (!out.length && /\.(tfm|pfb|enc|otf)$/i.test(name) && /^(ec-lm|lm|rm-lm|ts1-lm|cs-lm|qx-lm|t5-lm|l7x-lm|lm-)/.test(name)) out.push('GUST Font Licence (Latin Modern)');
  if (!out.length && /^LinLibertine|^LinBiolinum/.test(name)) out.push('SIL Open Font Licence 1.1 / GPL with font exception (Libertine)');
  return out.length ? out.join(' + ') : 'the licence of its TeX Live package (not stated in the file itself; see its CTAN entry)';
}

export async function collectLicences(o: {
  appMeta: E.Metafile; engineDir: string; pub: string; tc: string;
  texFiles: [string, Uint8Array][]; roots: string[]; seeds?: string[];
}): Promise<Licences> {
  const app = packagesOf(o.appMeta), worker = await workerPackages(o.engineDir, o.pub, o.tc);
  worker.add('fzstd');
  const names = [...new Set([...app, ...worker])].sort();
  const npm = names.map((n) => npmEntry(n, o.roots, [app.has(n) ? 'app' : '', worker.has(n) ? 'worker' : ''].filter(Boolean)));
  const L = (f: string) => { const p = join(o.engineDir, 'licences', f); return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''; };
  const engine = [
    { name: 'Tectonic (the TeX engine, compiled to WebAssembly), including XeTeX and xdvipdfmx', licence: 'MIT; the reflow-tectonic changes AGPL-3.0-or-later', text: L('tectonic.txt'),
      note: "Built in reflow-tectonic (https://github.com/radek-p/reflow-tectonic): Tectonic with the capture ReflowEd reads; those changes are © 2026 Radosław Piórkowski, AGPL-3.0-or-later. "
        + "XeTeX: © SIL International, Jonathan Kew, Khaled Hosny and others (MIT/X11); TeX: © Donald E. Knuth (TeX's own licence: free use, the name is reserved)." },
    { name: 'HarfBuzz', licence: 'MIT (Old MIT)', text: L('harfbuzz.txt') },
    { name: 'ICU 68 (Unicode data and algorithms)', licence: 'Unicode licence / ICU licence', text: L('icu.txt') },
    { name: 'FreeType 2.13', licence: 'FreeType Licence (FTL)', text: L('freetype-FTL.txt') },
    { name: 'libpng 1.6', licence: 'libpng licence', text: L('libpng.txt') },
    { name: 'zlib 1.2.13', licence: 'zlib licence', text: L('zlib.txt') },
    { name: 'Graphite2 1.3.14', licence: 'LGPL 2.1 or later, or MPL, or GPL 2 or later (used here under the MPL); source: https://github.com/silnrsi/graphite', text: L('graphite2.txt') },
    { name: 'latex.fmt (the LaTeX kernel, preloaded)', licence: 'LPPL 1.3c', text: 'Built from the LaTeX kernel (latex.ltx and its files) as distributed by TeX Live; LaTeX Project Public Licence 1.3c, https://www.latex-project.org/lppl/' },
    { name: 'reflowtex (the viewer, the encoder, the companion package)', licence: 'AGPL-3.0-or-later', text: existsSync(join(o.pub, 'LICENSE')) ? readFileSync(join(o.pub, 'LICENSE'), 'utf8').trim() : '' },
  ];
  const tex = o.texFiles.filter(([n]) => n.startsWith('texmf/')).map(([n, b]) => ({ file: n.slice(6), licence: texLicence(n.slice(6), b) })).sort((a, b) => a.file.localeCompare(b.file));
  const documents: { seed: string; title: string; source: string; licence: string; url?: string; changes: string[] }[] = [
    { seed: 'intro.json', title: 'An Introduction to ReflowEd', source: 'written for ReflowEd', licence: 'AGPL-3.0-or-later', url: 'https://www.gnu.org/licenses/agpl-3.0.html', changes: [] },
  ];
  return { notice: NOTICE, npm, engine, tex, documents: documents.filter((d) => !o.seeds || o.seeds.includes(d.seed)).map(({ seed: _s, ...d }) => d) };
}

/** The licences of a release that ships the public inspector (reflowtex src/inspector, AGPL-3.0-or-later like the rest
 *  of reflowtex) beside it: reflowtex's entry names it; the packages of its vendor bundle (vendor/preact.js, whose first
 *  line names them: "preact@10.29.8, htm@3.1.1, @preact/signals@2.11.2 – MIT licensed") are listed as in the inspector,
 *  with their licence texts from the packages found in `roots`. */
export function withInspector(l: Licences, vendorHeader: string, roots: string[]): Licences {
  const engine = l.engine.map((e) => (e.name.startsWith('reflowtex (') ? { ...e, name: 'reflowtex (the viewer, the encoder, the companion package, the inspector)' } : e));
  const named = [...vendorHeader.matchAll(/((?:@[\w.-]+\/)?[\w.-]+)@(\d[\w.-]*)/g)].map((m) => ({ name: m[1], version: m[2] }));
  if (!named.length) throw new Error(`licences: the inspector's vendor bundle names no package (${vendorHeader.slice(0, 120)})`);
  const npm = l.npm.map((p) => ({ ...p, where: [...p.where] }));
  for (const v of named) {
    const same = npm.find((p) => p.name === v.name && p.version === v.version);
    if (same) { if (!same.where.includes('inspector')) same.where.push('inspector'); continue; }
    const e = npmEntry(v.name, roots, ['inspector']);
    npm.push({ ...e, version: v.version, licence: e.version === '?' ? 'MIT' : e.licence });
  }
  npm.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { ...l, engine, npm };
}

/** The whole notice as plain text (the page's licence block and the About panel's "copy"). */
export function licencesText(l: Licences, build: string): string {
  const out = [l.notice, '', `Build: ${build}`, '', '════ Example documents (each under the licence named) ════'];
  for (const d of l.documents) out.push(`${d.title} — ${d.source}. Licence: ${d.licence}${d.url ? ` (${d.url})` : ''}.${d.changes.length ? ' Modified for this demo:' : ''}`, ...d.changes.map((c) => `  - ${c}`), '');
  out.push('════ The engine ════');
  for (const e of l.engine) out.push(`── ${e.name} — ${e.licence}`, ...(e.note ? [e.note] : []), e.text, '');
  out.push('════ npm packages ════');
  for (const p of l.npm) out.push(`── ${p.name} ${p.version} (${p.licence}; in the ${p.where.join(' and ')})`, p.text, '');
  out.push(`════ TeX files in the pack (${l.tex.length}), each under its own licence ════`,
    'Comments were removed from some TeX sources to make the file smaller; their licence statements are in the originals, as distributed by TeX Live and CTAN.');
  for (const t of l.tex) out.push(`${t.file}: ${t.licence}`);
  return out.join('\n');
}
