// Button, IconButton, Input, Tabs, Segmented, Chip, Pill, Card, Banner.
import { html, cx, nextId } from './core.js';
import { Icon } from './icons.ts';
import { useRef } from 'preact/hooks';

const iconOf = (i) => (typeof i === 'string' ? html`<${Icon[i]} />` : i);

/** variant: secondary (default) | primary | ghost | danger; size: sm | md | lg; pill: the website's pill shape */
export function Button({ variant = 'secondary', size = 'md', pill = false, block = false, icon = null, class: c = '', children, type = 'button', ...rest }) {
  return html`<button type=${type} class=${cx('ui-btn', variant !== 'secondary' && `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`,
    pill && 'ui-btn--pill', block && 'ui-btn--block', c)} ...${rest}>${icon && iconOf(icon)}${children}</button>`;
}

/** A square button with one icon; `label` is required (aria-label and the tooltip). */
export function IconButton({ icon, label, size = 'md', quiet = false, pressed, class: c = '', title, children, ...rest }) {
  return html`<button type="button" class=${cx('ui-icon-btn', size !== 'md' && `ui-icon-btn--${size}`, quiet && 'ui-icon-btn--quiet', c)}
    aria-label=${label} title=${title ?? label} aria-pressed=${pressed == null ? undefined : String(!!pressed)} ...${rest}>${iconOf(icon)}${children}</button>`;
}

export function Input({ size = 'md', quiet = false, mono = false, icon = null, class: c = '', inputRef, ...rest }) {
  const input = html`<input ref=${inputRef} class=${cx('ui-input', size !== 'md' && `ui-input--${size}`, quiet && 'ui-input--quiet', mono && 'ui-input--mono', c)} ...${rest} />`;
  if (!icon) return input;
  return html`<span class="ui-field">${html`<span class="ui-field-icon">${iconOf(icon)}</span>`}${input}</span>`;
}

export function Select({ size = 'md', class: c = '', children, ...rest }) {
  return html`<select class=${cx('ui-input', size !== 'md' && `ui-input--${size}`, c)} ...${rest}>${children}</select>`;
}

/** items: [{ id, label, count?, tone? }]; value: the selected id; variant: 'seg' (default) | 'strip' */
export function Tabs({ items, value, onChange, variant = 'seg', fill = false, label, class: c = '', idPrefix }) {
  const ref = useRef(null);
  const pre = useRef(idPrefix ?? nextId('tab')).current;
  const key = (e) => {
    const k = items.findIndex((t) => t.id === value);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = items[(k + d + items.length) % items.length];
    onChange?.(n.id);
    ref.current?.querySelector(`[data-tab="${n.id}"]`)?.focus();
  };
  return html`<div ref=${ref} role="tablist" aria-label=${label} class=${cx('ui-tabs', variant === 'strip' && 'ui-tabs--strip', fill && 'ui-tabs--fill', c)} onKeyDown=${key}>
    ${items.map((t) => html`<button type="button" role="tab" id=${`${pre}-${t.id}`} data-tab=${t.id} class=${cx('ui-tab', t.class)}
      aria-selected=${String(t.id === value)} tabindex=${t.id === value ? 0 : -1} onClick=${() => onChange?.(t.id)} ...${t.attrs ?? {}}>
      ${t.label}${t.count ? html`<${Pill} tone=${t.tone}>${t.count}<//>` : null}</button>`)}
  </div>`;
}

/** One of a few values (a segmented control): options [{ value, label, attrs? }]; labelledby: an id instead of label */
export function Segmented({ options, value, onChange, label, labelledby, class: c = '' }) {
  return html`<div role="radiogroup" aria-label=${labelledby ? undefined : label} aria-labelledby=${labelledby} class=${cx('ui-seg', c)}>
    ${options.map((o) => html`<button type="button" role="radio" aria-checked=${String(o.value === value)} onClick=${() => onChange?.(o.value)} ...${o.attrs ?? {}}>${o.label}</button>`)}
  </div>`;
}

/** A toggle or filter chip; `dot` a colour for a leading dot. */
export function Chip({ selected, dot, count, class: c = '', children, ...rest }) {
  return html`<button type="button" class=${cx('ui-chip', c)} aria-pressed=${selected == null ? undefined : String(!!selected)} ...${rest}>
    ${dot ? html`<span class="ui-dot" style=${{ color: dot }}></span>` : null}${children}${count != null ? html`<${Pill}>${count}<//>` : null}</button>`;
}

/** A count or badge (not a control). tone: danger | accent | outline */
export function Pill({ tone, class: c = '', children, ...rest }) {
  return html`<span class=${cx('ui-pill', tone && `ui-pill--${tone}`, c)} ...${rest}>${children}</span>`;
}

/** The website's example frame: a hairline, 12 px radius; optional title row or tab strip. */
export function Card({ title, actions, tabs, class: c = '', bodyClass = '', children, ...rest }) {
  return html`<section class=${cx('ui-card', c)} ...${rest}>
    ${tabs ?? null}
    ${title || actions ? html`<div class="ui-card-head"><span class="ui-card-title">${title}</span>${actions}</div>` : null}
    <div class=${cx('ui-card-body', bodyClass)}>${children}</div>
  </section>`;
}

/** A line above the page (a notice with actions). */
export function Banner({ children, actions, class: c = '', ...rest }) {
  return html`<div role="status" class=${cx('ui-banner', c)} ...${rest}><span class="ui-banner-text">${children}</span>${actions ? html`<span class="ui-banner-actions">${actions}</span>` : null}</div>`;
}
