// Downloads: the one file-name rule and the one way to save a file, for every export (the editor's and Home's
// Export .tex / .zip, Export all, the older-document prompt, references.bib).
//
//   fileName(title)                → the base of the file name ("Zürich Notes" → "Zurich-Notes"; no extension)
//   download(name, data, mime?)    → the browser saves `data` as `name`
//
// The name keeps the title's case and letters (a name the user recognises): accents on Latin letters are dropped and
// letters without a decomposition spelled plainly, as search folds them (latex-text.ts foldLetters); characters a
// file system refuses (/ \ : * ? " < > | and control characters) and whitespace become "-"; at most NAME_MAX
// characters; "document" when nothing is left.
import { foldLetters } from './latex-text.ts';

export const NAME_MAX = 80;

export function fileName(title: string | null | undefined): string {
  const plain = foldLetters((title ?? '').normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1')).normalize('NFC');
  const safe = plain.replace(/[\s/\\:*?"<>|\p{Cc}]+/gu, '-').replace(/-{2,}/g, '-');
  // no dash or dot at either end (a leading dot hides the file, a trailing one Windows drops), before and after the cut
  const trim = (s: string) => s.replace(/^[-.]+|[-.]+$/g, '');
  return trim(Array.from(trim(safe)).slice(0, NAME_MAX).join('')) || 'document';
}

/** how long the object URL lives after the click: long enough for Safari to start the download */
const REVOKE_MS = 10_000;

/** Save bytes, text or a Blob as a download (browser). */
export function download(name: string, data: Uint8Array | string | Blob, mime = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}
