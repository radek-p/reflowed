// The Settings panel's rows (settings/panel.ts), for the registrations that draw into it (settings/registry.ts): one
// look for every setting, its label, its one-line explanation, its control.
//
//   <${SwitchRow} id label hint checked onChange disabled? />   a switch (role switch): the whole row toggles it
//   <${Row} id label hint for? wide?>control<//>                 any control on its label's line (below it when it does
//                                                                not fit; wide: always below, the row's width)
// Classes: .rtx-set-row(.rtx-set-switch, .rtx-set-row--wide)[data-setting], .rtx-set-text, .rtx-set-label, .rtx-set-hint,
// .rtx-set-control (their CSS: settings/panel.ts).
import type { ComponentChildren } from 'preact';
import { html } from '../design/ui/core.js';

export function SwitchRow({ id, label, hint, checked, onChange, disabled = false }: { id: string; label: string; hint?: ComponentChildren; checked: boolean; onChange(on: boolean): void; disabled?: boolean }) {
  return html`<label class="rtx-set-row rtx-set-switch" data-setting=${id}>
    <span class="rtx-set-text"><span class="rtx-set-label">${label}</span>${hint ? html`<span class="rtx-set-hint" id=${`${id}-hint`}>${hint}</span>` : null}</span>
    <input type="checkbox" role="switch" id=${id} checked=${checked} disabled=${disabled} aria-describedby=${hint ? `${id}-hint` : undefined}
      onChange=${(e: Event) => onChange((e.currentTarget as HTMLInputElement).checked)} />
  </label>`;
}

export function Row({ id, label, hint, for: forId, wide = false, children }: { id: string; label: string; hint?: ComponentChildren; for?: string; wide?: boolean; children?: ComponentChildren }) {
  return html`<div class=${wide ? 'rtx-set-row rtx-set-row--wide' : 'rtx-set-row'} data-setting=${id}>
    <span class="rtx-set-text">${forId ? html`<label class="rtx-set-label" for=${forId}>${label}</label>` : html`<span class="rtx-set-label">${label}</span>`}${hint ? html`<span class="rtx-set-hint">${hint}</span>` : null}</span>
    <div class="rtx-set-control">${children}</div>
  </div>`;
}
