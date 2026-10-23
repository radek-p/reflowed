// "Show advanced features": one switch, off by default, for options most readers never need. A feature
// registers itself (registerAdvanced) and reads `advanced` (a signal) to show its control; with the switch off its
// control is hidden and its value is the default (the stored choice comes back when the switch is turned on).
// Kept per browser, as the View options are (localStorage). The inspector and the Files panel can join later by
// registering.
//
//   advanced (signal: boolean) · setAdvanced(on) · registerAdvanced({ id, label, where }) -> unregister
//   advancedFeatures (signal: [{ id, label, where }])
import { signal } from '@preact/signals';

const KEY = 'rtx-editor.advanced';
const load = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

export const advanced = signal(load());
export const advancedFeatures = signal([]);

export function setAdvanced(on) {
  advanced.value = !!on;
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window */ }
}

/** a feature behind the switch: { id, label (what it is), where (where its control is) } */
export function registerAdvanced(f) {
  if (!advancedFeatures.peek().some((x) => x.id === f.id)) advancedFeatures.value = [...advancedFeatures.peek(), f];
  return () => { advancedFeatures.value = advancedFeatures.peek().filter((x) => x.id !== f.id); };
}
