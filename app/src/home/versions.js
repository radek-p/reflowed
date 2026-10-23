// The versions panel on the kit: "Save version" with an optional name, the snapshots (newest first;
// automatic ones badged), restore with a one-line confirmation (the present is saved first, so a restore
// can be undone by restoring "Before restoring …"). In a dialog that has its own title (the editor's
// Versions, the home's) the panel draws no heading of its own.
//
//   const v = mountVersions(el, { store, docId, title?, onRestore?(docId, safety) })
//   v.refresh(); await v.idle(); v.destroy()
// Hooks kept: .rv, .rv-list > .rv-item[data-snapshot-id] (.rv-label, .rv-badge, .rv-when), form.rv-save
// input[name=label], [data-action=save-version|restore|confirm-restore], .rv-status, .rv-empty.
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html, render, ensureStyles, Button, Input, Pill } from '../design/ui/index.js';
import { restoreSnapshot, takeSnapshot } from '../store/snapshots.ts';
import { injectHomeStyle } from './css.ts';
import { relTime } from './text.js';

function Panel({ v }) {
  const input = useRef(null);
  const snaps = v.snaps.value;
  const submit = (e) => { e.preventDefault(); v.save(input.current.value); };
  return html`<div class="rv">
    ${v.heading ? html`<div class="rv-head"><h2>${v.heading}</h2></div>` : null}
    <form class="rv-save" onSubmit=${submit}>
      <${Input} inputRef=${input} name="label" placeholder="Name this version (optional)" aria-label="Version name" autocomplete="off" />
      <${Button} variant="primary" type="submit" data-action="save-version">Save version<//>
    </form>
    <div class="rv-list" role="list">
      ${snaps == null ? null : snaps.length ? snaps.map((s) => html`<${Item} key=${s.id} v=${v} s=${s} />`)
        : html`<div class="rv-empty">No versions yet. Versions are also saved automatically: on import, before a restore, and every 10 minutes while you edit.</div>`}
    </div>
    <div class="rv-status" role="status">${v.status.value}</div>
  </div>`;
}

function Item({ v, s }) {
  const asking = v.confirm.value === s.id;
  const ref = useRef(null);
  useLayoutEffect(() => { if (asking) ref.current.querySelector('[data-action="confirm-restore"]')?.focus(); }, [asking]);
  return html`<div ref=${ref} class="rv-item" role="listitem" data-snapshot-id=${s.id}>
    <div class="rv-label"><span class="rv-name">${s.label}</span>${s.kind === 'auto' ? html`<${Pill} class="rv-badge">auto<//>` : null}</div>
    <div class="rv-actions"><${Button} size="sm" data-action="restore" onClick=${() => { v.confirm.value = s.id; }}>Restore<//></div>
    <div class="rv-when">${relTime(s.at)} · ${new Date(s.at).toLocaleString()}${s.blockCount != null ? ` · ${s.blockCount} blocks` : ''}</div>
    ${asking ? html`<div class="rv-confirm">
      <span>Bring this version back? The present is saved as a version first.</span>
      <${Button} size="sm" variant="primary" data-action="confirm-restore" disabled=${v.busy.value} onClick=${() => v.restore(s)}>Restore<//>
      <${Button} size="sm" variant="ghost" data-action="cancel-restore" onClick=${() => { v.confirm.value = null; }}>Cancel<//>
    </div>` : null}
  </div>`;
}

export function mountVersions(el, ctx) {
  ensureStyles();
  injectHomeStyle();
  const { store, docId } = ctx;
  let destroyed = false;
  let pending = Promise.resolve();
  const track = (p) => { pending = pending.then(() => Promise.resolve(p).catch(() => {})); return p; };
  // in a dialog with a title (the editor's Versions, the home's) the dialog says what this is
  const inDialog = !!el.closest?.('dialog')?.querySelector('.ui-dialog-title');
  const v = {
    heading: inDialog ? null : ctx.title ? `Versions of “${ctx.title}”` : 'Versions',
    snaps: signal(null), status: signal(''), confirm: signal(null), busy: signal(false),
    async save(raw) {
      const label = raw.trim() || `Version of ${new Date().toLocaleString()}`;
      await track(takeSnapshot(store, docId, label, 'manual'));
      el.querySelector('input[name="label"]').value = '';
      v.status.value = `Saved “${label}”`;
      await track(refresh());
    },
    async restore(s) {
      v.busy.value = true;
      try {
        const safety = await track(restoreSnapshot(store, s.id));
        v.status.value = `Restored “${s.label}”`;
        ctx.onRestore?.(docId, safety);
      } catch (e) { v.status.value = `Could not restore: ${e.message}`; }
      v.busy.value = false; v.confirm.value = null;
      await track(refresh());
    },
  };
  async function refresh() {
    const snaps = await track(store.snapshots.list(docId));
    if (!destroyed) v.snaps.value = snaps;
  }
  const host = document.createElement('div');
  host.style.display = 'contents';
  el.appendChild(host);
  render(html`<${Panel} v=${v} />`, host);
  const unsub = store.subscribe?.((e) => { if (e.type === 'snapshot' && e.docId === docId && !destroyed) track(refresh()); }) ?? (() => {});
  track(refresh());
  return {
    refresh: () => track(refresh()),
    async idle() { for (;;) { const p = pending; await p; if (p === pending) break; } await new Promise((r) => setTimeout(r)); },   // and the render that queued (a microtask)
    destroy() { destroyed = true; unsub(); render(null, host); host.remove(); },
  };
}
