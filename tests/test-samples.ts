// Updated samples and Reset local data, in the dev app or the single file from file://, in a fresh profile, on the
// introduction (the one default document every build has; first an unedited copy, then an edited one):
//   - a stored sample older than the build's (no seed version recorded, or an older one) is marked "Updated sample
//     available" in the Documents view; an unedited copy is offered Replace (same document, the copy in its
//     Versions), an edited one "Open the new version" (a new document that is the sample from now on; the copy kept
//     as "… (edited)") or Keep mine; an edited copy is never lost, across reloads;
//   - "Reset local data…" in the footer: its dialog lists what goes, "Export all first" downloads every document,
//     Reset forgets the origin's data and the page opens as a fresh profile does;
//   - keyboard (Tab to the badge, Enter, Escape, focus back), screen-reader labels, light and dark (contrast ≥ 4.5).
// Waits on the app's events and idle, never on fixed times. Screenshots in test-results/samples/.
//
//   node tests/test-samples.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness } from './qa/lib/harness.ts';
import { CONTRAST } from './qa/lib/contrast.ts';
import { readZip } from '../app/src/io/archive.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness(`samples-${target}`);
const { ctx, page, errors } = await t.launch({ target, at });
await page.addInitScript(CONTRAST);
await page.evaluate(CONTRAST);
const shot = (name: string) => page.screenshot({ path: join(t.out, `${name}.png`) });
const homeIdle = () => page.evaluate(() => (window as any).editorAPI.homeIdle());
const home = async () => {
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).editorAPI.route().name === 'home' && document.querySelector('.rh-row[data-doc-id]'));
  await homeIdle();
};
/** reload and wait for the Documents view, drawn and idle. The workbench restores its layout on a reload (the
 *  documents open in tabs, the URL the active one's), so the Documents view is asked for again once the page is up */
async function reload() {
  await page.evaluate(() => { (window as any).__before = 1; location.hash = '#/'; });
  await page.reload();
  await page.waitForFunction(() => !(window as any).__before && !!(window as any).editorAPI?.route?.());
  await home();
}
/** what a fresh profile has: the documents, the databases, the storage keys */
const sig = () => page.evaluate(async () => {
  const s = (window as any).editorAPI.store();
  return { docs: (await s.listDocs()).map((d: any) => `${d.id} ${d.title}`).sort(), dbs: (await indexedDB.databases()).map((d) => d.name).sort(),
    ls: Object.keys(localStorage).sort(), ss: Object.keys(sessionStorage).sort() };
});
/** the build's seed for a sample (inline in the single file, seed/<name> on the dev server) */
const seedSources = (name: string) => page.evaluate(async (n: string) => {
  const g = globalThis as any;
  const raw = g.__rtxSeeds?.[n] ?? await (await fetch(`seed/${n}`)).text();
  const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { title: s.init.title as string, sources: s.init.blocks.map((b: any) => b.source) as string[] };
}, name);
const docOf = (id: string) => page.evaluate(async (i: string) => {
  const s = (window as any).editorAPI.store();
  const d = await s.getDoc(i);
  return d && { id: d.id, title: d.title, tags: d.meta?.tags ?? [], seed: d.meta?.seed ?? null, sources: d.blocks.map((b: any) => b.source), snaps: (await s.snapshots.list(i)).map((x: any) => x.label) };
}, id);
const row = (id: string) => `.rh-row[data-doc-id="${id}"]`;
const rowState = (id: string) => page.evaluate((sel: string) => {
  const r = document.querySelector(sel) as HTMLElement | null;
  const b = r?.querySelector('.rh-update') as HTMLElement | null;
  return r && { update: r.dataset.update ?? null, label: r.getAttribute('aria-label'), title: r.querySelector('.rh-title')?.textContent?.trim(),
    badge: b && { text: b.textContent, tag: b.tagName, label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), contrast: (window as any).__contrast(b) } };
}, row(id));
const activeIs = (sel: string) => page.evaluate((s: string) => !!document.activeElement?.matches(s), sel);
const dialogUp = (id: string) => page.waitForFunction((i: string) => (document.getElementById(i) as HTMLDialogElement | null)?.open === true, id);
const dialogGone = (id: string) => page.waitForFunction((i: string) => !document.getElementById(i), id);

// ── a fresh profile ───────────────────────────────────────────────────────────
await homeIdle();
const fresh = await sig();
const intro = await page.evaluate(async () => {
  const s = (window as any).editorAPI.store();
  for (const d of await s.listDocs()) { const r = await s.getDocRecord(d.id); if (r.meta?.tags?.includes('intro')) return d.id as string; }
  return null;
});
/** the default documents of this build (the intro, and the example when the build carries it) */
const N = fresh.docs.length;
t.check('a fresh profile: the default documents (the intro among them), no badge', N >= 1 && !!intro && await page.locator('.rh-update').count() === 0, fresh);
const ids = { intro: intro! };
const inSeed = await seedSources('intro.json');

// ── an older stored copy, unedited, with no seed version recorded ──
const MINE = ' A sentence of my own, added in an older release.';
await page.evaluate(async (e: string) => {
  const s = (window as any).editorAPI.store();
  const ed = await s.getDocRecord(e);
  await s.putMeta(e, { meta: { ...ed.meta, seed: undefined } });                  // from before seed versioning
}, ids.intro);
await reload();
const ex0 = await rowState(ids.intro);
t.check('an older unedited sample (no version recorded): "Updated sample available", marked unedited', ex0?.update === 'unedited' && ex0.badge?.text === 'Updated sample available', ex0);
t.check('screen reader: the row says it ("…, updated sample available"); the badge is a button opening a dialog, with a label saying what it does',
  /, updated sample available$/.test(ex0?.label ?? '') && ex0?.badge?.tag === 'BUTTON' && ex0.badge.popup === 'dialog' && /replace your unedited copy/.test(ex0.badge.label ?? ''), { ex: ex0?.badge?.label, row: ex0?.label });
t.check('light: the badge text readable (contrast ≥ 4.5)', (ex0?.badge?.contrast ?? 0) >= 4.5, ex0?.badge?.contrast);
await shot('01-light-badges');

// ── keyboard: Tab from the row to its badge, Enter opens the dialog, Escape closes it, the focus comes back ──
await page.focus(row(ids.intro));
await page.keyboard.press('Tab');
t.check('keyboard: Tab from the row reaches its badge', await activeIs(`${row(ids.intro)} .rh-update`));
await page.keyboard.press('Enter');
await dialogUp('rtx-sample-update');
const dlgU = await page.evaluate(() => {
  const d = document.getElementById('rtx-sample-update')!;
  const lab = document.getElementById(d.getAttribute('aria-labelledby') ?? '');
  return { title: lab?.textContent, text: d.querySelector('.ui-dialog-body')?.textContent ?? '', acts: [...d.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')),
    focus: (document.activeElement as HTMLElement)?.dataset.action };
});
t.check('unedited: the dialog (titled "Updated sample available") offers Replace, focused; no "Open the new version"',
  dlgU.title === 'Updated sample available' && dlgU.acts.includes('sample-replace') && !dlgU.acts.includes('sample-new') && dlgU.focus === 'sample-replace' && /no edits/.test(dlgU.text), dlgU);
await shot('02-light-replace-dialog');
await page.keyboard.press('Escape');
await dialogGone('rtx-sample-update');
t.check('Escape closes it; the focus is back on the badge; nothing changed', await activeIs(`${row(ids.intro)} .rh-update`) && (await rowState(ids.intro))?.update === 'unedited');
await page.keyboard.press('Enter');
await dialogUp('rtx-sample-update');
await page.keyboard.press('Enter');                       // Replace
await dialogGone('rtx-sample-update');
await homeIdle();
const ex1 = await docOf(ids.intro);
t.check('Replace: the same document is now this build\'s version (every block), its old copy in its Versions', ex1!.id === ids.intro
  && JSON.stringify(ex1!.sources) === JSON.stringify(inSeed.sources) && ex1!.title === inSeed.title && /^Before resetting/.test(ex1!.snaps[0] ?? ''), ex1!.snaps.slice(0, 2));
t.check('… the badge is gone, the status says so, the focus is on its row', (await rowState(ids.intro))?.update === null
  && /new version now/.test(await page.locator('.rh-status').textContent() ?? '') && await activeIs(row(ids.intro)));

// ── an older stored copy edited by its user: Open the new version ──
await page.evaluate(async ({ p, mine }: any) => {
  const s = (window as any).editorAPI.store();
  const pd = await s.getDoc(p);
  const b = pd.blocks.find((x: any) => x.kind === 'paragraph' && x.source.length > 200);
  await s.putBlock(p, { ...b, source: b.source + mine });
  await s.appendOps(p, [{ t: 'edit', blockId: b.id, payload: { from: b.source, to: b.source + mine } }]);
  await s.putMeta(p, { meta: { ...pd.meta, seed: { ...pd.meta.seed, seedVersion: 'an-older-build', seedHash: 'an-older-build' } } });
}, { p: ids.intro, mine: MINE });
await reload();
const pa0 = await rowState(ids.intro);
t.check('an older edited sample: the badge, marked edited; the edit is still there (not replaced at start)', pa0?.update === 'edited' && pa0.badge?.text === 'Updated sample available'
  && (await docOf(ids.intro))!.sources.some((x: string) => x.endsWith(MINE)), pa0);
t.check('screen reader: an edited copy\'s badge says the new version opens and the copy is kept', /open the new version; your edited copy is kept/.test(pa0?.badge?.label ?? ''), pa0?.badge?.label);
await page.click(`${row(ids.intro)} .rh-update`);
await dialogUp('rtx-sample-update');
const dlgE = await page.evaluate(() => {
  const d = document.getElementById('rtx-sample-update')!;
  return { text: d.querySelector('.ui-dialog-body')?.textContent ?? '', acts: [...d.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')), focus: (document.activeElement as HTMLElement)?.dataset.action };
});
t.check('edited: the dialog offers "Open the new version" (focused) and Keep mine, never Replace; it says the copy stays as "… (edited)"',
  dlgE.acts.includes('sample-new') && dlgE.acts.includes('sample-keep') && !dlgE.acts.includes('sample-replace') && dlgE.focus === 'sample-new' && /\(edited\)/.test(dlgE.text), dlgE);
await page.click('#rtx-sample-update [data-action=sample-new]');
await page.waitForFunction((old: string) => { const a = (window as any).editorAPI; return a.route().name === 'doc' && a.currentDoc()?.id && a.currentDoc().id !== old; }, ids.intro);
await t.idle(page);
const nd = await page.evaluate(() => ({ id: (window as any).editorAPI.currentDoc().id, ok: document.querySelectorAll('.blk[data-state="ok"]').length, bad: document.querySelectorAll('.blk[data-state="error"]').length }));
const nv = await docOf(nd.id);
t.check('"Open the new version": a new document, this build\'s version, opened and typeset (no failed block)', nv!.id !== ids.intro && nv!.title === inSeed.title
  && JSON.stringify(nv!.sources) === JSON.stringify(inSeed.sources) && nd.ok > 0 && nd.bad === 0, nd);
t.check('… it is the sample now (the version recorded, the "intro" tag moved to it)', !!nv!.seed?.seedVersion && nv!.tags.includes('intro'), nv!.tags);
await home();
const old = await docOf(ids.intro);
t.check('the edited copy is kept, renamed "… (edited)", its edit intact; no longer a sample (no badge, no tag)', old!.title === `${inSeed.title} (edited)`
  && old!.sources.some((x: string) => x.endsWith(MINE)) && !old!.seed && !old!.tags.includes('intro') && (await rowState(ids.intro))?.update === null, { title: old!.title, tags: old!.tags });
await page.hover(row(ids.intro));
await page.click(`${row(ids.intro)} [data-action=more]`);
await page.waitForSelector('.rh-pop');
const menuOld = await page.evaluate(() => [...document.querySelectorAll('.rh-pop [data-action]')].map((b) => b.getAttribute('data-action')));
await page.keyboard.press('Escape');
t.check('… its ⋯ menu has no "Reset to original" or "Updated sample…" any more', !menuOld.includes('reset-seed') && !menuOld.includes('sample-update'), menuOld);
await reload();
t.check('after a reload: no badge anywhere; the defaults and the edited copy there, with its edit', await page.locator('.rh-update').count() === 0
  && (await sig()).docs.length === N + 1 && (await docOf(ids.intro))!.sources.some((x: string) => x.endsWith(MINE)));

// ── Keep mine, in dark ──
await page.evaluate(async ({ id, mine }: any) => {
  const s = (window as any).editorAPI.store();
  const d = await s.getDoc(id);
  const b = d.blocks.find((x: any) => x.kind === 'paragraph' && x.source.length > 200);
  await s.putBlock(id, { ...b, source: b.source + mine });
  await s.appendOps(id, [{ t: 'edit', blockId: b.id, payload: { from: b.source, to: b.source + mine } }]);
  await s.putMeta(id, { meta: { ...d.meta, seed: { ...d.meta.seed, seedVersion: 'an-older-build', seedHash: 'an-older-build' } } });
  try { localStorage.setItem('rtx-editor.view', JSON.stringify({ ...JSON.parse(localStorage.getItem('rtx-editor.view') ?? '{}'), theme: 'dark' })); } catch { /* */ }
}, { id: nd.id, mine: MINE });
await reload();
const dk = await rowState(nd.id);
const dark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches);
t.check('dark: the badge on the edited new version, readable (contrast ≥ 4.5)', dark && dk?.update === 'edited' && (dk.badge?.contrast ?? 0) >= 4.5, { dark, c: dk?.badge?.contrast });
await shot('03-dark-badges');
await page.hover(row(nd.id));
await page.click(`${row(nd.id)} [data-action=more]`);
await page.waitForSelector('.rh-pop [data-action=sample-update]');
t.check('the row\'s ⋯ menu has "Updated sample…" too', true);
await page.click('.rh-pop [data-action=sample-update]');
await dialogUp('rtx-sample-update');
await shot('04-dark-new-version-dialog');
await page.click('#rtx-sample-update [data-action=sample-keep]');
await dialogGone('rtx-sample-update');
await homeIdle();
t.check('Keep mine: the badge goes, the edit stays', (await rowState(nd.id))?.update === null && (await docOf(nd.id))!.sources.some((x: string) => x.endsWith(MINE)));
await reload();
t.check('… and does not come back after a reload (this version)', (await rowState(nd.id))?.update === null && (await sig()).docs.length === N + 1);

// ── Reset local data ──
await page.evaluate(() => new Promise((ok) => { const r = indexedDB.open('test-samples-extra', 1); r.onupgradeneeded = () => r.result.createObjectStore('x'); r.onsuccess = () => { r.result.close(); ok(null); }; }));
await page.evaluate(() => { localStorage.setItem('test-samples', '1'); sessionStorage.setItem('test-samples', '1'); });
await page.focus('#reset-local');
await page.keyboard.press('Enter');
await dialogUp('rtx-reset-local');
await page.waitForFunction((n: number) => new RegExp(`\\(${n} documents\\)`).test(document.getElementById('rtx-reset-local')?.textContent ?? ''), N + 1);
const dlgR = await page.evaluate((n: number) => {
  const d = document.getElementById('rtx-reset-local')!;
  return { title: document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent, text: d.querySelector('.ui-dialog-body')?.textContent?.replace(/\s+/g, ' ') ?? '',
    acts: [...d.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')), focus: (document.activeElement as HTMLElement)?.dataset.action, status: d.querySelector('[role=status]') !== null, n };
}, N + 1);
t.check('Reset local data…: a dialog listing what goes (every document with its versions, settings, cached results), Export all first, Cancel focused',
  dlgR.title === 'Reset local data' && new RegExp(`every document \\(${dlgR.n} documents\\), with its versions`).test(dlgR.text) && /settings and view preferences/.test(dlgR.text) && /cached typesetting results/.test(dlgR.text)
  && ['export-all', 'cancel', 'reset'].every((a) => dlgR.acts.includes(a)) && dlgR.focus === 'cancel' && dlgR.status, dlgR);
t.check(`from ${target === 'file' ? 'file://' : 'the dev server'}: ${target === 'file' ? 'the note that files opened from disk share the data' : 'no file:// note'}`, target === 'file' ? /opened from disk/.test(dlgR.text) : !/opened from disk/.test(dlgR.text));
await shot('05-dark-reset-dialog');
await page.keyboard.press('Escape');
await dialogGone('rtx-reset-local');
t.check('Escape closes it, nothing is lost, the focus is back on the button', await activeIs('#reset-local') && (await sig()).docs.length === N + 1);
await page.click('#reset-local');
await dialogUp('rtx-reset-local');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rtx-reset-local [data-action=export-all]')]);
const inner = await readZip(new Uint8Array(readFileSync((await dl.path())!)));
const names = inner.map((e) => e.path);
t.check(`Export all first: one zip with each document's Export .zip (${N + 1}, unique names)`, /^ReflowEd-documents-\d{4}-\d\d-\d\d\.zip$/.test(dl.suggestedFilename()) && names.length === N + 1
  && names.every((n) => n.endsWith('.zip')) && new Set(names).size === N + 1 && names.some((n) => /edited/.test(n)), names);
const innerOk = await (async () => { const z = await readZip(inner.find((e) => /edited/.test(e.path))!.data); const main = z.find((e) => e.path === 'main.tex'); return !!main && new TextDecoder().decode(main.data).length > 0 && z.some((e) => new TextDecoder().decode(e.data).includes(MINE.trim())); })();
t.check('… the edited copy\'s zip has its edit', innerOk);
await page.waitForFunction(() => /^Saved /.test(document.querySelector('#rtx-reset-local .rtx-reset-status')?.textContent ?? ''));
await page.evaluate(() => { (window as any).__before = 1; });
await page.click('#rtx-reset-local [data-action=reset]');
await page.waitForFunction(() => !(window as any).__before && (window as any).editorAPI?.route?.().name === 'home' && document.querySelector('.rh-row[data-doc-id]'));
await homeIdle();
const after = await sig();
t.check('Reset: the page reloads and opens as a fresh profile does (the same documents, databases and storage keys; no badge)',
  JSON.stringify(after) === JSON.stringify(fresh) && await page.locator('.rh-update').count() === 0, { fresh, after });
t.check('… the edited copy, the extra database and the stored keys are gone', !after.docs.some((d) => d.includes('(edited)')) && !after.dbs.includes('test-samples-extra') && !after.ls.includes('test-samples') && !after.ss.includes('test-samples'));
t.check('… and the theme preference with them (light again)', !(await page.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark')));
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
