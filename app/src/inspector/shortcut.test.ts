// inspector/shortcut.ts: Alt+Shift+I is taken only when it toggles the inspector; otherwise it goes on (a character
// on a Mac), and only the public panel's own listener is stopped once its script is on the page.
//   node app/src/inspector/shortcut.test.ts      (Node; exit 1 on a failure)
import { shortcutAction } from './shortcut.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const key = (o: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean; code?: string } = {}) =>
  ({ altKey: o.alt ?? true, shiftKey: o.shift ?? true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, code: o.code ?? 'KeyI' });
const off = { canShow: false, panelLoaded: false };

check('the inspector cannot show (a release, or the advanced switch off), its panel not loaded: the key goes on untouched', shortcutAction(key(), off) === null);
check('the inspector can show: the key toggles it', shortcutAction(key(), { canShow: true, panelLoaded: false }) === 'toggle');
check('... also once the panel is loaded', shortcutAction(key(), { canShow: true, panelLoaded: true }) === 'toggle');
check('cannot show, the panel loaded (the switch turned off after use): only its listener is stopped, the default kept',
  shortcutAction(key(), { canShow: false, panelLoaded: true }) === 'shield');
for (const [name, e] of [['Alt+I', key({ shift: false })], ['Shift+I', key({ alt: false })], ['Ctrl+Alt+Shift+I', key({ ctrl: true })],
  ['Cmd+Alt+Shift+I', key({ meta: true })], ['Alt+Shift+J', key({ code: 'KeyJ' })]] as const)
  check(`${name} is not the shortcut, even when the inspector can show`, shortcutAction(e, { canShow: true, panelLoaded: true }) === null);

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
