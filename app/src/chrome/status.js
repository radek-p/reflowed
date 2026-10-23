// the top bar's typesetting status, with hysteresis. A fast compile (the live preview of a
// keystroke, a block left) changed it twice in a fraction of a second ("Typesetting 1 block…", "All blocks
// typeset"): a flicker at every edit. Now:
//   - "busy" shows only after BUSY_AFTER ms of being busy (a compile that ends sooner shows nothing);
//   - "ok" (all typeset) shows only after a busy that was shown (which stays at least MIN_SHOWN ms), and goes after OK_FOR ms;
//   - "warn" / "error" show at once and stay (they say something to act on); "" clears.
//
//   const st = createStatus(show(text, kind), { setTimeout, clearTimeout, busyAfter, okFor })
//   st.set(text, kind) · st.state() -> { text, kind } (what was said last, shown or not) · st.shown() · st.reset()
export const BUSY_AFTER = 1000, OK_FOR = 2500, MIN_SHOWN = 600;   // a busy once shown stays MIN_SHOWN ms (no flash)

export function createStatus(show, o = {}) {
  const T = o.setTimeout ?? setTimeout, C = o.clearTimeout ?? clearTimeout;
  const busyAfter = o.busyAfter ?? BUSY_AFTER, okFor = o.okFor ?? OK_FOR, minShown = o.minShown ?? MIN_SHOWN;
  const now = o.now ?? (() => performance.now());
  let said = { text: '', kind: '' }, shown = { text: '', kind: '' }, busyTimer = 0, okTimer = 0, holdTimer = 0, busyShown = false, busyAt = 0;
  const put = (text, kind) => { if (shown.text === text && shown.kind === kind) return; shown = { text, kind }; show(text, kind); };
  function set(text, kind = '') {
    said = { text, kind };
    if (kind === 'busy') {
      C(okTimer); okTimer = 0;
      if (busyShown) { put(text, kind); return; }                 // already showing: its count follows
      if (!busyTimer) busyTimer = T(() => { busyTimer = 0; busyShown = true; busyAt = now(); if (said.kind === 'busy') put(said.text, 'busy'); }, busyAfter);
      return;
    }
    C(busyTimer); busyTimer = 0;
    C(holdTimer); holdTimer = 0;
    // a busy just shown stays a moment: what replaces it comes after MIN_SHOWN (no flash)
    const left = busyShown ? minShown - (now() - busyAt) : 0;
    if (left > 0) { holdTimer = T(() => { holdTimer = 0; busyAt = -Infinity; set(said.text, said.kind); }, left); return; }
    const wasBusy = busyShown;
    busyShown = false;
    if (kind === 'ok') {
      if (!wasBusy) { if (shown.kind === 'busy') put('', ''); return; }   // fast: nothing was shown, nothing to say
      put(text, kind);
      C(okTimer); okTimer = T(() => { okTimer = 0; if (shown.kind === 'ok') put('', ''); }, okFor);
      return;
    }
    C(okTimer); okTimer = 0;
    put(text, kind);                                                  // warn, error, a message, or '' (cleared)
  }
  return {
    set,
    state: () => ({ ...said }),
    shown: () => ({ ...shown }),
    reset() { C(busyTimer); C(okTimer); C(holdTimer); busyTimer = okTimer = holdTimer = 0; busyShown = false; said = { text: '', kind: '' }; put('', ''); },
  };
}
