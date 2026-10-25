// Click in a reflowed block -> a place in its LaTeX source.
//
//   sourcePositionFor(block, click) -> { offset, method, glyph } | null
//     block = { source, el, result }   el: the element holding the block's
//             drawing (.blk-render); result: the backend's BlockResult
//     click = { x, y, target }         client coordinates, the event target
//     offset: a caret position in `source` (0..source.length)
//
// Two ways, the first that answers:
//
// exact   the backend gives each glyph its source offset. The patched
//         Tectonic capture (../../engine-api/) is to record them; when a
//         backend's result carries `sourceMap` (see exactPosition), the glyph
//         under the pointer is looked up there. Not available yet: no backend
//         sends it.
//
// fuzzy   what works with any backend today. The viewer draws a glyph as an
//         SVG <tspan> holding its character, in reading order. The glyph
//         under the pointer and ±CONTEXT letters around it are aligned
//         (semi-global edit distance) against a plain-text projection of the
//         source (commands, braces, $ and comments dropped; letters and
//         digits kept, each with its source offset). Both sides keep only
//         letters and digits, lower-cased, NFKD (ligatures ﬁ -> fi, math
//         italic 𝑎 -> a), so text, inline maths and headings all match.
//         A glyph that is no letter or digit (=, +, ∑, a bracket) is placed
//         at the first token of the source between its aligned neighbours:
//         `\sum`, `=`, … .
//
// The alignment costs O(window × source) time and memory, with the window a
// fixed 2·CONTEXT + 1 letters: about 1 ms for a block of a few thousand
// characters.

// The editor adds a third way, tried first:
//
// engine  result.sourcemap (contracts.d.ts BlockSourceMap: engine-api's
//         sourcemap.ts sidecar + where the block sits in the compiled file).
//         The glyph node under the pointer comes from the viewer's
//         Block.segments' walk, its address from locateGlyph on the viewer's
//         decoded document, its position from the map. A glyph a macro made
//         (viaMacro) or from another file falls through to fuzzy.
import { segmentsOf, documentOf, spToPx } from '../view/viewer-host.ts';
import { screenCTM } from '../view/screen-ctm.ts';
import { sourcePositionFor as mapPosition, toSourceOffset } from '../../../engine/api/src/sourcemap.ts';
import { guardedLocate } from '../../../engine/api/src/sourcemap-guard.ts';
import { shownBlock } from '../view/shown.ts';

const CONTEXT = 40;

export function sourcePositionFor(block, click) {
  try {
    return enginePosition(block, click) ?? exactPosition(block, click) ?? fuzzyPosition(block, click);
  } catch (e) {
    console.warn('sourcePositionFor:', e);
    return null;
  }
}

/** The glyph node the viewer drew under a point, in one block element. */
export function glyphNodeAt(el, x, y) {
  let best = null;
  for (const sg of segmentsOf(el)) {
    const m = screenCTM(sg.svg);   // (CSS zoom in it in every browser)
    if (!m) continue;
    const pt = new DOMPoint(x, y).matrixTransform(m.inverse());
    const em = 10 * 65536 * spToPx(el);
    sg.walk({
      node(n, nx, ny, adv) {
        if (n.type !== 'glyph') return;
        if (pt.x < nx || pt.x > nx + Math.max(adv, 1)) return;
        const dy = pt.y < ny - em ? Infinity : Math.abs(pt.y - (ny - 0.3 * em));
        if (dy > em) return;
        if (!best || dy < best.dy) best = { node: n, dy, after: pt.x > nx + adv / 2 };
      },
    });
  }
  return best && { node: best.node, doc: documentOf(el), after: best.after };
}

function enginePosition(block, click) {
  const sm = block.result?.sourcemap;
  if (!sm?.items) return null;
  const el = shownBlock(block.el);
  if (!el) return null;
  const hit = glyphNodeAt(el, click.x, click.y);
  if (!hit) return null;
  const at = guardedLocate(sm, hit.doc, hit.node);      // null when the item's glyphs do not match the map
  const pos = at && mapPosition(sm, at);
  if (!pos || pos.viaMacro || (sm.file && pos.file !== sm.file)) return null;
  const off = toSourceOffset(pos, block.source, sm.firstLine ?? 1);
  if (off < 0) return null;
  return { offset: Math.min(off + (hit.after ? pos.length || 0 : 0), block.source.length), method: 'engine', glyph: hit.node.char ?? '' };
}

/** The engine's own data, when a backend sends it. Expected shape (to be
 *  settled with engine-api): result.sourceMap = { glyphs: [offset | -1, …] }
 *  in the order the viewer draws the block's glyphs (its <tspan>s). */
function exactPosition(block, click) {
  const map = block.result?.sourceMap?.glyphs;
  if (!Array.isArray(map)) return null;
  const gs = glyphsOf(block.el);
  const hit = glyphAt(gs, click);
  if (!hit) return null;
  const off = map[hit.index];
  return typeof off === 'number' && off >= 0 ? { offset: Math.min(off, block.source.length), method: 'exact', glyph: hit.glyph.text } : null;
}

// ── The drawing: glyphs in reading order ────────────────────────────────────

/** The block's visible glyphs, in document (reading) order. */
export function glyphsOf(root) {
  const out = [];
  for (const svg of root.querySelectorAll('svg')) {
    if (!svg.closest('.latex-block')) continue;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) continue;                       // hidden (a hint's original, an incoming block)

    for (const t of svg.querySelectorAll('text tspan')) {
      const text = t.textContent;
      if (!text || !text.trim()) continue;                      // word spaces
      out.push({ el: t, text });
    }
  }
  return out;
}

/** The glyph under (or nearest to) the click. */
function glyphAt(gs, click) {
  if (!gs.length) return null;
  const direct = click.target?.closest?.('tspan');
  let index = direct ? gs.findIndex((g) => g.el === direct) : -1;
  let rect = null;
  if (index < 0) {
    let best = Infinity;
    gs.forEach((g, i) => {
      const r = g.el.getBoundingClientRect();
      const dx = click.x < r.left ? r.left - click.x : click.x > r.right ? click.x - r.right : 0;
      const dy = click.y < r.top ? r.top - click.y : click.y > r.bottom ? click.y - r.bottom : 0;
      const d = dx * dx + dy * dy * 4;                          // prefer the same line
      if (d < best) { best = d; index = i; rect = r; }
    });
  }
  rect ??= gs[index].el.getBoundingClientRect();
  return { index, glyph: gs[index], after: click.x > rect.left + rect.width / 2 };
}

// ── Both sides as letters and digits ────────────────────────────────────────

const ALNUM = /[\p{L}\p{N}]/u;
/** A glyph's letters (NFKD: ligatures and math alphanumerics to plain letters). */
const letters = (s) => [...s.normalize('NFKD')].filter((c) => ALNUM.test(c)).map((c) => c.toLowerCase());

// commands whose (first) braced argument is not typeset text
const SKIP_ARG = new Set(['begin', 'end', 'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'cite', 'usepackage',
  'hspace', 'vspace', 'includegraphics', 'input', 'include', 'newcommand', 'renewcommand', 'providecommand', 'DeclareMathOperator',
  'newtheorem', 'setlength', 'addtolength', 'setcounter', 'color', 'textcolor', 'pagecolor', 'documentclass', 'bibliography', 'bibliographystyle']);

/** The source's letters and digits, each with its offset in the source. */
export function projectSource(src) {
  const chars = [], offs = [];
  let i = 0;
  const n = src.length;
  const skipBraced = (j) => {                                    // j at '{': past its matching '}'
    let depth = 0;
    for (; j < n; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return j + 1;
    }
    return n;
  };
  while (i < n) {
    const c = src[i];
    if (c === '%') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '\\') {
      if (/[A-Za-z@]/.test(src[i + 1] ?? '')) {
        let j = i + 1;
        while (j < n && /[A-Za-z@]/.test(src[j])) j++;
        const name = src.slice(i + 1, j);
        if (src[j] === '*') j++;
        if (SKIP_ARG.has(name)) {
          let k = j;
          while (k < n && /\s/.test(src[k])) k++;
          if (src[k] === '[') { const e = src.indexOf(']', k); if (e > 0 && name !== 'begin') k = e + 1; }
          while (k < n && /\s/.test(src[k])) k++;
          if (src[k] === '{') j = skipBraced(k);
          if (name === 'newtheorem') { for (let r = 0; r < 2; r++) { let k2 = j; while (k2 < n && /\s/.test(src[k2])) k2++; if (src[k2] === '[' ) { const e = src.indexOf(']', k2); if (e > 0) k2 = e + 1; } if (src[k2] === '{') j = skipBraced(k2); } }
        }
        i = j;
        continue;
      }
      i += 2;                                                   // a control symbol: \, \\ \{ \$ …
      continue;
    }
    if (ALNUM.test(c)) {
      for (const l of letters(c)) { chars.push(l); offs.push(i); }
    }
    i++;
  }
  return { chars, offs };
}

// ── Alignment ───────────────────────────────────────────────────────────────

/** Semi-global alignment of `read` (every letter aligned or skipped at a
 *  cost) inside `ref` (free to start and end anywhere). Returns, per read
 *  index, the ref index it is matched with (equal letters only), or -1. */
export function align(read, ref) {
  const w = read.length, m = ref.length;
  const W = m + 1;
  let prev = new Int32Array(W), cur = new Int32Array(W);    // prev row: 0 everywhere (free start)
  const tb = new Uint8Array((w + 1) * W);                   // 1 diag, 2 up (read letter unmatched), 3 left (ref letter skipped)
  for (let i = 1; i <= w; i++) {
    cur[0] = i; tb[i * W] = 2;
    const a = read[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + (a === ref[j - 1] ? 0 : 1);
      const up = prev[j] + 1, left = cur[j - 1] + 1;
      let best = diag, dir = 1;
      if (up < best) { best = up; dir = 2; }
      if (left < best) { best = left; dir = 3; }
      cur[j] = best; tb[i * W + j] = dir;
    }
    [prev, cur] = [cur, prev];
  }
  // free end: the best column of the last row
  let j = 0;
  for (let k = 1; k <= m; k++) if (prev[k] < prev[j]) j = k;
  const out = new Array(w).fill(-1);
  let i = w;
  while (i > 0 && j > 0) {
    const dir = tb[i * W + j];
    if (dir === 1) { if (read[i - 1] === ref[j - 1]) out[i - 1] = j - 1; i--; j--; }
    else if (dir === 2) i--;
    else j--;
  }
  return out;
}

// ── Fuzzy ───────────────────────────────────────────────────────────────────

function fuzzyPosition(block, click) {
  const gs = glyphsOf(block.el);
  const hit = glyphAt(gs, click);
  if (!hit) return null;
  const { chars, offs } = projectSource(block.source);
  if (!chars.length) return null;
  // the glyphs' letters, each with the glyph it came from
  const gl = [], owner = [];
  gs.forEach((g, gi) => { for (const l of letters(g.text)) { gl.push(l); owner.push(gi); } });
  // the window: CONTEXT letters each side of the clicked glyph
  let first = owner.findIndex((o) => o >= hit.index);
  if (first < 0) first = gl.length;
  const own = owner.indexOf(hit.index) >= 0;                   // the clicked glyph has letters of its own
  const lo = Math.max(0, first - CONTEXT), hi = Math.min(gl.length, first + CONTEXT + 1);
  const matched = align(gl.slice(lo, hi), chars);
  const srcOf = (k) => (k >= lo && k < hi && matched[k - lo] >= 0 ? offs[matched[k - lo]] : -1);
  const result = (offset) => ({ offset: Math.max(0, Math.min(offset, block.source.length)), method: 'fuzzy', glyph: hit.glyph.text });

  if (own) {
    // a letter or digit matched in the source: its own offset
    const k = hit.after ? owner.lastIndexOf(hit.index) : first;
    const o = srcOf(k);
    if (o >= 0) return result(o + (hit.after ? 1 : 0));
    // unmatched, as when TeX draws things in another order than the source
    // (a sum's upper limit before its lower): the run of unmatched letters
    // around it, found near the matched neighbours
    const found = nearbyRun(k, srcOf, gl, lo, hi, chars, offs);
    if (found >= 0) return result(found + (hit.after ? 1 : 0));
  }
  // a symbol (=, ∑, ∈), or a letter the source spells otherwise (ℝ from \R):
  // among the source's tokens between the matched neighbours, the one at the
  // same place as the glyph among the glyphs between them
  let kl = -1, kr = -1, left = -1, right = block.source.length;
  for (let k = first - 1; k >= lo; k--) { const o = srcOf(k); if (o >= 0) { kl = k; left = o; break; } }
  for (let k = (own ? owner.lastIndexOf(hit.index) + 1 : first); k < hi; k++) { const o = srcOf(k); if (o >= 0) { kr = k; right = o; break; } }
  const g0 = kl >= 0 ? owner[kl] + 1 : 0, g1 = kr >= 0 ? owner[kr] : gs.length;   // the glyphs between, [g0, g1)
  const toks = tokens(block.source, left + 1, right);
  if (!toks.length) return result(left >= 0 ? left + 1 : right);
  const G = Math.max(1, g1 - g0), at = Math.max(0, Math.min(G - 1, hit.index - g0));
  const t = toks.length === G ? at : Math.round(at * (toks.length - 1) / Math.max(1, G - 1));
  return result(toks[Math.max(0, Math.min(toks.length - 1, t))]);
}

/** For the unmatched letter k: its run of unmatched letters (at least two),
 *  looked for in the source's letters near the matched neighbours (±24
 *  letters); the occurrence nearest to them. The source offset of k's letter
 *  there, or -1. */
function nearbyRun(k, srcOf, gl, lo, hi, chars, offs) {
  let a = k, b = k + 1;
  while (a > lo && srcOf(a - 1) < 0 && k - a < 8) a--;
  while (b < hi && srcOf(b) < 0 && b - k < 8) b++;
  if (b - a < 2) return -1;
  // the neighbours' positions among the source's letters
  let pl = -1, pr = -1;
  for (let j = a - 1; j >= lo && pl < 0; j--) { const o = srcOf(j); if (o >= 0) pl = offs.indexOf(o); }
  for (let j = b; j < hi && pr < 0; j++) { const o = srcOf(j); if (o >= 0) pr = offs.indexOf(o); }
  const centre = pl >= 0 && pr >= 0 ? (pl + pr) / 2 : pl >= 0 ? pl : pr;
  if (centre < 0) return -1;
  const text = chars.join('');
  // the whole run, then ever shorter pieces of it that hold k (a run may be
  // two pieces the source has the other way round: n1 k0 for k0 … n1)
  for (let len = b - a; len >= 2; len--) {
    for (let s0 = Math.max(a, k - len + 1); s0 <= k && s0 + len <= b; s0++) {
      const run = gl.slice(s0, s0 + len).join('');
      let best = -1, dist = Infinity;
      for (let i = text.indexOf(run, Math.max(0, Math.floor(centre) - 24)); i >= 0 && i <= centre + 24; i = text.indexOf(run, i + 1)) {
        const d = Math.abs(i - centre);
        if (d < dist) { dist = d; best = i; }
      }
      if (best >= 0) return offs[best + (k - s0)];
    }
  }
  return -1;
}

/** The typeset-looking tokens in src[from, to): commands and characters
 *  that are no space, brace, script mark or math shift; not \begin{…},
 *  spacing or \left/\right. Offsets. */
function tokens(src, from, to) {
  const out = [];
  for (let i = from; i < to; i++) {
    const c = src[i];
    if (c === '%') { while (i < to && src[i] !== '\n') i++; continue; }
    if (/\s|[{}^_$&~]/.test(c)) continue;
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i, i + 40));
      if (!m) continue;
      if (m[1] === 'begin' || m[1] === 'end') { const e = src.indexOf('}', i); if (e > 0 && e < to) { i = e; continue; } }
      if (!['left', 'right', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr', ',', ';', '!', ' ', 'quad', 'qquad', '[', ']', '(', ')', 'label', 'nonumber', 'notag'].includes(m[1])) out.push(i);
      if (m[1] === 'label') { const e = src.indexOf('}', i); if (e > 0 && e < to) { i = e; continue; } }
      i += m[0].length - 1;
      continue;
    }
    out.push(i);
  }
  return out;
}
