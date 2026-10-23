// LOADING: the page's files from static trees beside it, one mechanism for both.
// A tree is a static file tree beside the page with an index:
//   the release      (the multi-file build's files; index: the build's manifest)       fetched async by the boot loader
//   the TeX tree     (an unmodified TeX Live tree at texlive/2022/; index: its ls-R)   fetched sync by the engine worker
// Both resolve their base the same way (from the page's URL, relative: any subdirectory), build URLs, check answers
// and give reasons the same way, report every fetch to one status store, and keep fetched files in one cache where
// the browser does not already (the release's files are content-named: the HTTP cache holds them).
//
//   tree.ts         Tree, TreeIndex, treeBase, urlOf, accept, fetchSync (worker), fetchAsync (page), readBody, xhrGetSync,
//                   FetchEvent, TreeError
//   manifest.ts     the release's index: Manifest, ManifestFile, manifestIndex
//   ls-r.ts         the TeX tree's index: lsR (write), parseLsR (read, kpathsea's search order), lsRIndex
//   status.ts       filesStatus(): the one loading status (the overlay and the app's status line read it); bootHandoff()
//   pack.ts         many files as one request (the engine packs, the dev server's TeX set): packRaw, readPack
//   cache.ts        the cache of fetched TeX tree files (IndexedDB): createResourceStore, cacheKey
//   provider.ts     the engine's provider chain: embedded set → (the cache's files) → the TeX tree
//   http.ts         httpProvider: the TeX tree as a provider (a thin adapter of tree.ts fetchSync and lsRIndex)
//   page-loader.ts  the multi-file release's boot loader (the only page-side file: the DOM): an IIFE inlined in index.html
//
// Boundaries (tests/test-arch-units.ts): nothing here imports from app/, workbench/ or engine/; only page-loader.ts
// touches the DOM. The engine worker, engine/web, the app, scripts and tests import from here. UI (the status line) is
// the app's (app/src/boot/load-status.ts), reading filesStatus().
export * from './tree.ts';
export * from './manifest.ts';
export * from './status.ts';
export * from './pack.ts';
export { lsR, parseLsR, lsRIndex } from './ls-r.ts';
export { createResourceStore, cacheKey, RESOURCE_DB } from './cache.ts';
export { chain, mapProvider, type ResourceProvider } from './provider.ts';
export { httpProvider, texRequires, type HttpProvider } from './http.ts';
