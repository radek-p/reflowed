// The browser is out of space for this page's storage: one toast per page says so (the result cache and
// the documents share the origin's quota, so document writes fail too). Events: 'editor:quota'
// (engine/web/quota.js reportQuota: the result cache, the app's store writes).
import { showToast } from '../chrome/toast.js';
export const QUOTA_NOTE = 'The browser has no room left for this page\'s data: recent changes may not be saved. Free some space (delete old documents, or clear this site\'s data in the browser) and try again.';
let shown = false;
export function installQuotaNotice() {
  document.addEventListener('editor:quota', () => { if (shown) return; shown = true; showToast(QUOTA_NOTE); setTimeout(() => { shown = false; }, 60000); });
}
