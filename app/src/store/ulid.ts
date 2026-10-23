// ULIDs: 48-bit millisecond time + 80 random bits, Crockford base 32, 26
// characters; sort by creation time. Monotonic within one millisecond (the
// random part is incremented), so ids made in a burst keep their order.

const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface UlidOptions {
  now?: () => number;
  /** 16 random bytes → only the first 10 are used; default crypto.getRandomValues */
  random?: (n: number) => Uint8Array;
}

function cryptoRandom(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

/** A ULID generator (each with its own monotonic state). */
export function ulidFactory(opts: UlidOptions = {}): () => string {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? cryptoRandom;
  let lastT = -1;
  let lastR: number[] = [];
  return () => {
    let t = now();
    if (t <= lastT) {
      t = lastT;
      // increment the 80-bit random part (16 base-32 digits)
      let i = lastR.length - 1;
      while (i >= 0 && lastR[i] === 31) { lastR[i] = 0; i--; }
      if (i < 0) throw new Error('ulid: random part overflow');
      lastR[i]++;
    } else {
      const bytes = random(10);
      lastR = [];
      // 80 bits → 16 digits of 5 bits
      let acc = 0, bits = 0;
      for (const b of bytes) {
        acc = (acc << 8) | b; bits += 8;
        while (bits >= 5) { bits -= 5; lastR.push((acc >> bits) & 31); }
        acc &= (1 << bits) - 1;
      }
      lastT = t;
    }
    let time = '';
    let tt = t;
    for (let i = 0; i < 10; i++) { time = ENC[tt % 32] + time; tt = Math.floor(tt / 32); }
    return time + lastR.map((d) => ENC[d]).join('');
  };
}

export const ulid = ulidFactory();

/** The millisecond time in a ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (let i = 0; i < 10; i++) t = t * 32 + ENC.indexOf(id[i]);
  return t;
}

/** Deterministic ids (seed builds, tests): a fixed clock and a seeded PRNG. */
export function seededUlid(seed: number, time = Date.UTC(2026, 8, 27)): () => string {
  let s = seed >>> 0 || 1;
  const rnd = (n: number) => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; a[i] = s & 255; }
    return a;
  };
  return ulidFactory({ now: () => time, random: rnd });
}
