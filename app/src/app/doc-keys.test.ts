// app/doc-keys.ts with fake events and a fake host: which command a key calls, in which state, and whether its default
// is prevented. The rows' order is the keys' precedence (it was a switch in app.js; now a table these checks read).
//   node app/src/app/doc-keys.test.ts      (Node; exit 1 on a failure)
import { createDocKeys, KEY_ROWS, type KeyHost } from './doc-keys.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

type Ev = KeyboardEvent & { prevented: boolean };
function ev(key: string, o: { mod?: boolean; shift?: boolean; alt?: boolean; code?: string; inField?: boolean; inMenu?: boolean } = {}): Ev {
  const e = { key, code: o.code ?? (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key), metaKey: !!o.mod, ctrlKey: false, shiftKey: !!o.shift, altKey: !!o.alt,
    target: { closest: (s: string) => ((o.inField && s.includes('.cm-editor')) || (o.inMenu && s.includes('[role="menu"]')) ? {} : null) }, prevented: false, preventDefault() { this.prevented = true; } };
  return e as unknown as Ev;
}
function setup(state: { selected?: string | null; focusMode?: boolean; menu?: boolean; undoes?: boolean } = {}) {
  const calls: string[] = [];
  const blocks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const host: KeyHost = {
    takes: () => true, menuOpen: () => !!state.menu, selected: () => state.selected ?? null, indexOf: (id) => blocks.findIndex((b) => b.id === id), blocks: () => blocks,
    focusedPane: () => 'p1', focusMode: () => !!state.focusMode, clearSelection: () => calls.push('clear'), select: (id) => calls.push(`select ${id}`),
    command: (id, input) => { calls.push(`${id}${input && Object.keys(input).length ? ' ' + JSON.stringify(input) : ''}`); return id === 'doc.undo' ? !!state.undoes : true; },
  };
  return { keys: createDocKeys(host), calls };
}

check('the rows have unique ids', new Set(KEY_ROWS.map((r) => r.id)).size === KEY_ROWS.length);
{
  const { keys, calls } = setup(); const e = ev('f', { mod: true, inField: true });
  check('⌘F in a text field: find (prevented)', keys.handle(e)?.id === 'find' && calls[0] === 'find.open' && e.prevented, calls);
}
{
  const { keys, calls } = setup(); const e = ev('а', { mod: true, code: 'KeyF' });   // a Cyrillic layout: the key is another letter
  check('⌘F on another layout (the key\'s code): find', keys.handle(e)?.id === 'find' && calls[0] === 'find.open', calls);
}
{
  const { keys } = setup(); const e = ev('f', { mod: true, shift: true });
  check('⌘⇧F: focus mode, not find', keys.handle(e)?.id === 'focus-mode');
}
{
  const { keys, calls } = setup({ selected: 'b' }); const e = ev('j', { inField: true });
  check('j in a text field: nothing (typed), not prevented', keys.handle(e) === null && !calls.length && !e.prevented, calls);
  const k = setup({ selected: 'b' }); const e3 = ev('ArrowDown', { inMenu: true });
  check('↓ in a menu of the kit (the References ⋯): the menu takes it, not the page', k.keys.handle(e3) === null && !k.calls.length && !e3.prevented, k.calls);
  const m = setup({ selected: 'b', menu: true }); const e2 = ev('ArrowDown');
  check('↓ with a menu open: the menu\'s, not the page\'s', m.keys.handle(e2) === null && !m.calls.length);
}
{
  const { keys } = setup({ undoes: false }); const e = ev('z', { mod: true });
  check('⌘Z with nothing to undo: not prevented (the key goes on)', keys.handle(e)?.id === 'undo' && !e.prevented);
  const u = setup({ undoes: true }); const e2 = ev('z', { mod: true });
  check('⌘Z that undoes: prevented', u.keys.handle(e2)?.id === 'undo' && e2.prevented);
  const r = setup(); check('⌘⇧Z and ⌘Y: redo', r.keys.handle(ev('z', { mod: true, shift: true }))?.id === 'redo-shift' && r.keys.handle(ev('y', { mod: true }))?.id === 'redo');
}
{
  const f = setup({ focusMode: true, selected: 'b' });
  check('Escape in focus mode with a block selected: focus mode ends first', f.keys.handle(ev('Escape'))?.id === 'leave-focus' && f.calls[0] === 'view.focusMode {"on":false}', f.calls);
  const s = setup({ selected: 'b' });
  check('Escape with a block selected: the selection cleared', s.keys.handle(ev('Escape'))?.id === 'unselect' && s.calls[0] === 'clear');
  const z = setup(); const e = ev('Escape');
  check('Escape with nothing to do: not taken, not prevented', z.keys.handle(e) === null && !e.prevented);
}
{
  const { keys, calls } = setup({ selected: 'b' });
  keys.handle(ev('ArrowDown')); keys.handle(ev('k'));
  check('↓ and k: the selection moves from the selected block\'s index', calls.join('|') === 'select.down {"from":1}|select.up {"from":1}', calls);
}
{
  const { keys, calls } = setup({ selected: 'b' });
  check('⌥↑: the block moves up and stays selected (not the selection moving)', keys.handle(ev('ArrowUp', { alt: true }))?.id === 'move-up' && calls.join('|') === 'block.moveUp {"id":"b"}|select b', calls);
}
{
  const { keys, calls } = setup({ selected: 'c' });
  keys.handle(ev('Backspace'));
  check('⌫ on the last block: deleted, the one before selected', calls.join('|') === 'block.delete {"id":"c"}|select b', calls);
}
{
  const { keys, calls } = setup();
  const e = ev('Enter'); keys.handle(e); keys.handle(ev('d', { mod: true }));
  check('↵ and ⌘D with no selection: nothing (they need a selected block)', !calls.length && !e.prevented, calls);
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
