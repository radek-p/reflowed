// the preview card of a reference (Preact on the kit since the migration).
//
// Shows what the reference points at by mounting the target block's own
// typeset result again (its nodelist, as the app mounted it: no compile) in
// the card, at the card's width, clipped with a fade; the block's numbers are
// copied from the numbering overlay (numberingState(): the target's items in
// order, per counter), references in it are live text by name and follow by
// themselves. When the label sits inside a long block (an equation in a
// proof), the body is scrolled so the label's anchor is in view.
//
//   const card = createCard({ numberingState, sourceOf(blockId), renderOf(blockId), onGo(label), onClose(unit) })
//     renderOf: the block's typeset element in the card's editor (its container's), the copy's source
//   card.open(unit, anchorRects, { targets: [{ label, info, blockId }], focus })
//   card.close(); card.el; card.isOpen(); card.unit
// The card is a Preact component drawn synchronously (it is measured to be placed); the typeset copy in its
// body is the viewer's island (host.mount), as in the document. Hooks kept: #rn-card.rn-card, .rn-title,
// .rn-key, .rn-body, .rn-go[data-label], .rn-hint, .rn-empty, .rn-source.
// While open the card is a layer of the kit's one overlay layer (design/ui/layers.js): its place in the
// stacking order, Escape (the focus back on the reference when it was in the card) and a press outside close it.
import { html, render, ensureStyles, Button } from '../design/ui/index.js';
import { pushLayer } from '../design/ui/layers.js';
import { viewBox } from '../design/ui/view-box.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';

const MAX_H = 240;

/** one bibliography entry as the card shows it: authors, title, venue, year, the DOI as a link */
function Entry({ e }) {
  if (!e.entry) return html`<li class="rn-entry rn-missing" data-key=${e.key}><div class="rn-eline"><code class="rn-ekey">${e.key}</code></div><p class="rn-empty">Not in the bibliography: no entry with this key.</p></li>`;
  const x = e.entry, doi = x.fields?.doi, url = x.fields?.url;
  const authors = x.authors?.length > 2 ? `${x.authors.slice(0, -1).join(', ')} and ${x.authors[x.authors.length - 1]}` : (x.authors ?? []).join(' and ');
  return html`<li class="rn-entry" data-key=${e.key}>
    <div class="rn-eline">${x.label && !/[()]/.test(x.label) ? html`<span class="rn-label">[${x.label}]</span>` : null}<code class="rn-ekey">${e.key}</code></div>
    ${authors ? html`<div class="rn-authors">${authors}</div>` : null}
    ${x.title ? html`<div class="rn-etitle">${x.title}</div>` : null}
    ${x.venue || x.year ? html`<div class="rn-meta">${x.venue ? html`<span class="rn-venue">${x.venue}</span>` : null}${x.venue && x.year ? ', ' : ''}${x.year ? html`<span class="rn-year">${x.year}</span>` : null}</div>` : null}
    ${doi ? html`<a class="rn-doi" href=${`https://doi.org/${doi}`} target="_blank" rel="noopener" aria-label=${`DOI ${doi} (opens in a new tab)`}>doi:${doi}</a>`
      : url ? html`<a class="rn-doi rn-url" href=${url} target="_blank" rel="noopener">${url}</a>` : null}
  </li>`;
}

/** the card's CONTENT, apart from its container: a reference's target typeset, or a citation's entries,
 *  and their actions. The container (the floating card here) only places it. */
export function CardContent({ v, onGo, onAction, bodyRef }) {
  return html`<div class="rn-head"><span class="rn-title" id="rn-card-title">${v.title}</span><code class="rn-key">${v.keys}</code></div>
    <div class=${`rn-body${v.kind === 'cite' ? ' rn-cite' : ''}`} ref=${bodyRef}>
      ${v.empty ? html`<p class="rn-empty">${v.empty}</p>` : null}
      ${v.source != null ? html`<pre class="rn-source">${v.source}</pre>` : null}
      ${v.entries?.length ? html`<ul class="rn-entries" aria-label="Bibliography entries">${v.entries.map((e) => html`<${Entry} key=${e.key} e=${e} />`)}</ul>` : null}
    </div>
    <div class="rn-foot">
      ${v.go.map((g) => html`<${Button} key=${g.label} size="sm" variant="primary" class="rn-go" data-label=${g.label}
        onClick=${(e) => { e.stopPropagation(); onGo(g.label); }}>${g.text}<//>`)}
      ${(v.actions ?? []).map((a, i) => html`<${Button} key=${a.id} size="sm" variant=${i ? 'secondary' : 'primary'} class=${`rn-act rn-${a.id}`}
        onClick=${(e) => { e.stopPropagation(); onAction(a.id); }}>${a.text}<//>`)}
      <span class="rn-hint">${v.hint}</span>
    </div>`;
}

function Card({ v, onGo, onAction, bodyRef }) {
  return html`<div class="rn-card" id="rn-card" role="dialog" aria-modal="false" aria-labelledby="rn-card-title" data-kind=${v.kind} hidden=${!v.open}>
    <${CardContent} v=${v} onGo=${onGo} onAction=${onAction} bodyRef=${bodyRef} />
  </div>`;
}

export function createCard({ numberingState, sourceOf, renderOf, onGo, onAction, onClose }) {
  ensureStyles();
  const host = document.createElement('div');
  host.className = 'rn-card-host';
  host.style.display = 'contents';
  const bodyRef = { current: null };
  let v = { open: false, kind: 'ref', title: '', keys: '', go: [], actions: [], entries: null, hint: '', empty: null, source: null };
  const draw = () => render(html`<${Card} v=${v} onGo=${onGo} onAction=${(id) => onAction?.(id, unit)} bodyRef=${bodyRef} />`, host);
  draw();
  const el = host.firstElementChild;
  const body = () => bodyRef.current;
  let mounted = null, unit = null, token = 0, layer = null, was = null;

  function unmount() {
    if (mounted) { try { mounted.block?.destroy(); } catch { /* gone */ } mounted = null; }
    body().querySelector(':scope > .latex-block')?.remove();
    body().classList.remove('rn-clipped', 'rn-clipped-top');
    body().scrollTop = 0;
  }

  async function open(u, rect, { targets, focus = false }) {
    const t = ++token;
    unit = u;
    unmount();
    if (!host.isConnected) document.body.append(host);
    if (!layer) layer = pushLayer({ el, kind: 'card', onDismiss: () => { was = unit; close(); }, returnFocus: () => was?.els?.[0] ?? null });
    const first = targets[0];
    const name = first?.info ? cardTitle(first.info) : 'Undefined reference';
    const go = targets.slice(0, 4).filter((tg) => tg.blockId).map((tg) => ({ label: tg.label, text: targets.length > 1 ? `Go to ${cardTitle(tg.info)}` : 'Go to' }));
    v = { open: true, kind: 'ref', actions: [], entries: null, title: targets.length > 1 ? `${name} and ${targets.length - 1} more` : name, keys: u.labels.join(', '), go,
      hint: go.length ? `${shortcutLabel('mod')}-click to jump · click to edit` : 'Click to edit the reference',
      empty: first?.blockId ? null : first?.info ? 'This label is not in a block of the document.' : `No \\label{${u.labels[0] ?? ''}} in the document.`,
      source: null };
    draw();
    place(rect, u.els?.[0] ?? null);
    if (first?.blockId) await fill(first, t);
    if (t !== token) return;
    place(rect, u.els?.[0] ?? null);
    if (focus) (el.querySelector('.rn-go') ?? el).focus();
  }

  /** a citation: its entries (refsState().bib), "Show in References" and "Go to the reference list" */
  function openCite(u, rect, { entries, focus = false, hasList = true }) {
    ++token;
    unit = u;
    unmount();
    if (!host.isConnected) document.body.append(host);
    if (!layer) layer = pushLayer({ el, kind: 'card', onDismiss: () => { was = unit; close(); }, returnFocus: () => was?.els?.[0] ?? null });
    const known = entries.filter((e) => e.entry);
    v = { open: true, kind: 'cite', title: `Citation ${u.text.replace(/\s+/g, ' ').trim()}`, keys: '', go: [], source: null,
      empty: entries.length ? null : 'No keys in this citation.', entries,
      actions: [{ id: 'show-refs', text: 'Show in References' }, ...(hasList ? [{ id: 'goto-list', text: 'Go to the reference list' }] : [])],
      hint: known.length && hasList ? `${shortcutLabel('mod')}-click: the reference list · click to edit` : 'Click to edit the citation' };
    draw();
    place(rect, u.els?.[0] ?? null);
    if (focus) (el.querySelector('.rn-act') ?? el).focus();
  }

  async function fill(tg, t) {
    const src = renderOf(tg.blockId);
    if (!src?.dataset.nodelistB64 || !window.reflowtex?.host) {
      v = { ...v, source: sourceOf?.(tg.blockId) ?? '' };   // from its host, not the test surface
      draw();
      return;
    }
    // the viewer's island: a copy of the block's typeset result, mounted by the viewer
    const copy = document.createElement('div');
    copy.className = 'latex-block';
    copy.dataset.nodelistB64 = src.dataset.nodelistB64;
    if (src.dataset.colorMap) copy.dataset.colorMap = src.dataset.colorMap;
    body().append(copy);
    let block = null;
    try { block = await window.reflowtex.host.mount(copy); } catch (e) { console.warn('refnav card:', e.message); }
    if (t !== token) { try { block?.destroy(); } catch { /* */ } copy.remove(); return; }
    mounted = { block };
    if (block) copyNumbers(block, tg.blockId);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (t !== token) return;
    // the label's place in a long block: scroll the body to it
    const b = body();
    const a = copy.querySelector(`[id="${CSS.escape(tg.label)}"]`);
    if (a) {
      const y = a.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop;
      if (y > MAX_H * 0.6) { b.scrollTop = Math.max(0, y - MAX_H * 0.35); b.classList.add('rn-clipped-top'); }
    }
    if (b.scrollHeight - b.scrollTop > b.clientHeight + 2) b.classList.add('rn-clipped');
  }

  /** The target's theorem/section/equation numbers: the overlay's, item by item per counter; and the texts of the
   *  references in it, by name (with the slots set per instance, a copy mounted later shows TeX's default ⁇) */
  function copyNumbers(block, blockId) {
    const st = numberingState?.();
    if (!st) return;
    for (const inst of block.instances({ placement: 'text' })) {
      const text = st.refs?.[inst.attrs?.name ?? ''];
      if (text !== undefined) { try { inst.setText(text); } catch { /* */ } }
    }
    const queue = new Map();
    for (const it of st.items) if (it.blockId === blockId) { if (!queue.has(it.counter)) queue.set(it.counter, []); queue.get(it.counter).push(it.number); }
    const items = [];
    for (const inst of block.instances({ placement: 'text' })) {
      const name = inst.attrs?.name ?? '';
      if (!name.startsWith('rtxn ')) continue;
      try { const d = JSON.parse(name.slice(5)); items.push({ d, inst }); } catch { /* not ours */ }
    }
    items.sort((a, b) => a.d.s - b.d.s);
    for (const { d, inst } of items) {
      const n = queue.get(d.c)?.shift();
      if (n !== undefined) { try { inst.setText(n); } catch { /* */ } }
    }
  }

  /** next to the reference, inside the box it may use: its document view below the strip and the bar (view-box.ts) */
  function place(rects, at) {
    const r = Array.isArray(rects) ? rects[0] : rects;
    if (!r) return;
    const B = viewBox(at);
    const w = Math.min(460, B.right - B.left - 32);
    el.style.width = `${w}px`;
    const left = Math.max(B.left + 16, Math.min(r.left - 24, B.right - w - 16));
    const hgt = el.offsetHeight || 200;
    const below = r.bottom + 8, above = r.top - 8 - hgt;
    const top = below + hgt <= B.bottom - 8 || above < B.top + 8 ? below : above;
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(B.top + 8, top)}px`;
  }

  function close() {
    if (!v.open) return;
    token++;
    layer?.remove(); layer = null;
    v = { ...v, open: false, source: null, empty: null, entries: null };
    draw();
    unmount();
    const u = unit; unit = null;
    onClose?.(u);
  }

  return { el, open, openCite, close, isOpen: () => v.open, get kind() { return v.kind; }, get unit() { return unit; } };
}

/** "Lemma 3.2", "Section 2 (Preliminaries)", "Equation (4)". */
export function cardTitle(info) {
  if (!info) return 'Undefined reference';
  const num = info.number || '??';
  let t = info.text || `${info.refname || info.counter || 'Label'} ${num}`;
  if (info.counter === 'equation' && !/\(/.test(t)) t = `${info.refname || 'Equation'} (${num})`;
  if (info.title && /section|chapter|paragraph/.test(info.counter)) t += ` · ${info.title}`;
  return t;
}
