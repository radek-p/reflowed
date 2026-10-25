// The menus' entries and their keyboard, as data and pure functions (chrome/menu.ts draws them; Node runs the tests).
//
//   item(label, key, fn, { disabled, shortcut, icon, checked, hint, actions })
//                          a command entry (what nesting/ and notes/ contribute too; commands/registry.js menuItem makes
//                          the same shape); actions: buttons at the row's right, each doing something else with what the
//                          row names (Export › PDF: open in a new tab, download), as the workbench's section menu has
//                          them (new tab, pin)
//   submenu(label, key, items, { icon, disabled })                       an entry that opens a menu of its own
//   SEP                                                                  a separator
//   inactive(entry)        disabled, or a submenu none of whose entries can be chosen (it is drawn disabled)
//   step(entries, from, dir) -> index    the next entry that can be focused (dir 1 / -1, wrapping; from -1: the first)
//   edge(entries, last) -> index         the first (last: false) or the last one
//   typeAhead(entries, from, ch) -> index  the next one after `from` whose label starts with `ch` (wrapping), else -1
//   across(entry, at, dir) -> place | null  ← → within a row: -1 the row itself, k its action k (one that can be
//                                            chosen); null: no move (→ past the last action, ← on the row itself)
//   leads(entries)          whether the menu keeps a leading slot on every row (one of them has an icon or a check)
import type { IconName } from '../design/ui/icon-set.ts';

export interface MenuCommand {
  label: string;
  /** its data-action (tests and CSS find it by this) */
  key: string;
  fn?: () => void;
  disabled?: boolean;
  /** the key that does the same, as people read it (⌘F) */
  shortcut?: string;
  icon?: IconName;
  /** a toggle: checked or not (role menuitemcheckbox); absent: a plain command */
  checked?: boolean;
  /** a second line under the label */
  hint?: string;
  /** a submenu: chosen, it opens these entries */
  items?: readonly MenuEntry[];
  /** buttons at the row's right (not with a submenu) */
  actions?: readonly MenuAction[];
}
/** a row's secondary action: an icon button; its label is what it does to what the row names ("Download") */
export interface MenuAction {
  label: string;
  /** its data-act */
  key: string;
  icon: IconName;
  fn?: () => void;
  disabled?: boolean;
}
export interface MenuSeparator { sep: true }
export type MenuEntry = MenuCommand | MenuSeparator;

export const SEP: MenuSeparator = { sep: true };
export const isSep = (e: MenuEntry | undefined): e is MenuSeparator => !!e && 'sep' in e;

export function item(label: string, key: string, fn: () => void, { disabled = false, shortcut = '', icon, checked, hint, actions }: { disabled?: boolean; shortcut?: string; icon?: IconName; checked?: boolean; hint?: string; actions?: readonly MenuAction[] } = {}): MenuCommand {
  return { label, key, fn, disabled, shortcut, ...(icon ? { icon } : {}), ...(checked != null ? { checked } : {}), ...(hint ? { hint } : {}), ...(actions?.length ? { actions } : {}) };
}
export function submenu(label: string, key: string, items: readonly MenuEntry[], { icon, disabled = false }: { icon?: IconName; disabled?: boolean } = {}): MenuCommand {
  return { label, key, items, disabled, ...(icon ? { icon } : {}) };
}

/** disabled itself, or a submenu with nothing in it that can be chosen */
export function inactive(e: MenuEntry): boolean {
  if (isSep(e)) return true;
  if (e.disabled) return true;
  return !!e.items && e.items.every(inactive);
}

/** the next entry that can be focused from `from` in direction `dir`, wrapping; -1 when none can */
export function step(entries: readonly MenuEntry[], from: number, dir: 1 | -1): number {
  const n = entries.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (!inactive(entries[i]!)) return i;
  }
  return -1;
}
export const edge = (entries: readonly MenuEntry[], last: boolean): number => step(entries, last ? 0 : -1, last ? -1 : 1);

export function typeAhead(entries: readonly MenuEntry[], from: number, ch: string): number {
  const q = ch.toLowerCase(), n = entries.length;
  if (!q.trim()) return -1;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n, e = entries[i]!;
    if (!inactive(e) && !isSep(e) && e.label.trim().toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

/** ← → within a row (see the header); a disabled row's actions are disabled with it */
export function across(e: MenuEntry | undefined, at: number, dir: 1 | -1): number | null {
  if (!e || isSep(e) || e.disabled || !e.actions) return null;
  const ok = (k: number) => !e.actions![k]!.disabled;
  if (dir === 1) { for (let k = at + 1; k < e.actions.length; k++) if (ok(k)) return k; return null; }
  for (let k = at - 1; k >= 0; k--) if (ok(k)) return k;
  return at >= 0 ? -1 : null;
}

export const leads = (entries: readonly MenuEntry[]): boolean => entries.some((e) => !isSep(e) && (!!e.icon || e.checked != null));
