// Going somewhere in the document, per pane: ONE rule for every navigation (a \ref or \cite go-to,
// the reference card's buttons, the outline, find) and the Back history they share.
//
//   const nav = createNavigator(host)
//   host: { pane(p) -> the Pane (panes/pane.ts: id, view.container (its .blocks), scroller (null: the window), top(),
//                         keeper?, viewOf(blockId)) | null,
//           focused() -> pane id, focus (docview/focus.js: get(p), set(p, id), section(id)), toast(text) }
//   nav.goTo(blockId, { pane, anchor, align, from, history }) -> Promise<boolean>
//   nav.leaveFocusFor(pane, blockId, { history }) -> boolean   (the rule alone: callers that reveal by themselves)
//   nav.back() -> Promise<boolean> · nav.history() · nav.clear() · nav.onChange(fn) · nav.say(text) (a toast)
//
// The rule: a target outside the pane's section focus leaves the focus first (the focused heading kept where it is),
// then the target is revealed in one motion; Back returns to where the reader was, the section focused again at the
// same scroll. Never a silent no-op: a target that cannot be shown says why (a toast) and returns false.
// Every such scroll that is far jumps first and animates only the last pane height (far.js): the blocks in
// between are never in view, so the viewer does not paint them.
import { approach, glide } from './far.js';
import { appScroll } from '../perf/anchor.js';

const READING_Y = 200;
const MAX = 20;

export function createNavigator(host) {
  const stack = [];
  const listeners = new Set();
  const changed = () => { for (const f of listeners) { try { f(stack.length); } catch (e) { console.error(e); } } };

  /** where the reader is in pane P: the block at its reading line and that block's y (robust to reflow above) */
  function position(P, from) {
    const y = P.top() + Math.min(innerHeight * 0.3, READING_Y);
    const views = [...(P.view.container?.children ?? [])].filter((el) => el.matches?.('.blk[data-id]') && el.offsetParent !== null);
    const blk = from?.blockId ? P.viewOf(from.blockId)?.root ?? null : views.find((el) => el.getBoundingClientRect().bottom > y) ?? null;
    return { pane: P.id, blockId: blk?.dataset.id ?? null, top: blk ? blk.getBoundingClientRect().top : 0, scroll: scrollOf(P),
      focus: host.focus?.get(P.id) ?? null, from: from ?? null };
  }
  const scrollOf = (P) => (P.scroller ? P.scroller.scrollTop : scrollY);
  async function settled(P) {
    let last = -1, same = 0;
    for (let i = 0; i < 180 && same < 3; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const y = scrollOf(P);
      if (Math.abs(y - last) < 0.5) same++; else same = 0;
      last = y;
    }
  }
  const push = (entry) => { stack.push(entry); if (stack.length > MAX) stack.shift(); changed(); };

  /** the rule alone: pane p leaves its section focus when blockId is outside it. True when it left. */
  function leaveFocusFor(p, blockId, { history = false, from = null } = {}) {
    const F = host.focus, P = host.pane(p);
    const id = F?.get(p);
    if (!P || !id) return false;
    const sec = F.section(id);
    if (sec?.ids.has(blockId)) return false;
    if (history) push(position(P, from));
    F.set(p, null);
    return true;
  }

  async function goTo(blockId, { pane = null, anchor = null, align = 'top', from = null, history = true } = {}) {
    const P = host.pane(pane ?? host.focused());
    if (!P) { host.toast?.('There is no pane to show it in.'); return false; }
    const v = blockId ? P.viewOf(blockId) : null;
    if (!v) { host.toast?.('That place is not in this document any more.'); return false; }
    const entry = position(P, from);
    leaveFocusFor(P.id, blockId);
    const el = v.root;
    if (!el.isConnected || el.offsetParent === null) { host.toast?.('That block is hidden here and cannot be shown.'); return false; }
    if (history) push(entry);
    // a label deep in a long block: its anchor at a third of the pane; else the block's top under the pane's top
    const a = anchor ? el.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
    const br = el.getBoundingClientRect(), ar = a?.getBoundingClientRect();
    const deep = ar && ar.top - br.top > innerHeight * 0.4;
    if (deep) await glide(P, scrollOf(P) + ar.top - (P.top() + innerHeight * 0.33));
    else await reveal(P, el, { align });
    document.dispatchEvent(new CustomEvent('nav:jumped', { detail: { pane: P.id, blockId } }));
    return true;
  }

  /** bring el into view in pane P: through the keeper when it has one (it re-aims as blocks above change), after the
   *  far jump; 'nearest' scrolls only when it is not whole in view */
  async function reveal(P, el, { align = 'top' } = {}) {
    const r = el.getBoundingClientRect(), top = P.top(), bottom = top + (P.scroller ? P.scroller.clientHeight : innerHeight - top);
    if (align === 'nearest') {
      if (r.top >= top + 4 && r.bottom <= bottom - 20) return;
      const d = r.top < top + 4 ? r.top - top - 8 : Math.min(r.top - top - 8, r.bottom - bottom + 24);
      return glide(P, scrollOf(P) + d);
    }
    const want = align === 'center' ? (top + bottom - r.height) / 2 : top + 8;
    approach(P, r.top - want);
    if (P.keeper) return P.keeper.reveal(el, { align });
    return glide(P, scrollOf(P) + el.getBoundingClientRect().top - want);
  }

  async function back() {
    const e = stack.pop();
    changed();
    if (!e) return false;
    const P = host.pane(e.pane);
    if (!P) return false;
    const F = host.focus;
    const refocus = F && (F.get(P.id) ?? null) !== e.focus;
    if (refocus) F.set(P.id, e.focus);
    const el = e.blockId ? P.viewOf(e.blockId)?.root : null;
    const d = el && el.offsetParent !== null ? el.getBoundingClientRect().top - e.top : e.scroll - scrollOf(P);
    if (refocus) { if (Math.abs(d) >= 0.5) appScroll(P, { by: d }); else P.keeper?.moved?.(); await settled(P); }     // the section's layout changed: put back at once
    else await glide(P, scrollOf(P) + d);
    document.dispatchEvent(new CustomEvent('nav:back', { detail: { pane: P.id, entry: e } }));
    return true;
  }

  return {
    goTo, back, leaveFocusFor,
    reveal: (p, el, o) => { const P = host.pane(p ?? host.focused()); return P && el ? reveal(P, el, o) : Promise.resolve(); },
    /** a navigation that cannot happen says why (never a silent no-op) */
    say: (text) => host.toast?.(text),
    /** pane p's scroll position (the window's while it is the only pane) */
    scrollOf: (p) => { const P = host.pane(p ?? host.focused()); return P ? scrollOf(P) : scrollY; },
    history: () => stack.map((x) => ({ ...x })),
    clear() { if (stack.length) { stack.length = 0; changed(); } },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
export { createReveal } from './reveal.js';   // a block shown in a pane
