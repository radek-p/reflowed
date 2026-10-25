// The home screen, the Documents view: the documents, last opened first; search by title, authors
// and full text; new (blank / template / import), open, rename, duplicate, export, versions, reset a
// default document to its original, delete with an undo toast; import by the picker or a drop. Preact +
// signals on the kit (view.js draws, this module holds the state and the actions).
//
//   const h = mountHome(el, { store, io?, open(id), openBeside?(id), undoMs? })   openBeside: in a new tab (a host with tabs)     // contracts.d.ts HomeContext
//   h.refresh(); await h.idle(); h.lastImport(); h.destroy()
//
// Delete is soft first (doc.deletedAt, hidden from the list) and final when its undo time is up (or on
// the next mount, for a page closed meanwhile); the final delete has its own timer, so a newer toast
// replacing this one does not keep the document.
import { signal, computed } from '@preact/signals';
import { html, render, ensureStyles, showToast } from '../design/ui/index.js';
import { duplicateDoc } from '../store/edit.ts';
import { createFromImport, importUpload } from '../io/import.ts';
import { exportTexFromStore, exportZipFromStore } from '../io/export.ts';
import { download } from '../io/download.ts';
import { templateInit } from '../io/templates.ts';
import { resetToSeed, sampleUpdate, isSeedDoc } from '../io/seeds.ts';
import { injectHomeStyle } from './css.ts';
import { queryWords } from './text.js';
import { HomeView } from './view.js';
import { openVersionsDialog } from './versions-dialog.js';
import { openResetDialog } from './reset-dialog.js';
import { openSampleUpdate } from './sample-update.js';

const ACCEPT = '.tex,.ltx,.zip,.tar,.gz,.tgz,.src,application/zip,application/gzip,application/x-gzip,application/x-tar,application/x-tex,text/x-tex';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function mountHome(el, ctx) {
  ensureStyles();
  injectHomeStyle();
  const store = ctx.store;
  const go = (id) => { (ctx.open ?? ctx.onOpen)?.(id); };
  const undoMs = ctx.undoMs ?? 6000;
  let destroyed = false;
  let pending = Promise.resolve();
  let lastReport = null;
  const track = (p) => { const q = Promise.resolve(p).then(() => {}, () => {}); pending = pending.then(() => q); return p; };

  // ── state ──
  const m = {
    ACCEPT,
    rows: signal([]),
    loaded: signal(false),
    query: signal(''),
    status: signal({ text: '', kind: '' }),
    renaming: signal(null),          // the doc id whose title is being edited
    menu: signal(null),              // { kind: 'new' | 'row', anchor, doc? }
    dragging: signal(false),
    tick: signal(0),
    updates: signal(new Map()),     // doc id -> io/seeds.ts SampleUpdate: the row's "Updated sample available"
    searchRef: { current: null },
    fileRef: { current: null },
  };
  m.words = computed(() => queryWords(m.query.value));
  const setStatus = (text, kind = '') => { m.status.value = { text, kind }; };

  // a render landed: focus what an action asked for, wake idle()
  let wantFocus = null, renderWaiters = [];
  m.rendered = (root) => {
    if (wantFocus) {
      const r = root?.querySelector(`.rh-row[data-doc-id="${wantFocus}"]`);
      if (r) { wantFocus = null; r.focus(); }
    }
    const w = renderWaiters; renderWaiters = [];
    for (const f of w) f();
  };
  const focusRow = (id) => { wantFocus = id; };

  // ── the list ──
  async function purge() {
    // soft-deleted documents whose undo time is up (the page was closed meanwhile)
    const all = await store.listDocs({ includeDeleted: true });
    for (const d0 of all) {
      const d = await store.getDocRecord(d0.id);
      if (d?.deletedAt && Date.now() - d.deletedAt > undoMs && !undoing.has(d0.id)) await store.deleteDoc(d0.id);
    }
  }
  let seq = 0;
  async function refresh() {
    const my = ++seq;
    const q = m.query.peek().trim();
    const got = await store.listDocs(q ? { text: q } : {});
    if (destroyed || my !== seq) return;
    // the samples whose build has a newer version, before the rows are drawn (no badge popping in later)
    const ups = new Map();
    for (const d of got) {
      if (!isSeedDoc(d.id)) continue;
      const u = await sampleUpdate(store, d.id).catch(() => null);
      if (u) ups.set(d.id, u);
    }
    if (destroyed || my !== seq) return;
    m.updates.value = ups;
    m.rows.value = got;
    m.loaded.value = true;
  }

  // ── menus ──
  m.closeMenu = () => { m.menu.value = null; };
  m.toggleMenu = (next) => {
    const cur = m.menu.peek();
    m.menu.value = cur && cur.anchor === next.anchor ? null : next;
  };

  // ── actions ──
  m.openDoc = async (id) => {
    await track(store.putMeta(id, { openedAt: Date.now() }));
    go(id);
  };
  // a host with tabs (the workbench): "Open in a new tab" (the row menu; Ctrl/⌘-click on a row)
  m.canBeside = typeof ctx.openBeside === 'function';
  m.openBeside = async (id) => {
    if (!m.canBeside) { await m.openDoc(id); return; }
    await track(store.putMeta(id, { openedAt: Date.now() }));
    ctx.openBeside(id);
  };
  m.pickFiles = () => m.fileRef.current?.click();
  m.create = async (templateId) => {
    try {
      setStatus('Creating…', 'busy');
      const id = await track((async () => store.createDoc(await templateInit(templateId)))());
      setStatus('');
      await m.openDoc(id);
      await track(refresh());
    } catch (e) { setStatus(`Could not create: ${e.message}`, 'error'); }
  };
  m.rename = (d) => { m.renaming.value = d.id; };
  m.finishRename = async (d, value) => {
    const t = value == null ? null : value.trim();
    if (t != null && t !== d.title) await track(store.putMeta(d.id, { title: t }));
    if (m.renaming.peek() === d.id) m.renaming.value = null;
    focusRow(d.id);
    await track(refresh());
  };
  m.resetSeed = async (d) => {
    try {
      setStatus('Resetting…', 'busy');
      await track(resetToSeed(store, d.id));
      setStatus(`“${d.title || 'Untitled'}” is the original again; your copy is in its Versions`);
      await track(refresh());
    } catch (e) { setStatus(`Could not reset: ${e.message}`, 'error'); }
  };
  // Updated sample available: Replace (unedited) / Open the new version, Keep mine (edited)
  m.sampleUpdate = (d) => {
    const u = m.updates.peek().get(d.id);
    if (!u) return;
    openSampleUpdate({ store, update: u, title: d.title, back: () => el.querySelector(`.rh-row[data-doc-id="${d.id}"] .rh-update`) ?? el.querySelector(`.rh-row[data-doc-id="${d.id}"]`),
      onDone: (r) => {
        if (!r) return;
        if (r.action === 'new') { track(m.openDoc(r.docId)); return; }
        setStatus(r.action === 'replace' ? `“${d.title || 'Untitled'}” is the new version now; your copy is in its Versions` : `Kept your copy of “${d.title || 'Untitled'}”`);
        focusRow(d.id);
        track(refresh());
      } });
  };
  m.resetLocal = () => { openResetDialog({ store, reload: ctx.reload }); };
  m.duplicate = async (d) => {
    try {
      setStatus('Duplicating…', 'busy');
      const id = await track(duplicateDoc(store, d.id));
      await track(store.putMeta(id, { openedAt: Date.now() }));
      setStatus('');
      focusRow(id);
      await track(refresh());
    } catch (e) { setStatus(`Could not duplicate: ${e.message}`, 'error'); }
  };
  m.exportZip = async (d) => {
    try {
      setStatus('Exporting…', 'busy');
      const z = await track(exportZipFromStore(store, d.id));
      download(z.name, z.data, 'application/zip');
      setStatus(z.warnings.length ? `Exported ${z.name} (${plural(z.warnings.length, 'warning')}: ${z.warnings[0]})` : `Exported ${z.name}`);
    } catch (e) { setStatus(`Export failed: ${e.message}`, 'error'); }
  };
  m.exportTex = async (d) => {
    try {
      const t = await track(exportTexFromStore(store, d.id));
      download(t.name, t.text, 'text/x-tex');
      setStatus(t.missing.length ? `Exported ${t.name}; not in it: ${t.missing.join(', ')} (use Export .zip)` : `Exported ${t.name}`);
    } catch (e) { setStatus(`Export failed: ${e.message}`, 'error'); }
  };
  m.versions = (d) => { versionsDialog?.close(); versionsDialog = openVersionsDialog({ store, docId: d.id, title: d.title || 'Untitled', onRestore: () => track(refresh()),
    back: () => el.querySelector(`.rh-row[data-doc-id="${d.id}"]`) }); };   // its row has the focus again (its ⋯ hides once the row loses it)
  let versionsDialog = null;

  // delete: soft, an undo toast, then final
  const undoing = new Map();          // id -> { timer, toast }
  m.remove = async (d) => {
    await track(store.putMeta(d.id, { deletedAt: Date.now() }));
    await track(refresh());
    const undo = async () => {
      const u = undoing.get(d.id);
      if (!u) return;
      clearTimeout(u.timer); undoing.delete(d.id);
      await track(store.putMeta(d.id, { deletedAt: undefined }));
      focusRow(d.id);
      await track(refresh());
    };
    const toast = showToast(`Deleted “${d.title || 'Untitled'}”`, { action: { key: 'undo', label: 'Undo', onClick: () => track(undo()) }, duration: undoMs, class: 'rh-toast' });
    const timer = setTimeout(() => { undoing.delete(d.id); toast.close(); track(store.deleteDoc(d.id)); }, undoMs);
    undoing.set(d.id, { timer, toast });
  };

  // ── import ──
  async function importFiles(files) {
    if (!files.length) return;
    const name = files.length === 1 ? files[0].name : `${files.length} files`;
    try {
      setStatus(`Importing ${name}…`, 'busy');
      let res;
      if (files.length === 1) res = await importUpload(files[0].name, new Uint8Array(await files[0].arrayBuffer()));
      else {
        // several loose files: a project folder (paths from the folder picker when there are any)
        const entries = await Promise.all(files.map(async (f) => ({ path: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
        res = await importUpload(name, entries);
      }
      const id = await track(createFromImport(store, res.init));
      lastReport = res.report;
      const r = res.report;
      setStatus(`Imported “${res.init.title}”: ${r.blocks} blocks from ${plural(r.files.length, 'file')}, ${plural(r.assets.length, 'asset')}`
        + (r.bib.entries ? `, ${r.bib.entries} references` : '') + (r.warnings.length ? ` · ${plural(r.warnings.length, 'warning')}: ${r.warnings[0]}` : ''));
      await m.openDoc(id);
      await track(refresh());
    } catch (e) {
      setStatus(`Could not import ${name}: ${e.message}`, 'error');
    }
  }
  m.filesPicked = (e) => { const inp = e.currentTarget; const fs = [...(inp.files ?? [])]; inp.value = ''; track(importFiles(fs)); };

  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; m.dragging.value = true; };
  const onOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const onLeave = () => { if (--dragDepth <= 0) { dragDepth = 0; m.dragging.value = false; } };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; m.dragging.value = false;
    track(importFiles([...(e.dataTransfer?.files ?? [])]));
  };
  addEventListener('dragenter', onEnter);
  addEventListener('dragover', onOver);
  addEventListener('dragleave', onLeave);
  addEventListener('drop', onDrop);

  // ── search ──
  let searchTimer = null;
  m.setQuery = (v) => {
    m.query.value = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTimer = null; track(refresh()); }, 120);
  };
  m.searchKey = (e) => {
    const rows = m.rows.peek();
    if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.closest('.rh')?.querySelector('.rh-row')?.focus(); }
    else if (e.key === 'Enter' && rows[0]) { e.preventDefault(); m.openDoc(rows[0].id); }
    else if (e.key === 'Escape' && m.query.peek()) { e.preventDefault(); clearTimeout(searchTimer); searchTimer = null; m.query.value = ''; track(refresh()); }
  };
  const onKey = (e) => {
    if (e.key === '/' && !e.target.closest?.('input, textarea, [contenteditable], dialog')) { e.preventDefault(); m.searchRef.current?.focus(); }
  };
  document.addEventListener('keydown', onKey);

  // changes from elsewhere (another tab, the editor): list again, not while a title is being edited
  let evTimer = null;
  const unsub = store.subscribe?.(() => {
    if (evTimer) return;
    evTimer = setTimeout(() => { evTimer = null; if (!destroyed && !m.renaming.peek()) track(refresh()); }, 150);
  }) ?? (() => {});

  render(html`<${HomeView} m=${m} />`, el);
  track(purge().then(refresh));

  /** one render after everything set so far (the layout effect in HomeView) */
  const nextRender = () => new Promise((r) => { renderWaiters.push(r); m.tick.value++; });
  return {
    refresh: () => track(refresh()),
    /** resolves when every started action and list refresh is done and drawn */
    async idle() {
      for (;;) {
        const p = pending;
        await p;
        if (searchTimer || evTimer) { await new Promise((r) => setTimeout(r, 30)); continue; }
        if (p !== pending) continue;
        if (destroyed) return;
        await nextRender();
        if (p === pending) return;
      }
    },
    lastImport: () => lastReport,
    destroy() {
      destroyed = true;
      clearTimeout(searchTimer); clearTimeout(evTimer);
      unsub();
      versionsDialog?.close();
      document.removeEventListener('keydown', onKey);
      removeEventListener('dragenter', onEnter);
      removeEventListener('dragover', onOver);
      removeEventListener('dragleave', onLeave);
      removeEventListener('drop', onDrop);
      render(null, el);
    },
  };
}
