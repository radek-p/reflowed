// @ts-check
// One document's results: its compile results by key (the page's map; the persistent
// cache, store.cache, stays shared: it is content-addressed), its preamble's problems, its word count and when it was
// last edited. The last three are signals: the page shows the current document's (settings/index.js showPreambleErrors, chrome/
// sidebar-chrome.ts showWordCount), so two documents open at once keep their own. No DOM.
//
//   const results = createResults()
//     results.cache            Map: compile key -> BlockResult
//     results.preamble         signal: { errors, warnings } (the warm-up's answer)
//     results.preambleErrors   computed: its errors (the Settings panel's document tab, the outline entry's badge)
//     results.words            signal: { words, blocks, inline, displays, characters } | null (the sidebar's footer,
//                              the end space's foot: docview/end-space.ts)
//     results.edited           signal: when the document was last edited (ms; the store's updatedAt when it opened, then
//                              each edit made here: doc/session.ts), 0 before one opens (the end space's foot)
//     results.status the document's status as data (doc/status.ts): typesetting k of n, errors, unsaved
//     results.files            each block's last result's record of the files it used (doc/block-files.ts)
//     results.clear()          the document closed: its results go (its preamble's problems stay, as before)
import { signal, computed } from '@preact/signals';
import { createDocStatus } from './status.ts';
import { createBlockFiles } from './block-files.ts';

const EMPTY = { errors: [], warnings: [] };

export function createResults() {
  /** @type {Map<string, any>} */ const cache = new Map();
  const preamble = signal(/** @type {{ errors: any[], warnings: any[] }} */ (EMPTY));
  const preambleErrors = computed(() => preamble.value?.errors ?? []);
  const words = signal(/** @type {any} */ (null));
  const edited = signal(0);
  const status = createDocStatus();
  const files = createBlockFiles();
  return { cache, preamble, preambleErrors, words, edited, status, files, clear() { cache.clear(); files.clear(); status.reset(); } };
}
