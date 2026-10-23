// The keys of a strip and of a splitter (one rule each, pure, unit-tested in Node: tests/helpers.test.ts).
import type { Dir } from './model.ts';

/** A strip's arrow keys (the tab strip's and a side column's panel tabs alike, WAI-ARIA tabs): ← → to the previous or
 *  next one (wrapping; not with Ctrl, ⌘ or Alt: those are the keymap's), Home and End to the first and the last. */
export function rove(ids: readonly string[], i: number, e: KeyboardEvent): string | null {
  const plain = !e.altKey && !e.metaKey && !e.ctrlKey;
  if (e.key === 'ArrowRight' && plain) return ids[(i + 1) % ids.length] ?? null;
  if (e.key === 'ArrowLeft' && plain) return ids[(i - 1 + ids.length) % ids.length] ?? null;
  if (e.key === 'Home') return ids[0] ?? null;
  if (e.key === 'End') return ids.at(-1) ?? null;
  return null;
}

/** A splitter's key (the groups' splitters and a side column's edge alike): an arrow along its axis a step of 16 px
 *  (Shift: 64) back or forward; Home and End to its least and most; Enter its default (equal shares, the column's
 *  width). Null: not a splitter key. */
export function splitterKey(e: KeyboardEvent, dir: Dir): number | 'start' | 'end' | 'reset' | null {
  const step = e.shiftKey ? 64 : 16;
  if (e.key === (dir === 'row' ? 'ArrowLeft' : 'ArrowUp')) return -step;
  if (e.key === (dir === 'row' ? 'ArrowRight' : 'ArrowDown')) return step;
  if (e.key === 'Home') return 'start';
  if (e.key === 'End') return 'end';
  if (e.key === 'Enter') return 'reset';
  return null;
}
