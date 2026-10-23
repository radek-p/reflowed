// The workbench in a browser (Playwright on the demo page, served from memory: no port), by area: tests/e2e/<area>.ts
// register their groups on the harness (tests/e2e/harness.ts); this runs them. The checks wait on DOM state, the
// workbench's events and wb.idle(), never on fixed times.
//
//   node workbench/tests/e2e.ts [--area store|keys|layout|sides|tabs|bar|chips|looks|status[,…]] [--only <regex>] [--headed] [--browser chromium|firefox|webkit]
//
// The areas: 
//   store: the store and its container: two workbenches on a page, observers, the ticker, dispose, the view context, idle
//   keys: ARIA, the strip's keys, the keymap, chords, the focus rings and the recorded focus order
//   layout: layout: one tab, the boot, home, tab and content drags, resizing, lifecycle, persistence, the context menu, performance
//   sides: the side columns: stacks, docking, the splitter, opening and closing
//   tabs: tabs: the header forms, menus, rename, rows, narrowing, motion
//   bar: the window bar: the tabs in it, the side status bar, the wordmark, the glass top bar, the fit
//   chips: the pill's parts as painted: buttons, chips, the ×, dropdown edges, the insertion bar, strip lines, the gaps
//   looks: looks: glass, the viewport, the kit gallery, light and dark, overflow
//   status: document status: marks, the unsaved dot, the progress bar
import { run } from './e2e/harness.ts';

export const AREAS = ['store', 'keys', 'layout', 'sides', 'tabs', 'bar', 'chips', 'looks', 'status'];
const argv = process.argv.slice(2);
const picked = argv.includes('--area') ? argv[argv.indexOf('--area') + 1]!.split(',') : AREAS;
for (const a of picked) {
  if (!AREAS.includes(a)) { console.log(`no area "${a}" (${AREAS.join(', ')})`); process.exit(2); }
  await import(`./e2e/${a}.ts`);
}
await run();
