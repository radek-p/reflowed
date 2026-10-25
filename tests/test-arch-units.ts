// Architecture guards: ratchets that measure the refactor and keep it from
// slipping back. Node, no browser, about a second.
//   node tests/test-arch-units.ts            the checks
//   node tests/test-arch-units.ts --measure  also print the measures (app.js lines, host-object widths, event types)
//
// Each allow-list below may only SHRINK: a step that moves a responsibility out lowers its number in the same commit.
// Adding to one needs a reason in the comment next to it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEASURE = process.argv.includes('--measure');
let failed = 0, n = 0;
const check = (name: string, ok: boolean, detail = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const rel = (p: string) => relative(HERE, p).split('\\').join('/');

/** product sources: .js/.ts under `dir`, without dev/, node_modules, tests and the built bundles */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!['dev', 'node_modules', 'build', 'dist', 'tests', 'test'].includes(f)) walk(p); continue; }
      if (/\.(js|ts|mjs)$/.test(f) && !/\.(test|suite)\.ts$|\.d\.ts$/.test(f)) out.push(p);
    }
  };
  walk(join(HERE, dir));
  return out;
}
const APP = sources('app/src');
const ENGINE = ['engine/web', 'engine/src', 'engine/api/src'].flatMap((d) => { try { return sources(d); } catch { return []; } });
const read = (p: string) => readFileSync(p, 'utf8');

// ── 1. app.js shrinks ─────────────────────────────────────────────────────────
// the budget: app.js's lines now; every step that moves code out lowers it to the new count
// a ceiling that only goes down, with a little room: lower it when app.js shrinks, never raise it
// (the test surface moved out: 1,119 -> 1,018 lines; the files, app/doc-files.ts: -> 960; the preamble and bibliography, app/doc-meta.ts: -> 925; the menus, app/doc-menus.ts: -> 877; the refresh, go-to-definition: -> 845; the keys, app/doc-keys.ts: -> 818)
const APP_JS_BUDGET = 828;
// each part moved out of createDocEditor is one import here while app.js still composes the parts
// (test-api, doc-files, doc-meta, doc-menus, refresh, goto-definition, doc-keys: 44 -> 49, less the imports they took along); the line budget above is the ratchet that measures the split
const APP_JS_IMPORTS_BUDGET = 49;          // local imports (fan-out)
const appJs = read(join(HERE, 'app/src/app/app.js'));
const appLines = appJs.split('\n').length - (appJs.endsWith('\n') ? 1 : 0);
const appImports = [...appJs.matchAll(/^import .* from '(\.[^']+)'/gm)].length;
check(`app.js within its line budget (${APP_JS_BUDGET})`, appLines <= APP_JS_BUDGET, `${appLines} lines`);
check(`app.js within its import budget (${APP_JS_IMPORTS_BUDGET} local imports)`, appImports <= APP_JS_IMPORTS_BUDGET, `${appImports}`);

// ── 1b. app.js writes nothing to the store itself: doc/persist.js does ──
{
  const writes = [...appJs.matchAll(/\bstore\.(put\w*|delete\w*|appendOps|createDoc)\(/g)].map((m) => m[1]);
  const own = /\b(createWriter|typingTimers|savedSource|titleTimer|lastSafety)\b/.exec(appJs)?.[1];
  check('app.js: no store writes of its own (doc/persist.js); no writer, typing timers or stored sources', writes.length === 0 && !own, `${writes.join()} ${own ?? ''}`);
  // the undo history and the block operations are doc/'s: no stack, no list surgery in app.js
  const hist = /\b(undoStack|redoStack)\b/.exec(appJs)?.[1] ?? /\bdoc\.blocks\.splice\(/.exec(appJs)?.[0] ?? /function (insertBlock|removeBlock|moveBlocks|applyBlocks|splitBlock|mergeBlock|setSource|rekey)\b/.exec(appJs)?.[1];
  const raw = APP.map(rel).filter((f) => f !== 'app/src/doc/history.js' && /\bundoStack\b/.test(read(join(HERE, f))) && !/svgfig\/editor\.js$/.test(f));
  check('app.js keeps no undo stack and does no block-list surgery (doc/history.js, doc/ops.ts); nothing else reaches a raw undo stack (svgfig: history.top/drop/labels)', !hist && raw.length === 0, `${hist ?? ''} ${raw.join(', ')}`);
  // the derived state and the results are the document's (doc/derived.js, doc/results.js)
  const derivedOwn = /\blet (preHash|thmSet|contexts|contextsSig|recalls|preambleResult)\b|\bconst (assetHash|cache) = new Map\(\)|function (computeContexts|assetSig|bibKeyPart|withBibContext)\b|\bpreambleErrors\.value\s*=|\bwordCount\.value\s*=/.exec(appJs + read(join(HERE, 'app/src/app/panels.ts')))?.[0];
  check('app.js keeps no derived state or results of its own (contexts, recalls, preamble hash, theorem kinds, asset hashes, the result map, the preamble\'s problems); no page signal written with one document\'s data', !derivedOwn, derivedOwn ?? '');
  // the document is the DocSession's (doc/session.ts): app.js holds none and reads none from the store
  const ownDoc = /\blet doc\b|\bstore\.getBlocks\(|\bcreate(Persist|Model|History|Derived|Results|Ops)\(/.exec(appJs)?.[0];
  check('app.js keeps no document of its own and builds none of its parts (doc/session.ts does)', !ownDoc && /createDocSession\(/.test(appJs), ownDoc ?? '');
  const dom = APP.map(rel).filter((f) => f.startsWith('app/src/doc/') || f.startsWith('app/src/commands/')).filter((f) => /\b(document|window)\.|\bHTMLElement\b|querySelector/.test(read(join(HERE, f)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  check('doc/, commands/: no DOM (Node-testable)', dom.length === 0, dom.join(', '));
  // the document layer imports nothing from the page's hub directory (texscan, kinds, cache-key
  // and save-state moved down to tex/ and doc/): a ratchet at zero
  const up = APP.map(rel).filter((f) => f.startsWith('app/src/doc/') && /from '\.\.\/app\//.test(read(join(HERE, f))));
  check('doc/ imports nothing from app/ (the layer below the page)', up.length === 0, up.join(', '));
}

// ── 1c. intents are commands: app.js keeps no shortcuts table and no menu entry, key or editorAPI call that
// runs a block operation itself; the editor's keys are commands/editor-keys.js ──
{
  const table = /'Select the block above \/ below'|'Delete the selected block'/.test(appJs);
  const direct = [...appJs.matchAll(/\b(insertBlock|removeBlock|duplicateBlock|splitBlock|mergeBlock)\(/g)].map((m) => m[1]);
  const handMenus = [...appJs.matchAll(/menuItem\('(Edit source|Duplicate|Move up|Move down|Merge with the block above|Delete|Find and replace|Focus mode|Keyboard shortcuts|Document settings|Versions…|Export \.tex|Export \.zip|Export PDF|Import \.tex…)'/g)].map((m) => m[1]);
  const keySwitch = /function editorKey\b|case 'backspace-empty'/.test(appJs);
  check('app.js: the shortcuts dialog, the menus, the page keys, the block editor\'s keys and editorAPI\'s mutations go through commands (commands/)', !table && !direct.length && !handMenus.length && !keySwitch,
    JSON.stringify({ table, direct, handMenus, keySwitch }));
}

// ── 1d. each pane's UI state is the pane's: no page-wide selection, caret or click position in app.js; the go-tos
// that act in a pane are nav/reveal.js ──
{
  const own = /\blet (selected|lastCaret|lastPosition)\b|function (revealBlock|scrollToBlock|flashBlock)\b|\.cls\('selected'/.exec(appJs)?.[0];
  check('app.js keeps no selection, caret or position of its own (panes/pane-state.js, per pane) and no reveal of its own (nav/reveal.js)', !own, own ?? '');
}

// ── 1e. the workspace: main.js wires; the open documents and the current one are app/workspace.js's ──
{
  // the editor's wiring is app/mount.ts's: main.js is the standalone page's host of one mounted editor
  const mainJs = read(join(HERE, 'app/src/main.js')) + read(join(HERE, 'app/src/app/mount.ts'));
  const own = /new Map\(\);\s*\/\/ pane id -> its editor|function follow\(|shownCurrent/.exec(mainJs)?.[0];
  check('main.js and the mount keep no editors of their own (app/workspace.js: one per open document, the current one); refnav gets the workspace, not window.editorAPI', !own && /createWorkspace\(/.test(mainJs) && /mountEditor\(/.test(mainJs) && !/installRefNav\(\{ api: window\.editorAPI/.test(mainJs), own ?? '');
}

// ── 2. the engine imports nothing from app/ ────────
const ENGINE_TO_APP_ALLOWED = new Set<string>([]);   // none: the store, figures and route are given (opts), eviction is the engine's, commentStart is loading's
const engineToApp: string[] = [];
for (const f of ENGINE) {
  for (const m of read(f).matchAll(/(?:from\s*|import\(\s*)['"](\.[^'"]+)['"]/g)) {
    const target = rel(resolve(dirname(f), m[1]));
    if (target.startsWith('app/')) engineToApp.push(`${rel(f)} -> ${target}`);
  }
}
const newEngineImports = engineToApp.filter((x) => !ENGINE_TO_APP_ALLOWED.has(x));
check(`engine → app imports: none`, newEngineImports.length === 0, newEngineImports.join(', '));
const goneEngine = [...ENGINE_TO_APP_ALLOWED].filter((x) => !engineToApp.includes(x));
check('engine → app allow-list has no stale entries (remove an import, remove its entry)', goneEngine.length === 0, goneEngine.join(', '));

// ── 2b. loading/: the page's file loading, shared by the engine worker, engine/web and the app ────────
// It imports nothing from outside itself (not app/, the workbench or engine/: both sides import it), and only its
// page-side file (page-loader.ts, the boot loader) touches the DOM (the rest runs in the worker and in Node).
{
  const LOADING = sources('loading').filter((p) => !p.endsWith('.test.ts'));
  const out: string[] = [], dom: string[] = [];
  for (const f of LOADING) {
    for (const m of read(f).matchAll(/(?:from\s*|import\(\s*)['"]([^'"]+)['"]/g)) {
      const target = m[1].startsWith('.') ? rel(resolve(dirname(f), m[1])) : m[1];
      if (!target.startsWith('loading/')) out.push(`${rel(f)} -> ${target}`);
    }
    const code = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!f.endsWith('/page-loader.ts') && /\b(document|window|localStorage|matchMedia|requestAnimationFrame)\b/.test(code)) dom.push(rel(f));
  }
  check(`loading/ imports nothing from outside itself (${LOADING.length} files)`, LOADING.length > 5 && out.length === 0, out.join(', '));
  check('loading/: only page-loader.ts touches the DOM', dom.length === 0, dom.join(', '));
}

// ── 3. CustomEvent types the app dispatches ──
// The viewer's own (reflowtex:*) are the public viewer's and not counted here.
// the in-app ones are the page's signals (app/page-state.js). Left: what tests wait on (main.js's
// dispatchForTests: route, current, displayed, refreshed; the sheets' and the title form's close/open; nav, refnav),
// the engine's editor:quota (its edge, app/quota.js listens) and the page's editor:ready.
const EVENTS_ALLOWED = new Set([
  'editor:current', 'editor:displayed', 'editor:meta-closed', 'editor:meta-opened', 'editor:quota', 'editor:ready',
  'editor:refreshed', 'editor:route', 'editor:settings-closed', 'nav:back', 'nav:jumped', 'nav:scrolled', 'refnav:back', 'refnav:card',
]);
const events = new Map<string, string[]>();
for (const f of [...APP, ...ENGINE]) {
  for (const m of read(f).matchAll(/(?:new CustomEvent\(|\bfire\()\s*['"`]([^'"`$]+)['"`]/g)) {
    if (m[1].startsWith('reflowtex:')) continue;
    const l = events.get(m[1]) ?? []; l.push(rel(f)); events.set(m[1], l);
  }
}
const newEvents = [...events.keys()].filter((t) => !EVENTS_ALLOWED.has(t));
check(`CustomEvent types: none beyond the ${EVENTS_ALLOWED.size} allowed`, newEvents.length === 0, newEvents.map((t) => `${t} (${events.get(t)!.join(' ')})`).join(', '));
const goneEvents = [...EVENTS_ALLOWED].filter((t) => !events.has(t));
check('CustomEvent allow-list has no stale entries', goneEvents.length === 0, goneEvents.join(', '));

// no module listens to the app's own events (the page's signals instead); the engine's quota is its edge
{
  const listeners: string[] = [];
  for (const f of APP) for (const m of read(f).matchAll(/addEventListener\(\s*['"`]((?:editor|view|nav|notes|refnav):[\w-]+)['"`]/g)) listeners.push(`${rel(f)} ${m[1]}`);
  const bad = listeners.filter((x) => x !== 'app/src/app/quota.js editor:quota');
  check('no in-app listener of the app\'s own DOM events (app/page-state.js signals); only app/quota.js hears the engine\'s editor:quota', bad.length === 0, bad.join(', '));
}

// ── 4. module-level signals: none new; those holding one document's data must go ──
const SIGNALS_ALLOWED = new Set([
  // each document's preamble problems and word count are its own (doc/results.js); the editor's container
  // holds which one it shows (root.state.words, root.state.preambleErrors: app/page-state.ts), not the page
  'app/src/settings/advanced.js advanced',         // the page's: the advanced switch (a user preference)
  'app/src/settings/advanced.js advancedFeatures', // the page's
  'app/src/settings/resources.ts resourceChoice',  // the page's: the TeX resource server in force (a browser preference)
  'app/src/settings/resources.ts resourceServer',  // the page's: its address
  'app/src/design/ui/views.ts registry',           // the page's: registered view types (their hosts and state: slotsOf)
  'app/src/design/showcase.js tab', 'app/src/design/showcase.js strip', 'app/src/design/showcase.js seg', 'app/src/design/showcase.js chip',   // the kit's showcase page
]);
// module signals that hold one document's data: none (a new one fails here: give it to doc/)
const DOC_SIGNALS: string[] = [];
const signals: string[] = [];
for (const f of APP) {
  for (const line of read(f).split('\n')) {
    const m = /^(?:export )?(?:const|let) (.+)$/.exec(line);
    if (!m || !/\b(signal|computed)\(/.test(m[1])) continue;
    for (const d of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*=\s*(?:signal|computed)\(/g)) signals.push(`${rel(f)} ${d[1]}`);
  }
}
const newSignals = signals.filter((s) => !SIGNALS_ALLOWED.has(s));
check(`module-level signals: none beyond the ${SIGNALS_ALLOWED.size} allowed (${DOC_SIGNALS.length} of them hold document data)`, newSignals.length === 0, newSignals.join(', '));
const goneSignals = [...SIGNALS_ALLOWED].filter((s) => !signals.includes(s));
check('module-level signal allow-list has no stale entries', goneSignals.length === 0, goneSignals.join(', '));

// ── 5. product code reads window.editorAPI only where allowed (it is the test surface, 12 shrink this) ──
const EDITORAPI_READERS_ALLOWED = new Set<string>([
  // none: main.js no longer sets it (wb/test-surface.ts installs the test surface)
]);
const readers = new Set<string>();
for (const f of [...APP, ...ENGINE]) {
  const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  if (/\b(?:window|globalThis)\.editorAPI\b/.test(code)) readers.add(rel(f));
}
const newReaders = [...readers].filter((f) => !EDITORAPI_READERS_ALLOWED.has(f));
check(`window.editorAPI read only by the ${EDITORAPI_READERS_ALLOWED.size} allowed files (never the engine)`, newReaders.length === 0, newReaders.join(', '));
const goneReaders = [...EDITORAPI_READERS_ALLOWED].filter((f) => !readers.has(f));
check('editorAPI reader allow-list has no stale entries', goneReaders.length === 0, goneReaders.join(', '));

// ── 5a. no product module calls the test surface: an editor's `api` is editorAPI's, built in app.js and
// spread by main.js only; page features get a document host (app/doc-host.js: the DocSession and its commands) ──
{
  const API_USERS_ALLOWED = new Set(['app/src/main.js', 'app/src/harness/two-editors.ts', 'app/src/wb/test-surface.ts', 'app/src/gallery/live.ts']);   // the gallery (dev only, like the harness) drives a fixture editor's widgets   // the integrated page's test surface   // main.js sets window.editorAPI from the editors' api; the two-editors harness is a test surface
  const users: string[] = [];
  for (const f of APP) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    if (/\.api\b(?!\s*:)/.test(code) && !API_USERS_ALLOWED.has(rel(f))) users.push(rel(f));
  }
  check('no product module calls an editor\'s api (the test surface) or editorAPI; notes and refnav act through document hosts', users.length === 0, users.join(', '));
  const notesJs = read(join(HERE, 'app/src/notes/index.js')), mountTs = read(join(HERE, 'app/src/app/mount.ts'));
  check('notes are attached to each workspace\'s document hosts (every pane), refnav\'s host is a document host', /notes\?\.attach\?\.\(ws\.hosts\)/.test(mountTs) && /forPane: \(p: string \| null\) => ws\.hosts\.forPane\(p\)/.test(mountTs) && /hosts\?\.at\(/.test(notesJs));
}

// ── 5a'. one session per DOCUMENT: the workspace keys its editors by document id (a pane that shows a
// document already open joins its editor), the engine's state is keyed by the document and released ──
{
  const wsJs = read(join(HERE, 'app/src/app/workspace.js')), appJs2 = read(join(HERE, 'app/src/app/app.js')), be = read(join(HERE, 'engine/web/backend.js'));
  check('the workspace keys sessions by document (a second pane of a document joins its editor); app.js keys the engine by the document, no pane keys',
    /sessions\.get\(docId\)/.test(wsJs) && /addPane\(id, chrome\)/.test(wsJs) && !/`pane-\$\{/.test(appJs2) && /base\?\.forDoc\?\.\(id\)/.test(appJs2) && /f\.release = /.test(be));
}

// ── 5a''. the history is data: no undo closures anywhere, CodeMirror's own history off, its changes fed in ──
{
  const closures = APP.map(rel).filter((f) => /\bhistory\.perform\(|\bperform\([^;\n]*\),\s*\(\)\s*=>[^;\n]*\)\s*;/.test(read(join(HERE, f))));
  const ee = read(join(HERE, 'app/src/app/editor-entry.js'));
  check('no undo closures (history.perform or perform(label, do, undo)) in app/src; CodeMirror\'s history() and historyKeymap off; typing recorded (edit/undo.js)',
    closures.length === 0 && !/\bhistory\(\)|historyKeymap|historyField/.test(ee) && /recordTyping/.test(read(join(HERE, 'app/src/edit/index.js'))), closures.join(', '));
}

// ── 5b. every Backend call the app makes is in the contract (contracts.d.ts Backend) ──
{
  const contract = read(join(HERE, 'app/src/contracts.d.ts'));
  const body = /export interface Backend \{([\s\S]*?)\n\}/.exec(contract)?.[1] ?? '';
  const declared = new Set([...body.matchAll(/^\s+([a-zA-Z]+)\??[(:]/gm)].map((m) => m[1]));
  const called = new Map<string, string>();
  for (const f of APP.filter((p) => p.endsWith('.js'))) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    for (const m of code.matchAll(/\bbackend(?:\(\))?\??\.([a-zA-Z]+)\b(?!\.)/g)) if (m[1] !== 'js') called.set(m[1], rel(f));
  }
  const missing = [...called].filter(([k]) => !declared.has(k));
  check(`the Backend contract declares every call the app makes (${called.size} members)`, missing.length === 0 && declared.size > 0, missing.map(([k, f]) => `${k} (${f})`).join(', '));
}

// ── 5c. a view's content is apart from its container: only the kit's views.js imports Sheet; a pane hosts
// a view through FrameContext (panes/view-pane.js) ──
{
  const sheetUsers = APP.filter((f) => /import\s*\{[^}]*\bSheet\b[^}]*\}\s*from/.test(read(f))).map(rel).filter((f) => !/^app\/src\/design\/ui\/(views\.ts|index\.js)$|^app\/src\/gallery\/kit\.ts$/.test(f));   // the gallery shows the Sheet itself
  const vp = read(join(HERE, 'app/src/panes/view-pane.js'));
  check('views: no module but design/ui/views.ts imports the kit Sheet; panes/view-pane.js gives its content a container through FrameContext', sheetUsers.length === 0 && /FrameContext\.Provider/.test(vp), sheetUsers.join(', '));
}

// ── 6. refs and bib keep one document's state in instances (createRefs, createContexts) ──
// top-level `let` in refs/ and bib/: only these, which are the page's and not one document's
const REFS_LETS_ALLOWED = new Set([
  'app/src/refs/numbering.ts last',         // numberingState(): the last run of any document (refnav's fallback; each refs instance has its own)
]);
const refsLets: string[] = [];
for (const f of APP.filter((p) => /app\/src\/(refs|bib)\//.test(rel(p)))) {
  for (const m of read(f).matchAll(/^(?:export )?let ([A-Za-z_$][\w$]*)/gm)) refsLets.push(`${rel(f)} ${m[1]}`);
}
const newLets = refsLets.filter((x) => !REFS_LETS_ALLOWED.has(x));
check(`refs/, bib/: no module-level document state beyond the ${REFS_LETS_ALLOWED.size} page-wide lets`, newLets.length === 0 && refsLets.length === REFS_LETS_ALLOWED.size, newLets.join(', ') || refsLets.join(', '));

// ── 6b. the numbering core is plain logic over the host it is given: its modules import only refs/, tex/ and bib/
// (nothing from app/, view/, store/ or the viewer's internals; the viewer sets texts inside boxes itself) ──
{
  const CORE = ['numbering', 'cref', 'scan', 'tex-text', 'context'].map((m) => `app/src/refs/${m}.ts`);
  const out: string[] = [];
  for (const f of CORE) {
    for (const m of read(join(HERE, f)).matchAll(/(?:from\s*|import\(\s*)['"]([^'"]+)['"]/g)) {
      const target = m[1].startsWith('.') ? rel(resolve(dirname(join(HERE, f)), m[1])) : m[1];
      if (!/^app\/src\/(refs|tex|bib)\//.test(target)) out.push(`${f} -> ${target}`);
    }
  }
  check('refs/{numbering,cref,scan,tex-text,context}.ts import only from refs/, tex/ and bib/', out.length === 0, out.join(', '));
}

// ── 7. the v1 backend is gone, and nothing loads from experiments/ ──
// every code file in app/, tests/ and scripts/ (not node_modules or built output): no v1 name anywhere; outside
// comments no `experiments/` path. The allowed: test-select's path rule for experiments/** (selects no suite)
const CODE: string[] = [];
const walkCode = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['node_modules', 'lib', 'build', 'dist', 'test-results', 'seed'].includes(f)) walkCode(p); continue; }
    if (/\.(js|ts|mjs|sh)$/.test(f) && !f.endsWith('.min.js')) CODE.push(p);
  }
};
for (const d of ['app', 'tests', 'scripts']) walkCode(join(HERE, d));
const SELF = rel(fileURLToPath(import.meta.url));
const V1_NAMES = new RegExp(['backend' + '-v1', 'backend' + '=v1', 'lib' + '/v1', 'RTX_' + 'V1', 'create' + 'V1Backend'].join('|'));
const EXP_ALLOWED = new Set(['tests/suites.ts']);
const v1Uses: string[] = [], expUses: string[] = [];
for (const f of CODE) {
  const r = rel(f);
  if (r === SELF) continue;
  read(f).split('\n').forEach((line, i) => {
    if (V1_NAMES.test(line)) v1Uses.push(`${r}:${i + 1}`);
    const code = line.replace(/^\s*(\/\/|\*|\/\*|#|%).*$/, '').replace(/\s\/\/\s.*$/, '');
    if (/experiments\//.test(code) && !EXP_ALLOWED.has(r)) expUses.push(`${r}:${i + 1}`);
  });
}
check(`no v1 backend names in app/, tests/, scripts/ (${CODE.length} files)`, CODE.length > 50 && v1Uses.length === 0, v1Uses.slice(0, 8).join(', '));
check('nothing in app/, tests/, scripts/ loads from experiments/', expUses.length === 0, expUses.slice(0, 8).join(', '));

// the public checkout by publicRepo() (scripts/lib/public-repo.ts), never by a fixed /reflowtex/ path, which
// exists only where a checkout is mounted there
{
  const engineTests: string[] = [];
  for (const f of readdirSync(join(HERE, 'engine/tests'))) if (/\.ts$/.test(f)) engineTests.push(join(HERE, 'engine/tests', f));
  const fixed: string[] = [];
  for (const f of [...CODE, ...engineTests]) {
    if (rel(f) === SELF) continue;
    read(f).split('\n').forEach((line, i) => { if (/['"`]\/reflowtex\//.test(line.replace(/^\s*(\/\/|\*|\/\*|#).*$/, ''))) fixed.push(`${rel(f)}:${i + 1}`); });
  }
  check(`no fixed /reflowtex/ path in app/, tests/, scripts/, engine/tests/ (publicRepo() finds the checkout)`, fixed.length === 0, fixed.slice(0, 8).join(', '));
}

// ── 8. the fixture cache is dev and tests only (tests/integration/fixture-cache.ts) ──
// only the dev server, its recorder, test-all and the fixture cache's own test name it (or its module): nothing in
// app/ or scripts/ (scripts/build.ts makes releases), so a release can never carry it
const FX_NAME = new RegExp(['fixture' + '-cache', 'FIXTURE' + '_CACHE'].join('|'));
const FX_ALLOWED = new Set(['tests/integration/fixture-cache.ts', 'tests/integration/serve.ts', 'tests/integration/record-seed-cache.ts',
  'tests/test-all.ts', 'tests/test-fixture-cache.ts', 'tests/suites.ts']);
const fxUses = CODE.map(rel).filter((r) => r !== SELF && !FX_ALLOWED.has(r) && FX_NAME.test(read(join(HERE, r))));
check('the fixture cache: named only by the dev server, its recorder, test-all and its test (never app/ or scripts/)', fxUses.length === 0, fxUses.slice(0, 8));

// ── 9. nothing global is patched: the page's DOM and font set are the browser's own (the viewer's faces are its
// own FontFaces, given the worker's files through host.fonts.provide: engine/web/page-fonts.ts) ──
{
  const PATCH = /\b(Node|Element|HTMLElement|Document|EventTarget)\.prototype\.\w+\s*=(?!=)|\b(Node|Element|HTMLElement|Document|EventTarget)\.prototype\[[^\]]+\]\s*=(?!=)|\bdefineProperty\(\s*(Node|Element|HTMLElement|Document)\.prototype|\bhead\.(appendChild|append|insertBefore)\s*=(?!=)|\bfonts\.(check|add|delete|clear)\s*=(?!=)|\bfonts\[[^\]]+\]\s*=(?!=)/;
  const patches: string[] = [];
  for (const f of [...APP, ...ENGINE]) read(f).split('\n').forEach((line, i) => { if (PATCH.test(line.replace(/\/\/.*$/, ''))) patches.push(`${rel(f)}:${i + 1}`); });
  check('no prototype, document.head or document.fonts method patched in app/src or the engine', patches.length === 0, patches.slice(0, 8).join(', '));
}

// ── measures: host-object widths in app.js ──────────────────────────
/** the members of the object literal that starts at `open` (an index of '{'): commas at depth 1, plus one */
function members(src: string, open: number): number {
  let depth = 0, count = 0, any = false;
  let prev = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { const q = c; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++; prev = 'x'; continue; }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev)) { for (i++; i < src.length && src[i] !== '/'; i++) { if (src[i] === '\\') i++; else if (src[i] === '[') { while (src[i] !== ']') { if (src[i] === '\\') i++; i++; } } } prev = 'x'; continue; }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) { depth--; if (depth === 0) return any ? count + 1 : 0; }
    else if (c === ',' && depth === 1) { count++; }
    if (depth === 1 && !/\s/.test(c) && c !== '{' && c !== ',') any = true;
    if (!/\s/.test(c)) prev = c;
  }
  return count + 1;
}
// ── the editor's container (app/editor-root.ts) ──────────────────────────────────────
// No module looks the editor's own markup up by a page id, a .topbar or a .shell query (its container's parts:
// root.part); only main.js, the standalone page's host, names its own page (#home-view). No page state as body classes (the container's
// data attributes, or <html>'s for a page-wide option).
{
  const IDS = 'page|page-b|editor-view|blocks|find-host|doc-view-host|sidebar|word-count|add-end|btn-sidebar|btn-sidebar-close|btn-doc-menu|btn-split|btn-view|status|save-state|ol-drop';
  const idRe = new RegExp(`getElementById\\('(${IDS})'\\)|querySelector(?:All)?\\(['\`]#(${IDS})\\b|\\$\\(['\`]#(${IDS})\\b|querySelector\\('\\.topbar|querySelector\\('\\.shell'`);
  const PAGE_ID_ALLOWED = new Set([

  ]);
  const idUsers = APP.filter((p) => idRe.test(read(p))).map(rel);
  const newIds = idUsers.filter((p) => !PAGE_ID_ALLOWED.has(p)), goneIds = [...PAGE_ID_ALLOWED].filter((p) => !idUsers.includes(p));
  check('no page-id, .topbar or .shell lookups of the editor\'s markup outside the allowed files (root.part)', newIds.length === 0, newIds.join(', '));
  check('the page-id allow-list has no stale entries', goneIds.length === 0, goneIds.join(', '));
  const body = APP.filter((p) => /document\.body\.(classList|dataset)/.test(read(p))).map(rel);
  check('no page state on <body> (classes or data): the container\'s data attributes, <html> for a page-wide option', body.length === 0, body.join(', '));
}

// ── one view contract: every registered view has its content (a Component or a mount);
// the panels' data is doc/panels.ts's (app/panels.ts publishes it, scans nothing itself) ──
{
  const noContent: string[] = [];
  for (const f of APP) {
    const t = read(f);
    for (const m of t.matchAll(/\bregisterView\(/g)) {
      let depth = 0, end = m.index! + m[0].length - 1;
      for (let i = end; i < t.length; i++) { if (t[i] === '(') depth++; else if (t[i] === ')' && --depth === 0) { end = i; break; } }
      const arg = t.slice(m.index! + m[0].length, end).trim();
      if (rel(f) === 'app/src/design/ui/views.ts') continue;                 // the registry itself (its comments name the call)
      const id = /^[A-Za-z_$][\w$]*$/.test(arg) ? new RegExp(`\\b${arg}\\s*=\\s*\\{[^;]*\\b(Component|mount)\\b`).test(t) : /\b(Component|mount)\b/.test(arg);
      if (!id) noContent.push(`${rel(f)}: ${arg.slice(0, 60)}`);
    }
  }
  check('every registered view has its content (a Component or a mount)', noContent.length === 0, noContent.join('; '));
  const panelsTs = read(join(HERE, 'app/src/app/panels.ts'));
  const scans = /\b(scanHeadings|scanLabels|scanTodos|todoMacros)\(/.exec(panelsTs)?.[1];
  check('app/panels.ts scans no source for the panels (doc/panels.ts: the outline, problems, TODOs as data)', !scans, scans ?? '');
}

const widths: [string, number][] = [];
for (const m of appJs.matchAll(/\b(create[A-Z]\w*|[a-z]\w*Host)\s*(?:\(\s*|=\s*|:\s*)\{/g)) {
  const open = m.index! + m[0].length - 1;
  widths.push([m[1], members(appJs, open)]);
}
// ── the suites and scripts parse (a suite with a syntax error never runs: tests/test-widths.ts did not for a while) ──
{
  const { transformSync } = await import(join(HERE, 'app/node_modules/esbuild/lib/main.js'));
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!['node_modules', 'build', 'dist'].includes(f)) walk(p); } else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p); } };
  for (const d of ['tests', 'scripts']) walk(join(HERE, d));
  const bad: string[] = [];
  for (const p of files) { try { transformSync(read(p), { loader: 'ts', format: 'esm', sourcefile: rel(p) }); } catch (e) { bad.push(`${rel(p)}: ${String((e as Error).message).split('\n')[1] ?? e}`); } }
  check(`tests/ and scripts/: all ${files.length} TypeScript files parse`, bad.length === 0, bad.join('; '));
}

const eventCount = events.size;
if (MEASURE) {
  console.log(`\nmeasures: app.js ${appLines} lines, ${appImports} local imports; ${eventCount} CustomEvent types; ${engineToApp.length} engine → app imports; ${DOC_SIGNALS.length} module signals of document data; editorAPI readers ${[...readers].join(', ')}`);
  console.log(`host objects in app.js: ${widths.map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// ── typecheck finds the editor's TypeScript itself; its exceptions only shrink ──
{
  const tc = read(join(HERE, 'scripts/typecheck.ts'));
  const list = /const NOT_STRICT_YET = \[([^\]]*)\]/.exec(tc)?.[1] ?? '';
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  const gone = files.filter((p) => { try { statSync(join(HERE, 'app', p)); return false; } catch { return true; } });
  check(`typecheck: the editor's TypeScript found, not listed; NOT_STRICT_YET at most 3 entries, each a file that exists (${files.length})`, /readdirSync\(join\(HERE, 'app\/src'\)/.test(tc) && files.length <= 3 && !gone.length, JSON.stringify({ files, gone }));
}

console.log(`\n${n - failed}/${n} passed`);
process.exit(failed ? 1 : 0);
