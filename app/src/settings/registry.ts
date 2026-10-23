// Settings as registrations: a control of the View options or of Document settings is a
// registration, not a row written into the panel's JSX. A new option is its module and one registerSetting call: the
// panel (view/popover.js, settings/sheet.js) is not edited. The panel asks for its place's settings, in order, and
// draws each one's Control with its context.
//
//   registerSetting({ id, where, order, advanced?, shown?, Control }) -> unregister
//   settingsAt(where) -> the settings of a place, by order        visibleAt(where, ctx) -> those drawn now
//
// where: 'view'         a row of the View options (ctx: { view, mod, alt })
//        'view-switch'  a switch in the View options' last row, after "Show advanced features" (ctx: the same)
//        'engine'       a field of Document settings' Engine and view tab, after the engine (ctx: { host })
// advanced: true, the control is drawn only with "Show advanced features" on; { label, where }, the same, and the
//   switch lists it (registerAdvanced: its tooltip names what it shows)
// shown(ctx): drawn only when true (a feature that is not there: the inspector of a build without it)
// Signals are read with peek(): the panels are drawn again on a change (view/index.js syncs the popover).
import { advanced, registerAdvanced } from './advanced.js';

export type Where = 'view' | 'view-switch' | 'engine';
/** a place's context: each place says its own (view/popover.ts ViewCtx; the sheet: { host }) */
export type Ctx = object;

export interface Setting {
  id: string;
  where: Where;
  order: number;
  advanced?: boolean | { label: string; where: string };
  shown?(ctx: Ctx): boolean;
  Control(ctx: Ctx): unknown;
}

const all = new Map<string, Setting>();

export function registerSetting(s: Setting): () => void {
  if (all.has(s.id)) throw new Error(`setting ${s.id} registered twice`);
  all.set(s.id, s);
  const unAdv = typeof s.advanced === 'object' ? registerAdvanced({ id: s.id, label: s.advanced.label, where: s.advanced.where }) : null;
  return () => { if (all.get(s.id) === s) all.delete(s.id); unAdv?.(); };
}

export function settingsAt(where: Where): Setting[] {
  return [...all.values()].filter((s) => s.where === where).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

export function visibleAt(where: Where, ctx: Ctx): Setting[] {
  const adv = advanced.peek();
  return settingsAt(where).filter((s) => (!s.advanced || adv) && (s.shown?.(ctx) ?? true));
}
