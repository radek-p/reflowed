// where a block's source goes while it is edited, beside or below its
// live result (or instead of it: 'replace', the old way).
//
//   decide(pref, blockEl) -> { mode: 'side'|'stacked'|'replace', preview, editor, shift, row, gap }
//   applyLayout(blockEl, layout)   sets data-edit-layout and the sizes (CSS in style.js)
//   clearLayout(blockEl)
//
// Side by side keeps the result where it was: same left edge, same width
// (so the same line breaks), the source in the space to its right. When that
// space is too small the row first moves left into the free margin (the
// result keeps its measure; it slides, it does not re-break), then the result
// narrows, down to PREVIEW_MIN. If even then the source would be narrower
// than EDITOR_MIN, it is stacked: the result stays exactly where it is and
// the source opens below it.
//
// Thresholds:
//   EDITOR_MIN 340 px   ~40 columns of 13.5 px monospace: a line of LaTeX
//                       (\begin{theorem}[Name]\label{thm:x}) without wrapping
//   EDITOR_IDEAL 480    ~58 columns, the typical source line; more is not used
//   EDITOR_MAX 720
//   PREVIEW_MIN max(300 px, 60 % of the reading measure): below that a
//                       paragraph re-breaks into something that no longer
//                       resembles what the author was looking at
//   GAP 20
export const EDITOR_MIN = 340, EDITOR_IDEAL = 480, EDITOR_MAX = 720, PREVIEW_ABS_MIN = 300, PREVIEW_FRAC = 0.6, GAP = 20;
const GUTTER = 44;            // app.css .gutter: left -44px (the + and the handle stay visible)
const MARK = 16;              // app.css .blk::after: the margin marks at right -14px

export function decide(pref, blockEl) {
  if (pref === 'replace' || !blockEl) return { mode: 'replace' };
  // the pane the block is in (split view: each its own scroller, main[data-pane]): the room is that pane's
  const pane = blockEl.closest('main[data-pane]');
  const blocks = blockEl.closest('.blocks');
  const split = !!pane?.closest('[data-part="view"].scrolls');   // the pane scrolls itself (split, or an embedded editor)
  const page = pane;
  const shell = split ? pane : page?.closest('[data-part="shell"]');
  if (!page || !blocks || !shell) return { mode: pref === 'stacked' ? 'stacked' : 'replace' };
  if (pref === 'stacked') return { mode: 'stacked' };
  const pad = split ? 4 : parseFloat(getComputedStyle(page).paddingLeft) || 0;
  const sr = split ? { left: shell.getBoundingClientRect().left, right: shell.getBoundingClientRect().left + shell.clientWidth } : shell.getBoundingClientRect(), cr = blocks.getBoundingClientRect();
  const colLeft = cr.left, colW = cr.width;
  const minLeft = Math.max(sr.left + pad, 0) + GUTTER, maxRight = Math.min(sr.right, document.documentElement.clientWidth) - pad - MARK;
  const avail = maxRight - minLeft;
  const previewMin = Math.max(PREVIEW_ABS_MIN, PREVIEW_FRAC * colW);
  // 1. the result as it is; the source in the room to its right (at most EDITOR_MAX)
  let preview = colW;
  let editor = Math.min(EDITOR_MAX, maxRight - (colLeft + colW) - GAP);
  if (editor < EDITOR_IDEAL) {
    // 2. slide left into the free margin, the result's measure kept
    editor = Math.min(EDITOR_MAX, Math.max(editor, avail - colW - GAP));
    // 3. narrow the result, down to previewMin, for an editor of EDITOR_MIN
    if (editor < EDITOR_MIN) { editor = EDITOR_MIN; preview = Math.min(colW, avail - GAP - editor); }
  }
  if (preview < previewMin || editor < EDITOR_MIN) return { mode: 'stacked', reason: `no room: result ${Math.round(preview)} px, source ${Math.round(editor)} px` };
  const row = preview + GAP + editor;
  const shift = Math.max(0, Math.min(colLeft - minLeft, colLeft + row - maxRight));
  return { mode: 'side', preview: Math.floor(preview), editor: Math.floor(editor), gap: GAP, row: Math.floor(row), shift: Math.round(shift) };
}

export function applyLayout(el, l) {
  el.dataset.editLayout = l.mode;
  if (l.mode === 'side') {
    el.style.setProperty('--edit-preview', `${l.preview}px`);
    el.style.setProperty('--edit-editor', `${l.editor}px`);
    el.style.setProperty('--edit-gap', `${l.gap}px`);
    el.style.setProperty('--edit-row', `${l.row}px`);
    el.style.setProperty('--edit-shift', `${l.shift}px`);
  } else for (const p of ['--edit-preview', '--edit-editor', '--edit-gap', '--edit-row', '--edit-shift']) el.style.removeProperty(p);
}

export function clearLayout(el) {
  if (!el) return;
  delete el.dataset.editLayout;
  applyLayout(el, { mode: 'replace' });
  delete el.dataset.editLayout;
  clearMirrors(el);
}

// ── the caret, mirrored in the live result ───────────────────────────────
// A thin bar between the typeset glyphs where the source caret is: moved on
// every caret move and after every live compile, with no compile of its own.
// The glyphs' source offsets are worked out once per render and cached.
//
// Offsets: with the engine's sourcemap (result.sourcemap: engine-api
// sourcemap.ts blockGlyphOffsets), exact, per drawn glyph (-1 for a glyph a
// macro made); else the fuzzy aligner of app/source-position.js run the other
// way (the glyphs' letters against the source's letters, the whole block).
// The render was compiled from `compiled`, the editor holds `text`: the caret
// is carried across the edit between them (common prefix and suffix), so the
// bar follows typing before the next compile lands.
//
// Where (offset c in `compiled`): between the glyph of the character before
// the caret (c−1) and the glyph of the one after it (c) when both are drawn
// on one line; else the right edge of the former (the end of a word, of a
// line), else the left edge of the latter (after a space: a space has no
// glyph). Failing both, the nearest glyph within 3 characters with no `\`,
// brace or `$` between, dimmer; else hidden: a caret in a command name
// (`\tex|tbf`) marks nothing rather than guess. Height: the font's
// ascender to descender (0.75 / 0.25 of its size) at the glyph used.
import { blockOf, layoutGeneration, spToPx } from './viewer-host.ts';
import { screenCTM } from './screen-ctm.ts';
import { drawnGlyphs, sourcePositionFor, toSourceOffset } from '../../../engine/api/src/sourcemap.ts';
import { guardedBlockGlyphOffsets, guardedLocate } from '../../../engine/api/src/sourcemap-guard.ts';
import { projectSource, align, glyphsOf } from '../app/source-position.js';
import { definitionSpans } from '../tex/definitions.ts';
import { shownBlock } from './shown.ts';
import { visibleBox } from '../../../workbench/src/viewport.ts';

const glyphCache = new WeakMap();        // latex-block element -> { compiled, gen, glyphs, method }
// a segment's screen matrix, read once per burst of glyph boxes (a click's hit test, a caret mark): the
// boxes of one call are read with nothing laid out between them (one getScreenCTM per glyph was ~8 ms of a click
// on a long paragraph). Cleared at the start of each such call and after it (a microtask).
let ctms = null;
function ctmOf(svg) {
  if (!svg) return null;
  if (!ctms) { ctms = new Map(); queueMicrotask(() => { ctms = null; }); }
  let m = ctms.get(svg);
  if (m === undefined) { m = screenCTM(svg); ctms.set(svg, m); }   // (CSS zoom in it in every browser: view/screen-ctm.ts)
  return m;
}
const freshBoxes = () => { ctms = null; };
const ALNUM = /[\p{L}\p{N}]/u;
const letters = (s) => [...s.normalize('NFKD')].filter((c) => ALNUM.test(c)).map((c) => c.toLowerCase());

/** each drawn glyph: { off, line, box() -> { left, right, top, bottom } in client px } */
function exactGlyphs(el, blk, sm, compiled) {
  const doc = blk.document, segs = blk.segments(), sp = spToPx();
  const drawn = drawnGlyphs(segs);
  const { glyphs: offs } = guardedBlockGlyphOffsets(sm, doc, drawn, compiled, { file: sm.file, firstLine: sm.firstLine ?? 1 });
  const size = new Map((doc.fonts ?? []).map((f) => [f.id, (f.size_sp || 655360) * sp]));
  const gm = doc.glyph_metrics ?? [];
  const boxes = [];
  for (let i = 0; i < segs.length; i++) {
    let line = -1;
    // maths: a display, or between TeX's math nodes on a line (the capture keeps them)
    const display = segs[i].kind === 'display';
    let inMath = false;
    segs[i].walk({
      line(j) { line = j; },
      node(n, x, y, adv) {
        if (n.type === 'math') { inMath = !inMath; return; }
        if (n.type !== 'glyph') return;
        const m = gm[(n.metrics || 0) - 1] ?? {};
        boxes.push({ math: display,   // glyph boxes in displays only; inline maths selects with its line (inMath kept for later)
         inline: inMath, ch: String.fromCodePoint(n.char || 32), seg: i, line: `${i}:${line}`, x, y, adv: Math.max(adv, 0.5), s: size.get(n.font) ?? 10 * 65536 * sp,
          h: (n.height ?? m.height ?? 0) * sp, d: (n.depth ?? m.depth ?? 0) * sp });
      },
    });
  }
  const map = (b, x0, y0, x1, y1) => {
    const m = b && ctmOf(segs[b.seg]?.svg);
    if (!m) return null;
    // the affine map by hand (two DOMPoints per glyph were most of a long paragraph's hit test)
    const ax = m.a * x0 + m.c * y0 + m.e, ay = m.b * x0 + m.d * y0 + m.f, bx = m.a * x1 + m.c * y1 + m.e, by = m.b * x1 + m.d * y1 + m.f;
    return { left: Math.min(ax, bx), right: Math.max(ax, bx), top: Math.min(ay, by), bottom: Math.max(ay, by) };
  };
  // glyphs a macro made (viaMacro): the call's span in the source, \\name and its braced arguments
  const via = new Map();
  offs.forEach((off, k) => {
    if (off >= 0) return;
    const at = guardedLocate(sm, doc, drawn[k]);
    const p = at && sourcePositionFor(sm, at);
    if (!p || !p.viaMacro || (sm.file && p.file !== sm.file)) return;
    const m = toSourceOffset(p, compiled, sm.firstLine ?? 1);
    if (m < 0 || compiled[m] !== '\\') return;
    via.set(k, { m, end: callEnd(compiled, m) });
  });
  // Glyphs a macro's body made carry the body's position (in the preamble: no offset here; in a \\def
  // inside the block: an offset inside the definition). Neither is where the author wrote the call:
  // a run of such glyphs belongs to the call between its neighbours with block positions.
  const defs = definitions(compiled);
  const inDef = (o) => defs.some(([a, b]) => o >= a && o < b);
  const own = offs.map((o, k) => (o >= 0 && !inDef(o) ? o : via.has(k) ? -2 : -1));
  for (let k = 0; k < own.length; k++) {
    if (own[k] !== -1) continue;
    let e = k; while (e + 1 < own.length && own[e + 1] === -1) e++;
    let p = -1; for (let i = k - 1; i >= 0; i--) if (own[i] >= 0) { p = i; break; }
    let q = -1; for (let i = e + 1; i < own.length; i++) if (own[i] >= 0) { q = i; break; }
    const from = p >= 0 ? own[p] + 1 : 0, to = q >= 0 ? own[q] : compiled.length;
    let m = -1;
    for (let i = from; i < to; i++) { if (compiled[i] === '\\' && !inDef(i)) { m = i; break; } }
    if (m >= 0) { const end = Math.min(callEnd(compiled, m), Math.max(m + 1, to)); for (let i = k; i <= e; i++) via.set(i, { m, end }); }
    k = e;
  }
  const final = offs.map((off, k) => { const v = via.get(k); return v ? v.m : own[k] === -1 ? -1 : off; });
  return final.map((off, k) => {
    const b = boxes[k], v = via.get(k);
    const lig = !v && b ? ligatureSpan(b.ch, off, final, k, compiled) : 0;
    return {
      via: v ? v.end : 0,
      off, ch: b?.ch ?? '', line: b?.line ?? '', math: !!b?.math, inline: !!b?.inline,
      /** a ligature: one glyph for this many source letters (ﬂ of «flip»: 2); absent otherwise */
      ...(lig ? { span: lig, lig: true } : {}),
      /** the font's ascender to descender at this glyph (the caret's height) */
      box: () => b && map(b, b.x, b.y - 0.75 * b.s, b.x + b.adv, b.y + 0.25 * b.s),
      /** the glyph's own box: its advance by its height and depth (as the inspector outlines a glyph) */
      ink: () => b && map(b, b.x, b.y - Math.max(b.h, 0.05 * b.s), b.x + b.adv, b.y + b.d),
    };
  });
}

function fuzzyGlyphs(el, compiled) {
  const gs = glyphsOf(el);
  const { chars, offs } = projectSource(compiled);
  const gl = [], owner = [];
  gs.forEach((g, gi) => { for (const l of letters(g.text)) { gl.push(l); owner.push(gi); } });
  const off = gs.map(() => -1);
  if (gl.length && chars.length && gl.length * chars.length < 4e6) {
    const matched = align(gl, chars);
    matched.forEach((j, k) => { if (j >= 0 && off[owner[k]] < 0) off[owner[k]] = offs[j]; });
  }
  return gs.map((g, i) => {
    const r0 = g.el.getBoundingClientRect();
    const box = () => { const r = g.el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { off: off[i], ch: g.text, line: `${Math.round(r0.bottom)}`, box, ink: box };
  });
}

/** The caret in `text` carried to `compiled` (the edit between them: common prefix and suffix). */
export function carryCaret(compiled, text, caret) {
  if (compiled === text) return caret;
  let p = 0;
  const n = Math.min(compiled.length, text.length);
  while (p < n && compiled[p] === text[p]) p++;
  let s = 0;
  while (s < n - p && compiled[compiled.length - 1 - s] === text[text.length - 1 - s]) s++;
  if (caret <= p) return caret;
  if (caret >= text.length - s) return caret - (text.length - compiled.length);
  return p;                                                       // inside the edit: its start
}

/** Where the bar goes for offset c: { x, top, bottom, sure } in client px, or null.
 *  A glyph stands for its source span (spanOf: a command such as \\triangle is all its letters, a ligature its
 *  letters), so "after a glyph" is the end of that span, as the click's mapping has it. Where no glyph starts or ends
 *  at c (after \\triangle before \\), after \\), inside \\( or a command's name), the bar goes to the nearest edge:
 *  the right edge of the nearest glyph whose span ends at or before c, or the left edge of the next glyph when that
 *  is nearer in the source; inside a glyph's own span or a macro call's name, the nearer edge (dimmed). Sure when only markup that
 *  draws nothing (math delimiters, braces, spaces) lies between. */
/** the x at fraction t of a ligature's box, its letters taken as equal shares */
const ligatureX = (G, t) => G.left + (G.right - G.left) * Math.min(1, Math.max(0, t));
const QUIET = /^(?:\\[()[\]]|[${}\s])*$/;
export function caretPlace(glyphs, compiled, c) {
  const end = (g) => (g.via ? g.via : g.off + spanOf(g, compiled));
  let a = -1, b = -1;
  glyphs.forEach((g, i) => { if (g.off < 0 || g.via) return; if (end(g) === c && end(g) > g.off) a = i; if (g.off === c && b < 0) b = i; });   // (a break's hyphen stands for nothing)   // (-1: no source, never a neighbour)
  // a macro's glyphs are one unit: before the call, before its first glyph; after it, after its last
  glyphs.forEach((g, i) => { if (!g.via) return; if (g.via === c) a = i; if (g.off === c && b < 0) b = i; });
  // between a ligature's letters: its letter's share of the glyph (f|l of ﬂ: its middle), sure; before a call
  // around it (\\caption{… flip …}: the caption's label is the call's, its span the whole argument)
  if (a < 0 && b < 0) {
    const g = glyphs.find((q) => q.lig && q.off < c && c < q.off + q.span), G = g?.box();
    if (G) return { x: ligatureX(G, (c - g.off) / g.span), top: G.top, bottom: G.bottom, sure: true, line: g.line };
  }
  // inside a macro call's name: dimmed (not sure) at the nearer end of the call's glyphs, before its first or after its last
  if (a < 0 && b < 0) {
    const call = glyphs.map((g, i) => [g, i]).filter(([g]) => g.via && c > g.off && c < g.via);
    if (call.length) {
      const [g0] = call[0], atStart = c - g0.off <= g0.via - c;
      const [g, i] = atStart ? call[0] : call[call.length - 1], G = g.box();
      return G ? { x: atStart ? G.left : G.right, top: G.top, bottom: G.bottom, sure: false, line: glyphs[i].line } : null;
    }
  }
  const A = a >= 0 ? glyphs[a].box() : null, B = b >= 0 ? glyphs[b].box() : null;
  if (A && B && glyphs[a].line === glyphs[b].line) return { x: (A.right + B.left) / 2, top: Math.min(A.top, B.top), bottom: Math.max(A.bottom, B.bottom), sure: true, line: glyphs[a].line };
  // a break that takes no space (a hyphenated word: «sim-» | «ulated»): the glyphs on both sides touch c on
  // two lines; the caret is at the start of the next line (downstream, as text editors draw a soft break; a click before
  // that line's first glyph put it there), not after the previous line's last glyph
  if (B) return { x: B.left, top: B.top, bottom: B.bottom, sure: true, line: glyphs[b].line };
  if (A) return { x: A.right, top: A.top, bottom: A.bottom, sure: true, line: glyphs[a].line };
  // inside a glyph's own source (a command's name): the nearer edge of that glyph, dimmed
  const inside = glyphs.findIndex((g) => g.off >= 0 && !g.via && g.off < c && c < end(g));
  if (inside >= 0) {
    const g = glyphs[inside], G = g.box();
    if (G) return { x: c - g.off <= end(g) - c ? G.left : G.right, top: G.top, bottom: G.bottom, sure: false, line: g.line };
  }
  // the nearest glyph before (its span ending at or before c) and after (starting at or after c), by source distance
  let p = -1, n = -1;
  glyphs.forEach((g, i) => {
    if (g.off < 0) return;
    const e = end(g);
    if (e <= c && (p < 0 || e > end(glyphs[p]))) p = i;
    if (g.off >= c && (n < 0 || g.off < glyphs[n].off)) n = i;
  });
  const dp = p >= 0 ? c - end(glyphs[p]) : Infinity, dn = n >= 0 ? glyphs[n].off - c : Infinity;
  const pick = dp <= dn ? p : n;
  if (pick < 0) return null;
  const g = glyphs[pick], G = g.box();
  if (!G) return null;
  const between = pick === p ? compiled.slice(end(g), c) : compiled.slice(c, g.off);
  return { x: pick === p ? G.right : G.left, top: G.top, bottom: G.bottom, sure: QUIET.test(between), line: g.line };
}

/** Mirror the caret (an offset in `text`) in `renderEl`, the .blk-render of a result compiled from
 *  `compiled`. Returns { method, x, sure } or null (hidden). */
export function markCaret(renderEl, result, compiled, text, caret, sel = null) {
  freshBoxes();
  const clear = () => renderEl.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').forEach((m) => m.remove());
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || caret == null || compiled == null) { clear(); return null; }
  const c = mapFor(el, blk, result, compiled);
  const p = caretPlace(c.glyphs, compiled, carryCaret(compiled, text, caret));
  clear();
  const base = renderEl.getBoundingClientRect();
  // a mark over a wide display goes inside the display's scroller, in its content's coordinates: it scrolls with
  // the glyphs it marks (natively, in the same frame) when the display is scrolled sideways
  const displays = [...el.querySelectorAll('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display'))
    .map((d) => ({ d, r: d.getBoundingClientRect() }));
  const hostAt = (x, y) => {
    for (const { d, r } of displays) if (y >= r.top && y <= r.bottom) return { host: d, ox: r.left + d.clientLeft - d.scrollLeft, oy: r.top + d.clientTop - d.scrollTop, display: true };
    return { host: renderEl, ox: base.left, oy: base.top, display: false };
  };
  const inDisplay = new Map();          // display -> fragment of its marks
  // a selection: text as a text selection (a band per line over each run of selected text glyphs, the
  // line's height); maths glyph by glyph (each glyph's own box, so an exponent alone is just its box).
  // Source that drew nothing (command names) adds nothing.
  let bands = 0;
  if (sel && sel.to > sel.from) {
    const from = carryCaret(compiled, text, sel.from), to = carryCaret(compiled, text, sel.to);
    const frag = document.createDocumentFragment();
    const put = (r, math) => {
      if (!r || r.right - r.left <= 0) return;
      const d = document.createElement('div');
      d.className = math ? 'rtx-sel-band rtx-sel-glyph' : 'rtx-sel-band';
      const h = hostAt((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      d.style.cssText = `left:${r.left - h.ox}px;top:${r.top - h.oy}px;width:${r.right - r.left}px;height:${r.bottom - r.top}px`;
      if (h.display) { let f = inDisplay.get(h.host); if (!f) inDisplay.set(h.host, (f = document.createDocumentFragment())); f.append(d); } else frag.append(d);
      bands++;
    };
    // text bands end where the caret would: a selection that starts or ends with a space
    // runs over the interword glue to the caret's place (not to the last selected glyph); across a line
    // break a band runs to its line's end; spaces alone between two glyphs of a line are a band too
    const runs = [], lineBox = new Map();
    for (const g of c.glyphs) {
      if (g.off < 0 || g.math) continue;
      const r = g.box();
      if (!r) continue;
      const l = lineBox.get(g.line);
      if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); } else lineBox.set(g.line, { left: r.left, right: r.right });
    }
    let run = null, picked = false;          // picked: some glyph (text or maths) is in the selection
    const flush = () => { if (run) runs.push(run); run = null; };
    c.glyphs.forEach((g) => {
      if (g.off < 0) return;                          // drawn by a macro: neither in nor out
      const gEnd = g.via || g.off + (g.lig ? g.span : 1);
      if (gEnd <= from || g.off >= to) { flush(); return; }
      picked = true;
      // part of a ligature selected: that share of its box (the l of ﬂ alone: its right half)
      const share = (r) => (r && g.lig && (from > g.off || to < gEnd)
        ? { ...r, left: ligatureX(r, (Math.max(from, g.off) - g.off) / g.span), right: ligatureX(r, (Math.min(to, gEnd) - g.off) / g.span) } : r);
      if (g.math) { flush(); put(share(g.ink()), true); return; }
      const r = share(g.box());
      if (!r) return;
      if (run && run.line === g.line) { run.right = Math.max(run.right, r.right); run.top = Math.min(run.top, r.top); run.bottom = Math.max(run.bottom, r.bottom); }
      else { flush(); run = { ...r, line: g.line }; }
    });
    flush();
    const pf = caretPlace(c.glyphs, compiled, from), pt = caretPlace(c.glyphs, compiled, to);
    const at = (pl) => pl?.sure ? pl : null;
    if (runs.length) {
      const first = runs[0], last = runs[runs.length - 1];
      if (at(pf)?.line === first.line && pf.x < first.left) first.left = pf.x;
      if (at(pt)?.line === last.line && pt.x > last.right) last.right = pt.x;
      // the selection goes on past a run's line (a later run, or its end on a later line): to the line's end
      runs.forEach((r, i) => {
        const next = runs[i + 1];
        const goesOn = next ? next.line !== r.line : (at(pt) && pt.line !== r.line && pt.top >= r.bottom - 1);
        if (goesOn && lineBox.get(r.line)) r.right = Math.max(r.right, lineBox.get(r.line).right);
      });
    } else if (!picked && at(pf) && at(pt) && pf.line === pt.line && pt.x > pf.x) {         // only spaces
      runs.push({ left: pf.x, right: pt.x, top: Math.min(pf.top, pt.top), bottom: Math.max(pf.bottom, pt.bottom), line: pf.line });
    }
    for (const r of runs) put(r, false);
    renderEl.append(frag);
    for (const [d, f] of inDisplay) d.append(f);
  }
  if (!p) return bands ? { method: c.method, bands } : null;
  const bar = document.createElement('div');
  bar.className = p.sure ? 'rtx-caret-bar' : 'rtx-caret-bar rtx-caret-unsure';
  const dpr = devicePixelRatio || 1, z = parseFloat(getComputedStyle(el).zoom) || 1;
  const w = Math.max(1 / dpr, Math.round(2 * z * dpr) / dpr);
  const snap = (v) => Math.round(v * dpr) / dpr;
  const bh = hostAt(p.x, (p.top + p.bottom) / 2);
  bar.style.cssText = `left:${snap(p.x - bh.ox - w / 2)}px;top:${snap(p.top - bh.oy)}px;width:${w}px;height:${snap(Math.max(4, p.bottom - p.top))}px`;
  // the caret's line, faintly (paired with the source editor's active line)
  const line = document.createElement('div');
  line.className = 'rtx-line-band';
  line.style.cssText = `left:-6px;right:-6px;top:${snap(p.top - base.top - 2)}px;height:${snap(Math.max(4, p.bottom - p.top) + 4)}px`;
  renderEl.append(line);                              // the line band spans the block's width: it stays in the render
  bh.host.append(bar);
  return { method: c.method, x: p.x, sure: p.sure, bands };
}

// ── sliding into and out of the layout (after motion.js's morph) ───────────
// FLIP: the result was at r0 before the layout changed; it is laid out at its
// new place now: it slides from r0 there (transform, 220 ms, ease-out). The
// morph's ghost (a static copy of the old rendering, at the old width and
// breaks) slides along while it fades, so the text is not seen re-breaking
// mid-flight; the source pane fades in from the right. Reduced motion: none.
export const SLIDE_MS = 220;
export function slide(u, r0, { entering = true } = {}) {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
  if (reduce || !r0 || !u.render.isConnected || u.render.hidden) return;
  const r1 = u.render.getBoundingClientRect();
  if (!r1.width) return;
  const dx = r0.left - r1.left, dy = r0.top - r1.top;
  const opts = { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
  if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
    u.render.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], opts);
    const ghost = u.main.querySelector(':scope > .morph-ghost');
    ghost?.animate([{ transform: 'none' }, { transform: `translate(${-dx}px, ${-dy}px)` }], { ...opts, fill: 'forwards' });
  }
  if (entering) pulse();
  if (entering && !u.source.hidden) {
    // stacked: the source opens as a popover (a quick, slightly springy scale and fade); side by side: from the right
    const stacked = u.root.dataset.editLayout === 'stacked';
    u.source.animate(stacked ? [{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }],
      stacked ? { duration: 180, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' } : opts);
  }
}

/** both current lines (the source's, the result's) pulse once to a stronger tint and settle (a CSS animation) */
let pulseTimer = 0;
// el: where (the edited block: a class on the page's root would restyle every block during the open's motion)
export function pulse(el = document.documentElement) {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }
  if (reduce) return;
  const root = el;
  root.classList.remove('rtx-line-pulse');
  // restarted on the next frame (no forced style flush in the open's task)
  requestAnimationFrame(() => {
    root.classList.add('rtx-line-pulse');
    clearTimeout(pulseTimer); pulseTimer = setTimeout(() => root.classList.remove('rtx-line-pulse'), 700);
  });
}

/** (dev, tests) the caret map of a render: each drawn glyph's character and source offset */
export function caretMap(renderEl, o = {}) {
  const el = shownBlock(renderEl);
  const c = el && glyphCache.get(el);
  // o.boxes (tests): each glyph's box in client px and whether it is in maths
  return c ? { sm: c.sm, raw: c.raw?.(), method: c.method, compiled: c.compiled, glyphs: c.glyphs.map((g) => ({ ch: g.ch, off: g.off, via: g.via || 0, ...(g.lig ? { span: g.span } : {}),
    ...(o.boxes ? { box: g.box?.() ?? null, math: !!g.math, inline: !!g.inline } : {}) })) } : null;
}

/** Stacked, with a result taller than the window: the popover floats over the result's lower part,
 *  so the mirrored caret is kept in the upper half (at about a third of the window) as it moves. */
// follow: false (the reader scrolled away since the last caret move): the float is decided, nothing scrolls
export function keepCaretInView(u, pane = null, { follow = true } = {}) {
  if (u.root.dataset.editLayout !== 'stacked') return;
  // pane: { top, bottom, origin, scrollBy(dy) (the keeper told) } of the pane it is in (the session gives it: the
  // window below the top bar while it is the only pane, origin 0); without one, the window
  const top = pane?.top ?? 56, bottom = pane?.bottom ?? visibleBox().bottom, origin = pane?.origin ?? pane?.top ?? 0, room = bottom - origin;
  floatIfLarge(u, room);
  if (!follow) return;
  const bar = u.render.querySelector('.rtx-caret-bar');
  if (!bar) return;
  const b = bar.getBoundingClientRect(), pop = u.source.getBoundingClientRect();
  // only when the popover floats over the result (a result taller than the window), or the caret is off
  // screen: a small block's popover sits below its result and nothing moves
  const floating = pop.top < u.render.getBoundingClientRect().bottom - 1;
  const off = b.top < top || b.bottom > bottom;
  if (!off && !(floating && (b.bottom > Math.min(origin + room / 2, pop.top - 8) || b.top < top))) return;
  let dy = b.top - (origin + room * 0.3);
  // a floating popover is pinned at the pane's bottom while the result runs on under it; scrolled further,
  // the result's end would rise above the popover's place and carry it up (it is sticky in the result's flow).
  // Following down, the page scrolls at most until the result's end meets the popover: it stays where it is, and
  // the caret, inside the result, is above it.
  if (floating && dy > 0) dy = Math.max(0, Math.min(dy, u.render.getBoundingClientRect().bottom - pop.top));
  if (Math.abs(dy) < 0.5) return;
  // on the reader's behalf (the pane's anchor keeper is told); not smooth: the caret must be visible at once
  if (pane) { pane.scrollBy(dy); return; }
  window.scrollBy({ top: dy, behavior: 'instant' });
}

/** Everything mirrored from the editor into the preview — the caret, the selection, the line band, the
 *  pulse, the popover's fades — removed: the one teardown, from every way out of editing (app.js
 *  editLayoutLeave: Esc, a press outside, another block, the document closed, a move). */
export function clearMirrors(el) {
  el?.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').forEach((m) => m.remove());
  el?.classList.remove('rtx-float', 'rtx-line-pulse');
  document.documentElement.classList.remove('rtx-line-pulse');
}

/** The popover's scroll-edge fades: a fade on the side where more source is hidden. */
export function updateFades(scroller) {
  if (!scroller) return;
  const { scrollTop, scrollHeight, clientHeight } = scroller;
  scroller.style.setProperty('--fade-top', scrollTop > 1 ? '14px' : '0px');
  scroller.style.setProperty('--fade-bottom', scrollTop + clientHeight < scrollHeight - 1 ? '14px' : '0px');
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('scroll', (e) => {
  const t = e.target;
  if (t instanceof Element && t.classList.contains('cm-scroller') && t.closest('.blk.editing .blk-source')) updateFades(t);
}, true);

/** Stacked: the popover floats (sticky over the result's lower part) only for a result taller than
 *  about half the window; a small block's popover sits under it in the flow. With hysteresis (on above
 *  55 %, off below 45 %), so a block near the threshold does not flip while typing. */
export function floatIfLarge(u, room = visibleBox().bottom) {
  const h = u.render.getBoundingClientRect().height, on = u.root.classList.contains('rtx-float');
  const want = on ? h > room * 0.45 : h > room * 0.55;
  if (want !== on) u.root.classList.toggle('rtx-float', want);
}

/** The caret map of a block element for the source it was compiled from (cached per render and paint). */
function mapFor(el, blk, result, compiled) {
  const sm = result?.sourcemap;
  let c = glyphCache.get(el);
  // made again when the block was laid out again or drew more of its lines (its 'layout' event)
  const gen = layoutGeneration(el);
  if (!c || c.compiled !== compiled || c.gen !== gen) {
    const method = sm?.items ? 'engine' : 'fuzzy';
    let glyphs = [];
    try { glyphs = method === 'engine' ? exactGlyphs(el, blk, sm, compiled) : fuzzyGlyphs(el, compiled); } catch (e) { console.warn('caret map:', e.message); }
    c = { compiled, gen, glyphs, method, sm: sm ? { file: sm.file, firstLine: sm.firstLine, files: sm.files } : null,
      raw: () => { const d = drawnGlyphs(blk.segments()).slice(0, 12); return d.map((n) => { const at = guardedLocate(sm, blk.document, n); const p = at && sourcePositionFor(sm, at); return p ? `${String.fromCodePoint(n.char || 32)}:${p.file}:${p.line}:${p.column}${p.viaMacro ? 'v' : ''}` : `${String.fromCodePoint(n.char || 32)}:-`; }); } };
    glyphCache.set(el, c);
  }
  return c;
}

/** A ligature: how many source letters one glyph stands for (2 or 3), else 0. Its letters by Unicode (ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ:
 *  their compatibility decomposition) when the source has them there; else, for a glyph whose character is not its
 *  source letter (a font that maps its ligatures to private code points: Latin Modern's ff fi fl ffi ffl as U+E01B…),
 *  the letters up to the next glyph with a source of its own, when that is 2 or 3 letters away and nothing but letters
 *  lies between. A command's glyph (\\alpha) is not one. */
const LETTERS = /^\p{L}+$/u;
export function ligatureSpan(ch, off, offs, k, compiled) {
  if (off < 0 || !ch || compiled[off] === '\\' || !LETTERS.test(compiled[off] ?? '')) return 0;
  const parts = [...ch.normalize('NFKD')].filter((c) => !/\p{M}/u.test(c)).join('');
  if (parts.length > 1) return parts.length <= 3 && LETTERS.test(parts) && compiled.slice(off, off + parts.length).toLowerCase() === parts.toLowerCase() ? parts.length : 0;
  if (parts.toLowerCase() === compiled[off].normalize('NFKD')[0].toLowerCase()) return 0;     // the letter itself
  let next = -1;
  for (let i = k + 1; i < offs.length; i++) if (offs[i] >= 0) { next = offs[i]; break; }
  const n = next - off;
  return n >= 2 && n <= 3 && LETTERS.test(compiled.slice(off, next)) ? n : 0;
}

/** Source characters a glyph stands for, from its offset: a command (\\in, \\alpha) or a character
 *  (a ligature's letters: ﬁ is 2). */
function spanOf(g, compiled) {
  if (g.lig) return g.span;
  // a hyphen TeX added at a break stands for no source: after it is the break itself (before the next letter)
  if (/^[-\u2010]$/.test(g.ch) && compiled[g.off] !== '-') return 0;
  if (compiled[g.off] === '\\') { const m = /^\\(?:[A-Za-z@]+|.)/.exec(compiled.slice(g.off)); return m ? m[0].length : 1; }
  const n = [...String(g.ch || '').normalize('NFKD')].filter((c) => !/\p{M}/u.test(c)).length;
  return Math.max(1, Math.min(n, 3));
}

/** A click in the preview -> a caret offset in `text` (the editor's), or null. The text editor's rule:
 *  the visual line under the pointer first (lines are the parenthesis-high bands 0.75 em over and
 *  0.25 em under the baseline, so "." is as easy to hit as "M"; between lines, the nearer), then on it:
 *  past its last glyph, the end; before its first, the start; inside a glyph, before or after it by its
 *  middle; in a gap, the nearer boundary. Display maths: each glyph's own box (at least 0.5 em) first,
 *  for scripts. A boundary is mapped to the source by glyph identity: after a glyph = its offset plus the
 *  characters it stands for. */
/** the caret map of a render made ahead (in idle time, when the pointer comes over a block): the click that
 *  opens the editor then finds it cached (a long paragraph's map is tens of ms of the open's task otherwise) */
export function warmMap(renderEl, result, compiled) {
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || compiled == null) return false;
  mapFor(el, blk, result, compiled);
  return true;
}

export function offsetAt(renderEl, result, compiled, text, x, y) {
  freshBoxes();
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || compiled == null) return null;
  const { glyphs, method } = mapFor(el, blk, result, compiled);
  // only on the engine's map: the fuzzy one (a backend without a sourcemap) has no lines to rely on, and
  // app/source-position.js's click paths are better there
  if (method !== 'engine') return null;
  const after = (g) => (g.via ? g.via : g.off + spanOf(g, compiled)), before = (g) => g.off;
  // a click on a glyph: before or after it by its middle; on a ligature, the nearest boundary between its letters
  // (each letter an equal share of the glyph: ﬂ's left quarter before the f, its middle f|l, its right quarter after the l)
  const on = (g, r) => (g.lig ? g.off + Math.round(Math.min(1, Math.max(0, (x - r.left) / Math.max(1e-6, r.right - r.left))) * g.span)
    : x < (r.left + r.right) / 2 ? before(g) : after(g));
  const back = (o) => carryCaret(text, compiled, o);          // compiled -> text
  const withBox = glyphs.filter((g) => g.off >= 0).map((g) => ({ g, b: g.box() })).filter((q) => q.b);
  // glyphs stacked over each other (a binomial's or a fraction's entries, sub- and
  // superscripts, limits): of the glyphs under the click, the one whose ink is nearest to it, by its
  // centre measured in its own size; not the first in drawing order (that was the upper one: the lower
  // "2" of \binom{x}{2} put the caret on x)
  const inkOf = (q) => q.g.ink?.() ?? q.b;
  const nearest = (qs) => qs.reduce((best, q) => {
    const r = inkOf(q), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const d = Math.hypot((x - cx) / Math.max(2, r.right - r.left), (y - cy) / Math.max(2, r.bottom - r.top));
    return !best || d < best.d ? { q, d } : best;
  }, null)?.q;
  // display maths: a glyph's own box (at least 0.5 em)
  const inDisplay = withBox.filter((q) => {
    if (!q.g.math) return false;
    const r = inkOf(q), em = Math.max(4, (q.b.bottom - q.b.top) / 2);
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, hw = Math.max(em / 2, (r.right - r.left) / 2), hh = Math.max(em / 2, (r.bottom - r.top) / 2);
    return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
  });
  if (inDisplay.length) { const q = nearest(inDisplay); return back(on(q.g, inkOf(q))); }
  // lines: the bands of their glyphs
  const lines = new Map();
  for (const q of withBox) {
    const l = lines.get(q.g.line);
    if (l) { l.top = Math.min(l.top, q.b.top); l.bottom = Math.max(l.bottom, q.b.bottom); l.items.push(q); }
    else lines.set(q.g.line, { top: q.b.top, bottom: q.b.bottom, items: [q] });
  }
  let best = null, bestD = Infinity;
  for (const l of lines.values()) { const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0; if (d < bestD) { bestD = d; best = l; } }
  if (!best) return null;
  // a line of the capture can be much taller than its glyphs: a table row holds its
  // cells' minipages (lines of their own), a formula its fractions. On it, only the glyphs across the
  // click's height count when the click is across some glyph, so a click on a cell's text is not taken
  // by the text of the cell below it at the same x. A click across no glyph (the leading between lines)
  // and an ordinary line (every glyph across the click): all of the line's glyphs, as before.
  const across = best.items.filter((q) => y >= q.b.top && y <= q.b.bottom);
  const items = (across.length ? across : best.items).slice().sort((p, q) => p.b.left - q.b.left);
  const first = items[0], last = items[items.length - 1];
  // glyphs over each other at the click's x (inline maths: \binom, \frac, x_i^2): the nearest ink
  const under = items.filter((q) => x >= q.b.left && x <= q.b.right);
  if (under.length > 1) { const q = nearest(under); return back(on(q.g, q.b)); }
  if (x >= last.b.right) return back(after(last.g));
  if (x <= first.b.left) return back(before(first.g));
  for (let i = 0; i < items.length; i++) {
    const q = items[i];
    if (x >= q.b.left && x <= q.b.right) return back(on(q.g, q.b));
    const n = items[i + 1];
    if (n && x > q.b.right && x < n.b.left) return back(x - q.b.right <= n.b.left - x ? after(q.g) : before(n.g));
  }
  return back(after(last.g));
}

/** The end of a macro call at m: the control word, then its braced (and bracketed) arguments. */
export function callEnd(src, m) {
  const w = /^\\(?:[A-Za-z@]+\*?|.)/.exec(src.slice(m));
  let i = m + (w ? w[0].length : 1);
  for (;;) {
    let j = i;
    while (src[j] === ' ') j++;
    if (src[j] !== '{' && src[j] !== '[') return i;
    const open = src[j], close = open === '{' ? '}' : ']';
    let depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '\\') { k++; continue; } if (src[k] === open) depth++; else if (src[k] === close && --depth === 0) break; }
    if (k >= src.length) return i;
    i = k + 1;
  }
}

/** The spans of macro definitions in a block (\\def, \\newcommand, …): their bodies are not where
 *  the text is written. tex/definitions.ts, the one command table. */
export const definitions = (src) => definitionSpans(src);
