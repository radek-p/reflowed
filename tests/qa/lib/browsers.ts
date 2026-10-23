// The browsers Playwright launches, where the installed ones are another revision (e.g. a sandbox where /opt/pw-browsers
// has the revision of the Playwright it was built with; app/node_modules may pin a newer one, and a download is not
// allowed there). When the revision app/'s Playwright expects is not installed, a shim directory maps it to the newest
// one installed (chromium and its headless shell, each in whichever layout it has: chrome-linux on arm64 and before
// 1.57, chrome-*-linux64 on x64 since) and PLAYWRIGHT_BROWSERS_PATH points at it, for this process and the suites it
// starts. Nothing changes when the expected revisions are installed, in any layout.
//   ensureBrowsers(repoRoot, base?) -> a note (what was done) | null
//   (base: the browsers directory; PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright by default)
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** the shim, under the repository root */
export const SHIM = 'test-results/pw-browsers';
const LAYOUTS: Record<string, string[]> = { chromium: ['chrome-linux64', 'chrome-linux'], chromium_headless_shell: ['chrome-headless-shell-linux64', 'chrome-linux'] };

export function ensureBrowsers(root: string, base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright')): string | null {
  let wanted: { name: string; revision: string }[];
  try { wanted = JSON.parse(readFileSync(join(root, 'app/node_modules/playwright-core/browsers.json'), 'utf8')).browsers; } catch { return null; }
  const rev = (name: string) => wanted.find((b) => b.name === name)?.revision;
  const shell = rev('chromium-headless-shell'), full = rev('chromium');
  if (!shell || !full || !existsSync(base)) return null;
  if (existsSync(join(base, `chromium-${full}`)) && existsSync(join(base, `chromium_headless_shell-${shell}`))) return null;
  const installed = readdirSync(base);
  const newest = (prefix: string) => installed.filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => +b.split('-').pop()! - +a.split('-').pop()!)[0];
  const shim = join(root, SHIM);
  rmSync(shim, { recursive: true, force: true });
  mkdirSync(shim, { recursive: true });
  const made: string[] = [];
  for (const [prefix, want] of [['chromium', full], ['chromium_headless_shell', shell]] as const) {
    const have = newest(prefix);
    if (!have) continue;
    const layout = LAYOUTS[prefix].find((d) => existsSync(join(base, have, d)));
    if (!layout) continue;
    const dir = join(shim, `${prefix}-${want}`);
    mkdirSync(dir);
    // the installed layout under every name the expected revision may look for (the old one may want the new layout)
    for (const name of LAYOUTS[prefix]) symlinkSync(join(base, have, layout), join(dir, name));
    for (const f of ['DEPENDENCIES_VALIDATED', 'INSTALLATION_COMPLETE']) writeFileSync(join(dir, f), '');
    made.push(`${prefix}-${want} -> ${have}`);
  }
  for (const d of installed.filter((x) => x.startsWith('ffmpeg-'))) symlinkSync(join(base, d), join(shim, d));
  if (!made.length) return null;
  process.env.PLAYWRIGHT_BROWSERS_PATH = shim;
  return `browsers: Playwright wants revision ${shell}, ${base} has others; a shim (${made.join(', ')}) at ${shim}`;
}
