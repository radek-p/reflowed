// The TeX resource server: the address of a static HTTP server with a TeX Live tree, where the
// engine fetches a package, class or font the embedded set lacks. A preference of this browser (localStorage, as the
// View options), set in the Settings panel's Advanced section (settings/resource-field.ts), behind "Show advanced
// features": with the switch off the address is the default.
//
// The default: a page served over http(s) looks for the tree beside itself, at texlive/2022/
// relative to the page, so no CORS is needed. That address is only assumed:
// the engine asks for its ls-R at most once per page and, when it is not there, goes on quietly with no server (the
// problems do not mention one). From file:// there is no default. An address typed in the setting, or ?resources=
// on a dev page, overrides the default; "none" turns the server off.
//
//   resourceChoice (signal: { url, quiet, from }) · resourceServer (signal: the address in force)
//   storedServer (signal: what was typed, null: nothing) · setResourceServer(text) -> whether it was taken
//   DEFAULT_RESOURCE_SERVER · defaultServerFor(location) · chooseServer(…) · checkServerAddress(text) -> '' | why not
//   connectResources(backend, onChange)   the backend follows the choice; onChange() after a change (not at start)
import { signal, computed, effect } from '@preact/signals';
import { registerAdvanced } from './advanced.js';
import { inForce } from './registry.ts';
import { pageParams } from '../app/release-mode.js';
import { BESIDE_PAGE, NONE, isNone, defaultServerFor, chooseServer } from './resource-choice.ts';
export { BESIDE_PAGE, NONE, defaultServerFor, chooseServer, type ServerChoice } from './resource-choice.ts';

const KEY = 'rtx-editor.resource-server';
export const DEFAULT_RESOURCE_SERVER = (() => {
  try { return defaultServerFor(new URL(document.baseURI)); } catch { return ''; }
})();

const load = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
/** what was typed (null: nothing, the default applies) */
export const storedServer = signal<string | null>(load());

const fromPage = ((): string | null => { try { return pageParams().get('resources'); } catch { return null; } })();
// an advanced setting: with the switch off what was typed is not in force (settings/registry.ts inForce: its default, null)
export const resourceChoice = computed(() => chooseServer({ fromPage, stored: inForce('resource-server', storedServer.value), fallback: DEFAULT_RESOURCE_SERVER }));
export const resourceServer = computed(() => resourceChoice.value.url);

registerAdvanced({ id: 'resource-server', label: 'The TeX resource server', where: 'Settings, Advanced' });

/** '' when it can be used: empty (the default), none, or an http(s) address */
export function checkServerAddress(text: string | null | undefined): string {
  const u = (text ?? '').trim();
  if (!u || isNone(u)) return '';
  try { return /^https?:$/.test(new URL(u).protocol) ? '' : 'The address must start with http:// or https://'; }
  catch { return `Not a web address (for example https://tex.example.org/${BESIDE_PAGE}), or ${NONE}`; }
}

/** empty: back to the default; none: no server; else an http(s) address */
export function setResourceServer(text: string | null | undefined): boolean {
  const u = (text ?? '').trim();
  if (checkServerAddress(u)) return false;
  const keep = !u ? null : isNone(u) ? NONE : u;
  storedServer.value = keep;
  try { if (keep == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, keep); } catch { /* private window */ }
  return true;
}

interface ResourceBackend { setResourceServer?(url: string, o?: { quiet?: boolean }): Promise<boolean> | boolean }

/** the backend uses the address in force, now and after every change; onChange() runs after a change (the blocks
 *  that failed for want of a file typeset again) */
export function connectResources(backend: ResourceBackend | undefined, onChange?: () => void): () => void {
  const set = backend?.setResourceServer?.bind(backend);
  if (!set) return () => {};
  let first = true;
  return effect(() => {
    const { url, quiet } = resourceChoice.value;
    const was = first;
    first = false;
    Promise.resolve(set(url, { quiet })).then((changed) => { if (!was && changed) onChange?.(); }, (e: unknown) => console.warn(`resource server: ${(e as Error)?.message ?? e}`));
  });
}
