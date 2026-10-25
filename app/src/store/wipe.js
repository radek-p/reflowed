// @ts-check
// "Reset local data": forget everything ReflowEd keeps in this browser, as a new profile would have it, and nothing
// else: its IndexedDB databases (the store's reflowtex-editor, the engine's rtx-engine-cache, the TeX resources'
// reflowed-tex-resources) and its localStorage keys (OWN_KEY). Other pages of the same origin (a site that also
// serves ReflowEd: github.io, a university's ~user pages) keep their databases and keys. Plain JavaScript, so the
// dev server's /reset page (integration/serve.ts) imports this very file; the release calls it from the Documents
// view (home/reset-dialog.js). Works from file://: each part that the origin does not have is skipped.
//
//   const r = await wipeLocalData({ onBlocked(name) {…} });   // { databases: [names deleted] }; then location.reload()
//   announceReset();  onResetElsewhere(() => location.reload())   // the other tabs of the origin follow
//
// An open connection is asked to close (versionchange; the store and the engine cache close on it); a delete
// still blocked (another tab of an older build) is reported through onBlocked and waited for.

/** ReflowEd's databases (its only ones: nothing else on the origin is touched). */
export const KNOWN_DATABASES = ['reflowtex-editor', 'rtx-engine-cache', 'reflowed-tex-resources'];
/** ReflowEd's localStorage keys: its settings, views and layouts (rtx-editor.…), the store policy's record (rtx:…)
 *  and the first version's document (rtx-blocks.doc). */
export const OWN_KEY = /^(rtx-editor\.|rtx:|rtx-blocks\.)/;
const CHANNEL = 'reflowed-reset';
const PAGE = Math.random().toString(36).slice(2);   // this page: its own announcement is not for it

/** @param {{ onBlocked?: (name: string) => void, idb?: IDBFactory, storage?: Storage }} [o] */
export async function wipeLocalData(o = {}) {
  /** @type {IDBFactory | undefined} */
  const idb = o.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  /** @type {string[]} */
  let present = KNOWN_DATABASES;
  try {
    const listed = await idb?.databases?.();
    if (listed) present = KNOWN_DATABASES.filter((n) => listed.some((d) => d.name === n));
  } catch { /* not listed here: delete every one of ours */ }
  if (idb) {
    await Promise.all(KNOWN_DATABASES.map((n) => new Promise((done) => {
      let r;
      try { r = idb.deleteDatabase(n); } catch { done(null); return; }
      r.onsuccess = () => done(null);
      r.onerror = () => done(null);
      r.onblocked = () => o.onBlocked?.(n);
    })));
  }
  try {
    const st = o.storage ?? localStorage;
    const ours = [];
    for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k != null && OWN_KEY.test(k)) ours.push(k); }
    for (const k of ours) st.removeItem(k);
  } catch { /* no storage (file:// in some browsers) */ }
  return { databases: present };
}

/** Tell this origin's other tabs that their data is gone (they reload: onResetElsewhere). */
export function announceReset() {
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ reset: Date.now(), from: PAGE }); c.close(); } catch { /* no channel */ }
}

/** @param {() => void} fn  called when another tab of this origin reset its data */
export function onResetElsewhere(fn) {
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e) => { if (e.data?.reset && e.data.from !== PAGE) fn(); };
    return () => c.close();
  } catch { return () => {}; }
}
