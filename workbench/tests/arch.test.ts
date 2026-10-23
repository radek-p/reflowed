// Architecture guards: one tab strip for both hosts (the top bar's slot and a group's row).
//   node --test workbench/tests/arch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
/** Every source file under src/ (its subdirectories too), with its path from src/. */
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(js|ts)$/.test(e.name) ? [join(d, e.name)] : []);
const files = walk(SRC).filter((f) => !f.startsWith(join(SRC, 'kit'))).map((f) => [f.slice(SRC.length + 1), readFileSync(f, 'utf8')] as const);
const base = (f: string) => f.replace(/^.*\//, '').replace(/\.(js|ts)$/, '');
const all = files.map(([, s]) => s).join('\n');

test('one TabStrip component, rendered by both hosts (bar and row), nothing else renders document tabs', () => {
  assert.equal((all.match(/function TabStrip\(/g) ?? []).length, 1, 'one definition');
  const uses = all.match(/<\$\{TabStrip\}[^>]*host="(bar|row)"/g) ?? [];
  assert.deepEqual(uses.map((u) => u.match(/host="(\w+)"/)![1]).sort(), ['bar', 'row'], 'one use per host');
  assert.equal((all.match(/<\$\{TabPill\} /g) ?? []).length, 1, 'tabs are rendered in one place (inside TabStrip)');
  // the only other tablist is the side columns' panel tabs
  const lists = files.flatMap(([f, s]) => (s.match(/role="tablist"/g) ?? []).map(() => base(f)));
  assert.deepEqual(lists.sort(), ['sides', 'strip']);
  assert.ok(!/function Strip\(/.test(all), 'no second strip');
});

// The control library: every control is the kit's (src/kit). Outside it no control markup: no <button>, <input>,
// <select>, <textarea> (the demo's note view is content and keeps its textarea), no menu, grid, switch, tooltip or
// dialog roles, no button classes written by hand, no controls from the editor's kit.
test('no control markup outside src/kit (the workbench and the demo chrome)', () => {
  const DEMO = join(SRC, '../demo');
  const places = [...files.map(([f, s]) => [`src/${f}`, s] as const),
    ...readdirSync(DEMO).filter((f) => ['main', 'views', 'theme', 'gallery'].includes(base(f)) && /\.(js|ts)$/.test(f)).map((f) => [`demo/${f}`, readFileSync(join(DEMO, f), 'utf8')] as const)];
  const bad: string[] = [];
  for (const [f, s] of places) {
    if (f.startsWith('src/') && base(f) === 'css') continue;     // the workbench's CSS styles the kit's classes where they sit (the bars)
    const rules: [RegExp, string][] = [[/<(button|input|select)\b/g, 'a control element'], [/role="(menu|menuitem|menuitemradio|grid|gridcell|switch|tooltip|dialog|listbox|option)"/g, 'a control role'],
      [/['"`\s]wb-btn\b/g, 'the button class by hand (btnClass())'], [/\bui-btn\b|\bui-menu/g, 'the editor kit\'s classes'], [/design\/ui\/(overlays|controls)\.js/g, 'the editor kit\'s controls']];
    if (f.startsWith('src/')) rules.push([/<textarea\b/g, 'a control element']);
    for (const [re, what] of rules) for (const m of s.matchAll(re)) bad.push(`${f}: ${what}: ${m[0].trim()}`);
  }
  assert.deepEqual(bad, []);
});

// Every colour comes from the theme tokens: no literal colour outside the theme file (src/themes.ts). Comments are
test('no literal colours outside src/themes.ts (the workbench, the kit, the demo views)', () => {
  const DEMO = join(SRC, '../demo');
  const kit = readdirSync(join(SRC, 'kit')).filter((f) => /\.(js|ts)$/.test(f)).map((f) => [`src/kit/${f}`, readFileSync(join(SRC, 'kit', f), 'utf8')] as const);
  const places = [...files.filter(([f]) => f !== 'themes.ts').map(([f, s]) => [`src/${f}`, s] as const), ...kit,
    ...readdirSync(DEMO).filter((f) => /\.(js|ts)$/.test(f)).map((f) => [`demo/${f}`, readFileSync(join(DEMO, f), 'utf8')] as const)];
  const NAMED = 'white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon';
  const re = new RegExp(String.raw`(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?<![\w.])(?:rgba?|hsla?|hwb|oklab|oklch)\(|[:,(]\s*(?:${NAMED})\b(?![-\w])`, 'g');
  const bad: string[] = [];
  for (const [f, s] of places) {
    const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(re)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

// No markup from strings: the UI is Preact (htm) only; no hidden copies of the tabs built as HTML text (the measured
// fit's measuring copy is gone: the fit is a minimum, --wb-tab-min). Every file under src/, the kit's too.
test('no innerHTML anywhere in workbench/src', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(js|ts)$/.test(e.name) ? [join(d, e.name)] : []);
  const hits = walk(SRC).filter((f) => /innerHTML/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length + 1));
  assert.ok(walk(SRC).length > 10, 'the walk finds the sources');
  assert.deepEqual(hits, []);
});

// no module cycle through the UI: nothing imports ui.ts (the drawn workbench) but the public entry; the side
// columns take the splitter from split.ts. And the tab's parts live once, in tab/parts.ts, for
// every shell: the tab shell (tab/pill.ts) uses them; a breadcrumb shell will too.
test('no import of ui.ts but index.ts; the pill parts defined once (tab/parts.ts) and used by the tab shell', () => {
  const importsUi = files.filter(([f, s]) => /from '\.{1,2}\/ui\.ts'/.test(s) && !/^index\./.test(f)).map(([f]) => f);
  assert.deepEqual(importsUi, []);
  for (const part of ['DocChip', 'SectionChip', 'ChipLine', 'StatusLayer', 'DirtyDot', 'RenameField', 'statusOf']) {
    const defs = files.filter(([, s]) => new RegExp(`export (function|const) ${part}\\b`).test(s)).map(([f]) => f);
    assert.deepEqual(defs, ['tab/parts.ts'], `${part} is defined once, in tab/parts.ts`);
  }
  const pill = files.find(([f]) => f === 'tab/pill.ts')![1];
  for (const part of ['ChipLine', 'StatusLayer', 'DirtyDot', 'RenameField']) assert.ok(new RegExp(`<\\$\\{${part}\\}`).test(pill), `the tab shell draws ${part}`);
});

// what was duplicated is one helper each; the copies do not come back.
test('one helper each: the reduced-motion check (motion.ts), the drag look (drag.ts), a host shown or hidden (showHost), a drop\'s no-op (commitIfChanged)', () => {
  const where = (re: RegExp) => files.filter(([, s]) => re.test(s)).map(([f]) => f).sort();
  assert.deepEqual(where(/matchMedia\('\(prefers-reduced-motion/), ['motion.ts']);
  assert.deepEqual(where(/classList\.add\('wb-dragging'\)/), ['drag.ts']);
  assert.deepEqual(where(/'wb-sep--drag'\)/), ['split.ts'], 'the splitters\' drag look: splitterDrag');
  const store = files.find(([f]) => f === 'workbench.ts')![1];
  assert.equal((store.match(/classList\.toggle\('wb-panel--hidden'/g) ?? []).length, 1, 'showHost');
  assert.equal((store.match(/M\.sameShape\(/g) ?? []).length, 1, 'commitIfChanged');
});
