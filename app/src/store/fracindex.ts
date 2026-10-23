// Fractional indices for block order: a key is a base-62 fraction in (0, 1)
// written without the leading "0." and never ending in '0' (so every key has
// a key between it and any other). Keys compare as plain strings (ASCII order
// of the digits 0-9A-Za-z), which is also IndexedDB's string order.
//
// Two peers inserting between the same neighbours at the same time get the
// same key; order is then (pos, id), and a later move re-keys. (A CRDT such
// as Yjs orders its own list and would not need this at all)

export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const val = (c: string) => {
  const v = DIGITS.indexOf(c);
  if (v < 0) throw new Error(`fracindex: bad digit ${JSON.stringify(c)}`);
  return v;
};

/** A key strictly between a and b ('' = 0, null = 1). */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`fracindex: ${a} >= ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? val(a[0]) : 0;
  const db = b !== null ? val(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  // consecutive digits
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

export function isValidKey(k: string): boolean {
  if (!k || k.endsWith('0')) return false;
  for (const c of k) if (DIGITS.indexOf(c) < 0) return false;
  return true;
}

/** A key between a and b (either null = the start / the end). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidKey(a)) throw new Error(`fracindex: invalid key ${a}`);
  if (b !== null && !isValidKey(b)) throw new Error(`fracindex: invalid key ${b}`);
  return midpoint(a ?? '', b);
}

/** n ordered keys between a and b, as short as bisection allows. */
export function nKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  const mid = Math.floor(n / 2);
  const m = keyBetween(a, b);
  return [...nKeysBetween(a, m, mid), m, ...nKeysBetween(m, b, n - mid - 1)];
}

/** Compare two blocks by (pos, id). */
export const byPos = (x: { pos: string; id: string }, y: { pos: string; id: string }) =>
  x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
