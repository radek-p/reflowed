// references in the typeset blocks as *units*.
//
// A reference reaches the page in two pieces: live-text slot
// (`data-slot="rtxr:eq:x"`, `rtxc:a,b`, `rtxC:…`, `rtxa:…`: the number the
// numbering overlay sets) and, for \ref/\eqref/\autoref, hyperref's link on the
// glyphs TeX printed around it (`data-link`, `data-link-href="#eq:x"`,
// `data-link-label`: the parentheses of \eqref; the viewer drops the link on
// the slot's replaced text). A unit is the run of glyphs, in reading order,
// that belong to one reference: slot glyphs of one slot name plus the link
// glyphs of one hyperref link with the same label(s). Its target is resolved
// by label through refsState() (label -> block id), never through hyperref's
// anchors (a block is compiled on its own, so they do not exist across blocks).
//
// The link glyphs of a unit are neutralised: data-link/-href/-label, the
// latex-link class and the viewer's role/tabindex come off, so the viewer
// neither lights the brackets alone nor follows the link; the unit carries its
// own `rn-ref` class, and its first glyph the tab stop and the name.
// An external link (\url, \href: data-link-href not starting with '#') is a
// unit too, of kind 'link': the glyphs of one hyperref link (one data-link key),
// its label its address (unit.href), neutralised the same way (the address kept
// as data-rn-href), so neither the viewer nor the page follows it; index.js
// treats it as any unit. Action links (data-link-action) are not units.

// rtxk: a citation (rtx-numbering.sty prints every cite command inside a marker slot named by its keys)
export const REF_SLOT = /^rtx[racCk]:/;
/** The labels a reference slot's name holds ("rtxc:a,b" -> [a, b]); refs/numbering.ts refLabels. */
export const slotLabels = (name) => name.slice(5).split(',').map((x) => x.trim()).filter(Boolean);
/** The command family a slot name stands for. */
export const slotKind = (name) => ({ rtxr: 'ref', rtxa: 'autoref', rtxc: 'cref', rtxC: 'Cref', rtxk: 'cite' })[name.slice(0, 4)] ?? 'ref';

/** the text a link glyph may have to belong to a slot's reference: brackets, punctuation, space */
const DECOR = /^[\s()[\]{}⟨⟩.,;:~  -]*$/;
/** a unit's name for a screen reader, by kind */
const NOUN = { cite: 'Citation', link: 'Link' };
const units = new WeakMap();          // glyph element -> its unit
const byRender = new WeakMap();       // .blk-render / card body -> its units

/** The unit an event target belongs to (a glyph of one, or null). */
export function unitOf(target) {
  const el = target?.closest?.('tspan, text');
  return (el && units.get(el)) ?? null;
}
export const unitsIn = (root) => byRender.get(root) ?? [];

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Find the reference units of one rendered block (a `.blk-render`, or a
 * card's body) and mark them. Idempotent: called again after the viewer
 * repainted (new glyph elements), it rebuilds the list.
 */
export function scanRender(root, { blockId = root.closest?.('.blk')?.dataset.id ?? null, inCard = false } = {}) {
  const list = [];
  const links = new Map();            // an external link's data-link key -> its unit (its glyphs may be apart)
  let cur = null, gap = [];
  const glyphs = root.querySelectorAll('tspan');
  for (const g of glyphs) {
    const slot = g.dataset.slot;
    const isSlot = !!slot && REF_SLOT.test(slot);
    const ext = isSlot ? null : externalHref(g);
    if (ext) {
      cur = null; gap = [];
      const key = g.dataset.link ?? g.dataset.rnLink ?? ext;
      let u = links.get(key);
      if (!u) { u = { id: '', blockId, inCard, labels: [ext], href: ext, slot: null, kind: 'link', linkKey: key, els: [], hadLink: true }; list.push(u); links.set(key, u); }
      neutralise(g);
      u.els.push(g);
      continue;
    }
    // a tie inside a slot's text ("Lemma~1.1": the viewer draws the words apart, the space between
    // them is not the slot's): kept aside, and part of the unit when the same slot goes on after it
    if (!isSlot && cur?.slot && !g.dataset.linkLabel && !g.dataset.rnLabel && !(g.textContent ?? '').trim()) { gap.push(g); continue; }
    if (isSlot && cur?.slot === slot && gap.length) cur.els.push(...gap);
    gap = [];
    // a link we already neutralised keeps its label as data-rn-label
    const label = g.dataset.linkLabel ?? g.dataset.rnLabel;
    const href = g.dataset.linkHref ?? (g.dataset.rnLabel ? '#' : null);
    const isLink = !!label && !!href && href.startsWith('#');
    if (!isSlot && !isLink) { cur = null; continue; }
    if (isSlot && slot.slice(5).startsWith("thmt@@")) { cur = null; continue; }   // a restated theorem's own number, not a reference
    const labels = isSlot ? slotLabels(slot) : [label];   // a slot inside a box (a caption) may carry the link too
    const key = isLink && !isSlot ? (g.dataset.link ?? g.dataset.rnLink ?? '') : '';
    const fits = cur && sameSet(cur.labels, labels)
      && (!isSlot || !cur.slot || cur.slot === slot)
      && (!key || !cur.linkKey || cur.linkKey === key);
    if (!fits) {
      cur = { id: '', blockId, inCard, labels, slot: null, kind: 'ref', linkKey: '', els: [], hadLink: false };
      list.push(cur);
    }
    if (isSlot) { cur.slot = slot; cur.kind = slotKind(slot); }
    if (isLink) { cur.linkKey ||= key; cur.hadLink = true; neutralise(g); }
    cur.els.push(g);
  }
  // hit areas of neutralised links (the viewer's rects over a link's spaces) go inert too
  for (const r of root.querySelectorAll('rect.latex-link-hit[data-link-href]')) neutralise(r);
  // A reference with a slot is its slot's glyphs plus only the link glyphs that
  // decorate it (\eqref's brackets): hyperref's link can cover far more, e.g. a run-in
  // `\paragraph*{…}` heading set at the start of the paragraph that begins with
  // `\Cref{…}` lies inside that reference's link, and the whole heading became the
  // reference (user report: hovering the heading opened the lemma's card). Link glyphs
  // that are not brackets/punctuation next to the slot drop out: plain text again.
  for (const u of list) {
    if (!u.slot) continue;
    const isSlotG = (g) => !!g.dataset.slot && REF_SLOT.test(g.dataset.slot);
    const first = u.els.findIndex(isSlotG), last = u.els.length - 1 - [...u.els].reverse().findIndex(isSlotG);
    const keep = new Set(u.els.slice(first, last + 1));
    for (let i = first - 1; i >= 0 && DECOR.test(u.els[i].textContent ?? ''); i--) keep.add(u.els[i]);
    for (let i = last + 1; i < u.els.length && DECOR.test(u.els[i].textContent ?? ''); i++) keep.add(u.els[i]);
    u.els = u.els.filter((g) => keep.has(g));
  }
  // …and a run of such link glyphs elsewhere in the block (the heading broken over lines,
  // or split from the slot by a reflow) is not a reference of its own: the reference is its slot.
  const slotted = list.filter((u) => u.slot);
  for (let i = list.length - 1; i >= 0; i--) if (!list[i].slot && slotted.some((s) => sameSet(s.labels, list[i].labels))) list.splice(i, 1);
  // glyphs that are in no unit now (a rescan after a repaint or an edit) lose any unit state
  const inUnit = new Set(list.flatMap((u) => u.els));
  for (const g of glyphs) {
    if (inUnit.has(g) || !units.has(g) && !g.classList.contains('rn-ref')) continue;
    units.delete(g);
    g.classList.remove('rn-ref', 'rn-link', 'rn-hot', 'rn-flash');
    if (g.dataset.rnFirst !== undefined) { g.removeAttribute('tabindex'); g.removeAttribute('role'); g.removeAttribute('aria-haspopup'); g.removeAttribute('aria-describedby'); g.removeAttribute('aria-expanded'); g.removeAttribute('aria-label'); delete g.dataset.rnFirst; }
  }
  for (const u of list) {
    u.index = list.filter((x) => x.blockId === u.blockId && sameSet(x.labels, u.labels) && x.kind === u.kind).indexOf(u);
    // the pane in the id: the same reference drawn in both panes is two units
    const pane = u.inCard ? null : root.closest?.('.blk[data-pane]')?.dataset.pane ?? null;
    u.id = `${u.inCard ? 'card' : u.blockId}${pane ? `@${pane}` : ''}:${u.kind}:${u.labels.join()}:${u.index}`;
    u.text = u.els.map((g) => g.textContent).join('');
    u.els.forEach((g, i) => {
      units.set(g, u);
      g.classList.add('rn-ref');
      g.classList.toggle('rn-link', u.kind === 'link');
      if (i === 0) {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'link');
        g.setAttribute('aria-haspopup', 'dialog');
        // the whole unit's name for a screen reader (the first glyph alone may be a bracket)
        g.setAttribute('aria-label', `${NOUN[u.kind] ?? 'Reference'} ${u.text.replace(/\s+/g, ' ').trim()}`);
        g.dataset.rnFirst = '';
      } else if (g.dataset.rnFirst !== undefined || g.getAttribute('role') === 'link') {
        g.removeAttribute('tabindex'); g.removeAttribute('role'); g.removeAttribute('aria-haspopup'); g.removeAttribute('aria-label'); delete g.dataset.rnFirst;
      }
    });
  }
  byRender.set(root, list);
  return list;
}

/** An external link's address on a glyph: the viewer's, or the one kept when it was neutralised. */
function externalHref(g) {
  const h = g.dataset.linkHref;
  if (h != null) return h.startsWith('#') ? null : h;
  return g.dataset.rnHref ?? null;
}

/** Take hyperref's link off a glyph (it keeps its label, an external link its address, for the unit). */
function neutralise(g) {
  if (g.dataset.linkLabel) g.dataset.rnLabel = g.dataset.linkLabel;
  if (g.dataset.linkHref && !g.dataset.linkHref.startsWith('#')) g.dataset.rnHref = g.dataset.linkHref;
  if (g.dataset.link) g.dataset.rnLink = g.dataset.link;
  delete g.dataset.link; delete g.dataset.linkHref; delete g.dataset.linkLabel;
  g.classList.remove('latex-link', 'latex-link-hover', 'latex-link-active');
  if (g.tagName.toLowerCase() === 'rect') return;
  g.removeAttribute('role'); g.removeAttribute('tabindex');
}

// ── The hovered unit as a live mark ─────────────────────────────────────────
// The viewer laid the lines out, so it knows them: a live mark
// (host.addMark) over the unit's glyphs gives one rect per drawn line
// (mark.rects()) and a band under each, as tall as the line and at least a
// parenthesis (rect.latex-mark[data-mark~="rn-hot"], styled in style.js), in
// a subscript as on the baseline, kept through reflows. One mark at a time:
// adding one repaints the block's drawn lines (the glyph elements are kept).
export const HOT_MARK = 'rn-hot';
let hotMark = null;
/** Mark the unit (null: none); returns the mark or null (a viewer without live marks). */
export function markUnit(u) {
  try { if (hotMark?.live) hotMark.remove(); } catch { /* gone */ }
  hotMark = null;
  const host = window.reflowtex?.host;
  if (!u || !host?.addMark || !host?.rangesOf) return null;
  const first = u.els[0], last = u.els[u.els.length - 1];
  if (!first?.isConnected || !last?.isConnected) return null;
  const r = document.createRange();
  r.setStart(first.firstChild ?? first, 0);
  r.setEnd(last.firstChild ?? last, last.firstChild ? (last.firstChild.textContent ?? '').length : last.childNodes.length);
  const ranges = host.rangesOf(r);
  hotMark = ranges.length ? host.addMark(ranges, { id: HOT_MARK, classes: HOT_MARK }) : null;
  return hotMark;
}
export const markedUnit = () => hotMark;

/** Screen rects of a unit, one per drawn line: the live mark's when there is one. */
export function unitRects(u) {
  if (hotMark?.live && hotMark.elements().includes(u.els[0])) {
    // the bands the viewer drew for the mark: one per line, the line's height
    // (in the unit's own block: a removed mark's bands stay on lines drawn off screen until they are drawn again)
    const scope = u.els[0].closest('.latex-block') ?? document;
    const bands = [...scope.querySelectorAll(`rect.latex-mark[data-rtx-id="${HOT_MARK}"]`)].map((b) => b.getBoundingClientRect()).filter((r) => r.width);
    const m = bands.length ? bands : hotMark.rects();
    if (m.length) return m.map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  }
  // no live marks (an older viewer): the glyphs' own boxes, one per SVG row
  return u.els.map((g) => g.getBoundingClientRect()).filter((r) => r.width || r.height)
    .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
}
