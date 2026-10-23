// The dev app with the release's seed cache: the seed papers open with 0 compiles, as from the
// single file, instead of typesetting cold (about 40 s a paper). Dev pages only: with ?seedcache, or on every page
// of a dev server started with --seed-cache (tests/integration/serve.ts puts a meta tag in index.html; test-all
// starts one for the suites that do not test the compile path). The server serves the cache only while its build
// id is the worker's; otherwise (404) the page typesets cold as before.
/** @param {URLSearchParams} params @param {boolean} release @returns {Promise<any> | undefined} the seed for createBackend */
export function devSeedCache(params, release) {
  if (release || typeof document === 'undefined') return undefined;
  const url = params.has('seedcache') ? '/dev/seed-cache.json' : document.querySelector('meta[name="rtx-dev-seed-cache"]')?.getAttribute('content');
  if (!url) return undefined;
  return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
