// What a tab shows, from its view type through its context (shared by the tab shells: tab/pill.ts, the strip's fit and
// keys): its label and icon, its section, its document switcher, its crumbs.
import type { Workbench } from '../workbench.ts';
import type { Tab } from '../model.ts';
import type { Crumb } from '../crumbs.ts';
import type { IconName } from '../kit/icons.ts';
import type { Subtitle, Switcher, ViewContext } from '../types.ts';

/** The active tab's header items from its view type (the host's crumbs), through the tab's host context. */
export const ctxOf = (wb: Workbench, t: Tab): ViewContext => wb.contextOf(t.id);
export function crumbsOf(wb: Workbench, t: Tab): Crumb[] | null { const type = wb.viewType(t.view), ctx = ctxOf(wb, t); return type?.crumbs && ctx ? type.crumbs(t, ctx) : null; }
/** The document switcher of a tab: its 'doc' crumb with a menu (the host's), or null. */
export function switcherOf(wb: Workbench, t: Tab | null): Switcher | null {
  if (!t) return null;
  const type = wb.viewType(t.view);
  return type?.switcher?.(t, ctxOf(wb, t)) ?? ((crumbsOf(wb, t) ?? []).find((c) => c.id === 'doc' && c.menu && c.onSelect) as Switcher | undefined) ?? null;
}
/** A tab's section (its second line, or after the "›"): { label, onSelect?, title? } from the view type. */
export function subtitleOf(wb: Workbench, t: Tab): Subtitle | null { const type = wb.viewType(t.view), ctx = ctxOf(wb, t); return type?.subtitle && ctx ? type.subtitle(t, ctx) : null; }
export function tabInfo(wb: Workbench, t: Tab): { label: string; icon: IconName } {
  const type = wb.viewType(t.view);
  const label = type ? (type.title?.(t.state ?? {}, t) ?? type.label ?? t.view) : `${t.view} (not available)`;
  const icon = type ? (typeof type.icon === 'function' ? type.icon(t.state ?? {}) : type.icon) ?? 'file' : 'missing';
  return { label, icon };
}