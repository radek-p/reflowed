// The settings registry (settings/registry.ts): a place's settings in order, the advanced ones only with the switch
// on, the absent ones not drawn, an id once, unregister.
//   node app/src/settings/registry.test.ts      (Node; exit 1 on a failure)
import { registerSetting, settingsAt, visibleAt } from './registry.ts';
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
let threw = false;
try { registerSetting({ id: 't-a', where: 'notes', order: 0, Control }); } catch { threw = true; }
check('an id is registered once', threw);
offs.forEach((off) => off());
check('unregistered: gone from its place', settingsAt('view').length === 0 && settingsAt('editing').length === 0);

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
