// the View popover, opened from the top bar ("Aa", ⌥⌘V / Ctrl+Alt+V): column width, text size, colour,
// justification, the edit layout, and switches (note chips, block handles, the inspector). Every control applies at once.
// On Preact and the design kit (PR-NOTES), behaviour kept: one element #rtx-view-pop that stays in the
// page (hidden when closed), the kit's Segmented controls (role radio, aria-checked, the data-w/-a/-e hooks), kit
// icon buttons for the text size; placed by the kit's place() under its button, right-aligned; Esc (focus back to
// the button) and a press outside close it: the kit's one overlay layer, while it is open.
//   createPopover(view, { mod, alt }) -> { el, open(anchor), close({ focus }), toggle(anchor), sync(), isOpen }
//   Panel({ view, mod, alt })  the panel's content (the gallery draws it in place: app/src/gallery/live.ts)
// the rows and switches are registrations (settings/registry.ts, where 'view' and 'view-switch'; their
// context is a ViewCtx): a new option is a registration in its own module, no edit here. The built-in ones follow.
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { html, render, Segmented, IconButton, place } from '../design/ui/index.js';
import { pushLayer } from '../design/ui/layers.js';
import { WIDTHS, SLIDER, THEMES, EDIT_LAYOUTS, layoutsDebug } from './settings.js';
import { installPopoverStyle } from './popover-style.js';
import { advanced, setAdvanced, advancedFeatures } from '../settings/advanced.js';
import { registerSetting, visibleAt } from '../settings/registry.ts';

/** what the panel reads and sets of the page's view (view/index.js) */
export interface ViewSettings { width: string; widthPx: number; zoom: number; theme: string; align: string; handles: boolean; editLayout: string }
export interface PopoverView {
  settings: ViewSettings;
  set(patch: Partial<ViewSettings>, o?: { animate?: boolean }): void;
  zoomBy(dir: number): void;
  measure(): { columnPx: number; measurePt: number; textwidthPt?: number | null; fitted?: boolean; limited?: boolean };
  editDecision(): { mode: string };
  setNotes(on: boolean): void;
  readonly notes: { settings(): { hidden: boolean } } | null;
}
/** a View option's context (registerSetting's ctx for 'view' and 'view-switch') */
export interface ViewCtx { view: PopoverView; mod: string; alt: string }
type Choice = { name: string; label: string; hint?: string };
type Input = HTMLInputElement;

// (Signals are read with peek(): a component that reads a signal is not drawn again by render() with the same props,
// and this panel is drawn by sync(); view/index.js syncs it when the advanced switch changes.)
const seg = (items: readonly Choice[], attr: string) => items.map((it) => ({ value: it.name, label: it.label, attrs: { [`data-${attr}`]: it.name, title: it.hint ?? undefined } }));

export function Caption({ id, children, out }: { id?: string; children?: ComponentChildren; out?: unknown }) {
  return html`<p class="rtx-vp-cap"><span id=${id}>${children}</span>${out ?? null}</p>`;
}

registerSetting({ id: 'view-width', where: 'view', order: 10, Control: ({ view }: ViewCtx) => {
  const s = view.settings, m = view.measure();
  const wNote = s.width === 'paper'
    ? (m.textwidthPt ? `\\textwidth = ${m.textwidthPt.toFixed(2)} pt: the PDF’s line breaks${m.fitted ? '; fitted: the window is narrower, lines are broken to fit it' : ''}` : 'the document’s \\textwidth, once a block is typeset')
    : m.limited ? 'narrower than chosen: the window is' : '';
  return html`<div class="rtx-vp-row">
      <${Caption} id="rtx-view-w" out=${html`<output aria-live="polite">${m.columnPx ? `${Math.round(m.columnPx)} px · ${m.measurePt.toFixed(m.measurePt % 1 ? 1 : 0)} pt` : ''}</output>`}>Column width<//>
      <${Segmented} class="rtx-vp-seg" labelledby="rtx-view-w" options=${seg(WIDTHS, 'w')} value=${s.width} onChange=${(w: string) => view.set({ width: w }, { animate: true })} />
      <input class="rtx-vp-range" type="range" min=${SLIDER.min} max=${SLIDER.max} step=${SLIDER.step} aria-label="Column width in pixels"
        value=${String(Math.round(m.columnPx))} onInput=${(e: Event) => view.set({ width: 'custom', widthPx: Number((e.currentTarget as Input).value) })} />
      <p class="rtx-vp-note" hidden=${!wNote}>${wNote}</p>
    </div>`;
} });

registerSetting({ id: 'view-size', where: 'view', order: 20, Control: ({ view, mod, alt }: ViewCtx) => html`<div class="rtx-vp-row">
    <${Caption}>Text size<//>
    <div class="rtx-vp-zoom" role="group" aria-label="Text size">
      <${IconButton} icon="minus" label="Smaller text" title=${`Smaller (${mod}${alt}−)`} data-z="-1" onClick=${() => view.zoomBy(-1)} />
      <button type="button" class="ui-btn ui-btn--ghost" data-z="0" title=${`Reset (${mod}${alt}0)`} aria-label="Reset text size" onClick=${() => view.zoomBy(0)}>${Math.round(view.settings.zoom * 100)} %</button>
      <${IconButton} icon="plus" label="Larger text" title=${`Larger (${mod}${alt}=)`} data-z="1" onClick=${() => view.zoomBy(1)} />
    </div>
  </div>` });

registerSetting({ id: 'view-theme', where: 'view', order: 30, Control: ({ view }: ViewCtx) => html`<div class="rtx-vp-row">
    <${Caption}>Colours<//>
    <div class="rtx-vp-themes" role="radiogroup" aria-label="Colour scheme">
      ${THEMES.map((t) => html`<button type="button" role="radio" data-t=${t.name} aria-checked=${String(t.name === view.settings.theme)} onClick=${() => view.set({ theme: t.name })}>
        <span class="rtx-vp-sw" data-t=${t.name} aria-hidden="true">Aa</span><span>${t.label}</span></button>`)}
    </div>
  </div>` });

registerSetting({ id: 'view-ragged', where: 'view', order: 40, advanced: { label: 'Ragged right', where: 'View' }, Control: ({ view }: ViewCtx) => html`<div class="rtx-vp-row">
    <${Caption} id="rtx-view-a">Lines<//>
    <${Segmented} class="rtx-vp-seg" labelledby="rtx-view-a" options=${seg([{ name: 'justify', label: 'Justified' }, { name: 'left', label: 'Ragged right' }], 'a')} value=${view.settings.align} onChange=${(a: string) => view.set({ align: a })} />
  </div>` });

registerSetting({ id: 'view-edit-layout', where: 'view', order: 50, shown: () => !!layoutsDebug(), Control: ({ view }: ViewCtx) => {
  const d = view.editDecision();
  const eNote = view.settings.editLayout === 'side' && d.mode === 'stacked' ? 'Stacked for now: the window is too narrow for both side by side.' : '';
  return html`<div class="rtx-vp-row">
      <${Caption} id="rtx-view-e">While editing a block<//>
      <${Segmented} class="rtx-vp-seg" labelledby="rtx-view-e" options=${seg(EDIT_LAYOUTS, 'e')} value=${view.settings.editLayout} onChange=${(l: string) => view.set({ editLayout: l })} />
      <p class="rtx-vp-note" hidden=${!eNote}>${eNote}</p>
    </div>`;
} });

registerSetting({ id: 'view-chips', where: 'view-switch', order: 10, advanced: { label: 'Note chips on or off', where: 'View' }, Control: ({ view }: ViewCtx) => {
  const notes = view.notes;
  return html`<label title="The chips of \\todo notes and note comments" hidden=${!notes}>
    <input type="checkbox" checked=${!!notes && !notes.settings().hidden} onChange=${(e: Event) => view.setNotes((e.currentTarget as Input).checked)} /><span>Note chips</span></label>`;
} });

registerSetting({ id: 'view-handles', where: 'view-switch', order: 20, advanced: { label: 'Block handles on or off', where: 'View' }, Control: ({ view }: ViewCtx) => html`<label title="The + and drag handle beside each block">
    <input type="checkbox" checked=${view.settings.handles} onChange=${(e: Event) => view.set({ handles: (e.currentTarget as Input).checked })} /><span>Block handles</span></label>` });

export function Panel({ view, mod, alt }: ViewCtx) {
  const ctx: ViewCtx = { view, mod, alt };
  return html`
    ${visibleAt('view', ctx).map((s) => html`<${s.Control} key=${s.id} ...${ctx} />`)}
    <div class="rtx-vp-row"><div class="rtx-vp-toggles">
      <label title=${`Shows: ${advancedFeatures.peek().map((f: { label: string }) => f.label).join(', ')}`}>
        <input type="checkbox" id="rtx-vp-advanced" checked=${advanced.peek()} onChange=${(e: Event) => setAdvanced((e.currentTarget as Input).checked)} /><span>Show advanced features</span></label>
      ${visibleAt('view-switch', ctx).map((s) => html`<${s.Control} key=${s.id} ...${ctx} />`)}
    </div></div>
    <div class="rtx-vp-keys">${`Text size ${mod}${alt}=  ${mod}${alt}−  ${mod}${alt}0 · this panel ${mod}${alt}V`}</div>`;
}

type Anchor = { current: HTMLElement | null };

// drawn synchronously by render() on open, close and sync(): the focus can go to the chosen option at once
function Root({ view, mod, alt, isOpen, anchor }: ViewCtx & { isOpen: boolean; anchor: Anchor }) {
  const ref = useRef<HTMLDivElement>(null);
  // placed before the first paint, under its button, right-aligned, kept on that side (the kit's place)
  useLayoutEffect(() => { if (isOpen && anchor.current && ref.current) place(ref.current, anchor.current, { placement: 'bottom-end', keep: true }); });
  return html`<div ref=${ref} class="rtx-vp ui-popover" id="rtx-view-pop" role="dialog" aria-label="View options" hidden=${!isOpen}>
    ${isOpen ? html`<${Panel} view=${view} mod=${mod} alt=${alt} />` : null}</div>`;
}

export function createPopover(view: PopoverView, { mod, alt }: { mod: string; alt: string }) {
  installPopoverStyle();
  let isOpen = false;
  let layer: { remove(): void } | null = null;
  const anchor: Anchor = { current: null };
  const host = document.createElement('div');
  host.style.display = 'contents';
  document.body.append(host);
  const draw = () => render(html`<${Root} view=${view} mod=${mod} alt=${alt} isOpen=${isOpen} anchor=${anchor} />`, host);
  draw();
  const pop = host.firstElementChild as HTMLElement;

  // measure() even while closed, as the plain-DOM popover did on every sync: it reads \textwidth from the viewer
  // and remembers it (view/textwidth.js), and the paper column and the outline landing depend on that timing
  const sync = () => { if (isOpen) draw(); else view.measure(); };
  function show(at?: HTMLElement | null) {
    anchor.current = at ?? anchor.current;
    isOpen = true;
    draw();
    layer?.remove();
    layer = pushLayer({ el: pop, kind: 'popover', anchor: anchor.current, toggle: true, returnFocus: anchor.current,
      onDismiss: (reason: string) => close({ focus: reason === 'escape' }) });
    anchor.current?.setAttribute('aria-expanded', 'true');
    (pop.querySelector<HTMLElement>('[aria-checked="true"]') ?? pop.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }
  function close({ focus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    layer?.remove(); layer = null;
    draw();
    anchor.current?.setAttribute('aria-expanded', 'false');
    if (focus) anchor.current?.focus();
  }
  addEventListener('resize', () => { if (isOpen) sync(); });
  return { el: pop, open: show, close, toggle: (at?: HTMLElement | null) => (isOpen ? close({ focus: true }) : show(at)), sync, get isOpen() { return isOpen; } };
}
