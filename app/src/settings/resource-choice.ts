// Which TeX resource server is in force, as pure functions: settings/resources.ts holds the
// signals, this file what tests can run in Node.
//
//   defaultServerFor(location) -> the tree beside an http(s) page, '' elsewhere
//   chooseServer({ fromPage, stored, fallback }) -> { url, quiet, from }
//   isNone(text) · BESIDE_PAGE · NONE
import { treeBase } from '../../../loading/tree.ts';

/** where the tree is looked for, relative to the page */
export const BESIDE_PAGE = 'texlive/2022/';
/** typed in the setting (or ?resources=none): no server, also where a default would apply */
export const NONE = 'none';
export const isNone = (s: string) => s.trim().toLowerCase() === NONE;

/** the tree beside a page served over http(s); '' elsewhere (file://, blob:, about:) */
export function defaultServerFor(page: { href: string; protocol: string }): string {
  if (!/^https?:$/.test(page.protocol)) return '';
  return treeBase(BESIDE_PAGE, page.href);          // (loading/tree.ts) as the release's own tree is found
}

export interface ServerChoice {
  /** '' for none */
  url: string;
  /** assumed, not set: asked once, quietly off when absent */
  quiet: boolean;
  from: 'page' | 'setting' | 'default';
}
/** the address in force: ?resources= (dev pages), then the setting in force (null while advanced features are hidden:
 *  settings/resources.ts), then the default */
export function chooseServer(o: { fromPage: string | null; stored: string | null; fallback: string }): ServerChoice {
  if (o.fromPage != null) return { url: isNone(o.fromPage) ? '' : o.fromPage.trim(), quiet: false, from: 'page' };
  const typed = (o.stored ?? '').trim();
  if (typed) return { url: isNone(typed) ? '' : typed, quiet: false, from: 'setting' };
  return { url: o.fallback, quiet: !!o.fallback, from: 'default' };
}
