// The buttons: ONE metric for all (the pill's radius --wb-r, the padding --wb-pad / --wb-pad-x, a height per bar
// --wb-btn-h, the same inset on every side of a bar), one hover, press, focus ring and pressed look. The editor's
// kit names: Button, IconButton; Toggle (a pressed state), Switch (role="switch").
import type { ComponentChildren, JSX, Ref } from 'preact';
import { html } from '../html.ts';
import { Icon, type IconName } from './icons.ts';
import { cx } from './popover.ts';

/** The button's classes, for an element that is not a button but takes its metrics (a side column's panel tab). */
export const btnClass = ({ square = false }: { square?: boolean } = {}): string => (square ? 'wb-btn wb-btn--icon' : 'wb-btn');
/** A text button (optionally an icon before the label). `tip`: the tooltip and, for an icon button, the name;
 *  `square`: an icon button's box (a crumb that shows only its icon). */
type ButtonAttrs = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'label' | 'icon' | 'onChange'> & { [data: `data-${string}`]: string | undefined };
export type ButtonProps = ButtonAttrs & { label?: ComponentChildren; icon?: IconName | null; class?: string; children?: ComponentChildren; tip?: string; square?: boolean };
export type IconButtonProps = ButtonAttrs & { icon?: IconName | null; label: string; tip?: string; class?: string; children?: ComponentChildren };
export function Button({ label, icon, class: c = '', children, tip, square = false, ...rest }: ButtonProps) {
  return html`<button type="button" class=${cx(btnClass({ square }), c)} title=${tip} ...${rest}>${icon ? html`<${Icon} name=${icon} />` : null}${label != null ? html`<span class="wb-btn-label">${label}</span>` : null}${children}</button>`;
}
/** An icon button: square; `label` is its accessible name (and its tooltip unless `tip` says otherwise). */
export function IconButton({ icon, label, tip, class: c = '', children, ...rest }: IconButtonProps) {
  return html`<button type="button" class=${cx('wb-btn wb-btn--icon', c)} aria-label=${label} title=${tip ?? label} ...${rest}>${icon ? html`<${Icon} name=${icon} />` : null}${children}</button>`;
}
/** A toggle button: aria-pressed. */
export function Toggle({ pressed, icon, label, tip, class: c = '', onChange, ...rest }: ButtonAttrs & { pressed: boolean; icon?: IconName; label?: string; tip?: string; class?: string; onChange?: (on: boolean, e: Event) => void }) {
  const B = icon && label == null ? IconButton : Button;
  return html`<${B} icon=${icon} label=${label} tip=${tip} class=${cx('wb-toggle', c)} aria-pressed=${pressed ? 'true' : 'false'} onClick=${(e: Event) => onChange?.(!pressed, e)} ...${rest} />`;
}
/** A switch (on/off): role="switch", aria-checked; the track on the button's metrics. */
export function Switch({ checked, label, class: c = '', onChange, ...rest }: ButtonAttrs & { checked: boolean; label?: string; class?: string; onChange?: (on: boolean, e: Event) => void }) {
  return html`<button type="button" role="switch" aria-checked=${checked ? 'true' : 'false'} class=${cx('wb-btn wb-switch', c)} onClick=${(e: Event) => onChange?.(!checked, e)} ...${rest}>
    <span class="wb-switch-track" aria-hidden="true"><span class="wb-switch-knob"></span></span>${label != null ? html`<span class="wb-btn-label">${label}</span>` : null}</button>`;
}
/** A text field (the editor's kit name): `inputRef` reaches the element. */
export function Input({ class: c = '', inputRef, ...rest }: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'ref'> & { class?: string; inputRef?: Ref<HTMLInputElement>; [data: `data-${string}`]: string | undefined }) {
  return html`<input ref=${inputRef} class=${cx('wb-input', c)} ...${rest} />`;
}
