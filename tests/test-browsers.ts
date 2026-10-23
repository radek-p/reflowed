// tests/qa/lib/browsers.ts ensureBrowsers, in Node on fake browser directories:
//   node tests/test-browsers.ts
// The expected revisions installed in either layout (arm64's chrome-linux, x64's chrome-*-linux64): nothing changes
// (a shim to a directory that does not exist fails every suite at launch). Another revision installed: a shim that offers it under both layout names.
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBrowsers, SHIM } from './qa/lib/browsers.ts';

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { n++; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`); };

function fixture(installed: Record<string, string>): { root: string; base: string } {
  const t = mkdtempSync(join(tmpdir(), 'rf-browsers-'));
  const root = join(t, 'repo'), base = join(t, 'pw');
  mkdirSync(join(root, 'app/node_modules/playwright-core'), { recursive: true });
  writeFileSync(join(root, 'app/node_modules/playwright-core/browsers.json'),
    JSON.stringify({ browsers: [{ name: 'chromium', revision: '1208' }, { name: 'chromium-headless-shell', revision: '1208' }] }));
  for (const [dir, layout] of Object.entries(installed)) mkdirSync(join(base, dir, layout), { recursive: true });
  return { root, base };
}
const saved = process.env.PLAYWRIGHT_BROWSERS_PATH;

for (const [arch, full, shell] of [['arm64', 'chrome-linux', 'chrome-linux'], ['x64', 'chrome-linux64', 'chrome-headless-shell-linux64']]) {
  const { root, base } = fixture({ 'chromium-1208': full, 'chromium_headless_shell-1208': shell });
  process.env.PLAYWRIGHT_BROWSERS_PATH = base;
  const note = ensureBrowsers(root, base);
  check(`${arch}: the expected revision installed: no shim`, note === null && process.env.PLAYWRIGHT_BROWSERS_PATH === base && !existsSync(join(root, SHIM)), note);
}

for (const [arch, layout] of [['arm64', 'chrome-linux'], ['x64', 'chrome-headless-shell-linux64']]) {
  const { root, base } = fixture({ 'chromium-1200': arch === 'x64' ? 'chrome-linux64' : 'chrome-linux', 'chromium_headless_shell-1200': layout });
  const note = ensureBrowsers(root, base);
  const shim = join(root, SHIM, 'chromium_headless_shell-1208');
  check(`${arch}: another revision: a shim`, note !== null && process.env.PLAYWRIGHT_BROWSERS_PATH === join(root, SHIM), note);
  check(`${arch}: the shim offers the installed layout under both names`,
    ['chrome-headless-shell-linux64', 'chrome-linux'].every((d) => existsSync(join(shim, d)) && readlinkSync(join(shim, d)) === join(base, 'chromium_headless_shell-1200', layout)));
}

if (saved === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = saved;
console.log(`\n${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
