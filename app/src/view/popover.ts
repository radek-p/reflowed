// the View popover, opened from the top bar ("Aa", ⌥⌘V / Ctrl+Alt+V): what a reader changes while reading, the column
// width, the text (its size, its line ends: justified or ragged right) and the colours. Every control applies at once;
// the rest of the preferences are the Settings panel's (settings/panel.ts; the key line names its key).
// On Preact and the design kit, behaviour kept: one element #rtx-view-pop that stays in the
// page (hidden when closed), the kit's Segmented controls (role radio, aria-checked, the data-w/-a/-e hooks), kit
// icon buttons for the text size; placed by the kit's place() under its button, right-aligned; Esc (focus back to
// the button) and a press outside close it: the kit's one overlay layer, while it is open.
//   createPopover(view) -> { el, open(anchor), close({ focus }), toggle(anchor), sync(), isOpen }
//   Panel({ view })  the panel's content (the gallery draws it in place: app/src/gallery/live.ts)
// The rows are registrations (settings/registry.ts, where 'view'; their context is a ViewCtx): the Settings panel draws
// the same rows in its Reading section, each with its one-line explanation (ctx.detail). The View options' own rows that
// only the Settings panel draws (where 'editing': block handles, the edit layout) are registered here too.
// Keys are written as the workbench writes its own (workbench/src/keys.ts shortcutLabel: ⌥⌘V, Ctrl+Alt+V).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { html, render, Segmented, IconButton, place } from '../design/ui/index.js';
import { pushLayer } from '../design/ui/layers.js';
import { WIDTHS, SLIDER, THEMES, EDIT_LAYOUTS, layoutsDebug } from './settings.js';
import { installPopoverStyle } from './popover-style.js';
import { registerSetting, visibleAt } from '../settings/registry.ts';
import { SwitchRow } from '../settings/rows.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';

/** what the panel reads and sets of the page's view (view/index.js) */
export interface ViewSettings { width: string; widthPx: number; zoom: number; theme: string; align: string; handles: boolean; editLayout: string }
export interface PopoverView {
  settings: ViewSettings;
  set(patch: Partial<ViewSettings>, o?: { animate?: boolean }): void;
  zoomBy(dir: number): void;
  measure(): { columnPx: number; measurePt: number; textwidthPt?: number | null; fitted?: boolean; limited?: boolean };
  editDecision(): { mode: string };
}
/** a View option's context (registerSetting's ctx for 'view' and 'editing'); detail: the Settings panel draws each
 *  row's one-line explanation */
export interface ViewCtx { view: PopoverView; detail?: boolean }
type Choice = { name: string; label: string; hint?: string };
type Input = HTMLInputElement;

// (Signals are read with peek(): a component that reads a signal is not drawn again by render() with the same props,
// and this panel is drawn by sync().)
const seg = (items: readonly Choice[], attr: string) => items.map((it) => ({ value: it.name, label: it.label, attrs: { [`data-${attr}`]: it.name, title: it.hint ?? undefined } }));
const k = (key: string) => shortcutLabel(`mod+alt+${key}`);

/** a row's caption; `out`: a reading at its right; `hint`: its one-line explanation (drawn with ctx.detail) */
export function Caption({ id, children, out, hint }: { id?: string; children?: ComponentChildren; out?: unknown; hint?: string | null }) {
  return html`<p class="rtx-vp-cap"><span id=${id}>${children}</span>${out ?? null}</p>${hint ? html`<p class="rtx-vp-hint">${hint}</p>` : null}`;
}

registerSetting({ id: 'view-width', where: 'view', order: 10, Control: ({ view, detail }: ViewCtx) => {
  const s = view.settings, m = view.measure();
  const wNote = s.width === 'paper'
    ? (m.textwidthPt ? `\\textwidth = ${m.textwidthPt.toFixed(2)} pt: the PDF’s line breaks${m.fitted ? '; fitted: the window is narrower, lines are broken to fit it' : ''}` : 'the document’s \\textwidth, once a block is typeset')
    : m.limited ? 'narrower than chosen: the window is' : '';
  return html`<div class="rtx-vp-row" data-setting="view-width">
      <${Caption} id="rtx-view-w" hint=${detail ? 'The column the text is set in. Paper: the document’s own width, so its lines break as in the PDF.' : null}
        out=${html`<output aria-live="polite">${m.columnPx ? `${Math.round(m.columnPx)} px · ${m.measurePt.toFixed(m.measurePt % 1 ? 1 : 0)} pt` : ''}</output>`}>Column width<//>
      <${Segmented} class="rtx-vp-seg" labelledby="rtx-view-w" options=${seg(WIDTHS, 'w')} value=${s.width} onChange=${(w: string) => view.set({ width: w }, { animate: true })} />
      <input class="rtx-vp-range" type="range" min=${SLIDER.min} max=${SLIDER.max} step=${SLIDER.step} aria-label="Column width in pixels"
        value=${String(Math.round(m.columnPx))} onInput=${(e: Event) => view.set({ width: 'custom', widthPx: Number((e.currentTarget as Input).value) })} />
      <p class="rtx-vp-note" hidden=${!wNote}>${wNote}</p>
    </div>`;
} });

registerSetting({ id: 'view-text', where: 'view', order: 20, Control: ({ view, detail }: ViewCtx) => html`<div class="rtx-vp-row" data-setting="view-text">
    <${Caption} id="rtx-view-text" hint=${detail ? `Its size, and how its lines end: justified, or ragged right (even spaces).` : null}>Text<//>
    <div class="rtx-vp-zoom" role="group" aria-label="Text size">
      <${IconButton} icon="minus" label="Smaller text" title=${`Smaller (${k('−')})`} data-z="-1" onClick=${() => view.zoomBy(-1)} />
      <button type="button" class="ui-btn ui-btn--ghost" data-z="0" title=${`Reset (${k('0')})`} aria-label="Reset text size" onClick=${() => view.zoomBy(0)}>${Math.round(view.settings.zoom * 100)} %</button>
      <${IconButton} icon="plus" label="Larger text" title=${`Larger (${k('=')})`} data-z="1" onClick=${() => view.zoomBy(1)} />
    </div>
    <${Segmented} class="rtx-vp-seg rtx-vp-align" label="Line ends" options=${seg([{ name: 'justify', label: 'Justified' }, { name: 'left', label: 'Ragged right' }], 'a')} value=${view.settings.align} onChange=${(a: string) => view.set({ align: a })} />
  </div>` });

registerSetting({ id: 'view-theme', where: 'view', order: 30, Control: ({ view, detail }: ViewCtx) => html`<div class="rtx-vp-row" data-setting="view-theme">
    <${Caption} hint=${detail ? 'System follows the device’s light or dark appearance.' : null}>Colours<//>
    <div class="rtx-vp-themes" role="radiogroup" aria-label="Colour scheme">
      ${THEMES.map((t) => html`<button type="button" role="radio" data-t=${t.name} aria-checked=${String(t.name === view.settings.theme)} onClick=${() => view.set({ theme: t.name })}>
        <span class="rtx-vp-sw" data-t=${t.name} aria-hidden="true">Aa</span><span>${t.label}</span></button>`)}
    </div>
  </div>` });

registerSetting({ id: 'view-handles', where: 'editing', order: 10, Control: ({ view }: ViewCtx) => html`<${SwitchRow} id="set-handles" label="Block handles"
    hint="The + and the drag handle beside each block, on hover." checked=${view.settings.handles} onChange=${(on: boolean) => view.set({ handles: on })} />` });

registerSetting({ id: 'view-edit-layout', where: 'editing', order: 20, shown: () => !!layoutsDebug(), Control: ({ view }: ViewCtx) => {
  const d = view.editDecision();
  const eNote = view.settings.editLayout === 'side' && d.mode === 'stacked' ? 'Stacked for now: the window is too narrow for both side by side.' : '';
  return html`<div class="rtx-vp-row" data-setting="view-edit-layout">
      <${Caption} id="rtx-view-e" hint="Where a block’s source goes while it is edited (a developer’s option).">While editing a block<//>
      <${Segmented} class="rtx-vp-seg" labelledby="rtx-view-e" options=${seg(EDIT_LAYOUTS, 'e')} value=${view.settings.editLayout} onChange=${(l: string) => view.set({ editLayout: l })} />
      <p class="rtx-vp-note" hidden=${!eNote}>${eNote}</p>
    </div>`;
} });

export function Panel({ view }: ViewCtx) {
  const ctx: ViewCtx = { view };
  return html`
    ${visibleAt('view', ctx).map((s) => html`<${s.Control} key=${s.id} ...${ctx} />`)}
    <div class="rtx-vp-keys">${`Text size ${k('=')}  ${k('−')}  ${k('0')} · this panel ${k('v')} · all settings ${shortcutLabel('mod+,')}`}</div>`;
}

type Anchor = { current: HTMLElement | null };

// drawn synchronously by render() on open, close and sync(): the focus can go to the chosen option at once
function Root({ view, isOpen, anchor }: ViewCtx & { isOpen: boolean; anchor: Anchor }) {
  const ref = useRef<HTMLDivElement>(null);
  // placed before the first paint, under its button, right-aligned, kept on that side (the kit's place)
  useLayoutEffect(() => { if (isOpen && anchor.current && ref.current) place(ref.current, anchor.current, { placement: 'bottom-end', keep: true }); });
  return html`<div ref=${ref} class="rtx-vp ui-popover" id="rtx-view-pop" role="dialog" aria-label="View options" hidden=${!isOpen}>
    ${isOpen ? html`<${Panel} view=${view} />` : null}</div>`;
}

export function createPopover(view: PopoverView) {
  installPopoverStyle();
  let isOpen = false;
  let layer: { remove(): void } | null = null;
  const anchor: Anchor = { current: null };
  const host = document.createElement('div');
  host.style.display = 'contents';
  document.body.append(host);
  const draw = () => render(html`<${Root} view=${view} isOpen=${isOpen} anchor=${anchor} />`, host);
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
