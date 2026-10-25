// The menus' model (chrome/menu-model.ts): the keyboard's moves over what can be chosen, type-ahead, a submenu with
// nothing to choose drawn disabled, the leading slot, ← → within a row with actions.
//   node app/src/chrome/menu-model.test.ts      (Node; exit 1 on a failure)
import { item, submenu, SEP, inactive, step, edge, typeAhead, across, leads, type MenuEntry } from './menu-model.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d !== '' ? ` — ${JSON.stringify(d)}` : ''}`); };
const f = () => {};

const list: MenuEntry[] = [
  item('Find and replace', 'find', f),         // 0
  SEP,                                         // 1
  item('Focus mode', 'focus', f, { disabled: true }),   // 2
  submenu('Export', 'export', [item('PDF', 'pdf', f)]),   // 3
  submenu('Document', 'document', [item('Versions…', 'versions', f, { disabled: true })]),   // 4: nothing to choose
  item('Settings…', 'settings', f),            // 5
];
check('a submenu whose entries are all disabled is inactive; one with an entry to choose is not', inactive(list[4]!) && !inactive(list[3]!));
check('a separator and a disabled entry are inactive', inactive(list[1]!) && inactive(list[2]!));
check('↓ skips separators and inactive entries', step(list, 0, 1) === 3 && step(list, 3, 1) === 5);
check('↓ wraps at the end, ↑ at the start', step(list, 5, 1) === 0 && step(list, 0, -1) === 5);
check('from nowhere (-1): ↓ gives the first entry', step(list, -1, 1) === 0);
check('Home and End: the first and the last entry that can be chosen', edge(list, false) === 0 && edge(list, true) === 5);
check('nothing to choose: -1', step([SEP, item('x', 'x', f, { disabled: true })], -1, 1) === -1 && edge([], false) === -1);
check('type-ahead: the next entry after the focused one that starts with the letter', typeAhead(list, 0, 'e') === 3 && typeAhead(list, 3, 's') === 5);
check('type-ahead wraps, ignores inactive entries and case', typeAhead(list, 5, 'F') === 0 && typeAhead(list, 0, 'd') === -1);
check('type-ahead: a space or nothing matches nothing', typeAhead(list, 0, ' ') === -1);
check('the leading slot: kept when one entry has an icon or a check', !leads(list) && leads([item('a', 'a', f), item('b', 'b', f, { icon: 'search' })]) && leads([item('c', 'c', f, { checked: false })]));
check('item(): its options only when given (a check of false is a toggle that is off)', !('icon' in item('a', 'a', f)) && item('a', 'a', f, { checked: false }).checked === false && !('checked' in item('a', 'a', f)));

// a row with actions (Export › PDF: open in a new tab, download): → from the row to its first action, on to the next;
// ← back, to the row itself; no move past the ends (← on the row is the menu's own: a submenu closes)
{
  const pdf = item('PDF', 'pdf', f, { actions: [{ label: 'Open in a new tab', key: 'open', icon: 'newTab', fn: f }, { label: 'Download', key: 'download', icon: 'download', fn: f }] });
  check('→ from the row: its first action; → again: the next; past the last: no move', across(pdf, -1, 1) === 0 && across(pdf, 0, 1) === 1 && across(pdf, 1, 1) === null);
  check('← from an action: the one before, then the row itself; ← on the row: no move', across(pdf, 1, -1) === 0 && across(pdf, 0, -1) === -1 && across(pdf, -1, -1) === null);
  const some = item('PDF', 'pdf', f, { actions: [{ label: 'A', key: 'a', icon: 'newTab', disabled: true }, { label: 'B', key: 'b', icon: 'download' }] });
  check('a disabled action is skipped', across(some, -1, 1) === 1 && across(some, 1, -1) === -1);
  const off = item('PDF', 'pdf', f, { disabled: true, actions: [{ label: 'A', key: 'a', icon: 'newTab' }] });
  check('a disabled row: its actions too; a row without actions, a separator: no move', across(off, -1, 1) === null && across(list[0], -1, 1) === null && across(SEP, -1, 1) === null);
  check('↑ ↓ and type-ahead treat a row with actions as one row', step([list[0]!, pdf], 0, 1) === 1 && typeAhead([list[0]!, pdf], 0, 'p') === 1);
  check('item(): actions only when given', !('actions' in item('a', 'a', f)) && !('actions' in item('a', 'a', f, { actions: [] })) && pdf.actions?.length === 2);
}

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
