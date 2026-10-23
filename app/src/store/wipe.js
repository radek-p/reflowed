// @ts-check
// "Reset local data": forget everything this page's origin keeps in the browser, as a new profile would
// have it: every IndexedDB database (the store's reflowtex-editor, the engine's rtx-engine-cache, any other),
// local and session storage, Cache Storage, service workers. Plain JavaScript, so the dev server's /reset page
// (integration/serve.ts) imports this very file; the release calls it from the Documents view
// (home/reset-dialog.js). Works from file://: each part that the origin does not have is skipped.
//
//   const r = await wipeOrigin({ onBlocked(name) {…} });   // { databases: [names] }; then location.reload()
//   announceReset();  onResetElsewhere(() => location.reload())   // the other tabs of the origin follow
//
// An open connection is asked to close (versionchange; the store and the engine cache close on it); a delete
// still blocked (another tab of an older build) is reported through onBlocked and waited for.

/** Databases the app is known to use, deleted even where indexedDB.databases() is missing. */
export const KNOWN_DATABASES = ['reflowtex-editor', 'rtx-engine-cache', 'reflowed-tex-resources'];
const CHANNEL = 'reflowed-reset';
const PAGE = Math.random().toString(36).slice(2);   // this page: its own announcement is not for it

/** @param {{ onBlocked?: (name: string) => void }} [o] */
export async function wipeOrigin(o = {}) {
  /** @type {string[]} */
  let listed = [];
  try { listed = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '').filter(Boolean); } catch { /* not listed here */ }
  const names = [...new Set([...listed, ...KNOWN_DATABASES])];
  if (typeof indexedDB !== 'undefined') {
    await Promise.all(names.map((n) => new Promise((done) => {
      let r;
      try { r = indexedDB.deleteDatabase(n); } catch { done(null); return; }
      r.onsuccess = () => done(null);
      r.onerror = () => done(null);
      r.onblocked = () => o.onBlocked?.(n);
    })));
  }
  try { localStorage.clear(); } catch { /* no storage (file:// in some browsers) */ }
  try { sessionStorage.clear(); } catch { /* */ }
  try { if (globalThis.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* not on file:// */ }
  try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) ?? []) await r.unregister(); } catch { /* */ }
  return { databases: listed };
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
