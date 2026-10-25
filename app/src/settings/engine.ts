// THE ENGINE: what typesets the blocks, one choice for the page (every open document follows it) and a preference
// of this browser (localStorage, as the View options). An advanced setting: its row is in the Settings panel's Advanced
// section with "Show advanced features" on; with the switch off the default (the page's first engine) is in force
// (settings/registry.ts inForce), the stored choice back when it is on again. ?backend=<id> on a page overrides both.
//
//   provideEngines(options, fromPage)   the page's engines ({ id, label }, the default first), once (app/services.ts)
//   engine (signal: the id in force, null: none offered) · setEngine(id)
// A document editor follows `engine` (app/app.js: every block typesets again on a change).
import { computed, signal } from '@preact/signals';
import { html } from '../design/ui/core.js';
import { Select } from '../design/ui/index.js';
import { registerSetting, inForce } from './registry.ts';
import { registerAdvanced } from './advanced.js';
import { Row } from './rows.ts';

export interface EngineOption { id: string; label: string }
const KEY = 'rtx-editor.backend';
const load = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** the page's engines (the default first), ?backend= (a dev page's) and the choice stored (null: none made) */
const choice = signal<{ options: EngineOption[]; fromPage: string | null; stored: string | null }>({ options: [], fromPage: null, stored: load() });
export const engine = computed<string | null>(() => {
  const { options, fromPage, stored } = choice.value;
  const want = fromPage ?? inForce('engine', stored);
  return options.find((o) => o.id === want)?.id ?? options[0]?.id ?? null;
});

/** the page's engines, the default first; fromPage: ?backend= (a dev page's) */
export function provideEngines(list: EngineOption[], fromPage: string | null = null): void {
  choice.value = { ...choice.peek(), options: list.map(({ id, label }) => ({ id, label: label || id })), fromPage };
}

export function setEngine(id: string): void {
  choice.value = { ...choice.peek(), stored: id };
  try { localStorage.setItem(KEY, id); } catch { /* private window */ }
}

registerAdvanced({ id: 'engine', label: 'The typesetting engine', where: 'Settings, Advanced' });
registerSetting({ id: 'engine', where: 'advanced', order: 15, advanced: true, default: null, shown: () => choice.peek().options.length > 1, Control: () => html`<${Row} id="engine"
    label="Engine" for="backend-select" hint="What typesets the blocks of every open document. Another engine typesets them all again.">
    <${Select} id="backend-select" value=${engine.peek() ?? ''} onChange=${(e: Event) => setEngine((e.currentTarget as HTMLSelectElement).value)}>
      ${choice.peek().options.map((o) => html`<option value=${o.id}>${o.label}</option>`)}<//>
  <//>` });
