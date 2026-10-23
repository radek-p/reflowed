// A pane's scroll on the reader's behalf (panes/pane.ts, perf/anchor.js appScroll): the anchor keeper is
// told around it (its callers told it by hand; two did not, and the keeper took that scroll for the reader's own).
//   node app/src/panes/pane.test.ts      (Node; exit 1 on a failure)
import { createPane } from './pane.ts';
import type { DocView, Keeper } from './types.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };
const log: string[] = [];
// the window a pane listens on (resize), as far as this test needs it
Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0, innerHeight: 800, scrollBy: () => log.push('window scroll'), getComputedStyle: () => ({ scrollPaddingTop: '0' }) });
const el = { dataset: {} as Record<string, string>, style: { setProperty() {} }, addEventListener() {}, removeEventListener() {}, ownerDocument: {} } as unknown as HTMLElement;
const keeper = { moved: () => log.push('moved'), adjusted: () => log.push('adjusted'), setScroller() {} } as unknown as Keeper;
const p = createPane({ id: 'a', el, docView: { container: null } as unknown as DocView, keeper, inset: () => 0 });
const scroller = { scrollBy: (o: { top: number }) => log.push(`scroll ${o.top}`), getBoundingClientRect: () => ({ top: 0 }), clientHeight: 500, scrollTop: 0, style: {} } as unknown as HTMLElement;
try { p.setScroller(scroller); } catch { /* its height variable: DOM this test has not */ }
log.length = 0;
p.scrollBy(40);
check('scrollBy tells the keeper, scrolls the pane, tells it again (its scroll event comes later)', log.join(',') === 'moved,scroll 40,moved', log.join(','));
// a correction for a change of the page (the stacked editor kept in place): the keeper's reading point stays
log.length = 0;
p.scrollBy(12, { hold: true });
check('scrollBy with hold: a correction, the keeper told it adjusted, not moved', log.join(',') === 'scroll 12,adjusted', log.join(','));
// the window, when the pane is the page: appScroll to a y
const { appScroll } = await import('../perf/anchor.js');
log.length = 0;
Object.assign(globalThis, { scrollTo: (o: { top: number }) => log.push(`window to ${o.top}`) });
Object.assign(globalThis, { window: globalThis });
appScroll({ scroller: null, keeper }, { to: 120 });
check('appScroll to a y in the window, the keeper told around it', log.join(',') === 'moved,window to 120,moved', log.join(','));
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
