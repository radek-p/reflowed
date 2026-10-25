// What a press on a unit does, and the card's hint line that says so: one rule for every unit (units.js: a
// reference, a citation, a link), apart from the DOM so that Node tests it (rule.test.ts).
//
//   clickAction({ mod, inCard, editable })   'go' | 'edit' | 'card'
//     in a card's typeset copy, or with ⌘/Ctrl: 'go' (the unit's own navigation: a reference's target, a citation's
//     reference list, a link's address in a new tab); otherwise 'edit' (the block's source, the caret in the unit),
//     or 'card' where the document cannot be edited (a read-only document: the card is all a click shows)
//   cardHint({ go, editable, noun, mod })    the hint at the foot of a card: "⌘-click to jump · click to edit";
//     go: the words after "⌘-click" (' to jump', ': the reference list', ' to open'), or null when it does nothing
//   openable(href, base?)                    the address a link opens in a new tab (http, https, mailto, ftp, tel; a
//                                            relative one against base, the page), or null for anything else
//                                            (javascript:, data:, file:, a relative one without a base …)
//   linkTitle(href)                          a link card's title: "Link to example.org", "Email a@b.org", "Link"
export type ClickAction = 'go' | 'edit' | 'card';

export function clickAction({ mod, inCard, editable }: { mod: boolean; inCard: boolean; editable: boolean }): ClickAction {
  if (inCard || mod) return 'go';
  return editable ? 'edit' : 'card';
}

export function cardHint({ go, editable, noun, mod }: { go: string | null; editable: boolean; noun: string; mod: string }): string {
  if (go) return `${mod}-click${go}${editable ? ' · click to edit' : ''}`;
  return editable ? `Click to edit the ${noun}` : '';
}

const OPENS = new Set(['http:', 'https:', 'mailto:', 'ftp:', 'tel:']);

export function openable(href: string, base?: string): string | null {
  let u: URL;
  try { u = new URL(href.trim(), base); } catch { return null; }
  return OPENS.has(u.protocol) ? u.href : null;
}

export function linkTitle(href: string): string {
  let u: URL;
  try { u = new URL(href.trim()); } catch { return 'Link'; }
  if (u.protocol === 'mailto:') {
    let to = u.pathname;
    try { to = decodeURIComponent(to); } catch { /* as written */ }
    return to ? `Email ${to}` : 'Link';
  }
  return u.hostname ? `Link to ${u.hostname.replace(/^www\./, '')}` : 'Link';
}
