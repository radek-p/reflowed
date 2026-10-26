// The views registry's on-demand panels (design/ui/views.ts panel.onDemand): offered but not in their slot until opened,
// listed by offered() open or not (in their order), opened and closed by openPanel / closePanel (a signal: an effect
// follows), closed by their own close (then their onClose runs), closed when unregistered; a panel that is not on demand
// is in its slot at once and cannot be "opened".
//   node app/src/design/ui/views.test.ts      (Node; exit 1 on a failure)
import { effect } from '@preact/signals';
import { registerView, views, offered, openPanel, closePanel, panelOpen, view } from './views.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d !== '' && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const ids = (l: { id: string }[]) => l.map((v) => v.id).join(' ');
const C = () => null;

const offA = registerView({ id: 't-plain', title: 'Plain', panel: { side: 'left', order: 10 }, Component: C });
let closed = 0;
const offB = registerView({ id: 't-later', title: 'Later', panel: { side: 'right', order: 60, onDemand: true, onClose: () => { closed++; } }, Component: C });
const offC = registerView({ id: 't-first', title: 'First', panel: { side: 'left', order: 50, onDemand: true }, Component: C });

check('a plain panel is in its slot at once; the on-demand ones are not (closed)', ids(views('sidebar')) === 't-plain' && !panelOpen('t-later') && !panelOpen('t-first'), ids(views('sidebar')));
check('offered(): the on-demand panels, open or not, in their order', ids(offered()) === 't-first t-later', ids(offered()));
check('a plain panel cannot be opened (openPanel false), nor an unknown id', openPanel('t-plain') === false && openPanel('t-none') === false && !panelOpen('t-plain'));
const seen: string[] = [];
const stop = effect(() => { seen.push(ids(views('sidebar'))); });
check('openPanel: in its slot, in its order; an effect on views() follows', openPanel('t-later') && panelOpen('t-later') && ids(views('sidebar')) === 't-plain t-later' && seen.at(-1) === 't-plain t-later', seen);
openPanel('t-first');
check('… a second one: both, in order', ids(views('sidebar')) === 't-plain t-first t-later', ids(views('sidebar')));
const k = seen.length;
openPanel('t-first');
check('… opening an open one changes nothing (no re-run)', seen.length === k, seen);
view('t-later')!.panel!.onClose!();
check('its close (the container\'s close on its tab) closes it, then its own onClose runs', !panelOpen('t-later') && closed === 1 && ids(views('sidebar')) === 't-plain t-first', { closed, v: ids(views('sidebar')) });
check('… still offered (a View menu keeps its row, unchecked)', ids(offered()) === 't-first t-later');
check('an on-demand panel is closable even without its own onClose', typeof view('t-first')!.panel!.onClose === 'function');
closePanel('t-first');
check('closePanel: out of its slot', !panelOpen('t-first') && ids(views('sidebar')) === 't-plain');
openPanel('t-first');
offC();
check('unregistered: closed and no longer offered', !panelOpen('t-first') && ids(offered()) === 't-later' && ids(views('sidebar')) === 't-plain', { offered: ids(offered()) });
const again = registerView({ id: 't-first', title: 'First', panel: { side: 'left', order: 50, onDemand: true }, Component: C });
check('registered again: offered, closed (an unregistered panel does not come back open)', !panelOpen('t-first') && ids(offered()) === 't-first t-later' && ids(views('sidebar')) === 't-plain');
again();
stop(); offA(); offB();
check('the registry empty again', views().length === 0 && offered().length === 0, ids(views()));

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
