// In-page UX instrumentation, installed with page.addInitScript({ path }).
// Everything is recorded against performance.now(); a scenario step brackets its
// actions with __qa.begin(label, opts) … __qa.end() and gets one summary.
//
// What it measures (cross-browser; Chromium adds longtask / layout-shift entries):
// - frames: a requestAnimationFrame loop; gaps > 50 ms are jank (all browsers)
// - long tasks > 50 ms (PerformanceObserver 'longtask', Chromium)
// - flashes: an element (outside typeset content and CodeMirror internals) that
//   was visible for < 200 ms before it was removed or hidden again; a text in a
//   status line (#status, #pre-status, #toast-text, .rh-status) shown
//   for < 200 ms before it changed; a block's pending state (the breathing side
//   line) that lasted < 200 ms
// - shifts: per frame, the viewport top/height of every block in view; a block
//   the step did not touch that moves (> 1 px) without a scroll the test made is
//   a shift, net of the height changes of touched blocks above it
// - blank frames: a block in view that had typeset content and has none
// - latency: arm(type, cond) → from the input event's timeStamp to the first
//   frame after cond() holds (as harness)
(() => {
  if (window.__qa) return;
  const now = () => performance.now();
  const qa = {
    longtasks: [], layoutShifts: [], frames: [], flashes: [], textFlashes: [], stateFlashes: [],
    shifts: [], blanks: [], errors: [], rec: null, hasLongtask: false, hasLayoutShift: false,
    firstPaint: null,
  };
  window.__qa = qa;
  addEventListener('error', (e) => qa.errors.push({ t: now(), msg: String(e.message).slice(0, 300) }));
  addEventListener('unhandledrejection', (e) => qa.errors.push({ t: now(), msg: `unhandled: ${String(e.reason?.message ?? e.reason).slice(0, 300)}` }));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); qa.hasLongtask = true; } catch { /* not Chromium */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) qa.layoutShifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput,
        src: (e.sources ?? []).slice(0, 3).map((s) => { const n = s.node; return n?.nodeType === 1 ? `${n.tagName.toLowerCase()}.${String(n.className?.baseVal ?? n.className ?? '').split(' ')[0]}${n.dataset?.kind ? `[${n.dataset.kind}]` : ''}` : n?.nodeName ?? '?'; }) });
    }).observe({ type: 'layout-shift', buffered: true });
    qa.hasLayoutShift = true;
  } catch { /* not Chromium */ }

  // ── elements that appear / disappear ─────────────────────────────────────
  const IGNORE = '.latex-block, .cm-editor, .blk-render, .fe-root svg, .rn-card .latex-block, .cm-tooltip';
  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  /** shown by style (display, visibility, opacity, size), wherever it is: an attribute change that only scrolls it in is not a flash */
  const styleVisible = (el) => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}${el.textContent ? ` «${el.textContent.trim().slice(0, 40)}»` : ''}`;
  const watched = new Map();
  const removedSoon = [];                       // checked on the next frame: replaced by an identical element?
  qa.churn = 0;                    // el → { added, shown, desc }
  const skip = (el) => el.nodeType !== 1 || el.closest?.(IGNORE) || /^(SCRIPT|STYLE|LINK|META|TSPAN|TEXT|PATH|USE|G|SYMBOL|DEFS)$/i.test(el.tagName);
  const watch = (el) => { if (!skip(el) && !watched.has(el)) watched.set(el, { added: now(), shown: null, desc: '' }); };
  const TEXT_SEL = '#status, #pre-status, #toast-text, .rh-status, .live-note, .bp-status';
  const texts = new Map();                      // el → { text, since }
  const mo = new MutationObserver((ms) => {
    const t = now();
    for (const m of ms) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1) watch(n);
        for (const n of m.removedNodes) {
          if (n.nodeType !== 1) continue;
          const w = watched.get(n);
          if (w) { if (w.shown != null && t - w.shown < 200) removedSoon.push({ t, w }); watched.delete(n); }
        }
      } else if (m.type === 'attributes') {
        const el = m.target;
        if (el.nodeType !== 1) continue;
        if (m.attributeName === 'data-state' && el.classList.contains('blk')) {
          const v = el.getAttribute('data-state');
          const prev = el.__qaState;
          if (prev && prev.v === 'pending' && v !== 'pending' && !el.classList.contains('editing') && t - prev.t < 200 && prev.inView)
            qa.stateFlashes.push({ t, ms: +(t - prev.t).toFixed(1), id: el.dataset.id, kind: el.dataset.kind, to: v });
          const r = el.getBoundingClientRect();
          el.__qaState = { v, t, inView: r.bottom > 0 && r.top < innerHeight };
        } else if (!skip(el) && !watched.has(el) && (m.attributeName === 'class' || m.attributeName === 'hidden' || m.attributeName === 'style')) {
          { const v1 = styleVisible(el); watched.set(el, { added: t, shown: null, desc: describe(el), attr: true, v1 }); }
        }
      }
      // status texts
      const host = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(TEXT_SEL);
      if (host) {
        const txt = host.textContent.trim();
        const p = texts.get(host);
        if (!p || p.text !== txt) {
          if (p && p.text && t - p.since < 200 && visible(host)) qa.textFlashes.push({ t, ms: +(t - p.since).toFixed(1), where: `#${host.id || host.className}`, text: p.text.slice(0, 60), next: txt.slice(0, 60) });
          texts.set(host, { text: txt, since: t });
        }
      }
    }
  });
  const startMO = () => mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'data-state'], characterData: true });
  if (document.documentElement) startMO(); else addEventListener('DOMContentLoaded', startMO);

  // ── the frame loop ────────────────────────────────────────────────────────
  let last = now();
  const blockGeom = () => {
    const out = new Map();
    for (const el of document.querySelectorAll('#page .blk')) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.height === 0) continue;
      const rend = el.querySelector(':scope > .blk-main > .blk-render');
      out.set(el.dataset.id, { top: r.top, h: r.height, ink: !!rend?.querySelector('.latex-block svg, .latex-block img, .latex-block image'), state: el.dataset.state, editing: el.classList.contains('editing') });
    }
    return out;
  };
  const tick = () => {
    const t = now();
    if (qa.firstPaint == null && document.body) qa.firstPaint = { t, bg: getComputedStyle(document.body).backgroundColor, html: getComputedStyle(document.documentElement).backgroundColor };
    if (t - last > 50) qa.frames.push([last, t - last]);
    last = t;
    // watched elements: first visible frame; hidden again quickly
    while (removedSoon.length) {
      const { t: tr, w } = removedSoon.shift();
      const twin = w.rect && [...document.getElementsByTagName(w.key.split('.')[0])].some((e) => (e.tagName + '.' + (typeof e.className === 'string' ? e.className : '')) === w.key && e.textContent === w.text && (() => { const r = e.getBoundingClientRect(); return Math.abs(r.left - w.rect[0]) < 1 && Math.abs(r.top - w.rect[1]) < 1 && Math.abs(r.width - w.rect[2]) < 1; })());
      if (twin) qa.churn++; else qa.flashes.push({ t: tr, ms: +(tr - w.shown).toFixed(1), what: w.desc, how: 'removed' });
    }
    for (const [el, w] of watched) {
      if (!el.isConnected) { watched.delete(el); continue; }
      const vis = w.attr ? styleVisible(el) : visible(el);
      if (w.attr) {
        // the state an attribute change gave lasted < 200 ms: shown briefly, or hidden briefly (a blink)
        if (vis !== w.v1) { if (t - w.added < 200) qa.flashes.push({ t, ms: +(t - w.added).toFixed(1), what: w.desc, how: w.v1 ? 'shown briefly' : 'hidden briefly' }); watched.delete(el); }
        else if (t - w.added > 400) watched.delete(el);
        continue;
      }
      if (w.shown == null && vis) { w.shown = t; w.desc = describe(el); const r = el.getBoundingClientRect(); w.rect = [r.left, r.top, r.width, r.height]; w.key = el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''); w.text = el.textContent; }
      else if (w.shown != null && !vis) { if (t - w.shown < 200) qa.flashes.push({ t, ms: +(t - w.shown).toFixed(1), what: w.desc, how: 'hidden' }); watched.delete(el); }
      else if (w.shown == null && t - w.added > 1000) watched.delete(el);
      else if (w.shown != null && t - w.shown > 400) watched.delete(el);
    }
    const rec = qa.rec;
    if (rec) {
      const g = blockGeom();
      const sy = scrollY;
      if (rec.prev && !rec.scrolling) {
        if (Math.abs(sy - rec.prevScroll) > 1) rec.appScroll = Math.max(rec.appScroll, Math.abs(sy - rec.prevScroll));
        // walk in document order. Above the first touched (edited, new) block nothing may move;
        // the touched block itself should stay put (touchedMove); below it, moves follow its
        // height (reported as belowMove, not a failure). A step that touches nothing: every block counts.
        let below = false;
        for (const [id, b] of g) {
          const p = rec.prev.get(id);
          if (!p) { below = true; continue; }                        // a new block in view
          const dTop = b.top - p.top, dH = b.h - p.h;
          if (rec.touched.has(id) || b.editing) { below = true; rec.touchedMove = Math.max(rec.touchedMove, Math.abs(dTop)); continue; }
          if (below) { rec.belowMove = Math.max(rec.belowMove, Math.abs(dTop)); }
          else if (Math.abs(dTop) > 1 || Math.abs(dH) > 1) rec.shiftFrames.push({ t, id, dTop: +dTop.toFixed(1), dH: +dH.toFixed(1), un: +dTop.toFixed(1) });
          if (p.ink && !b.ink && b.state !== 'editing') rec.blankFrames.push({ t, id });
        }
      }
      rec.prev = g; rec.prevScroll = sy;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ── steps and latency ─────────────────────────────────────────────────────
  qa.begin = (label, opts = {}) => {
    qa.rec = { label, t0: now(), touched: new Set(opts.touched ?? []), anchorBelowOnly: opts.anchorBelowOnly !== false, prev: null, prevScroll: scrollY,
      shiftFrames: [], blankFrames: [], touchedMove: 0, belowMove: 0, appScroll: 0, scrolling: false };
  };
  qa.touch = (id) => qa.rec?.touched.add(id);
  qa.scrolling = (on) => { if (qa.rec) { qa.rec.scrolling = on; qa.rec.prev = null; } };
  qa.end = () => {
    const r = qa.rec; qa.rec = null;
    if (!r) return null;
    const t1 = now(), inW = (t) => t >= r.t0 && t <= t1;
    const lts = qa.longtasks.filter(([t]) => inW(t)), gaps = qa.frames.filter(([t]) => inW(t));
    const byBlock = new Map();
    for (const s of r.shiftFrames) { const b = byBlock.get(s.id) ?? { id: s.id, frames: 0, maxTop: 0, maxH: 0 }; b.frames++; b.maxTop = Math.max(b.maxTop, Math.abs(s.un)); b.maxH = Math.max(b.maxH, Math.abs(s.dH)); byBlock.set(s.id, b); }
    const kinds = new Map([...document.querySelectorAll('#page .blk')].map((e) => [e.dataset.id, e.dataset.kind]));
    return {
      label: r.label, ms: +(t1 - r.t0).toFixed(0),
      longtasks: { n: lts.length, max: +Math.max(0, ...lts.map(([, d]) => d)).toFixed(0), total: +lts.reduce((s, [, d]) => s + d, 0).toFixed(0) },
      jank: { n: gaps.length, max: +Math.max(0, ...gaps.map(([, d]) => d)).toFixed(0), over100: gaps.filter(([, d]) => d > 100).length },
      cls: +qa.layoutShifts.filter((e) => inW(e.t) && !e.input).reduce((s, e) => s + e.v, 0).toFixed(4),
      clsSrc: [...new Set(qa.layoutShifts.filter((e) => inW(e.t) && !e.input).flatMap((e) => e.src))].slice(0, 6),
      shifts: [...byBlock.values()].map((b) => ({ ...b, kind: kinds.get(b.id), maxTop: +b.maxTop.toFixed(1), maxH: +b.maxH.toFixed(1) })).sort((a, b) => b.maxTop - a.maxTop).slice(0, 8),
      shiftMax: +Math.max(0, ...[...byBlock.values()].map((b) => b.maxTop)).toFixed(1),
      touchedMove: +r.touchedMove.toFixed(1), belowMove: +r.belowMove.toFixed(1), appScroll: +r.appScroll.toFixed(1),
      blanks: [...new Set(r.blankFrames.map((b) => b.id))].length,
      flashes: qa.flashes.filter((f) => inW(f.t)),
      textFlashes: qa.textFlashes.filter((f) => inW(f.t)),
      stateFlashes: qa.stateFlashes.filter((f) => inW(f.t)),
      errors: qa.errors.filter((e) => inW(e.t)),
    };
  };
  /** latency of the next `type` event: its timeStamp → the first frame after cond() is true */
  qa.arm = (type, cond, timeout = 30000) => {
    qa.lat = new Promise((res) => {
      const f = (e) => {
        removeEventListener(type, f, true);
        const t0 = e.timeStamp, c = typeof cond === 'function' ? cond : new Function(`return (${cond})`)();
        const give = setTimeout(() => res({ ms: NaN, timeout: true }), timeout);
        const frame = () => { let ok = false; try { ok = c(); } catch { /* not yet */ } if (ok) { clearTimeout(give); requestAnimationFrame(() => res({ ms: +(performance.now() - t0).toFixed(1) })); } else requestAnimationFrame(frame); };
        frame();
      };
      addEventListener(type, f, true);
    });
  };
  qa.until = (cond, timeout = 60000) => new Promise((res) => {
    const t0 = now(), c = typeof cond === 'function' ? cond : new Function(`return (${cond})`)();
    const frame = () => { let ok = false; try { ok = c(); } catch { /* */ } if (ok) res({ ms: +(now() - t0).toFixed(1) }); else if (now() - t0 > timeout) res({ ms: NaN, timeout: true }); else requestAnimationFrame(frame); };
    frame();
  });
})();
