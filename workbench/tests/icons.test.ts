// The one icon registry (app/src/design/ui/icon-set.ts, which src/kit/icons.ts re-exports: our names → Lucide): every name draws an SVG on Lucide's grid with the one
// stroke, as a Preact element and as a string; esbuild bundles only the icons named (tree-shaken, inlined); Lucide's
// licence reaches the release's third-party licences; and every icon name written in the sources (htm attributes, the
// JavaScript call sites, which typecheck does not see) is in the registry.
//   node --test workbench/tests/icons.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as E from 'esbuild';

const WB = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(WB, '..');
const esbuild = createRequire(join(REPO, 'app/package.json'))('esbuild') as typeof E;

// the registry as the page gets it (the workbench's entry, bundled: its metafile says what is in it), then imported
const built = await esbuild.build({ entryPoints: [join(WB, 'src/kit/icons.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false,
  metafile: true, nodePaths: [join(REPO, 'app/node_modules')], mainFields: ['module', 'main'], logLevel: 'warning' });
const code = built.outputFiles[0]!.text;
type VNodeLike = { type: string; props: Record<string, unknown> & { children?: VNodeLike[] } };
const R = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as {
  ICONS: string[]; ICON_SET: Record<string, [string, Record<string, string>][]>; ICON_STROKE: number; isIconName(s: unknown): boolean;
  iconSvg(name: string, size?: number, cls?: string): string; Icon(p: { name: string; size?: number; class?: string }): VNodeLike;
};

test('every registry name renders an SVG on the 24-unit grid with the one stroke (string and Preact)', () => {
  assert.ok(R.ICONS.length > 40, `the registry has its icons (${R.ICONS.length})`);
  assert.equal(R.ICON_STROKE, 1.75);
  for (const n of R.ICONS) {
    const node = R.ICON_SET[n]!;
    assert.ok(node.length > 0, `${n}: Lucide gives it shapes`);
    const s = R.iconSvg(n, 20);
    assert.match(s, /^<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="[a-zA-Z]+">/, n);
    assert.ok(s.includes(` data-icon="${n}"`), `${n}: its name on the svg`);
    assert.equal((s.match(/<(path|circle|rect|line|polyline|polygon|ellipse) /g) ?? []).length, node.length, `${n}: every shape in the string`);
    const v = R.Icon({ name: n, size: 18, class: 'svf-ic' });
    assert.equal(v.type, 'svg', n);
    assert.equal(v.props.viewBox, '0 0 24 24', n);
    assert.equal(v.props['stroke-width'], 1.75, n);
    assert.equal(v.props.stroke, 'currentColor', n);
    assert.equal(v.props['aria-hidden'], 'true', n);
    assert.equal(v.props.class, 'svf-ic', `${n}: the caller's class`);
    assert.equal(v.props.width, 18, n);
    assert.equal(v.props['data-icon'], n, n);
    assert.equal(v.props.children?.length, node.length, `${n}: every shape as a child`);
  }
  assert.equal(R.Icon({ name: 'plus' }).props.class, 'ui-icon', 'the default class');
  assert.ok(R.isIconName('close') && !R.isIconName('typeface') && !R.isIconName('toString'), 'isIconName: own names only');
});

// the editor's modules load in Node (Node tests import the kit): the registry must resolve its packages
// from app/node_modules, as it does under app/ (it broke them while it lived in workbench/src/kit)
test('the editor kit\'s icons load in Node, without a bundler', async () => {
  const K = await import('../../app/src/design/ui/icons.ts') as { svg(n: string, s?: number): string; ICON_NAMES: readonly string[] };
  assert.match(K.svg('plus', 12), /^<svg class="ui-icon" width="12" height="12" viewBox="0 0 24 24"/);
  assert.deepEqual([...K.ICON_NAMES], R.ICONS);
});

test('esbuild bundles only the icons named (tree-shaken), and Lucide\'s licence goes into the release\'s list', async () => {
  const out = Object.values(built.metafile!.outputs)[0]!;
  const lucide = Object.entries(out.inputs).filter(([f, i]) => /node_modules\/lucide\/dist\/esm\/icons\//.test(f) && i.bytesInOutput > 0);
  const distinct = new Set(Object.values(R.ICON_SET)).size;
  assert.ok(lucide.length >= distinct && lucide.length <= distinct + 2, `${lucide.length} Lucide icon modules bundled for ${distinct} distinct icons`);
  assert.ok(code.length < 60_000, `the registry bundled with Preact: ${code.length} bytes (all of Lucide would be megabytes)`);
  // the release (scripts/build.ts) lists every package its metafile names, with the package's LICENSE (scripts/licences.ts)
  const { packagesOf } = await import('../../scripts/licences.ts');
  assert.ok(packagesOf(built.metafile!).has('lucide'), 'lucide is a bundled package');
  const pj = JSON.parse(readFileSync(join(REPO, 'app/node_modules/lucide/package.json'), 'utf8'));
  assert.equal(pj.version, '1.59.0');
  assert.equal(pj.license, 'ISC');
  assert.match(readFileSync(join(REPO, 'app/node_modules/lucide/LICENSE'), 'utf8'), /ISC License[\s\S]*Copyright \(c\) 2026 Lucide Icons and Contributors/);
  assert.equal(JSON.parse(readFileSync(join(REPO, 'app/package.json'), 'utf8')).dependencies?.lucide, '1.59.0', 'pinned exactly');
});

// the sources: every icon name a call site writes is in the registry (TypeScript object literals are typechecked; htm
// attributes and JavaScript are not)
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory()
  ? (['node_modules', 'vendor', 'dev'].includes(e.name) ? [] : walk(join(d, e.name))) : /\.(js|ts)$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name) ? [join(d, e.name)] : []);
const SOURCES = [...walk(join(REPO, 'app/src')), ...walk(join(WB, 'src')), ...walk(join(WB, 'demo'))];
// the values of an expression: a quoted name alone, or a branch of a ternary or ?? (not a compared value: side === 'left')
const quoted = (s: string) => [...s.matchAll(/(?:^|\?\??|:)\s*'([a-z][A-Za-z0-9]*)'/g)].map((m) => m[1]!);
function iconNamesIn(src: string, file: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bicon="([^"]*)"/g)) out.push(m[1]!);                                     // <${Button} icon="plus">
  for (const m of src.matchAll(/\bicon=\$\{([^}]*)\}/g)) out.push(...quoted(m[1]!));                      // icon=${open ? 'chevronUp' : 'chevronDown'}
  for (const m of src.matchAll(/<\$\{(?:Icon|Glyph)\}[^>]*?\bname=(?:"([^"]*)"|\$\{([^}]*)\})/g)) out.push(...(m[1] ? [m[1]] : quoted(m[2]!)));
  for (const m of src.matchAll(/\bicon: (?:\(?)'([a-z][A-Za-z0-9]*)'/g)) out.push(m[1]!);                  // { icon: 'trash' }, registerView({ icon: 'home' })
  for (const m of src.matchAll(/\bIcon\.([a-z][A-Za-z0-9]*)\b/g)) out.push(m[1]!);                           // Icon.close
  for (const m of src.matchAll(/\b(?:svg|iconSvg)\('([^']*)'/g)) out.push(m[1]!);                          // svg('chevronDown', 12)
  for (const m of src.matchAll(/\bconst (?:ICON|ICONS|TYPE_ICON)\b[^=]*= \{([^}]*)\}/g)) out.push(...[...m[1]!.matchAll(/: '([^']*)'/g)].map((x) => x[1]!));   // name maps
  if (/svgfig\/ui\.js$/.test(file)) {
    const tools = /\bconst TOOLS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
    assert.ok(tools, 'svgfig/ui.js: the TOOLS table');
    for (const m of tools.matchAll(/\[\s*'[^']*',\s*(?:'[^']*'|`[^`]*`),\s*'([^']*)'\s*\]/g)) out.push(m[1]!);   // TOOLS: [tool, label, icon]
    for (const m of src.matchAll(/\bglyph\('([^']*)'/g)) out.push(m[1]!);                                // a Seg's icon
  }
  return out;
}

test('every icon name in the sources is in the registry (the htm and JavaScript call sites)', () => {
  const bad: string[] = [];
  let seen = 0;
  for (const f of SOURCES) {
    if (f.endsWith(join('ui', 'icon-set.ts'))) continue;
    const src = readFileSync(f, 'utf8');
    for (const n of iconNamesIn(src, f)) { seen++; if (!R.isIconName(n)) bad.push(`${relative(REPO, f)}: ${n}`); }
  }
  assert.ok(seen > 80, `the scan finds the call sites (${seen})`);
  assert.deepEqual(bad, []);
  // the scan itself: a typo is caught in each form
  const probe = `<\${IconButton} icon="pluss" /> <\${Icon} name="clse" /> Icon.chevronDwn svg('mor') { icon: 'trsh' } icon=\${side === 'left' ? 'eye' : 'eyeOf'}`;
  assert.deepEqual(iconNamesIn(probe, 'x.js').filter((n) => !R.isIconName(n)).sort(), ['chevronDwn', 'clse', 'eyeOf', 'mor', 'pluss', 'trsh']);
});
