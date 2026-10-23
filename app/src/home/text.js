// The home screen's pure helpers (no DOM): relative times and the query's marks.
//   relTime(t, now?)          'just now' · '5 min ago' · '3 h ago' · 'yesterday' · '4 Oct' (· year)
//   markParts(text, words)    [{ text, mark }] runs, the words marked accent- and case-insensitively
import { searchKey } from '../io/latex-text.ts';

export function relTime(t, now = Date.now()) {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 && new Date(t).getDate() === new Date(now).getDate()) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t), y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** The query's words, as searchKey folds them. */
export const queryWords = (q) => (q.trim() ? searchKey(q.trim()).split(/\s+/).filter(Boolean) : []);

/** Runs of `text` with the words marked; overlapping hits: the first wins. */
export function markParts(text, words) {
  if (!text) return [];
  if (!words.length) return [{ text, mark: false }];
  // searchKey keeps one char per char for Unicode text (NFD marks removed after composing back)
  const chars = [...text];
  const key = chars.map((c) => searchKey(c)[0] ?? c).join('');
  const hits = [];
  for (const w of words) { let i = -1; while ((i = key.indexOf(w, i + 1)) >= 0) hits.push([i, i + w.length]); }
  hits.sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  for (const [s, e] of hits) {
    if (s < at) continue;
    if (s > at) out.push({ text: chars.slice(at, s).join(''), mark: false });
    out.push({ text: chars.slice(s, e).join(''), mark: true });
    at = e;
  }
  if (at < chars.length) out.push({ text: chars.slice(at).join(''), mark: false });
  return out;
}
