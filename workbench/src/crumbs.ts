// The breadcrumbs bar at the top of a document tab: the items come from the host (a view type's
// crumbs(tab, ctx)). The home crumb is its icon when the bar is narrow (a container query), with its
// label as the accessible name and tooltip either way.
import type { ComponentChildren } from 'preact';
import { html } from './html.ts';
import { Icon, type IconName } from './kit/icons.ts';
import { Button, IconButton } from './kit/index.ts';

/**
 * items: [{ id?, label, icon?, home?, menu?, onSelect?(e), title? }]; the last one is the current page. A crumb with
 * `menu` (its siblings: the other sections) opens it, the last one too, and shows a chevron.
 * `class`: where the bar is (the panel row, the strip, the fallback row).
 */
/** A crumb: the host's (a view type's crumbs(tab, ctx)). The 'doc' crumb with a menu is the document switcher. */
export type Crumb = { id?: string; label: string; icon?: IconName; home?: boolean; menu?: boolean; title?: string;
  onSelect?(e: { currentTarget: Element; anchor?: Element; returnFocus?: Element | null }): void; action?: { label: string; icon?: IconName; onSelect?(e: MouseEvent): void } };
export function Crumbs({ items, label = 'Breadcrumbs', class: cls = '', before = null, after = null, homeIsLink = false, field = null }: {
  items: readonly Crumb[]; label?: string; class?: string; before?: ComponentChildren; after?: ComponentChildren; homeIsLink?: boolean; field?: ComponentChildren }) {
  return html`<div class=${`wb-crumbs ${cls}`}>${before}<nav class="wb-crumbs-nav" aria-label=${label}><ol>
    ${items.map((c, i) => {
      // the home crumb is never the current page: it opens (or brings forward) the document list
      const last = i === items.length - 1 && !(homeIsLink && c.home);
      const icon = c.icon ?? (c.home ? 'home' : null);
      return html`<li key=${c.id ?? i}>
        ${i > 0 ? html`<span class="wb-crumb-sep" aria-hidden="true"><${Icon} name="chevronRight" /></span>` : null}
        <${Button} class=${`wb-crumb${c.home ? ' wb-crumb--home' : ''}`} square=${!!(c.home && homeIsLink)} aria-current=${last ? 'page' : undefined} icon=${icon}
          aria-label=${c.home ? c.label : undefined} tip=${c.title ?? c.label} data-crumb=${c.id ?? i} data-action=${c.home ? 'home' : undefined}
          aria-haspopup=${c.menu ? 'menu' : undefined} data-menu=${c.menu ? '' : undefined}
          onClick=${(e: MouseEvent) => (!last || c.menu) && c.onSelect?.(e as MouseEvent & { currentTarget: Element })}><span class="wb-crumb-label">${c.label}</span><//>${field && c.id === 'doc' ? field : null}${c.action ? html`<${IconButton} class="wb-crumb-action" label=${c.action.label} data-crumb-action=${c.id ?? i}
          icon=${c.action.icon ?? 'pencil'} onClick=${(e: MouseEvent) => c.action!.onSelect?.(e)} />` : null}</li>`;
    })}
  </ol></nav>${after}</div>`;
}
