// The build's version, shown so a reader can tell an updated file: scripts/build.ts writes the stamp and the
// commit; the dev page has none: "dev".
//   buildVersion() -> { stamp: '2026-10-04 12:40' | null, rev, label: 'Preview · 4 Oct 2026 12:40' | 'Preview · dev', about }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function buildVersion() {
  const c = globalThis.document?.querySelector('meta[name="reflowed-build"]')?.content ?? '';
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})(?: · (\S+))?/.exec(c);
  if (!m) return { stamp: null, rev: null, label: 'Preview · dev', about: 'Build: dev' };
  const [, y, mo, d, t, rev = ''] = m;
  return { stamp: `${y}-${mo}-${d} ${t}`, rev, label: `Preview · ${Number(d)} ${MONTHS[Number(mo) - 1]} ${y} ${t}`, about: `Build ${y}-${mo}-${d} ${t}${rev ? ` (${rev})` : ''}` };
}
