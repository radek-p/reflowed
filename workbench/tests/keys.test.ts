// The keymap (src/keys.ts): no key the browser keeps, no key that types a Polish letter, no clashes, chords.
//   node --test workbench/tests/keys.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../src/keys.ts';

const PLATFORMS = ['mac', 'win', 'linux'] as const;
const parts = (b: any) => b.chord;
const norm = (k: any) => `${k.ctrl ? 'ctrl+' : ''}${k.meta ? 'meta+' : ''}${k.alt ? 'alt+' : ''}${k.shift ? 'shift+' : ''}${k.key}`;
const normText = (s: string) => norm(K.parseKey(s));

test('no binding uses a key the browser keeps (Chromium\'s reserved list)', () => {
  for (const p of PLATFORMS) {
    const reserved = new Set((p === 'mac' ? K.RESERVED.mac : K.RESERVED.other).map(normText));
    for (const b of K.bindings(p)) for (const k of parts(b)) assert.ok(!reserved.has(norm(k)), `${p}: ${b.text} (${b.action})`);
  }
});

test('no Alt+letter anywhere; on Windows and Linux no Ctrl+Alt(+Shift)+ą ć ę ł ń ó ś ź ż letter (AltGr)', () => {
  for (const p of PLATFORMS) {
    for (const b of K.bindings(p)) for (const k of parts(b)) {
      const letter = /^[a-z]$/.test(k.key);
      assert.ok(!(k.alt && !k.ctrl && !k.meta && letter), `${p}: Alt+letter ${b.text}`);
      if (p !== 'mac') assert.ok(!(k.ctrl && k.alt && K.POLISH_ALTGR.includes(k.key)), `${p}: AltGr letter ${b.text}`);
    }
  }
});

test('no two actions share a key or a chord prefix collides with a single key', () => {
  for (const p of PLATFORMS) {
    const seen = new Map<string, string>();
    const bs = K.bindings(p);
    for (const b of bs) {
      const key = b.chord.map(norm).join(' ');
      assert.ok(!seen.has(key), `${p}: ${key} for ${seen.get(key)} and ${b.action}`);
      seen.set(key, `${b.action}:${b.arg}`);
    }
    const singles = new Set(bs.filter((b) => b.chord.length === 1).map((b) => norm(b.chord[0])));
    for (const b of bs) if (b.chord.length === 2) assert.ok(!singles.has(norm(b.chord[0])), `${p}: prefix ${b.text}`);
  }
});

test('every entry names its VS Code source (or, its own, why)', () => {
  for (const e of K.KEYMAP) assert.ok(e.own ? !!e.note && !!e.vscode : e.vscode && /workbench\.action\./.test(e.vscode), e.action);     // own: no VS Code command (a note says why)
});

test('the matcher: single keys, chords, cancel', () => {
  const m = K.createMatcher(K.bindings('linux'));
  const ev = (code: string, key: string, mods: any = {}) => ({ code, key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
  assert.equal((m.feed(ev('Digit2', '2', { ctrl: true })) as any).arg, 1);
  assert.equal(m.feed(ev('KeyK', 'k', { ctrl: true })), 'pending');
  assert.equal(m.feed(ev('ControlLeft', 'Control', { ctrl: true })), 'pending', 'a modifier alone keeps the chord armed');
  assert.equal((m.feed(ev('KeyM', 'm', { ctrl: true })) as any).action, 'maximize');
  assert.equal(m.feed(ev('KeyK', 'k', { ctrl: true })), 'pending');
  assert.equal(m.feed(ev('KeyQ', 'q', { ctrl: true })), 'cancelled');
  assert.equal(m.feed(ev('KeyQ', 'q', {})), null);
  assert.equal((m.feed(ev('KeyW', 'ẃ', { ctrl: true, alt: true })) as any).action, 'close', 'the physical key, whatever AltGr types');
  const mac = K.createMatcher(K.bindings('mac'));
  assert.equal((mac.feed(ev('KeyW', '∑', { meta: true, alt: true })) as any).action, 'close');
  assert.equal(mac.feed(ev('KeyK', 'k', { meta: true })), 'pending');
  assert.equal((mac.feed(ev('KeyN', 'n', {})) as any)?.action ?? null, null, '⌘K N is not a mac binding (⌘⌥N is)');
});

test('overrides: rebind or unbind', () => {
  const bs = K.bindings('linux', { close: 'f4', 'focusGroup:0': null, cycleMru: 'ctrl+e' });
  assert.equal(bs.find((b) => b.action === 'close')!.text, 'f4');
  assert.ok(!bs.some((b) => b.action === 'focusGroup' && b.arg === 0));
  assert.equal(bs.find((b) => b.action === 'cycleMru')!.text, 'ctrl+e');
});

test('labels', () => {
  assert.equal(K.label('meta+alt+w', 'mac'), '⌥⌘W');
  assert.equal(K.label('ctrl+alt+shift+t', 'linux'), 'Ctrl+Alt+Shift+T');
  assert.equal(K.label('ctrl+k ctrl+arrowleft', 'win'), 'Ctrl+K Ctrl+←');
});

// the keymap as data, one table: the workbench's rows from the keymap, a host's rows before them, when clauses
test('keyRows: every binding a row (workbench.<action>, its argument as args, the standalone host only)', () => {
  const rows = K.keyRows('linux'), bs = K.bindings('linux');
  assert.equal(rows.length, bs.length);
  assert.ok(rows.every((r, i) => r.command === `workbench.${bs[i]!.action}` && r.key === bs[i]!.text && (bs[i]!.arg === undefined ? !('args' in r) : r.args === bs[i]!.arg)));
  assert.ok(rows.every((r) => r.hosts?.join() === 'standalone'), 'the workbench\'s tab keys are not VS Code\'s');
  assert.equal(K.rowKey({ key: 'ctrl+b', mac: 'meta+b', command: 'x' }, 'mac'), 'meta+b');
  assert.equal(K.rowKey({ key: 'ctrl+b', mac: 'meta+b', command: 'x' }, 'linux'), 'ctrl+b');
});

test('evalWhen: keys, !, &&, ||, parentheses, == and != (VS Code\'s subset); none is true; an unknown key is falsy', () => {
  const ctx = (k: string) => ({ 'reflowed.field': true, 'editor.mode': 'tex', 'reflowed.blockSelected': false } as Record<string, unknown>)[k];
  const t = (e?: string) => K.evalWhen(e, ctx);
  assert.equal(t(undefined), true);
  assert.equal(t(''), true);
  assert.equal(t('reflowed.field'), true);
  assert.equal(t('!reflowed.field'), false);
  assert.equal(t('reflowed.field && reflowed.blockSelected'), false);
  assert.equal(t('reflowed.field || reflowed.blockSelected'), true);
  assert.equal(t('!(reflowed.field && reflowed.blockSelected)'), true);
  assert.equal(t("editor.mode == 'tex'"), true);
  assert.equal(t('editor.mode != tex'), false);
  assert.equal(t('nothing.here'), false);
  assert.equal(t('a || reflowed.field && !nothing'), true, '&& binds tighter than ||');
});

test('the matcher with when clauses: a host row wins while its clause holds, the workbench row otherwise', () => {
  type R = K.KeyRow & { chord: K.Key[] };
  const host: K.KeyRow[] = [{ key: 'ctrl+b', command: 'editor.bold', when: 'reflowed.field' }];
  const rows: R[] = [...host, ...K.keyRows('linux')].map((r) => ({ ...r, chord: K.parseChord(K.rowKey(r, 'linux')) }));
  const m = K.createMatcher<R>(rows);
  const ev = { code: 'KeyB', key: 'b', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  let field = true;
  const applies = (r: R) => K.evalWhen(r.when, (k) => (k === 'reflowed.field' ? field : undefined));
  assert.equal((m.feed(ev, applies) as R).command, 'editor.bold', 'in a field: the editor\'s bold');
  field = false;
  const w = m.feed(ev, applies) as R;
  assert.equal(w.command, 'workbench.toggleSide');
  assert.equal(w.args, 'left', 'elsewhere: the left sidebar');
});

test('vscodeKeybindings: only the rows for VS Code, ⌘ as cmd, each when ANDed with the editor\'s own', () => {
  const rows: K.KeyRow[] = [...K.keyRows('linux'), { key: 'ctrl+alt+enter', mac: 'meta+alt+enter', command: 'reflowed.typesetAll' },
    { key: 'ctrl+b', mac: 'meta+b', command: 'editor.bold', when: 'reflowed.field', hosts: ['standalone', 'vscode'] }];
  const vs = K.vscodeKeybindings(rows);
  assert.deepEqual(vs, [
    { key: 'ctrl+alt+enter', mac: 'cmd+alt+enter', command: 'reflowed.typesetAll', when: "activeCustomEditorId == 'reflowed.rtex'" },
    { key: 'ctrl+b', mac: 'cmd+b', command: 'editor.bold', when: "activeCustomEditorId == 'reflowed.rtex' && (reflowed.field)" },
  ]);
});

// the app's own Ctrl/⌘ \ kept second; a host's bold row with when 'reflowed.field' wins inside a field
test('toggleSide: Ctrl+B / ⌘B first (VS Code\'s toggleSidebarVisibility), Ctrl+Alt+B / ⌥⌘B the right (toggleAuxiliaryBar); the host\'s bold row in a field first', () => {
  for (const [p, left, right] of [['mac', ['meta+b', 'meta+\\'], ['meta+alt+b', 'meta+shift+\\']], ['linux', ['ctrl+b', 'ctrl+\\'], ['ctrl+alt+b', 'ctrl+shift+\\']], ['win', ['ctrl+b', 'ctrl+\\'], ['ctrl+alt+b', 'ctrl+shift+\\']]] as const) {
    const rows = K.keyRows(p as K.Platform), keys = (side: string) => rows.filter((r) => r.command === 'workbench.toggleSide' && r.args === side).map((r) => r.key);
    assert.deepEqual(keys('left'), [...left], `${p}: the left sidebar`);
    assert.deepEqual(keys('right'), [...right], `${p}: the right sidebar`);
  }
  const host: K.KeyRow[] = [{ key: 'ctrl+b', mac: 'meta+b', command: 'editor.bold', when: 'reflowed.field' }];
  for (const p of ['mac', 'linux'] as const) {
    let field = true;
    const m = K.createMatcher([...host, ...K.keyRows(p)].map((r) => ({ ...r, chord: K.parseChord(K.rowKey(r, p)) })));
    const applies = (r: { when?: string }) => K.evalWhen(r.when, (k) => (k === 'reflowed.field' ? field : undefined));
    const ev = { code: 'KeyB', key: 'b', ctrlKey: p !== 'mac', metaKey: p === 'mac', altKey: false, shiftKey: false } as KeyboardEvent;
    type R = { command: string };
    assert.equal((m.feed(ev, applies) as R).command, 'editor.bold', `${p}: in a field, the host's bold`);
    field = false;
    assert.equal((m.feed(ev, applies) as R).command, 'workbench.toggleSide', `${p}: elsewhere, the sidebar`);
  }
});
