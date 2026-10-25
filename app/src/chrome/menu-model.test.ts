// The menus' model (chrome/menu-model.ts): the keyboard's moves over what can be chosen, type-ahead, a submenu with
// nothing to choose drawn disabled, the leading slot.
//   node app/src/chrome/menu-model.test.ts      (Node; exit 1 on a failure)
import { item, submenu, SEP, inactive, step, edge, typeAhead, leads, type MenuEntry } from './menu-model.ts';

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

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
