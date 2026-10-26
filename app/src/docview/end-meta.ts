// The document's short metadata at the foot of a pane's end space (docview/end-space.ts), as text: pure, no DOM.
//
//   endMeta({ open, title, words, blocks, edited }, now?) -> { title, line }    (open false: no document, both '')
//     title   the document's title ('Untitled' when it has none)
//     line    '693 words · 41 blocks · edited today' (its parts when known: words and blocks once counted, edited
//             once the document has a time); '' while nothing is known yet
//   editedOn(t, now?) -> 'today' · 'yesterday' · '4 Oct' (· year): the Documents view's date (home/text.js shortDate)
import { shortDate } from '../home/text.js';

export interface EndMetaInput {
  /** a document is open (default true); none: nothing to say */
  open?: boolean;
  title: string | null | undefined;
  /** the word count (doc/results.js words: texcount-like) and the number of blocks; null: not counted yet */
  words: number | null | undefined;
  blocks: number | null | undefined;
  /** when the document was last edited (ms since the epoch; doc/results.js edited); 0 or null: not known */
  edited: number | null | undefined;
}
export interface EndMetaText { title: string; line: string }

/** the numbers as the word count footer writes them (chrome/sidebar-chrome.ts): 1,234 */
const fmt = (n: number) => n.toLocaleString('en-GB');
const count = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** the day of time t as the end space says it: today, yesterday, else the date (the year when not this one) */
export function editedOn(t: number, now = Date.now()): string {
  const d = new Date(t), today = new Date(now), y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString() || t > now) return 'today';   // (a clock a little behind another tab's: today)
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return shortDate(t, now);
}

export function endMeta({ open = true, title, words, blocks, edited }: EndMetaInput, now = Date.now()): EndMetaText {
  if (!open) return { title: '', line: '' };
  const parts: string[] = [];
  if (words != null) parts.push(count(words, 'word', 'words'));
  if (blocks != null) parts.push(count(blocks, 'block', 'blocks'));
  if (edited) parts.push(`edited ${editedOn(edited, now)}`);
  return { title: title?.trim() || 'Untitled', line: parts.join(' · ') };
}
