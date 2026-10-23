// a note's colour (the author's, stable across documents), the ink on it, and its initials. Pure.

const PALETTE = ['#f6c343', '#7fb3f5', '#8fd19e', '#f59e8b', '#c9a4f2', '#f5a3c7', '#7fd3d1', '#f0b27a'];
/** an authorless, colourless note (and the fallback): a neutral grey */
export const NEUTRAL = '#d9d8d4';

function hashOf(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }

/** The chip's colour: the note's own (todonotes' color=, as #RRGGBB) or the author's. */
export function authorColour(author, own = '') {
  if (/^#[0-9a-f]{6}$/i.test(own)) return own;
  if (!author) return NEUTRAL;
  return PALETTE[hashOf(author.toLowerCase()) % PALETTE.length];
}
/** A colour mixed with white (todonotes' package default is meant for a box, not a chip). */
export function tint(hex, k) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return '';
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
/** Ink on a chip of this colour: the colour darkened a lot, so it reads on it. */
export function inkOf(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return '';
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.32));
  return `rgb(${ch.join(',')})`;
}
/** Two words: their initials (AL); one: its first two letters (Sz). */
export function initials(author) {
  const w = (author ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  return w.length > 1 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : w[0].charAt(0).toUpperCase() + w[0].slice(1, 2).toLowerCase();
}
