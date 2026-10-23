// The "Keyboard shortcuts" view: the whole keymap, generated from keys.ts (never kept by hand), grouped by area, in
// the platform's notation (⌘ ⌥ ⇧ on a Mac, words elsewhere), chords as their two keys, searchable. A normal view
// type (createWorkbench registers it as 'shortcuts'): it opens as a tab in any group.
import { html } from './html.ts';
import { useState, useMemo } from 'preact/hooks';
import { KEYMAP, AREAS, describe, keysOf, label, type KeyOverrides, type Platform } from './keys.ts';
import { Input } from './kit/index.ts';

/** The rows: one per keymap entry (an unbound one too, shown with a dash), in the areas' order. */
export type ShortcutRow = { id: string; area: string; name: string; keys: string[][]; note: string };
export function shortcutRows(platform: Platform, overrides: KeyOverrides = {}): ShortcutRow[] {
  return KEYMAP.map((e) => {
    const id = e.arg != null ? `${e.action}:${e.arg}` : e.action;
    const keys = id in overrides ? overrides[id] : e.action in overrides && e.arg == null ? overrides[e.action] : keysOf(e, platform);
    const list: readonly string[] = keys == null ? [] : typeof keys === 'string' ? [keys] : keys;
    return { id, area: AREAS[e.action] ?? 'Other', name: describe(e), keys: list.map((k) => k.split(/\s+/).map((part) => label(part, platform))), note: e.note ?? '' };
  });
}

export function ShortcutsView({ ctx }: { ctx: { wb: { platform: Platform; keymapOverrides?: KeyOverrides } } }) {
  const wb = ctx.wb;
  const [q, setQ] = useState('');
  const rows = useMemo(() => shortcutRows(wb.platform, wb.keymapOverrides ?? {}), [wb]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.area} ${r.name} ${r.keys.flat().join(' ')}`.toLowerCase().includes(needle)) : rows;
  const areas = [...new Set(rows.map((r) => r.area))];
  return html`<div class="wb-keys" data-shortcuts>
    <h1 class="wb-keys-title">Keyboard shortcuts</h1>
    <${Input} class="wb-keys-search" type="search" placeholder="Search" aria-label="Search the shortcuts" value=${q} onInput=${(e: Event) => setQ((e.currentTarget as HTMLInputElement).value)} />
    <p class="wb-keys-count" aria-live="polite">${shown.length === rows.length ? `${rows.length} shortcuts` : `${shown.length} of ${rows.length}`}</p>
    ${areas.map((a) => { const rs = shown.filter((r) => r.area === a); return rs.length ? html`<section class="wb-keys-area" data-area=${a}>
      <h2>${a}</h2>
      <table><tbody>${rs.map((r) => html`<tr data-shortcut=${r.id} title=${r.note}>
        <th scope="row">${r.name}</th>
        <td>${r.keys.length ? r.keys.map((k, i) => html`${i ? html`<span class="wb-keys-or"> or </span>` : null}${k.map((part, j) => html`${j ? html`<span class="wb-keys-then">then</span>` : null}<kbd>${part}</kbd>`)}`) : html`<span class="wb-keys-none">—</span>`}</td>
      </tr>`)}</tbody></table>
    </section>` : null; })}
  </div>`;
}

// its CSS: css.js (the keyboard shortcuts view)
