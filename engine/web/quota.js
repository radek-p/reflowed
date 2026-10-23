// @ts-check
// A write the browser refused for lack of space (QuotaExceededError) is said, not swallowed: the page
// gets one 'editor:quota' event (app/quota.js shows a toast); other write failures stay quiet misses.
/** @param {unknown} e */
export const isQuota = (e) => /** @type {any} */ (e)?.name === 'QuotaExceededError' || /quota/i.test(String(/** @type {any} */ (e)?.message ?? ''));
/** @param {unknown} e */
export function reportQuota(e) {
  if (!isQuota(e) || typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('editor:quota', { detail: String(/** @type {any} */ (e)?.message ?? e) }));
}
