// The caret, the selection and the caret's line drawn in a typeset block, and a point of it mapped back to a source
// offset: the live preview's marks. It reads the viewer's public host API only (view/viewer-host.ts): a block
// element, the engine's result (its sourcemap), the source it was compiled from and the editor's text; no app state.
//
//   markCaret(renderEl, result, compiled, text, caret, sel?) -> { method, x, sure, bands } | null
//   offsetAt(renderEl, result, compiled, text, x, y) -> offset in text | null   (the engine's map only)
//   warmMap(renderEl, result, compiled)      the caret map made ahead (idle time)
//   caretMap(renderEl, o?)                   (dev, tests) each drawn glyph's character and source offset
//   carryCaret · caretPlace · ligatureSpan · callEnd · definitions   (their parts, for tests)
//
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
import { blockOf, layoutGeneration, spToPx, type ViewerBlock, type ViewerNode } from '../view/viewer-host.ts';
import { screenCTM } from '../view/screen-ctm.ts';
import { drawnGlyphs, sourcePositionFor, toSourceOffset } from '../../../engine/api/src/sourcemap.ts';
import { guardedBlockGlyphOffsets, guardedLocate } from '../../../engine/api/src/sourcemap-guard.ts';
// @ts-ignore: a JS module
import { projectSource, align, glyphsOf } from '../app/source-position.js';
import { definitionSpans } from '../tex/definitions.ts';
import { shownBlock } from '../view/shown.ts';

/** A box in client px. */
export interface Box { left: number; right: number; top: number; bottom: number }
/** One drawn glyph of the caret map: its source offset (-1: none; a macro's glyphs: the call's start, `via` its end),
 *  its character, its line's key, and its boxes (the font's ascender to descender; its ink). */
export interface MapGlyph {
  off: number; ch: string; line: string; via?: number; lig?: boolean; span?: number; math?: boolean; inline?: boolean;
  box(): Box | null; ink?(): Box | null;
}
/** Where a caret goes: x and its height in client px; sure: only markup that draws nothing lies between. */
export interface CaretPlace { x: number; top: number; bottom: number; sure: boolean; line: string }
/** The engine's result as read here: its source map (engine/api sourcemap.ts), if any. */
export interface PreviewResult { sourcemap?: any; [k: string]: unknown }
type Method = 'engine' | 'fuzzy';
interface CaretCache { compiled: string; gen: number; glyphs: MapGlyph[]; method: Method; sm: { file?: string; firstLine?: number; files?: unknown } | null; raw: () => string[] }

const glyphCache = new WeakMap<Element, CaretCache>();        // latex-block element -> { compiled, gen, glyphs, method }
// a segment's screen matrix, read once per burst of glyph boxes (a click's hit test, a caret mark): the
// boxes of one call are read with nothing laid out between them (one getScreenCTM per glyph was ~8 ms of a click
// on a long paragraph). Cleared at the start of each such call and after it (a microtask).
let ctms: Map<Element, DOMMatrix | null> | null = null;
function ctmOf(svg: Element | null | undefined): DOMMatrix | null {
  if (!svg) return null;
  if (!ctms) { ctms = new Map(); queueMicrotask(() => { ctms = null; }); }
  let m = ctms.get(svg);
  if (m === undefined) { m = screenCTM(svg as SVGGraphicsElement); ctms.set(svg, m); }   // (CSS zoom in it in every browser: view/screen-ctm.ts)
  return m;
}
const freshBoxes = () => { ctms = null; };
const ALNUM = /[\p{L}\p{N}]/u;
const letters = (s: string): string[] => [...s.normalize('NFKD')].filter((c) => ALNUM.test(c)).map((c) => c.toLowerCase());

/** each drawn glyph: { off, line, box() -> { left, right, top, bottom } in client px } */
function exactGlyphs(el: Element, blk: ViewerBlock, sm: any, compiled: string): MapGlyph[] {
  const doc = blk.document, segs = blk.segments(), sp = spToPx();
  const drawn = drawnGlyphs(segs);
  const { glyphs: offs } = guardedBlockGlyphOffsets(sm, doc, drawn, compiled, { file: sm.file, firstLine: sm.firstLine ?? 1 });
  const size = new Map<number, number>((doc.fonts ?? []).map((f: any) => [f.id, (f.size_sp || 655360) * sp]));
  const gm = doc.glyph_metrics ?? [];
  const boxes: { math: boolean; inline: boolean; ch: string; seg: number; line: string; x: number; y: number; adv: number; s: number; h: number; d: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    let line = -1;
    // maths: a display, or between TeX's math nodes on a line (the capture keeps them)
    const display = segs[i].kind === 'display';
    let inMath = false;
    segs[i].walk({
      line(j: number) { line = j; },
      node(n: ViewerNode, x: number, y: number, adv: number) {
        if (n.type === 'math') { inMath = !inMath; return; }
        if (n.type !== 'glyph') return;
        const m = gm[(n.metrics || 0) - 1] ?? {};
        boxes.push({ math: display,   // glyph boxes in displays only; inline maths selects with its line (inMath kept for later)
         inline: inMath, ch: String.fromCodePoint(n.char || 32), seg: i, line: `${i}:${line}`, x, y, adv: Math.max(adv, 0.5), s: size.get(n.font as number) ?? 10 * 65536 * sp,
          h: (n.height ?? m.height ?? 0) * sp, d: (n.depth ?? m.depth ?? 0) * sp });
      },
    });
  }
  const map = (b: (typeof boxes)[number] | undefined, x0: number, y0: number, x1: number, y1: number): Box | null => {
    const m = b && ctmOf(segs[b.seg]?.svg);
    if (!m) return null;
    // the affine map by hand (two DOMPoints per glyph were most of a long paragraph's hit test)
    const ax = m.a * x0 + m.c * y0 + m.e, ay = m.b * x0 + m.d * y0 + m.f, bx = m.a * x1 + m.c * y1 + m.e, by = m.b * x1 + m.d * y1 + m.f;
    return { left: Math.min(ax, bx), right: Math.max(ax, bx), top: Math.min(ay, by), bottom: Math.max(ay, by) };
  };
  // glyphs a macro made (viaMacro): the call's span in the source, \\name and its braced arguments
  const via = new Map<number, { m: number; end: number }>();
  offs.forEach((off: number, k: number) => {
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
  const inDef = (o: number) => defs.some(([a, b]) => o >= a && o < b);
  const own = offs.map((o: number, k: number) => (o >= 0 && !inDef(o) ? o : via.has(k) ? -2 : -1));
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
  const final: number[] = offs.map((off: number, k: number) => { const v = via.get(k); return v ? v.m : own[k] === -1 ? -1 : off; });
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

function fuzzyGlyphs(el: Element, compiled: string): MapGlyph[] {
  const { chars, offs } = projectSource(compiled);
  const gs: { el: Element; text: string }[] = glyphsOf(el);
  const gl: string[] = [], owner: number[] = [];
  gs.forEach((g, gi) => { for (const l of letters(g.text)) { gl.push(l); owner.push(gi); } });
  const off = gs.map(() => -1);
  if (gl.length && chars.length && gl.length * chars.length < 4e6) {
    const matched = align(gl, chars);
    matched.forEach((j: number, k: number) => { if (j >= 0 && off[owner[k]] < 0) off[owner[k]] = offs[j]; });
  }
  return gs.map((g, i) => {
    const r0 = g.el.getBoundingClientRect();
    const box = () => { const r = g.el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { off: off[i], ch: g.text, line: `${Math.round(r0.bottom)}`, box, ink: box };
  });
}

/** The caret in `text` carried to `compiled` (the edit between them: common prefix and suffix). */
export function carryCaret(compiled: string, text: string, caret: number): number {
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
const ligatureX = (G: Box, t: number): number => G.left + (G.right - G.left) * Math.min(1, Math.max(0, t));
const QUIET = /^(?:\\[()[\]]|[${}\s])*$/;
export function caretPlace(glyphs: MapGlyph[], compiled: string, c: number): CaretPlace | null {
  const end = (g: MapGlyph): number => (g.via ? g.via : g.off + spanOf(g, compiled));
  let a = -1, b = -1;
  glyphs.forEach((g, i) => { if (g.off < 0 || g.via) return; if (end(g) === c && end(g) > g.off) a = i; if (g.off === c && b < 0) b = i; });   // (a break's hyphen stands for nothing)   // (-1: no source, never a neighbour)
  // a macro's glyphs are one unit: before the call, before its first glyph; after it, after its last
  glyphs.forEach((g, i) => { if (!g.via) return; if (g.via === c) a = i; if (g.off === c && b < 0) b = i; });
  // between a ligature's letters: its letter's share of the glyph (f|l of ﬂ: its middle), sure; before a call
  // around it (\\caption{… flip …}: the caption's label is the call's, its span the whole argument)
  if (a < 0 && b < 0) {
    const g = glyphs.find((q) => q.lig && q.off < c && c < q.off + q.span!), G = g?.box();
    if (g && G) return { x: ligatureX(G, (c - g.off) / g.span!), top: G.top, bottom: G.bottom, sure: true, line: g.line };
  }
  // inside a macro call's name: dimmed (not sure) at the nearer end of the call's glyphs, before its first or after its last
  if (a < 0 && b < 0) {
    const call = glyphs.map((g, i) => [g, i] as [MapGlyph, number]).filter(([g]) => g.via && c > g.off && c < g.via);
    if (call.length) {
      const [g0] = call[0]!, atStart = c - g0.off <= g0.via! - c;
      const [g, i] = atStart ? call[0]! : call[call.length - 1]!, G = g.box();
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
export function markCaret(renderEl: HTMLElement, result: PreviewResult | null, compiled: string | null, text: string, caret: number | null,
                          sel: { from: number; to: number } | null = null): { method: Method; x?: number; sure?: boolean; bands: number } | null {
  freshBoxes();
  const clear = () => renderEl.querySelectorAll('.rtx-caret-bar, .rtx-sel-band, .rtx-line-band').forEach((m) => m.remove());
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || caret == null || compiled == null) { clear(); return null; }
  const c = mapFor(el!, blk, result, compiled);
  const p = caretPlace(c.glyphs, compiled, carryCaret(compiled, text, caret));
  clear();
  const base = renderEl.getBoundingClientRect();
  // a mark over a wide display goes inside the display's scroller, in its content's coordinates: it scrolls with
  // the glyphs it marks (natively, in the same frame) when the display is scrolled sideways
  const displays = [...el!.querySelectorAll<HTMLElement>('.latex-display')].filter((d) => !d.parentElement?.closest('.latex-display'))
    .map((d) => ({ d, r: d.getBoundingClientRect() }));
  const hostAt = (x: number, y: number): { host: HTMLElement; ox: number; oy: number; display: boolean } => {
    for (const { d, r } of displays) if (y >= r.top && y <= r.bottom) return { host: d, ox: r.left + d.clientLeft - d.scrollLeft, oy: r.top + d.clientTop - d.scrollTop, display: true };
    return { host: renderEl, ox: base.left, oy: base.top, display: false };
  };
  const inDisplay = new Map<HTMLElement, DocumentFragment>();          // display -> fragment of its marks
  // a selection: text as a text selection (a band per line over each run of selected text glyphs, the
  // line's height); maths glyph by glyph (each glyph's own box, so an exponent alone is just its box).
  // Source that drew nothing (command names) adds nothing.
  let bands = 0;
  if (sel && sel.to > sel.from) {
    const from = carryCaret(compiled, text, sel.from), to = carryCaret(compiled, text, sel.to);
    const frag = document.createDocumentFragment();
    const put = (r: Box | null | undefined, math: boolean) => {
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
    const runs: (Box & { line: string })[] = [], lineBox = new Map<string, { left: number; right: number }>();
    for (const g of c.glyphs) {
      if (g.off < 0 || g.math) continue;
      const r = g.box();
      if (!r) continue;
      const l = lineBox.get(g.line);
      if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); } else lineBox.set(g.line, { left: r.left, right: r.right });
    }
    let run: (Box & { line: string }) | null = null, picked = false;          // picked: some glyph (text or maths) is in the selection
    const flush = () => { if (run) runs.push(run); run = null; };
    c.glyphs.forEach((g) => {
      if (g.off < 0) return;                          // drawn by a macro: neither in nor out
      const gEnd = g.via || g.off + (g.lig ? g.span! : 1);
      if (gEnd <= from || g.off >= to) { flush(); return; }
      picked = true;
      // part of a ligature selected: that share of its box (the l of ﬂ alone: its right half)
      const share = (r: Box | null | undefined): Box | null | undefined => (r && g.lig && (from > g.off || to < gEnd)
        ? { ...r, left: ligatureX(r, (Math.max(from, g.off) - g.off) / g.span!), right: ligatureX(r, (Math.min(to, gEnd) - g.off) / g.span!) } : r);
      if (g.math) { flush(); put(share(g.ink?.()), true); return; }
      const r = share(g.box());
      if (!r) return;
      if (run && run.line === g.line) { run.right = Math.max(run.right, r.right); run.top = Math.min(run.top, r.top); run.bottom = Math.max(run.bottom, r.bottom); }
      else { flush(); run = { ...r, line: g.line }; }
    });
    flush();
    const pf = caretPlace(c.glyphs, compiled, from), pt = caretPlace(c.glyphs, compiled, to);
    const at = (pl: CaretPlace | null) => (pl?.sure ? pl : null);
    if (runs.length) {
      const first = runs[0], last = runs[runs.length - 1];
      if (pf && at(pf)?.line === first.line && pf.x < first.left) first.left = pf.x;
      if (pt && at(pt)?.line === last.line && pt.x > last.right) last.right = pt.x;
      // the selection goes on past a run's line (a later run, or its end on a later line): to the line's end
      runs.forEach((r, i) => {
        const next = runs[i + 1];
        const goesOn = next ? next.line !== r.line : (!!pt && !!at(pt) && pt.line !== r.line && pt.top >= r.bottom - 1);
        const lb = lineBox.get(r.line);
        if (goesOn && lb) r.right = Math.max(r.right, lb.right);
      });
    } else if (!picked && pf && pt && at(pf) && at(pt) && pf.line === pt.line && pt.x > pf.x) {         // only spaces
      runs.push({ left: pf.x, right: pt.x, top: Math.min(pf.top, pt.top), bottom: Math.max(pf.bottom, pt.bottom), line: pf.line });
    }
    for (const r of runs) put(r, false);
    renderEl.append(frag);
    for (const [d, f] of inDisplay) d.append(f);
  }
  if (!p) return bands ? { method: c.method, bands } : null;
  const bar = document.createElement('div');
  bar.className = p.sure ? 'rtx-caret-bar' : 'rtx-caret-bar rtx-caret-unsure';
  const dpr = devicePixelRatio || 1, z = parseFloat(getComputedStyle(el!).zoom) || 1;
  const w = Math.max(1 / dpr, Math.round(2 * z * dpr) / dpr);
  const snap = (v: number) => Math.round(v * dpr) / dpr;
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

/** (dev, tests) the caret map of a render: each drawn glyph's character and source offset */
export function caretMap(renderEl: HTMLElement, o: { boxes?: boolean } = {}) {
  const el = shownBlock(renderEl);
  const c = el && glyphCache.get(el);
  // o.boxes (tests): each glyph's box in client px and whether it is in maths
  return c ? { sm: c.sm, raw: c.raw?.(), method: c.method, compiled: c.compiled, glyphs: c.glyphs.map((g) => ({ ch: g.ch, off: g.off, via: g.via || 0, ...(g.lig ? { span: g.span } : {}),
    ...(o.boxes ? { box: g.box?.() ?? null, math: !!g.math, inline: !!g.inline } : {}) })) } : null;
}

/** The caret map of a block element for the source it was compiled from (cached per render and paint). */
function mapFor(el: Element, blk: ViewerBlock, result: PreviewResult | null, compiled: string): CaretCache {
  const sm = result?.sourcemap;
  let c = glyphCache.get(el);
  // made again when the block was laid out again or drew more of its lines (its 'layout' event)
  const gen = layoutGeneration(el);
  if (!c || c.compiled !== compiled || c.gen !== gen) {
    const method: Method = sm?.items ? 'engine' : 'fuzzy';
    let glyphs: MapGlyph[] = [];
    try { glyphs = method === 'engine' ? exactGlyphs(el, blk, sm, compiled) : fuzzyGlyphs(el, compiled); } catch (e) { console.warn('caret map:', (e as Error).message); }
    c = { compiled, gen, glyphs, method, sm: sm ? { file: sm.file, firstLine: sm.firstLine, files: sm.files } : null,
      raw: () => { const d = drawnGlyphs(blk.segments()).slice(0, 12); return d.map((n: any) => { const at = guardedLocate(sm, blk.document, n); const p = at && sourcePositionFor(sm, at); return p ? `${String.fromCodePoint(n.char || 32)}:${p.file}:${p.line}:${p.column}${p.viaMacro ? 'v' : ''}` : `${String.fromCodePoint(n.char || 32)}:-`; }); } };
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
export function ligatureSpan(ch: string, off: number, offs: number[], k: number, compiled: string): number {
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
function spanOf(g: MapGlyph, compiled: string): number {
  if (g.lig) return g.span!;
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
export function warmMap(renderEl: HTMLElement, result: PreviewResult | null, compiled: string | null): boolean {
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || compiled == null) return false;
  mapFor(el!, blk, result, compiled);
  return true;
}

export function offsetAt(renderEl: HTMLElement, result: PreviewResult | null, compiled: string | null, text: string, x: number, y: number): number | null {
  freshBoxes();
  const el = shownBlock(renderEl);
  const blk = blockOf(el);
  if (!blk || compiled == null) return null;
  const { glyphs, method } = mapFor(el!, blk, result, compiled);
  // only on the engine's map: the fuzzy one (a backend without a sourcemap) has no lines to rely on, and
  // app/source-position.js's click paths are better there
  if (method !== 'engine') return null;
  const after = (g: MapGlyph) => (g.via ? g.via : g.off + spanOf(g, compiled)), before = (g: MapGlyph) => g.off;
  // a click on a glyph: before or after it by its middle; on a ligature, the nearest boundary between its letters
  // (each letter an equal share of the glyph: ﬂ's left quarter before the f, its middle f|l, its right quarter after the l)
  const on = (g: MapGlyph, r: Box) => (g.lig ? g.off + Math.round(Math.min(1, Math.max(0, (x - r.left) / Math.max(1e-6, r.right - r.left))) * g.span!)
    : x < (r.left + r.right) / 2 ? before(g) : after(g));
  const back = (o: number) => carryCaret(text, compiled, o);          // compiled -> text
  type Q = { g: MapGlyph; b: Box };
  const withBox: Q[] = glyphs.filter((g) => g.off >= 0).map((g) => ({ g, b: g.box() })).filter((q): q is Q => !!q.b);
  // glyphs stacked over each other (a binomial's or a fraction's entries, sub- and
  // superscripts, limits): of the glyphs under the click, the one whose ink is nearest to it, by its
  // centre measured in its own size; not the first in drawing order (that was the upper one: the lower
  // "2" of \binom{x}{2} put the caret on x)
  const inkOf = (q: Q): Box => q.g.ink?.() ?? q.b;
  const nearest = (qs: Q[]): Q | undefined => qs.reduce<{ q: Q; d: number } | null>((best, q) => {
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
  if (inDisplay.length) { const q = nearest(inDisplay)!; return back(on(q.g, inkOf(q))); }
  // lines: the bands of their glyphs
  const lines = new Map<string, { top: number; bottom: number; items: Q[] }>();
  for (const q of withBox) {
    const l = lines.get(q.g.line);
    if (l) { l.top = Math.min(l.top, q.b.top); l.bottom = Math.max(l.bottom, q.b.bottom); l.items.push(q); }
    else lines.set(q.g.line, { top: q.b.top, bottom: q.b.bottom, items: [q] });
  }
  let best: { top: number; bottom: number; items: Q[] } | null = null, bestD = Infinity;
  for (const l of lines.values()) { const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0; if (d < bestD) { bestD = d; best = l; } }
  if (!best) return null;
  // a line of the capture can be much taller than its glyphs: a table row holds its
  // cells' minipages (lines of their own), a formula its fractions. On it, only the glyphs across the
  // click's height count when the click is across some glyph, so a click on a cell's text is not taken
  // by the text of the cell below it at the same x. A click across no glyph (the leading between lines)
  // and an ordinary line (every glyph across the click): all of the line's glyphs, as before.
  const across = best.items.filter((q) => y >= q.b.top && y <= q.b.bottom);
  const items = (across.length ? across : best.items).slice().sort((p, q) => p.b.left - q.b.left);
  const first = items[0]!, last = items[items.length - 1]!;
  // glyphs over each other at the click's x (inline maths: \binom, \frac, x_i^2): the nearest ink
  const under = items.filter((q) => x >= q.b.left && x <= q.b.right);
  if (under.length > 1) { const q = nearest(under)!; return back(on(q.g, q.b)); }
  if (x >= last.b.right) return back(after(last.g));
  if (x <= first.b.left) return back(before(first.g));
  for (let i = 0; i < items.length; i++) {
    const q = items[i]!;
    if (x >= q.b.left && x <= q.b.right) return back(on(q.g, q.b));
    const n = items[i + 1];
    if (n && x > q.b.right && x < n.b.left) return back(x - q.b.right <= n.b.left - x ? after(q.g) : before(n.g));
  }
  return back(after(last.g));
}

/** The end of a macro call at m: the control word, then its braced (and bracketed) arguments. */
export function callEnd(src: string, m: number): number {
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
export const definitions = (src: string): [number, number][] => definitionSpans(src);
