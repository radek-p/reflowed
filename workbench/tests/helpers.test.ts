// The helpers the duplicated code became: a strip's arrow keys, a splitter's keys, one rule each.
//   node --test workbench/tests/helpers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rove, splitterKey } from '../src/ui-keys.ts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

test('rove: ← → wrap, Home and End; never with Ctrl, ⌘ or Alt (the keymap\'s)', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(rove(ids, 0, key('ArrowRight')), 'b');
  assert.equal(rove(ids, 2, key('ArrowRight')), 'a', 'wraps forward');
  assert.equal(rove(ids, 0, key('ArrowLeft')), 'c', 'wraps back');
  assert.equal(rove(ids, 1, key('Home')), 'a');
  assert.equal(rove(ids, 1, key('End')), 'c');
  for (const m of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) assert.equal(rove(ids, 0, key('ArrowRight', m)), null);
  assert.equal(rove(ids, 0, key('ArrowDown')), null, 'not a strip key');
});

test('splitterKey: along its axis 16 px (Shift 64), Home, End, Enter; across it nothing', () => {
  assert.equal(splitterKey(key('ArrowRight'), 'row'), 16);
  assert.equal(splitterKey(key('ArrowLeft', { shiftKey: true }), 'row'), -64);
  assert.equal(splitterKey(key('ArrowDown'), 'column'), 16);
  assert.equal(splitterKey(key('ArrowUp'), 'row'), null, 'across a vertical splitter');
  assert.equal(splitterKey(key('ArrowRight'), 'column'), null, 'across a horizontal one');
  assert.equal(splitterKey(key('Home'), 'row'), 'start');
  assert.equal(splitterKey(key('End'), 'column'), 'end');
  assert.equal(splitterKey(key('Enter'), 'row'), 'reset');
});
