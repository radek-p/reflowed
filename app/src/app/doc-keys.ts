// A document editor's page keys (out of app.js's keydown switch): one ordered table of
// rows, each a key, its modifiers, where it applies and the command it calls (commands/editor.js). The first row that
// matches wins; a row's place in the table is its precedence. A key not in the table goes on (no preventDefault).
//
//   const keys = createDocKeys(host)
//     keys.handle(event) -> the row that took it, or null
//   KEY_ROWS                     the table (tests, the shortcuts dialog later)
//
// A row: { id (unique, for tests), key: one key or several (KeyboardEvent.key; a letter also by its code, so ⌘F works
// on any layout), mod / shift / alt: true (must be held), false (must not), absent (either), inField: also in a field
// (a text field, or a widget that takes its own keys: a menu, a listbox, a dialog) or with a menu of the editor open,
// when(c): only then, run(c, e) -> false when it did nothing, prevent: 'always' (default) or 'handled' (only when run
// did something: undo, redo) }.

export interface KeyHost {
  /** the keys apply now: a document is open, this editor is the current one, the key is its own, its view is shown */
  takes(e: KeyboardEvent): boolean;
  /** a menu of this editor is open */
  menuOpen(): boolean;
  /** the focused pane's keyboard-selected block, its index */
  selected(): string | null;
  indexOf(id: string): number;
  blocks(): { id: string }[];
  focusedPane(): string;
  focusMode(): boolean;
  /** the selection cleared (Escape) */
  clearSelection(): void;
  select(id: string): void;
  command(id: string, input?: object): unknown;
}
export interface KeyContext { host: KeyHost; selected: string | null; index: number }
export interface KeyRow {
  id: string;
  key: string | string[];
  mod?: boolean; shift?: boolean; alt?: boolean;
  inField?: boolean;
  when?(c: KeyContext): boolean;
  run(c: KeyContext, e: KeyboardEvent): unknown;
  prevent?: 'always' | 'handled';
}

const sel = (c: KeyContext) => !!c.selected;
export const KEY_ROWS: readonly KeyRow[] = [
  // in a field or with a menu open too
  { id: 'find', key: 'f', mod: true, shift: false, alt: false, inField: true, run: (c) => c.host.command('find.open') },
  { id: 'focus-mode', key: 'f', mod: true, shift: true, inField: true, run: (c) => c.host.command('view.focusMode') },
  { id: 'sidebar', key: '\\', mod: true, inField: true, run: (c) => c.host.command('view.sidebar') },
  // the page's own (not in a field, no menu open)
  { id: 'undo', key: 'z', mod: true, shift: false, prevent: 'handled', run: (c) => c.host.command('doc.undo') },
  { id: 'redo', key: 'y', mod: true, prevent: 'handled', run: (c) => c.host.command('doc.redo') },
  { id: 'redo-shift', key: 'z', mod: true, shift: true, prevent: 'handled', run: (c) => c.host.command('doc.redo') },
  { id: 'leave-focus', key: 'Escape', when: (c) => c.host.focusMode(), run: (c) => c.host.command('view.focusMode', { on: false }) },
  { id: 'unselect', key: 'Escape', when: sel, run: (c) => c.host.clearSelection() },
  { id: 'down', key: ['ArrowDown', 'j'], mod: false, alt: false, run: (c) => c.host.command('select.down', { from: c.index }) },
  { id: 'up', key: ['ArrowUp', 'k'], mod: false, alt: false, run: (c) => c.host.command('select.up', { from: c.index }) },
  { id: 'first', key: 'Home', when: sel, run: (c) => c.host.command('select.first') },
  { id: 'last', key: 'End', when: sel, run: (c) => c.host.command('select.last') },
  { id: 'edit', key: 'Enter', when: sel, run: (c) => c.host.command('block.edit', { id: c.selected, pane: c.host.focusedPane() }) },
  { id: 'move-up', key: 'ArrowUp', alt: true, when: sel, run: (c) => { c.host.command('block.moveUp', { id: c.selected }); c.host.select(c.selected!); } },
  { id: 'move-down', key: 'ArrowDown', alt: true, when: sel, run: (c) => { c.host.command('block.moveDown', { id: c.selected }); c.host.select(c.selected!); } },
  { id: 'delete', key: ['Backspace', 'Delete'], when: sel, run: (c) => {
    const list = c.host.blocks(), next = list[c.index + 1] ?? list[c.index - 1];
    c.host.command('block.delete', { id: c.selected });
    if (next) c.host.select(next.id);
  } },
  { id: 'duplicate', key: 'd', mod: true, when: sel, run: (c) => c.host.command('block.duplicate', { id: c.selected }) },
  { id: 'kinds', key: '/', when: sel, run: (c) => c.host.command('block.kinds', { id: c.selected, pane: c.host.focusedPane() }) },
  { id: 'shortcuts', key: '?', run: (c) => c.host.command('view.shortcuts') },
];

const FIELD = 'input, textarea, select, .cm-editor, [contenteditable="true"], [role="menu"], [role="listbox"], [role="dialog"], dialog';   // a key typed there is the field's
/** does the event press this row's key with its modifiers? */
export function matches(row: KeyRow, e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (row.mod !== undefined && row.mod !== mod) return false;
  if (row.shift !== undefined && row.shift !== e.shiftKey) return false;
  if (row.alt !== undefined && row.alt !== e.altKey) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return (Array.isArray(row.key) ? row.key : [row.key]).some((k) => key === k || (/^[a-z]$/.test(k) && e.code === `Key${k.toUpperCase()}`));
}

export function createDocKeys(host: KeyHost, rows: readonly KeyRow[] = KEY_ROWS) {
  return {
    handle(e: KeyboardEvent): KeyRow | null {
      if (!host.takes(e)) return null;
      const inField = !!(e.target as Element | null)?.closest?.(FIELD) || host.menuOpen();
      const selected = host.selected();
      const c: KeyContext = { host, selected, index: selected ? host.indexOf(selected) : -1 };
      for (const row of rows) {
        if (inField && !row.inField) continue;
        if (!matches(row, e) || (row.when && !row.when(c))) continue;
        const r = row.run(c, e);
        if ((row.prevent ?? 'always') === 'always' || r) e.preventDefault();
        return row;
      }
      return null;
    },
  };
}
