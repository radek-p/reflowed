// The themes (src/themes.ts): JSON registration, extends, validation, and the built-ins' lines equal to the editor's.
//   node --test workbench/tests/themes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN, TOKENS, registerTheme, resolveTheme, themes } from '../src/themes.ts';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../../app');
const WB = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE = readFileSync(join(APP, 'src/view/style.js'), 'utf8');
const APPCSS = readFileSync(join(APP, 'app.css'), 'utf8');
const norm = (c: string) => c.replace(/\s+/g, '').toLowerCase().replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3');

test('the built-ins: light, dark, sepia, high contrast; every token they set is known', () => {
  assert.deepEqual(BUILTIN.map((t) => t.id), ['light', 'dark', 'sepia', 'hc']);
  assert.deepEqual(BUILTIN.map((t) => t.type), ['light', 'dark', 'light', 'hc']);
  for (const t of BUILTIN) for (const k of Object.keys(t.colors ?? {})) assert.ok(Object.hasOwn(TOKENS, k), `${t.id}: ${k}`);
});

test('the splitter, the side column edges, the strip and top bar lines: one border per theme (the editor\'s, its --border-soft an alias)', async () => {
  // the editor's colours live here now (its CSS sets none: below); its sidebar edge, --border-soft, is an alias of
  // splitter.border, and every line of the workbench is that border in each theme (high contrast: #000, its top bar's too)
  const { EDITOR_VARIABLES } = await import('../src/theme-map.ts');
  assert.equal(EDITOR_VARIABLES.find((v) => v.css === '--border-soft')?.to, TOKENS['splitter.border'].css);
  const EDGE = { light: 'rgba(55, 53, 47, 0.07)', dark: 'rgba(255, 255, 255, 0.08)', sepia: 'rgba(69, 58, 38, 0.1)', hc: '#000' } as const;
  const PAGE = { light: '#fff', dark: '#191919', sepia: '#f4ecd8', hc: '#fff' } as const;
  for (const t of BUILTIN) {
    const id = t.id as keyof typeof EDGE;
    for (const k of ['splitter.border', 'panel.border', 'tabStrip.border', 'topBar.border'] as const) assert.equal(norm(t.colors![k]!), norm(EDGE[id]), `${t.id} ${k}`);
    assert.equal(norm(t.colors!['pageBackground']!), norm(PAGE[id]), `${t.id} page`);
  }
});

test('registerTheme: JSON (a string or an object), extends, unknown tokens and bad values reported, listed', () => {
  const r = registerTheme(JSON.stringify({ id: 'night', label: 'Night', type: 'dark', extends: 'dark', colors: { 'tab.activeBackground': '#334455', 'tab.nope': '#000', 'splitter.border': 'not a colour!' } }));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2, r.errors.join('; '));
  const t = resolveTheme('night')!;
  assert.equal(t.colors['tab.activeBackground'], '#334455');
  assert.equal(t.colors['pageBackground'], BUILTIN[1]!.colors!['pageBackground'], 'from dark');
  assert.equal(t.colors['splitter.border'], BUILTIN[1]!.colors!['splitter.border'], 'a bad value keeps the base\'s');
  assert.ok(themes().some((x) => x.id === 'night' && x.label === 'Night'));
  assert.equal(registerTheme({ id: 'x', type: 'blue', colors: {} }).ok, false);
  assert.equal(registerTheme('{ nope').ok, false);
  assert.equal(registerTheme({ id: 'y', type: 'light', extends: 'missing', colors: {} }).errors.length, 1);
});

// the editor's colour variables mapped onto the tokens (src/theme-map.ts): every variable of view/style.js's
// themes, of app.css's :root and of the kit's colour tokens is in the map; every token named exists; the table in
test('the theme map: complete over the editor\'s variables, its tokens real, the notes\' table current', async () => {
  const { EDITOR_VARIABLES } = await import('../src/theme-map.ts');
  const mapped = new Set(EDITOR_VARIABLES.map((v) => v.css));
  const decl = (css: string) => [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!);
  const NOT_COLOURS = new Set(['--col', '--sidebar-w']);
  const legacy = [...decl(STYLE.slice(STYLE.indexOf('const CSS'), STYLE.indexOf('html.contrast :focus-visible'))), ...decl(APPCSS.match(/:root \{[\s\S]*?\n\}/)![0])].filter((v) => !NOT_COLOURS.has(v));
  const TOKENSCSS = readFileSync(join(APP, 'src/design/tokens.css.js'), 'utf8');
  const kit = decl(TOKENSCSS).filter((v) => /^--ui-(ink|accent|on-accent|danger|warn|page|surface|border|tint|hover|press|on$|selected|field|ring-color|shadow|backdrop)/.test(v) || v === '--ui-on');
  const missing = [...new Set([...legacy, ...kit])].filter((v) => !mapped.has(v));
  assert.deepEqual(missing, [], 'every colour variable of the editor is in the map');
  // and the editor declares none of them itself: each is an alias of its token (app/src/design/theme.ts), only
  // the shadows (not colours) keep their own values
  const own = [...new Set([...legacy, ...kit])].filter((v) => !/shadow/.test(v));
  assert.deepEqual(own, [], 'the editor sets no colour variable of its own (the JSON themes are the one source)');
  for (const v of EDITOR_VARIABLES) {
    assert.match(v.to, /^--rfed-[a-z0-9]+(-[a-z0-9]+)*$/, `${v.css}: ${v.to} follows the scheme`);
    if (v.token) { assert.ok(Object.hasOwn(TOKENS, v.token), `${v.css}: ${v.token} is a token`); assert.equal(TOKENS[v.token].css, v.to, `${v.css}: ${v.token} sets ${v.to}`); }
    if (v.propose) assert.match(v.propose, /^([a-z][A-Za-z]*\.)?[a-z][A-Za-z]*$/, `${v.css}: ${v.propose} in VS Code's form`);
  }
  assert.equal(new Set(EDITOR_VARIABLES.map((v) => v.css)).size, EDITOR_VARIABLES.length, 'each variable once');
});

// from the workbench (no aliases), the editor's only in the migration table (theme-map.ts)
test('one scheme: every token --rfed-<role> or --rfed-<part>-<state>-<ink|bg|border>, its key VS Code\'s form; no old colour name left in the workbench', async () => {
  for (const [k, t] of Object.entries(TOKENS)) {
    assert.match(t.css, /^--rfed-[a-z0-9]+(-[a-z0-9]+)*$/, k);
    assert.match(k, /^([a-z][A-Za-z]*\.)?[a-z][A-Za-z]*$/, `${k}: VS Code's form`);
    if (k.includes('.')) assert.match(t.css, /-(ink|bg|border)$/, `${k}: a part's token ends in its property (${t.css})`);
  }
  const OLD = /(?<![\w-])--(ui-(accent|border|danger|field|hover|ink|on|page|press|ring|selected|surface|tint|warn)|wb-(ok|name|sec|sec-on|name-idle|tab-on-[a-z-]+|tab-hover|status-(err|err-band|run|done)|glass|strip-border|bar-glass|bar-border|mark-ink|divider|divider-on|panel-border|focus|ring|zone-bg|zone-border|insert)|bg|text|muted|accent|error|warn|panel-bg)(?![\w-])/;
  const { readdirSync } = await import('node:fs');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|html)$/.test(e.name) ? [join(d, e.name)] : []);
  const bad = [...walk(join(WB, 'src')), ...walk(join(WB, 'demo')), ...walk(join(WB, 'tests')).filter((p) => !p.endsWith('themes.test.ts'))]
    .filter((p) => !p.endsWith('theme-map.ts')).flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i) => [p.slice(WB.length + 1), i + 1, l] as const)).filter(([, , l]) => OLD.test(l)).map(([p, i, l]) => `${p}:${i}: ${l.trim().slice(0, 80)}`);
  assert.deepEqual(bad, []);
});
