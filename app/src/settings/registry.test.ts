// The settings registry (settings/registry.ts): a place's settings in order, the advanced ones only with the switch
// on, the absent ones not drawn, an id once, unregister; an advanced setting's value in force is its default while the
// switch is off (inForce), the stored one when it is on, and a computed over it follows the switch.
//   node app/src/settings/registry.test.ts      (Node; exit 1 on a failure)
import { registerSetting, settingsAt, visibleAt, inForce } from './registry.ts';
import { computed } from '@preact/signals';
import { advanced } from './advanced.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };
const ids = (l: { id: string }[]) => l.map((s) => s.id).join(',');
const Control = () => null;

advanced.value = false;
const offs = [
  registerSetting({ id: 't-c', where: 'view', order: 30, Control }),
  registerSetting({ id: 't-a', where: 'view', order: 10, Control }),
  registerSetting({ id: 't-b', where: 'view', order: 20, Control }),
  registerSetting({ id: 't-gated', where: 'view', order: 25, advanced: true, Control }),
  registerSetting({ id: 't-absent', where: 'view', order: 15, shown: (ctx: { here?: boolean }) => ctx.here === true, Control }),
  registerSetting({ id: 't-e', where: 'editing', order: 1, Control }),
];
check('a place lists its settings by order, not by registration', ids(settingsAt('view')) === 't-a,t-absent,t-b,t-gated,t-c', ids(settingsAt('view')));
check('… and only its own', ids(settingsAt('editing')) === 't-e' && settingsAt('advanced').length === 0);
check('with the advanced switch off, the advanced settings are not drawn', ids(visibleAt('view', {})) === 't-a,t-b,t-c', ids(visibleAt('view', {})));
advanced.value = true;
check('with it on, they are', ids(visibleAt('view', {})) === 't-a,t-b,t-gated,t-c', ids(visibleAt('view', {})));
check('a setting shown only when there is drawn when its context says so', ids(visibleAt('view', { here: true })) === 't-a,t-absent,t-b,t-gated,t-c');
offs.push(registerSetting({ id: 't-align', where: 'view', order: 40, advanced: true, default: 'justify', Control }));
advanced.value = false;
const shown = computed(() => inForce('t-align', 'left'));
check('advanced off: an advanced setting\'s default is in force, whatever is stored', inForce('t-align', 'left') === 'justify' && shown.value === 'justify');
check('… and an ordinary setting\'s stored value always', inForce('t-a', 'mine') === 'mine' && inForce('not-registered', 'x') === 'x');
advanced.value = true;
check('advanced on: the stored value is back (a computed over it follows the switch)', inForce('t-align', 'left') === 'left' && shown.value === 'left');
advanced.value = false;
check('… off again: the default', shown.value === 'justify');
let threw = false;
try { registerSetting({ id: 't-a', where: 'notes', order: 0, Control }); } catch { threw = true; }
check('an id is registered once', threw);
offs.forEach((off) => off());
check('unregistered: gone from its place', settingsAt('view').length === 0 && settingsAt('editing').length === 0);

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
