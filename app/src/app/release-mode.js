// What a release page does differently from the dev page.
//   isRelease()          the single file (its boot script sets globalThis.__rtxEditor)
//   pageParams(search)   the page's URL parameters; in a release the dev switches ?stubs= and ?store= are
//                        dropped (a stub store is a memory store: nothing would persist)
//   featureFailed(n, e)  a feature that did not install: said as an error and kept in
//                        globalThis.__rtxFeatureErrors (the release acceptance fails on any)
export const isRelease = () => !!globalThis.__rtxEditor;
const DEV_ONLY = ['resources', 'stubs', 'store'];
export function pageParams(search = location.search) {
  const p = new URLSearchParams(search);
  if (isRelease()) for (const k of DEV_ONLY) if (p.has(k)) { console.warn(`?${k}= is a dev switch: ignored in a release`); p.delete(k); }
  return p;
}
export function featureFailed(name, e) {
  const list = (globalThis.__rtxFeatureErrors ??= []);
  list.push({ name, message: String(e?.message ?? e) });
  console.error(`feature ${name} did not install:`, e);
  return null;
}
