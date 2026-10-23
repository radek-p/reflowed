// PANES: the route as app state. location.hash is the URL's copy of it, written only here: modules
// navigate through the router (the Documents, another document, a pane's document), never by setting the hash.
//
//   const router = createRouter()
//   const router = createRouter({ loc: { hash: '#/doc/<id>' }, win: null }) an embedded editor's: in memory, no URL
//   router.route            signal: { name: 'home' } | { name: 'doc', id }
//   router.home() · router.openDoc(id, { pane }) · router.onChange(fn) -> off · router.dispose()
//   router.setPaneOpener(fn) fn(id, pane) -> true when that pane opened the document itself; otherwise the
//                             whole editor opens it (the route's document)
//   parseRoute(hash) · formatRoute(route)    (pure; test-w15-units)
import { signal } from '@preact/signals';

export function parseRoute(hash) {
  const m = /^#\/doc\/([^/?]+)/.exec(hash ?? '');
  if (!m) return { name: 'home' };
  let id = m[1];
  try { id = decodeURIComponent(id); } catch { /* as it is */ }
  return { name: 'doc', id };
}
export function formatRoute(r) { return r?.name === 'doc' ? `#/doc/${encodeURIComponent(r.id)}` : '#/'; }

/** @param {{ loc?: { hash: string }, win?: { addEventListener(t: string, f: () => void): void, removeEventListener(t: string, f: () => void): void } | null }} [o] */
export function createRouter({ loc = globalThis.location, win = globalThis } = {}) {
  const route = signal(parseRoute(loc?.hash));
  const subs = new Set();
  let paneOpener = null;
  const onHash = () => {
    route.value = parseRoute(loc.hash);
    for (const fn of subs) { try { fn(route.peek()); } catch (e) { console.error('route:', e); } }
  };
  win?.addEventListener?.('hashchange', onHash);
  function go(r) {
    const h = formatRoute(r);
    if (loc.hash === h) return;
    loc.hash = h;                                     // hashchange follows: the subscribers run then
    if (!win) onHash();                               // in memory: no hashchange, so now
  }
  return {
    route,
    home: () => go({ name: 'home' }),
    openDoc(id, { pane = null } = {}) {
      if (pane && paneOpener?.(id, pane)) return;
      go({ name: 'doc', id });
    },
    setPaneOpener(fn) { paneOpener = fn; },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    dispose() { win?.removeEventListener?.('hashchange', onHash); subs.clear(); },
  };
}
