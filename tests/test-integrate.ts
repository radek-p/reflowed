// the editor on the workbench: its documents as tabs, its panels as side panels, its home in the
// groups' home panels, the status and crumbs in the tabs, the keys, the layout restored on reload; and the performance
// guards of the integrated page.
//   node tests/test-integrate.ts [base=http://localhost:8151/] [--only <regex of section names>]
// On the tests' fixture document (?seed=sample, from the dev server's seed cache where it fits) and a second, small
// document made in the page. Every wait is on state (the editors idle, the workbench at rest), never on a time.
//
// Each section is its own file, tests/integrate/<name>.ts, whose default export takes the shared
// harness (tests/integrate/harness.ts); they run in the order of their names. A new section is a new file: nothing here
// lists them.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarness, type Harness } from './integrate/harness.ts';

const h = await createHarness(process.argv.slice(2));
const { HERE, OUT, browser, problems, results, check, section } = h;

// the page never scrolls from its first frame: index.html carries the workbench's viewport CSS as it is
{
  const { VIEWPORT_CSS } = await import('../workbench/src/viewport.ts');
  const page = readFileSync(join(HERE, 'app/index.html'), 'utf8');
  const m = page.match(/<style id="wb-viewport-css">([\s\S]*?)<\/style>/);
  check('index.html: the viewport CSS is the workbench\'s (ownViewport adopts it)', !!m && m[1]!.trim() === VIEWPORT_CSS.trim(), m?.[1]);
}

const names = readdirSync(join(HERE, 'tests/integrate')).filter((f) => f.endsWith('.ts') && f !== 'harness.ts').map((f) => f.slice(0, -3)).sort();
for (const name of names) {
  if (!section(name)) continue;
  const run = (await import(`./integrate/${name}.ts`)).default as (h: Harness) => Promise<void>;
  // a section that throws fails as itself; the sections after it still run
  try { await run(h); } catch (e) { check(`${name}: the section ran to its end`, false, String((e as Error)?.stack ?? e).split("\n").slice(0, 4).join(" | ")); }
}

await browser.close();
const bad = results.filter((r) => !r.ok);
const unexpected = problems.filter((p) => !/favicon|ResizeObserver loop/.test(p));
if (unexpected.length) console.log(`page problems:\n  ${[...new Set(unexpected)].slice(0, 20).join('\n  ')}`);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, problems: unexpected }, null, 1));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length || unexpected.length ? 1 : 0);
