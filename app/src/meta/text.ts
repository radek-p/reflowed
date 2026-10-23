// Values in the form: LaTeX source shown as text when that is lossless
// (accents: Kr\'{o}l is "Król"), else as source; typed text
// written as Unicode with LaTeX's special characters escaped. ORCID and
// email checks.

import { textValue, valueText } from '../tex/text.ts';

/** Text for a source value, or null when it is not plain text (maths, commands, \\ …). */
export const plainOf = valueText;
/** Source for typed text: Unicode as typed, LaTeX's specials escaped. */
export const sourceOf = textValue;

/** ORCID iD: 0000-0002-1825-0097, with or without https://orcid.org/; the check digit (ISO 7064 11,2). */
export function orcidProblem(v: string): string | null {
  const m = /^(?:https?:\/\/(?:www\.)?orcid\.org\/)?(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$/i.exec(v.trim());
  if (!m) return 'An ORCID iD looks like 0000-0002-1825-0097';
  const digits = (m[1] + m[2] + m[3] + m[4]).toUpperCase();
  let t = 0;
  for (const ch of digits.slice(0, 15)) t = (t + Number(ch)) * 2;
  const r = (12 - (t % 11)) % 11;
  const check = r === 10 ? 'X' : String(r);
  return check === digits[15] ? null : 'This ORCID iD has a wrong check digit';
}
/** The bare iD (as stored) from what was typed. */
export const orcidBare = (v: string) => v.trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').toUpperCase();

export function emailProblem(v: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'An email address looks like name@example.org';
}
