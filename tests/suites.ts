// The suites of test-all, as data, and the "changed paths → suites" selector.
// tests/test-all.ts runs them; tests/test-select.ts checks the table. Nothing here starts a process.
//
// Each suite:
//   tier     the cheapest tier that always runs it: 'fast' (every tier), 'full' (only the full run, or when the
//            changed paths select it in standard)
//   minutes  its time limit in test-all
//   cmd      its command, given the servers and the file
//   sample   its sampled form (standard tier): the exhaustive suites (caret, caret-bounds)
//   timing   its checks measure time: rerun once on a failure (the flaky ledger), run in the quiet phase with --lanes
//   alone    runs in the quiet phase (alone, after the lanes): timing suites and those that sample frames
//   cold     dev suites that must typeset from nothing (the compile path); the others get the dev seed cache
//            (tests/integration/serve.ts --seed-cache): the same results the release carries, 0 compiles to open
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Group = 'unit' | 'dev' | 'file' | 'smoke';
export type Tier = 'fast' | 'full';
/** dev: the dev app (seeded or cold, as the suite asks); file: the single file */
export interface Ctx { dev: string; file: string }
export interface Suite {
  name: string; group: Group; tier: Tier; minutes: number;
  cmd: (c: Ctx) => string[];
  sample?: (c: Ctx) => string[];
  timing?: boolean; alone?: boolean; cold?: boolean;
  /** file: the built single file (dist/); intro: build/seed/intro.json (node scripts/seed.ts) */
  needs?: 'file' | 'intro';
  /** runs only against the seeded dev server (skipped with --cold, or when the cache does not fit the worker) */
  seedOnly?: boolean;
  /** why it is cold or alone, shown by --list */
  note?: string;
}

const node = (...a: string[]) => [process.execPath, ...a];
const S = (name: string, group: Group, minutes: number, cmd: Suite['cmd'], more: Partial<Suite> = {}): Suite =>
  ({ name, group, minutes, cmd, tier: 'full', ...(group === 'file' || group === 'smoke' ? { needs: 'file' } : {}), ...more });
const FAST = { tier: 'fast' as const };

export const SUITES: Suite[] = [
  // ── units (Node; kit in Chromium without the app) ──
  S('typecheck', 'unit', 5, () => node('scripts/typecheck.ts'), FAST),
  S('select', 'unit', 2, () => node('tests/test-select.ts'), FAST),   // this table and the selector
  S('browsers', 'unit', 1, () => node('tests/test-browsers.ts'), FAST),   // the Playwright browser shim
  S('static-server', 'unit', 1, () => node('tests/test-static-server.ts'), FAST),   // the suites' static server (tests/qa/lib/static-server.ts): an awkward host's ways
  S('engine-stamp', 'unit', 2, () => node('tests/test-engine-stamp.ts'), FAST),
  S('engine-build-id', 'unit', 3, () => node('tests/test-engine-build-id.ts'), FAST),
  S('seed-title-form', 'unit', 2, () => node('tests/test-seed-title-form.ts'), FAST),   // the seeds' title in the title form's format
  S('intro-versions', 'unit', 1, () => node('samples/intro/variants.test.ts'), FAST),   // the intro's two versions (samples/intro/variants.ts) and the editor's seed of it
  S('site-intro', 'unit', 1, () => node('website/tools/prepare-intro.test.ts'), FAST),   // the website's copy of the intro (website/tools/prepare-intro.ts)
  S('w15-units', 'unit', 5, () => node('tests/test-w15-units.ts'), FAST),
  S('in-view', 'unit', 1, () => node('app/src/docview/in-view.test.ts'), FAST),   // the section in view: the crumbs' and the Outline's one rule (docview/in-view.ts)
  S('drag-rules', 'unit', 1, () => node('app/src/docview/drag-rules.test.ts'), FAST),   // a block drag's rules: the drop pane, the autoscroll's speed and dwell, the places offered, a cancel's landing (docview/drag-rules.ts)
  S('end-meta', 'unit', 1, () => node('app/src/docview/end-meta.test.ts'), FAST),   // the end space's foot as text: title, words, blocks, the day of the last edit (docview/end-meta.ts)
  S('arch-units', 'unit', 2, () => node('tests/test-arch-units.ts'), FAST),   // the refactor's ratchets
  S('doc-units', 'unit', 2, () => node('tests/test-doc-units.ts'), FAST),     // (6–8) app/src/doc/ on a Memory store
  S('loading-units', 'unit', 1, () => node('loading/loading.test.ts'), FAST),   // loading/: both trees' indexes, the fetch front ends, the status store   // the TeX resource server: ls-R, the provider chain, the HTTP provider
  S('kept-docs', 'unit', 1, () => node('tests/test-kept-docs.ts'), FAST),   // engine/web/kept-docs.js: released documents' states, the last 2
  S('commands-units', 'unit', 2, () => node('tests/test-commands-units.ts'), FAST),   // the registry, the shortcuts' rows, the commands on a DocSession
  S('kit', 'unit', 3, () => node('tests/test-kit.ts'), FAST),
  S('editor-frame', 'unit', 2, () => node('tests/test-editor-frame.ts'), FAST),   // the block source editor in a frame's document: its own elements, undo and redo asked of onKey   // the kit's shared parts in Chromium, no app
  S('refnav-host', 'unit', 3, () => node('tests/test-refnav-host.ts'), FAST),   // reference navigation (refnav/listen.ts) on a page with only the viewer, and in a frame: one gesture table, recorded hooks
  S('pdf-svg', 'unit', 2, () => node('engine/tests/pdf-svg.test.ts'), FAST),   // PDF pictures as SVG
  S('file-deps', 'unit', 1, () => node('engine/tests/file-deps.test.ts'), FAST),   // a stored result used only while the files its runs read are as they were
  S('keys', 'unit', 2, () => node('tests/test-keys.ts'), { ...FAST, cold: true, note: 'result keys: the compile path' }),   // result keys memoised, byte-identical
  S('motion-units', 'unit', 2, () => node('tests/test-motion-units.ts'), FAST),   // the popover's placement, toSourceOffset's memo
  S('view-units', 'unit', 2, () => node('tests/test-view-units.ts'), FAST),   // diff.js, copy-errors.js
  S('minify', 'unit', 2, () => node('tests/test-minify.ts'), FAST),
  S('tex', 'unit', 2, () => node('app/src/tex/definitions.test.ts'), FAST),
  S('tex-lex', 'unit', 2, () => node('app/src/tex/lex.test.ts'), FAST),
  S('tex-calls', 'unit', 2, () => node('app/src/tex/calls.test.ts'), FAST),
  S('provenance', 'unit', 2, () => node('tests/test-provenance.ts'), FAST),
  S('brand', 'unit', 2, () => node('tests/test-brand.ts'), FAST),   // the app's icon in the window bar and the favicon
  S('w4-units', 'unit', 3, () => node('tests/test-w4.ts', '--units'), FAST),
  S('cite-units', 'unit', 2, () => node('tests/test-cite.ts', '--units'), FAST),   // bibtex-style citations: \bibitem numbers, contexts
  S('cite-engine', 'unit', 15, () => node('tests/test-cite.ts', '--engine')),   // block runs' \bibcite = print's; the one-.tex export
  S('bundle-cache', 'unit', 2, () => node('tests/test-bundle-cache.ts'), FAST),   // the TeX bundle's disk cache: cold, offline, damaged, two servers at once
  S('engine-node', 'unit', 40, () => node('tests/test-w1.ts', '--node'), { cold: true }),
  // ── the workbench (standalone): its own page, served from memory by its suite (no dev server, no port) ──
  S('workbench-units', 'unit', 3, () => node('--test', ...['model', 'keys', 'arch', 'viewport', 'themes', 'progress', 'helpers', 'icons', 'overlay-scrollbar'].map((f) => `workbench/tests/${f}.test.ts`)), FAST),   // the units and the guards (model, keys, arch, viewport, themes, progress, helpers, icons: the one icon registry, overlay-scrollbar: the own bar's thumb)
  S('workbench', 'unit', 15, () => node('workbench/tests/e2e.ts')),   // the browser suite on the demo (ARIA, keys, drags, persistence)
  // ── the dev app ──
  S('dev-seed', 'dev', 5, (c) => node('tests/test-dev-seed.ts', `${c.dev}/`), { seedOnly: true }),
  S('fewer-requests', 'dev', 5, (c) => node('tests/test-fewer-requests.ts', `${c.dev}/`), { seedOnly: true }),   // the dev page takes the TeX set as one pack, compressed and cacheable, not file by file
  S('fmt-early', 'dev', 5, (c) => node('tests/test-fmt-early.ts', `${c.dev}/`), { seedOnly: true }),   // the intro shown from the seed cache with the format held back 30 s, the engine's files asked for before the UI, the format compressed and cacheable
  S('webkit-open', 'dev', 5, (c) => node('tests/test-webkit-open.ts', `${c.dev}/`), { seedOnly: true }),   // the paper opened from the seed cache in WebKit: one mount a block, a few requests, within 4x Chromium's time
  S('fixture-cache', 'dev', 5, (c) => node('tests/test-fixture-cache.ts', `${c.dev}/`, c.file), { seedOnly: true }),   // the fixture's blocks: stale recorded again, cold still compiles, never in a release   // the seeded dev server opens the paper with 0 compiles
  S('app-bundle', 'dev', 2, () => node('tests/test-app-bundle.ts'), FAST),   // (after the dev bundle and worker builds)
  S('resources', 'dev', 10, (c) => node('tests/test-resources.ts', '--url', c.dev, '--file', c.file), { cold: true, needs: 'file', note: 'the engine on the release\'s embedded set only, with and without the TeX resource server' }),
  S('resources-origin', 'dev', 5, (c) => node('tests/test-resources-origin.ts', '--file', c.file), { needs: 'file', note: 'the single file over http (a static server on a free port), the tree beside it by default; Chromium, Firefox, WebKit probes' }),
  S('resources-setting', 'dev', 5, (c) => node('tests/test-resources-setting.ts', `${c.dev}/`)),   // the TeX resource server's address in the Settings panel (Advanced)
  S('recovery', 'dev', 15, (c) => node('engine/tests/recovery.test.ts', '--url', c.dev), { cold: true, note: 'the worker failing and restarting' }),
  S('colour-maps', 'dev', 3, (c) => node('tests/test-colour-maps.ts', `${c.dev}/`)),   // the editor's colour maps given before the viewer's first block are the ones in force
  S('live-preview', 'dev', 5, (c) => node('tests/test-live-preview.ts', `${c.dev}/`)),   // the live preview on a plain page and in an iframe: caret, selection, clicks, fuzzy, swapIn, renderClick
  S('page-fonts', 'dev', 5, (c) => node('tests/test-page-fonts.ts', `${c.dev}/`)),   // the worker's fonts given to the viewer as bytes; no global patched, no @font-face rule
  S('fonts-dump', 'dev', 3, (c) => node('engine/tests/fonts-dump.test.ts', '--url', c.dev), FAST),   // the worker's dumpFonts has every font served, after later blocks patched others (the seed's fonts)
  S('home', 'dev', 10, (c) => node('tests/test-home.ts', `${c.dev}/`, '--no-shots'), FAST),   // the Documents view (Preact)
  S('reset-dev', 'dev', 5, (c) => node('tests/integration/test-reset.ts', c.dev), FAST),   // the dev server's /reset page (the app's wipe module)
  S('home-samples-dev', 'dev', 15, (c) => node('tests/test-samples.ts', 'dev', `${c.dev}/`)),   // updated samples, Reset local data…
  S('intro-dev', 'dev', 5, (c) => node('tests/test-intro.ts', 'dev', `${c.dev}/`)),   // the introduction: on Home, typesets, its pictures drawn, refs, edit + undo
  S('w10', 'dev', 15, (c) => node('tests/test-w10.ts', `${c.dev}/`, '--no-shots')),   // reference navigation (card, Back) on the dev app
  S('w3', 'dev', 25, (c) => node('tests/test-w3.ts', `${c.dev}/`, '--no-shots')),
  S('offered-kinds', 'dev', 5, (c) => node('tests/test-offered-kinds.ts', `${c.dev}/`)),   // the slash menu and the kind switcher list only the kinds the preamble and class define
  S('e2e-dev', 'dev', 30, (c) => node('tests/test-e2e.ts', 'dev', `${c.dev}/`, '--no-shots'), { cold: true, note: 'acceptance from a first open: every block compiles' }),
  S('panes', 'dev', 20, (c) => node('tests/test-panes.ts', `${c.dev}/`), { alone: true, note: 'the leak check reads the heap' }),   // the two panes are equal
  S('block-drag', 'dev', 25, (c) => node('tests/test-block-drag.ts', `${c.dev}/`), { alone: true, note: 'long tasks and layouts per move; autoscroll by frames' }),   // a block dragged by its handle: in a pane, between panes, no-drop places, Esc, undo; Chromium, WebKit, Firefox
  S('public-bundles', 'unit', 1, () => node('tests/test-public-bundles.ts')),   // the public checkout (REFLOWTEX, else a sibling checkout); its bundles built on demand (a fresh clone builds the app)
  S('integrate', 'dev', 10, (c) => node('tests/test-integrate.ts', `${c.dev}/`)),   // the editor on the workbench: tabs, splits, two documents, panels, home, status, keys, reload
  S('two-editors', 'dev', 10, (c) => node('tests/test-two-editors.ts', `${c.dev}/`), { alone: true, note: 'the leak check reads listener and node counts' }),   // two editors in two divs, apart; one unmounted leaves nothing
  S('follow', 'dev', 10, (c) => node('tests/test-follow.ts', `${c.dev}/`)),   // two tabs on one document: edits, inserts, moves, deletes, the title followed; an open editor's two cases; deleted elsewhere
  S('motion', 'dev', 15, (c) => node('tests/test-motion.ts', `${c.dev}/`), { timing: true, alone: true }),   // the popover's motion, the followed caret, both panes
  S('calibrate', 'dev', 5, (c) => node('tests/test-calibrate.ts', `${c.dev}/`), { timing: true, alone: true, note: 'loads the host on purpose (CPU burners)' }),   // the timing limits' calibration: the factor, a regression still caught, under load
  S('widths', 'dev', 20, (c) => node('tests/test-widths.ts', `${c.dev}/`), { timing: true, alone: true }),   // width changes: lines kept while moving, then re-broken once
  S('notes', 'dev', 20, (c) => node('tests/test-notes.ts', `${c.dev}/`, '--no-shots')),   // the note chips on the engine (test-w6's page parts)
  S('settings', 'dev', 15, (c) => node('tests/test-settings.ts', `${c.dev}/`)),   // the Settings panel's tabs and its document tab (preamble, bibliography); the engine
  S('view', 'dev', 10, (c) => node('tests/test-view.ts', `${c.dev}/`), FAST),   // the View popover and its button
  S('files', 'dev', 2, (c) => node('tests/test-files.ts', `${c.dev}/`), FAST),   // the Files panel: hidden by default, the export's own list
  S('chrome', 'dev', 10, (c) => node('tests/test-chrome.ts', `${c.dev}/`), { alone: true, note: 'frame sampling (the top bar holds still)' }),
  S('sidebar', 'dev', 10, (c) => node('tests/test-sidebar.ts', `${c.dev}/`)),   // the sidebar's chrome, Add a block
  S('refs-panel', 'dev', 8, (c) => node('tests/test-refs-panel.ts', `${c.dev}/`)),   // the References pane's rows: years aligned, sizes, keyboard, one dialog per paste
  S('zoom-caret', 'dev', 8, (c) => node('tests/test-zoom-caret.ts', `${c.dev}/`)),   // caret, caret bar and selection at text zoom 80–200 % as at 100 %
  S('gallery', 'dev', 3, (c) => node('tests/test-gallery.ts', `${c.dev}/`)),   // every UI component in four themes (app/gallery.html)
  S('inspector', 'dev', 3, (c) => node('tests/test-inspector.ts', `${c.dev}/`), FAST),   // the public inspector on one pane (advanced)
  S('selection-dev', 'dev', 15, (c) => node('tests/test-selection.ts', 'dev', `${c.dev}/`)),
  S('cref-dev', 'dev', 15, (c) => node('tests/test-cref.ts', 'dev', `${c.dev}/`), FAST),
  S('popover-hold', 'dev', 10, (c) => node('tests/test-popover-hold.ts', `${c.dev}/`), { alone: true, note: 'frame sampling (±1 px)' }),
  S('popover-keys', 'dev', 5, (c) => node('tests/test-popover-keys.ts', `${c.dev}/`)),   // the editing popover by keyboard (Tab, Enter, Escape, the focus back) and its error note's status region, each layout
  S('ios-zoom', 'dev', 3, (c) => node('tests/test-ios-zoom.ts', `${c.dev}/`)),   // WebKit iPhone: tapping to edit does not zoom (editables >= 16 px on a coarse pointer)
  S('mobile-fit', 'dev', 5, (c) => node('tests/test-mobile-fit.ts', `${c.dev}/`)),   // phones: the app fits above the keyboard (the 50 % cap of the visible part, the caret in view), the safe areas and theme-color
  S('mobile-chrome', 'dev', 5, (c) => node('tests/test-mobile-chrome.ts', `${c.dev}/`)),   // phones: one row of chrome, the save state on the tab only, Add to Home Screen
  S('far-dev', 'dev', 15, (c) => node('tests/test-far.ts', 'dev', `${c.dev}/`), { timing: true, alone: true }),   // far jumps and End/Home without passing every block
  S('cite-card-dev', 'dev', 20, (c) => node('tests/test-cite-card.ts', 'dev', `${c.dev}/`)),   // the citation card; go-to out of a section focus, Back
  S('cite-dev', 'dev', 15, (c) => node('tests/test-cite.ts', 'dev', `${c.dev}/`)),   // the intro's citations, the biblatex document unchanged
  S('sheets', 'dev', 10, (c) => node('tests/test-sheets.ts', `${c.dev}/`), FAST),   // one side sheet, registered views
  S('caret-bounds', 'dev', 25, (c) => node('tests/test-caret-bounds.ts', `${c.dev}/`),   // the preview caret at every inline-maths boundary
    { sample: (c) => node('tests/test-caret-bounds.ts', `${c.dev}/`, '--sample', '60') }),
  S('boot', 'dev', 5, (c) => node('tests/test-boot.ts', `${c.dev}/`), { alone: true, note: 'the first painted frame' }),   // the loader follows the theme
  S('doc-header', 'dev', 10, (c) => node('tests/test-doc-header.ts', `${c.dev}/`), FAST),   // the document switcher and the rename pencil
  S('meta-dev', 'dev', 20, (c) => node('tests/test-meta.ts', `${c.dev}/`), { cold: true, note: 'the title form typesets its block' }),    // the title form
  S('readonly-dev', 'dev', 10, (c) => node('tests/test-readonly.ts', 'dev', `${c.dev}/`), FAST),
  S('older-core-dev', 'dev', 10, (c) => node('tests/test-older-core.ts', 'dev', `${c.dev}/`), FAST),
  S('replay-dev', 'dev', 10, (c) => node('tests/test-replay.ts', 'dev', `${c.dev}/`), FAST),
  S('quota-dev', 'dev', 5, (c) => node('tests/test-quota.ts', 'dev', `${c.dev}/`), FAST),
  S('caret-math-dev', 'dev', 15, (c) => node('tests/test-caret-math.ts', 'dev', `${c.dev}/`), FAST),
  S('caret-dev', 'dev', 60, (c) => node('tests/test-caret.ts', 'dev', `${c.dev}/`, '--per', '8'),
    { sample: (c) => node('tests/test-caret.ts', 'dev', `${c.dev}/`, '--per', '2', '--sample', '40') }),
  // ── the single file (a release build: --file) ──
  S('build-chromium', 'file', 20, (c) => node('tests/test-build.ts', '--chromium', '--file', c.file)),
  S('e2e-file', 'file', 30, (c) => node('tests/test-e2e.ts', 'file', c.file, '--no-shots')),
  S('caret-file', 'file', 60, (c) => node('tests/test-caret.ts', 'file', c.file, '--per', '8'),
    { sample: (c) => node('tests/test-caret.ts', 'file', c.file, '--per', '2', '--sample', '40') }),
  S('far-file', 'file', 15, (c) => node('tests/test-far.ts', 'file', c.file), { timing: true, alone: true }),
  S('cite-card-file', 'file', 20, (c) => node('tests/test-cite-card.ts', 'file', c.file)),
  S('cite-file', 'file', 15, (c) => node('tests/test-cite.ts', 'file', c.file)),
  S('readonly-file', 'file', 10, (c) => node('tests/test-readonly.ts', 'file', c.file)),
  S('older-core-file', 'file', 10, (c) => node('tests/test-older-core.ts', 'file', c.file)),
  S('home-samples-file', 'file', 15, (c) => node('tests/test-samples.ts', 'file', c.file)),   // the same from file://
  S('intro-file', 'file', 5, (c) => node('tests/test-intro.ts', 'file', c.file)),   // the introduction from file://
  S('release-mode', 'file', 10, (c) => node('tests/test-release-mode.ts', c.file)),
  S('caret-math-file', 'file', 15, (c) => node('tests/test-caret-math.ts', 'file', c.file)),
  S('fonts-flicker', 'file', 20, (c) => node('tests/test-fonts.ts', c.file), { alone: true, note: 'frame sampling' }),   // finished blocks do not flicker
  S('cache', 'file', 10, (c) => node('tests/test-cache.ts', c.file), { cold: true }),
  S('nested-seed', 'file', 30, (c) => node('tests/test-nested-seed.ts', c.file), { cold: true }),
  S('refnav-hit', 'file', 15, (c) => node('tests/test-refnav-hit.ts', c.file)),   // a reference's hover area is its own glyphs
  S('anchor', 'file', 25, (c) => node('tests/test-w11-anchor.ts', '--html', c.file, '--label', 'all'), { timing: true, alone: true }),
  S('anchor-motion', 'file', 25, (c) => node('tests/test-w11-anchor.ts', '--html', c.file, '--motion', '--label', 'all-motion'), { timing: true, alone: true }),
  S('smoke-firefox-webkit', 'smoke', 30, (c) => node('tests/test-build.ts', '--firefox', '--webkit', '--file', c.file)),
  // the multi-file release beside the file (dist/reflowtex-editor/), over http from a subdirectory as on a static
  // host (no type for .wasm, gzip with no Content-Length, slowed), Chromium, Firefox, WebKit
  S('fewer-requests-release', 'file', 10, (c) => node('tests/test-fewer-requests.ts', '--release', c.file, ...(existsSync(join(ROOT, 'build/resources/www/texlive')) ? ['--tree', 'build/resources/www'] : [])), { note: 'a static server on a free port; what the UI needs in one request; with the TeX tree installed (scripts/fetch-engine.ts), a package from it in one round of parallel requests' }),
  S('fmt-early-release', 'file', 20, (c) => node('tests/test-fmt-early.ts', '--release', c.file), { note: 'a static server on a free port; the intro shown with the engine packs held back 30 s' }),
  S('multifile', 'file', 20, (c) => node('tests/test-multifile.ts', '--file', c.file), { note: 'static servers on free ports; the loading indicator, the engine from the packs, requests' }),
];
// the suites the intro is the subject of (they stop at once without it): skipped, with the reason, where it is not built
for (const s of SUITES) if (['popover-hold', 'refs-panel', 'files', 'e2e-dev', 'widths', 'far-dev'].includes(s.name)) s.needs ??= 'intro';
export const byName = new Map(SUITES.map((s) => [s.name, s]));
const DUMMY: Ctx = { dev: 'http://x', file: '/x.html' };
/** the script a suite runs (repository-relative) */
export const scriptOf = (s: Suite) => s.cmd(DUMMY).find((a) => /\.(ts|js|mjs)$/.test(a) && a !== process.execPath)!;
/** the dev suites that get the seed cache (all but the cold ones) */
export const seeded = (s: Suite) => s.group === 'dev' && !s.cold && s.name !== 'app-bundle';

/** Seconds per suite in the last full runs (both logs): estimates until test-all has history of its own.
 *  The suites added since (chrome, files, inspector, widths, select) are guessed. */
export const EST_SECONDS: Record<string, number> = {
  typecheck: 1, select: 1, browsers: 1, 'static-server': 1, 'engine-stamp': 1, 'engine-build-id': 1, 'seed-title-form': 1, 'intro-versions': 1, 'site-intro': 1, 'w15-units': 1, 'in-view': 1, 'drag-rules': 1, 'end-meta': 1, 'arch-units': 1, 'doc-units': 1, 'commands-units': 1, kit: 3,
  'pdf-svg': 1, 'file-deps': 1, 'loading-units': 1, resources: 40, 'resources-setting': 25, 'resources-origin': 90, 'workbench-units': 2, workbench: 120, keys: 1, 'motion-units': 1, 'view-units': 1, minify: 1, tex: 1, 'tex-lex': 1, 'tex-calls': 1,
  provenance: 1, brand: 1, 'w4-units': 1, 'cite-units': 1, 'cite-engine': 38, 'bundle-cache': 3, 'engine-node': 90,
  'app-bundle': 1, 'dev-seed': 12, 'webkit-open': 11, 'fmt-early': 60, 'fewer-requests': 30, 'fewer-requests-release': 40, 'fmt-early-release': 180, 'fixture-cache': 20, recovery: 18, 'fonts-dump': 2, 'editor-frame': 3, 'refnav-host': 6, 'page-fonts': 25, 'live-preview': 30, 'colour-maps': 15, home: 2, 'offered-kinds': 15, 'reset-dev': 1, 'home-samples-dev': 29, w10: 37, w3: 27, 'e2e-dev': 140,
  panes: 82, 'block-drag': 240, 'two-editors': 60, follow: 40, 'popover-keys': 40, 'kept-docs': 1, motion: 142, widths: 240, notes: 19, settings: 18, view: 7, files: 10, chrome: 60,
  sidebar: 11, inspector: 10, 'refs-panel': 30, 'selection-dev': 21, 'cref-dev': 3, 'popover-hold': 45, 'ios-zoom': 30, 'mobile-fit': 60, 'far-dev': 100, 'cite-card-dev': 226,
  'cite-dev': 76, sheets: 4, 'caret-bounds': 1289, boot: 54,
  'doc-header': 3, 'meta-dev': 125, 'readonly-dev': 2, 'older-core-dev': 4, 'replay-dev': 12, 'quota-dev': 1, 'caret-math-dev': 7,
  'caret-dev': 564, 'build-chromium': 8, 'e2e-file': 76, 'caret-file': 486,
  calibrate: 40, 'far-file': 41, 'cite-card-file': 66, 'cite-file': 18, 'readonly-file': 2, 'older-core-file': 4, 'home-samples-file': 8,
  'release-mode': 2, 'caret-math-file': 7, 'fonts-flicker': 28, cache: 46, 'nested-seed': 38, 'refnav-hit': 56,
  anchor: 95, 'anchor-motion': 98, 'smoke-firefox-webkit': 25, multifile: 150,
};
/** sampled forms: their estimate (the sample's share of the exhaustive run) */
export const EST_SAMPLED_SECONDS: Record<string, number> = { 'caret-bounds': 150, 'caret-dev': 120, 'caret-file': 100 };

// ── the selector ─────────────────────────────────────────────────────────────
// A rule: path globs (repository-relative; ** any depth, * within a name, {a,b} either) → suites. The union over the
// changed paths is the selection. A path no rule matches selects the WIDE set and is printed ("unmapped"), so the
// table grows. Rules for tests/<script>.ts are derived: the suites that run that script.

/** app.js and main.js, the core the refactor moves: the wide set */
export const WIDE = ['panes', 'e2e-dev', 'w3', 'recovery', 'keys', 'meta-dev', 'cite-card-dev', 'far-dev',
  'notes', 'w10', 'selection-dev', 'caret-dev', 'motion', 'widths', 'chrome', 'two-editors', 'integrate'];
const STORE = ['home', 'reset-dev', 'home-samples-dev', 'recovery', 'quota-dev', 'readonly-dev', 'older-core-dev', 'replay-dev', 'cache', 'follow', 'doc-units'];
const ENGINE_CORE = ['engine-node', 'engine-stamp', 'engine-build-id', 'cite-engine', 'nested-seed', 'e2e-dev', 'caret-dev', 'keys'];
const RELEASE = ['public-bundles', 'build-chromium', 'release-mode', 'minify', 'provenance', 'home-samples-file', 'e2e-file', 'smoke-firefox-webkit', 'multifile', 'fmt-early-release', 'fewer-requests-release'];
const EDIT = ['caret-dev', 'caret-bounds', 'selection-dev', 'caret-math-dev', 'popover-hold', 'popover-keys', 'follow', 'motion', 'ios-zoom', 'mobile-fit'];
const UI = ['kit', 'sheets', 'settings', 'view', 'boot', 'sidebar', 'chrome', 'doc-header', 'inspector', 'files', 'mobile-fit', 'mobile-chrome'];

export interface Rule { paths: string[]; suites: string[]; why: string }
export const RULES: Rule[] = [
  { why: 'docs and the licence', paths: ['**/*.md', 'LICENSE', '**/test-results/**', '.gitignore', '**/.gitignore'], suites: [] },
  { why: 'the core (app.js, main.js)', paths: ['app/src/app/app.js', 'app/src/main.js', 'app/src/app/editor-root.ts', 'app/src/rtx-modules.d.ts', 'app/src/app/editor-entry.js', 'app/src/doc/kinds.ts', 'app/src/app/stubs.js', 'app/src/app/model.js', 'app/src/app/panels.ts', 'app/src/app/source-position.js', 'app/src/tex/texscan.js', 'app/src/app/test-fixture.js', 'app/src/contracts.d.ts', 'app/index.html', 'app/app.css', 'app/package.json', 'app/package-lock.json'], suites: WIDE },
  { why: 'the core, other parts', paths: ['app/src/app/**'], suites: WIDE },
  { why: 'the two-editors harness', paths: ['app/src/harness/**', 'app/two-editors.html', 'tests/test-two-editors.ts'], suites: ['two-editors', 'typecheck', 'arch-units'] },
  { why: 'the kinds a document offers: the slash menu, the kind switcher', paths: ['app/src/doc/kinds.ts', 'app/src/doc/kind-probe.ts', 'app/src/app/doc-menus.ts', 'app/src/chrome/menu.ts', 'app/src/io/split.ts'], suites: ['offered-kinds'] },
  { why: 'the document model', paths: ['app/src/doc/**'], suites: [...WIDE, 'replay-dev', 'readonly-dev', 'w15-units', 'cache', 'keys', 'doc-units', 'follow'] },
  { why: 'commands', paths: ['app/src/commands/**'], suites: [...WIDE, 'selection-dev', 'chrome', 'sidebar', 'commands-units'] },
  { why: 'the dev seed cache', paths: ['app/src/app/dev-seed.js'], suites: ['dev-seed'] },
  { why: 'the fixture cache', paths: ['tests/integration/fixture-cache.ts', 'tests/integration/record-seed-cache.ts', 'app/src/app/test-fixture.js'], suites: ['fixture-cache', 'dev-seed'] },
  { why: 'the compile queue, keys', paths: ['app/src/app/compile-queue.js', 'app/src/doc/cache-key.js'], suites: ['w15-units', 'keys', 'recovery', 'cache', 'e2e-dev', 'webkit-open'] },
  { why: 'the open path (blocks, the engine backend)', paths: ['app/src/panes/blocks.js', 'engine/web/backend.js', 'tests/test-webkit-open.ts'], suites: ['webkit-open', 'dev-seed', 'fmt-early'] },
  { why: 'the open does not wait for the engine; the engine\'s files early', paths: ['engine/web/backend.js', 'engine/src/worker.ts', 'loading/page-loader.ts', 'tests/test-fmt-early.ts'], suites: ['fmt-early', 'fmt-early-release', 'recovery'] },
  { why: 'fewer requests: the dev page\'s TeX pack, the release\'s start-up file', paths: ['tests/integration/serve.ts', 'engine/src/worker.ts', 'loading/**', 'scripts/lib/multifile.ts', 'tests/test-fewer-requests.ts'], suites: ['fewer-requests', 'fewer-requests-release', 'fmt-early', 'multifile', 'resources', 'loading-units'] },
  { why: 'the router', paths: ['app/src/app/router.js'], suites: ['home', 'far-dev', 'cite-card-dev'] },
  { why: 'saving', paths: ['app/src/doc/save-state.js', 'app/src/app/read-only.js', 'app/src/app/older-core.js', 'app/src/app/quota.js', 'app/src/app/purge-retired-sample.js'], suites: STORE },
  { why: 'loading/: the page\'s files from the trees beside it (the release, the TeX tree), the boot loader, the one loading status', paths: ['loading/**'], suites: ['loading-units', 'resources', 'resources-origin', 'resources-setting', 'multifile', 'typecheck', 'arch-units'] },
  { why: 'the multi-file release and the loading status line', paths: ['app/src/boot/**', 'scripts/lib/multifile.ts'], suites: ['multifile', 'typecheck', 'boot', 'chrome'] },
  { why: 'release mode', paths: ['app/src/app/release-mode.js', 'app/src/app/build-version.js', 'app/src/app/about.js'], suites: ['release-mode', 'build-chromium', 'boot'] },
  { why: 'the inspector in the releases: on demand in the multi-file one, none in the single file', paths: ['app/src/inspector/**', 'scripts/lib/app-bundle.ts'], suites: ['release-mode', 'inspector', 'multifile'] },
  { why: 'store, io, home', paths: ['app/src/store/**', 'app/src/io/**', 'app/src/home/**'], suites: STORE },
  { why: 'TeX scanning', paths: ['app/src/tex/**'], suites: ['tex', 'tex-lex', 'tex-calls', 'keys', 'engine-node', 'caret-math-dev'] },
  { why: 'references, bibliography', paths: ['app/src/refs/**', 'app/src/bib/**', 'app/src/bibpane/**'], suites: ['refs-panel', 'w4-units', 'cite-units', 'cite-engine', 'cref-dev', 'cite-dev', 'cite-card-dev', 'panes'] },
  { why: 'reference navigation', paths: ['app/src/refnav/**'], suites: ['w10', 'cite-card-dev', 'refnav-hit', 'refnav-host'] },
  { why: 'nesting', paths: ['app/src/nesting/**'], suites: ['nested-seed', 'panes', 'block-drag'] },
  { why: 'dragging a block', paths: ['app/src/docview/drag*.ts', 'app/src/nesting/drag-motion.ts'], suites: ['drag-rules', 'block-drag', 'panes', 'typecheck'] },
  { why: 'the title form', paths: ['app/src/meta/**'], suites: ['seed-title-form', 'meta-dev'] },
  { why: 'notes, view', paths: ['app/src/notes/**', 'app/src/view/**'], suites: ['notes', 'view-units', 'view', 'ios-zoom', 'zoom-caret'] },
  { why: 'figures', paths: ['app/src/svgfig/**', 'app/src/figures/**'], suites: ['pdf-svg'] },
  { why: 'the kit and page UI', paths: ['app/src/design/**', 'app/src/settings/**', 'app/src/sidebar/**', 'app/src/chrome/**', 'app/src/inspector/**', 'app/src/files/**'], suites: UI },
  { why: 'the document view, outline', paths: ['app/src/docview/**', 'app/src/outline/**'], suites: ['w15-units', 'in-view', 'end-meta', 'far-dev', 'anchor'] },
  { why: 'editing', paths: ['app/src/edit/**'], suites: EDIT },
  { why: 'motion, navigation, panes', paths: ['app/src/motion/**', 'app/src/nav/**', 'app/src/panes/**'], suites: ['motion-units', 'motion', 'popover-hold', 'far-dev', 'panes', 'widths', 'chrome', 'sheets', 'selection-dev', 'cite-card-dev'] },
  { why: 'perf probes', paths: ['app/src/perf/**'], suites: ['anchor', 'anchor-motion', 'widths'] },
  { why: 'dev-only parts', paths: ['app/src/lua-dev/**'], suites: ['typecheck'] },
  { why: 'the TeX resource server', paths: ['app/src/settings/resources.ts', 'app/src/settings/resource-choice.ts', 'tests/test-resources*.ts'], suites: ['resources', 'resources-origin', 'resources-setting'] },
  { why: 'the engine in the page', paths: ['engine/web/**'], suites: ['dev-seed', 'keys', 'file-deps', 'recovery', 'cache', 'fonts-flicker', 'page-fonts', 'e2e-dev', 'app-bundle', 'build-chromium', 'panes', 'multifile'] }, 
  { why: 'the engine', paths: ['engine/{src,api,server,encode,tex,slots,pictures,licences,scripts}/**', 'engine/reflow-tectonic.json', 'scripts/fetch-engine.ts', 'engine/package.json', 'engine/package-lock.json', 'engine/*.txt', 'engine/working-set-tiers.json'], suites: ENGINE_CORE },
  { why: 'engine tests', paths: ['engine/tests/**'], suites: ['pdf-svg', 'file-deps', 'recovery', 'fonts-dump'] },
  { why: "the editor's TeX files", paths: ['tex/**'], suites: [...ENGINE_CORE, 'meta-dev'] },
  { why: 'the release build', paths: ['scripts/build.ts', 'scripts/minify*', 'scripts/licences.ts', 'scripts/node-engine.ts', 'scripts/engine-stamp.ts', 'scripts/fetch-engine.ts', 'scripts/node24.sh', 'scripts/lib/**', 'scripts/lock-reflowtex.ts', 'reflowtex.lock.json'], suites: RELEASE },
  { why: 'the dev bundle', paths: ['scripts/w3-*', 'scripts/typecheck.ts'], suites: ['typecheck', 'app-bundle', 'w3', 'build-chromium', 'public-bundles'] },
  { why: 'seeds and samples', paths: ['scripts/seed*.ts', 'scripts/record*.ts', 'samples/**'], suites: ['intro-versions', 'site-intro', 'typecheck', 'seed-title-form', 'home-samples-dev', 'intro-dev', 'nested-seed', 'e2e-dev'] },
  { why: "the website's tools (the intro's copy)", paths: ['website/tools/**'], suites: ['site-intro'] },
  { why: "the website's pages, templates and scripts, and its deploy (checked by building the site: website/build.sh)", paths: ['website/**', '.github/workflows/website.yml'], suites: [] },
  { why: 'the page icons (scripts/icons.ts writes them into index.html)', paths: ['scripts/icons.ts', 'app/src/chrome/wordmark/icon.svg'], suites: ['brand', 'typecheck'] },
  { why: 'the component gallery (dev only)', paths: ['app/gallery.html', 'app/src/gallery/**', 'tests/test-gallery.ts'], suites: ['gallery'] },
  { why: 'the test harness', paths: ['tests/qa/lib/**', 'tests/integration/serve.ts'], suites: ['browsers'] },    // derived below: its users, sampled
  { why: 'the workbench: its own suites (workbench/README.md), and the editor on it', paths: ['workbench/**'], suites: ['workbench-units', 'workbench', 'typecheck', 'integrate', 'mobile-fit'] },
  { why: 'every icon name a source writes is in the one registry (workbench/tests/icons.test.ts scans app/src)', paths: ['app/src/**/*.js', 'app/src/**/*.ts'], suites: ['workbench-units'] },
  { why: 'the standalone page on the workbench', paths: ['app/src/wb/**'], suites: ['integrate', 'typecheck', 'home', 'chrome', 'mobile-fit'] },
  { why: 'test-integrate\'s sections (one file each)', paths: ['tests/integrate/**'], suites: ['integrate'] },
  { why: 'test-all and its table', paths: ['tests/test-all.ts', 'tests/suites.ts', 'tests/test-select.ts'], suites: ['select'] },
  { why: 'dev-only test tools', paths: ['tests/integration/**', 'tests/qa/**', 'tests/test-w6.ts'], suites: [] },
];


// unit tests colocated with their code, found here: every app/src/**/*.test.ts (outside dev/)
// that no row above runs is a fast unit suite named `unit:<dir>.<name>` (app/src/doc/model.test.ts: unit:doc.model), chosen when a file of its directory changes. A
// module's new unit test needs no edit in this file (it was the file most branches touched).
export const COLOCATED_ROOT = 'app/src';
export function colocatedUnits(root = ROOT): string[] {
  const dir = join(root, COLOCATED_ROOT);
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split('\\').join('/'))
    .filter((p) => p.endsWith('.test.ts') && !p.split('/').includes('dev') && !p.split('/').includes('node_modules'))
    .map((p) => `${COLOCATED_ROOT}/${p}`).sort();
}
{
  const run = new Set(SUITES.map((x) => scriptOf(x)));
  for (const file of colocatedUnits()) {
    if (run.has(file)) continue;
    const name = `unit:${file.slice(COLOCATED_ROOT.length + 1).replace(/\.test\.ts$/, '').split('/').join('.')}`;   // (no / : a suite's log is <name>.log)
    const suite = S(name, 'unit', 2, () => node(file), { ...FAST, note: 'colocated unit test (found, not listed)' });
    SUITES.push(suite); byName.set(name, suite);
    RULES.push({ why: `a colocated unit test: ${file}`, paths: [`${dirname(file)}/**`], suites: [name] });
    EST_SECONDS[name] ??= 3;
  }
}
/** a glob as a regular expression: ** any depth (also none), * within one name, ? one character, {a,b} either */
export function globRe(g: string): RegExp {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { const j = g.indexOf('}', i); re += `(?:${g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = j; }
    else if (c === '[') { const j = g.indexOf(']', i); re += g.slice(i, j + 1); i = j; }
    else re += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const ruleRes = RULES.map((r) => ({ ...r, res: r.paths.map(globRe) }));

/** suites whose script imports the given harness file (tests/qa/lib/x.ts: by its name) */
function harnessUsers(path: string): string[] {
  if (path === 'tests/integration/serve.ts') return SUITES.filter((s) => s.group === 'dev').map((s) => s.name);
  // harness.ts imports the other lib files: its users count for every lib file
  const base = path.split('/').pop()!.split('.')[0];     // a lib module's companion files (work.baseline.json) count for its users
  const re = new RegExp(`qa/lib/(?:${base}|harness)\\b`);
  return SUITES.filter((s) => { const f = join(ROOT, scriptOf(s)); return existsSync(f) && re.test(readFileSync(f, 'utf8')); }).map((s) => s.name);
}

export interface Selection {
  /** suite → why it was chosen */
  suites: Map<string, string[]>;
  unmapped: string[];
  /** the dev suites run in their sampled form */
  sampled: Set<string>;
}
/** The suites for changed paths (standard tier): fast always, the rules' union, build-chromium for app/engine/scripts. */
export function select(paths: string[]): Selection {
  const suites = new Map<string, string[]>();
  const add = (n: string, why: string) => { if (!byName.has(n)) throw new Error(`rule names an unknown suite: ${n}`); const w = suites.get(n) ?? []; if (!w.includes(why)) w.push(why); suites.set(n, w); };
  for (const s of SUITES) if (s.tier === 'fast') add(s.name, 'fast tier');
  const unmapped: string[] = [];
  for (const p of paths) {
    if (ruleRes[0].res.some((re) => re.test(p))) continue;     // docs (results kept in git): nothing beyond fast
    let hit = false;
    // tests/<script>: the suites that run it
    for (const s of SUITES) if (scriptOf(s) === p) { add(s.name, `runs ${p}`); hit = true; }
    for (const r of ruleRes) if (r.res.some((re) => re.test(p))) {
      hit = true;
      const list = r.why === 'the test harness' ? harnessUsers(p) : r.suites;
      for (const n of list) add(n, `${r.why}: ${p}`);
    }
    if (!hit) { unmapped.push(p); for (const n of WIDE) add(n, `unmapped: ${p}`); }
    if (/^(app|engine|scripts)\//.test(p) && !/\.md$/.test(p)) add('build-chromium', `app/, engine/ or scripts/ changed: ${p}`);
  }
  // standard runs the exhaustive suites sampled
  const sampled = new Set([...suites.keys()].filter((n) => byName.get(n)!.sample));
  return { suites, unmapped, sampled };
}

/** Estimated seconds of a suite: the last durations test-all recorded (history), else the estimates above. */
export function estimate(name: string, sampled: boolean, history: Record<string, number> = {}): number {
  const k = sampled ? `${name}~sampled` : name;
  return history[k] ?? (sampled ? EST_SAMPLED_SECONDS[name] : undefined) ?? EST_SECONDS[name] ?? 60;
}

/**
 *  tests/test-select.ts checks that the selector's set for the paths contains the guards. */
export const ARCH_STEPS: { step: number; paths: string[]; guards: string[] }[] = [];

// ── failures known and explained ─────────────────────────────────────────────
// A FAIL line of a suite that matches an entry is reported as known. Each
// entry has its issue, the date it was added and its owner; test-all prints each one's age, and those older than
export interface Known { suite: RegExp; line: RegExp; why: string; issue: string; added: string; owner: string }
export const KNOWN_REVIEW_DAYS = 14;
export const KNOWN: Known[] = [];
/** A timing suite failed and ran once more: what the pair of runs counts as. */
export function afterRerun(again: string, loads: number[], limit: number): 'flaky' | 'unsure' | 'fail' {
  if (again === 'pass' || again === 'known') return 'flaky';
  return again === 'fail' && Math.max(...loads) > limit ? 'unsure' : 'fail';
}
/** the per-check HOST TOO LOADED lines of a suite's output (tests/qa/lib/work.ts gate(); not its summary line "HOST TOO LOADED: …") */
export const tooLoadedLines = (lines: string[]) => lines.filter((l) => /^HOST TOO LOADED (?=\S)/.test(l));
/** the calibration factors a suite saw (work.ts prints "calibration: N measurements, factor a–b" at exit): [min, max] */
export function factorsIn(text: string): [number, number] | null {
  const m = [...text.matchAll(/^calibration: \d+ measurements?, factor ([\d.]+)–([\d.]+)/gm)].pop();
  return m ? [Number(m[1]), Number(m[2])] : null;
}
/** A FAIL line with its measured numbers left out, to match the same check across runs. */
export const normLine = (line: string) => line.replace(/\d+(\.\d+)?/g, '#').replace(/ — .*/, '').trim();
/** whole days since an entry was added */
export const knownAge = (k: Known, now = new Date()) => Math.floor((now.getTime() - Date.parse(`${k.added}T00:00:00Z`)) / 86400000);
