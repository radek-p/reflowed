// Settings as registrations: a control of the View options or of the Settings panel is a registration, not a row
// written into the panel's JSX. A new option is its module and one registerSetting call: the panels (view/popover.ts,
// settings/panel.ts) are not edited. A panel asks for its place's settings, in order, and draws each one's Control with
// its context.
//
//   registerSetting({ id, where, order, advanced?, default?, shown?, Control }) -> unregister
//   settingsAt(where) -> the settings of a place, by order        visibleAt(where, ctx) -> those drawn now
//   inForce(id, stored) -> the value in force: the stored one, or the setting's default (below)
//
// where: 'view'      a row of the View options, and of the Settings panel's Reading section (ctx: view/popover.ts
//                    ViewCtx; `detail` in the panel: each row's one-line explanation)
//        'editing'   the Settings panel's Editing section          'notes'      its Notes section
//        'advanced'  its Advanced section (last)
//        (the panel's ctx: settings/panel.ts SettingsCtx)
// advanced: true, the control is drawn only with "Show advanced features" on (the switch's list of what it shows is
//   settings/advanced.js registerAdvanced, the feature's own), and its value is in force only then: with the switch off
//   inForce gives its `default`, so nobody is held by a choice they cannot see; on again, the stored choice is back
//   (it is kept). The owner of the value reads it through inForce (a signal read: an effect follows the switch).
// shown(ctx): drawn only when true (a feature that is not there: notes in a page without them)
// Signals are read with peek(): the panels are drawn again on a change (view/index.js syncs the popover; the Settings
// panel follows the page's preferences' signals).
import { advanced } from './advanced.js';

export type Where = 'view' | 'editing' | 'notes' | 'advanced';
/** a place's context: each place says its own (view/popover.ts ViewCtx; settings/panel.ts SettingsCtx) */
export type Ctx = object;

export interface Setting {
  id: string;
  where: Where;
  order: number;
  advanced?: boolean;
  /** an advanced setting's value while the switch is off */
  default?: unknown;
  shown?(ctx: Ctx): boolean;
  Control(ctx: Ctx): unknown;
}

const all = new Map<string, Setting>();

export function registerSetting(s: Setting): () => void {
  if (all.has(s.id)) throw new Error(`setting ${s.id} registered twice`);
  all.set(s.id, s);
  return () => { if (all.get(s.id) === s) all.delete(s.id); };
}

export function settingsAt(where: Where): Setting[] {
  return [...all.values()].filter((s) => s.where === where).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

export function visibleAt(where: Where, ctx: Ctx): Setting[] {
  const adv = advanced.peek();
  return settingsAt(where).filter((s) => (!s.advanced || adv) && (s.shown?.(ctx) ?? true));
}

/** setting `id`'s value in force: `stored`, or its default while it is advanced and the switch is off */
export function inForce<T>(id: string, stored: T): T {
  const on = advanced.value;                      // read first, always: a computed over it follows the switch
  const s = all.get(id);
  return s?.advanced && !on ? (s.default as T) : stored;
}
