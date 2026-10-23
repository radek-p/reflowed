// svgfig label edits in place: a click on a drawn figure's text in the document opens a small
// LaTeX field by that text, without opening the figure editor. While typing, the text is typeset again
// (one compile at a time, always for the latest source) and drawn in the document's picture in place;
// Enter (a text box: Mod-Enter) or a click elsewhere saves, Escape puts the old glyphs back.
// The save is headless: the figure's model from its SVG, the one text's source set and typeset (a text
// box keeps its width, the text reflows), the SVG and its TikZ rendition written again, and the app's
// saveEdit (lifecycle.js: one undo step, the op log, versions). Nothing else in the figure changes.
//
//   const labels = createLabelEdits(host)
//   host: { root() (the document's element), figureAt(picture element) → { block, name, scale, include } | null,
//           asset(name) → Promise<asset with bytes>, renderTikz(src) → Promise, saveEdit(asset, res), toast(text),
//           editable() → boolean (false: read-only document, or the block being edited) }
//   labels.dispose()

import { h, render } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { svgToFigure, figureToSvg, svgText } from './asset.js';
import { createTypesetter } from './text.js';
import { renderObject } from './render.js';
import { find } from './model.js';
import { toTikz } from './tikz.js';

const html = htm.bind(h);
const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

const CSS = `
.svf-label { position: fixed; z-index: 900; width: 300px; padding: 8px; border-radius: 10px; color: var(--text, #2f2e2b);
  background: var(--bg, #fff); box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 13%, transparent), 0 8px 28px rgba(15, 15, 15, 0.12);
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
.svf-label textarea { box-sizing: border-box; width: 100%; resize: vertical; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: inherit; background: color-mix(in srgb, currentColor 6%, transparent); border: 1px solid transparent; border-radius: 6px; padding: 5px 7px; outline: none; }
.svf-label textarea:focus { border-color: var(--accent, #2383e2); }
.svf-label-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; font-size: 11px; color: var(--muted, #9b9a97); }
.svf-label-err { color: var(--danger, #d44c47); }
.latex-picture [data-rtx-text].svf-label-on { outline: 1px dashed var(--accent, #2383e2); outline-offset: 2px; }
`;
function injectStyle() {
  if (document.getElementById('svf-label-style')) return;
  const s = document.createElement('style');
  s.id = 'svf-label-style';
  s.textContent = CSS;
  document.head.append(s);
}

function LabelField({ o, at, onInput, onDone, state }) {
  const ref = useRef(null);
  const [src, setSrc] = useState(o.src);
  useLayoutEffect(() => { const t = ref.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, []);
  const box = o.box != null;
  const s = state.value;
  return html`<div class="svf-label" role="dialog" aria-label="Edit the figure's label" style=${`left:${at.left}px;top:${at.top}px`}
      onPointerDown=${(e) => e.stopPropagation()}>
    <textarea ref=${ref} rows=${box ? 3 : 1} spellcheck="false" aria-label="LaTeX" value=${src}
      onInput=${(e) => { setSrc(e.currentTarget.value); onInput(e.currentTarget.value); }}
      onKeyDown=${(e) => {
        e.stopPropagation();
        const enter = box ? (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) : (e.key === 'Enter' && !e.shiftKey);
        if (enter) { e.preventDefault(); onDone(true); } else if (e.key === 'Escape') { e.preventDefault(); onDone(false); }
      }}
      onBlur=${() => onDone(true)}></textarea>
    <div class="svf-label-foot">
      ${s.error ? html`<span class="svf-label-err">${s.error.split('\n')[0]}</span>` : html`<span>${s.busy ? 'Typesetting…' : ''}</span>`}
      <span>${box ? `${isMac ? '⌘' : 'Ctrl+'}Enter` : 'Enter'} to save · Esc to cancel</span>
    </div>
  </div>`;
}

export function createLabelEdits(host) {
  injectStyle();
  let cur = null;          // the open edit

  /** The document's <g data-rtx-text> for text id inside picture pic (fresh: a re-render may replace it). */
  const textEl = (pic, id) => [...pic.querySelectorAll('[data-rtx-text]')].find((e) => e.getAttribute('data-rtx-text') === id) ?? null;

  /** Draw object o (typeset with ts) in place of its text in the document's picture. */
  function drawInPlace(e, o, ts) {
    const pic = e.pic.isConnected ? e.pic : null;
    const el = pic && textEl(pic, o.id);
    if (!el) return;
    const markup = renderObject(o, 'asset', { glyphs: ts.glyphs });
    const tpl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tpl.innerHTML = markup;
    const fresh = tpl.querySelector('[data-rtx-text]');
    if (!fresh) return;
    // the theme's colour, as the picture step writes it (var(--latex-color-rrggbb, #rrggbb))
    const fill = fresh.getAttribute('fill');
    if (fill && /^#[0-9a-f]{6}$/i.test(fill)) fresh.setAttribute('fill', `var(--latex-color-${fill.slice(1).toLowerCase()}, ${fill})`);
    fresh.classList.add('svf-label-on');
    el.replaceWith(fresh);
  }

  async function open(pic, textId) {
    if (cur) await close(true);
    const fig0 = host.figureAt(pic);
    if (!fig0) return false;
    const asset = await host.asset(fig0.name);
    const parsed = asset ? svgToFigure(svgText(asset.bytes)) : null;
    const o = parsed && find(parsed.fig, textId);
    if (!o || o.type !== 'text') return false;
    const ts = createTypesetter({ renderTikz: host.renderTikz });
    ts.adopt(parsed.glyphs);
    const el = textEl(pic, textId);
    const original = el?.cloneNode(true) ?? null;
    el?.classList.add('svf-label-on');
    const r = (el ?? pic).getBoundingClientRect();
    const at = { left: Math.max(8, Math.min(r.left, innerWidth - 316)), top: r.bottom + 8 + 120 > innerHeight ? Math.max(8, r.top - 120) : r.bottom + 8 };
    const state = { value: { busy: false, error: null } };
    const holder = document.createElement('div');
    document.body.append(holder);
    const e = { pic, o, ts, fig: parsed.fig, asset, fig0, original, src0: o.src, holder, state, want: o.src, running: null, closing: false };
    cur = e;
    const paint = () => render(html`<${LabelField} o=${o} at=${at} state=${state} onInput=${(s) => edit(e, s)} onDone=${(save) => close(save)}/>`, holder);
    e.paint = paint;
    paint();
    return true;
  }

  function setState(e, patch) { e.state.value = { ...e.state.value, ...patch }; e.paint?.(); }

  /** Typeset e.want (one compile at a time; a newer source waits for the running one, then wins). */
  function edit(e, src) {
    e.want = src;
    if (e.running) return;
    e.running = (async () => {
      while (!e.closing) {
        const want = e.want;
        e.o.src = want;
        setState(e, { busy: true });
        const r = await e.ts.typeset(e.o);
        if (e.closing) break;
        if (e.want !== want) continue;
        setState(e, { busy: false, error: r.error ?? null });
        if (!r.error) drawInPlace(e, e.o, e.ts);
        break;
      }
    })().finally(() => { e.running = null; });
  }

  async function close(save) {
    const e = cur;
    if (!e || e.closing) return;
    e.closing = true;
    cur = null;
    render(null, e.holder);
    e.holder.remove();
    await e.running;
    const restore = () => {
      const el = e.pic.isConnected && textEl(e.pic, e.o.id);
      if (el && e.original) el.replaceWith(e.original.cloneNode(true));
      else el?.classList.remove('svf-label-on');
    };
    const src = e.want;
    if (!save || src === e.src0 || !src.trim()) { e.o.src = e.src0; restore(); return { saved: false }; }
    e.o.src = src;
    const r = await e.ts.typeset(e.o);
    if (r.error) { restore(); host.toast(`Label: ${r.error.split('\n')[0]}`); return { saved: false, error: r.error }; }
    const svg = figureToSvg(e.fig, e.ts.glyphs);
    const tikz = toTikz(e.fig, { scale: e.fig0.scale ?? 1, name: e.fig0.name, include: e.fig0.include ?? '' });
    textEl(e.pic, e.o.id)?.classList.remove('svf-label-on');
    host.saveEdit(e.asset, { svg, tikz });
    return { saved: true };
  }

  // a press on a drawn figure's text: the field, not the block's source editor (the click that follows
  // is the field's too)
  function hit(ev) {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return null;
    // the viewer draws pictures with pointer-events: none, so the hit is by geometry: a figure text of the
    // block under the pointer whose box holds the point
    const blk = ev.target instanceof Element ? ev.target.closest('.blk') : null;
    if (!blk || ev.target.closest('.svf-label, .cm-editor')) return null;
    const t = [...blk.querySelectorAll('.latex-picture [data-rtx-text]')].find((e) => { const r = e.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; });
    const pic = t?.closest('.latex-picture');
    if (!t || !pic || !host.root()?.contains(pic) || !host.editable(pic) || !host.figureAt(pic)) return null;
    return { pic, id: t.getAttribute('data-rtx-text') };
  }
  function onDown(ev) {
    const h = hit(ev);
    if (!h) return;
    ev.preventDefault(); ev.stopPropagation();
    open(h.pic, h.id);
  }
  function onClick(ev) { if (hit(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('click', onClick, true);

  return {
    open, close: (save = true) => close(save),
    current: () => (cur ? { id: cur.o.id, src: cur.want, busy: !!cur.running, error: cur.state.value.error } : null),
    /** resolves when the open field's typesetting has settled */
    idle: async () => { while (cur?.running) await cur.running; },
    dispose() { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('click', onClick, true); if (cur) close(false); },
  };
}
