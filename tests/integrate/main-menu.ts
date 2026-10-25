// ── the main menu (the Re button) and the Settings panel: the menu's top level and submenus, by the pointer and the
// keyboard (↓ ↑ → ← Escape), its keys shown; Export › PDF's two actions (a row with actions: → ← reach them, Enter runs
// one; download saves <title>.pdf, open opens a tab); Settings… and Ctrl/⌘ , open the panel (on the right, a third of the window
// within its bounds) on General, the key again and the close on its tab close it; its sections in order, a hairline
// between them; a setting changed there applies; an advanced setting (line ends) is drawn only with advanced features
// on, its default in force while they are off; the View options keep only what a reader changes while reading ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^main-menu$'
import type { Harness } from './harness.ts';
import { fileName } from '../../app/src/io/download.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440, height: 900 });
  const menuState = () => page.evaluate(() => {
    const panels = [...document.querySelectorAll('.main-menu[role="menu"]')];
    const rows = (p: Element) => [...p.querySelectorAll(':scope > .menu-item, :scope > .menu-row > .menu-item')].map((b: any) => b.dataset.action);
    return { panels: panels.length, root: panels[0] ? rows(panels[0]) : [], sub: panels[1] ? rows(panels[1]) : [], subLabel: panels[1]?.getAttribute('aria-label') ?? null,
      focus: (document.activeElement as HTMLElement | null)?.dataset?.action ?? null, act: (document.activeElement as HTMLElement | null)?.dataset?.act ?? null, expanded: document.getElementById('btn-main-menu')!.getAttribute('aria-expanded') };
  });
  const bar = await page.evaluate(() => ({ menu: !!document.querySelector('.wb-bar #btn-main-menu .rtx-wb-logo svg'), popup: document.getElementById('btn-main-menu')?.getAttribute('aria-haspopup'),
    oldMenu: !!document.querySelector('#btn-doc-menu'), mark: !!document.querySelector('.wb-bar .wb-bar-mark') }));
  check('bar: the Re icon is the main menu\'s button (a menu button); no ⋯ button, no decorative mark', bar.menu && bar.popup === 'menu' && !bar.oldMenu && !bar.mark, bar);

  // ── the menu ──
  await page.click('#btn-main-menu');
  await page.waitForSelector('.main-menu[role="menu"]');
  let s = await menuState();
  check('the top level: Documents, Find and replace, View ›, Document ›, Export ›, Settings…, Keyboard shortcuts, About',
    s.root.join() === 'documents,find,view,document,export,settings,keys,about' && s.expanded === 'true', s);
  const looks = await page.evaluate(() => {
    const m = document.querySelector('.main-menu')!;
    const row = (k: string) => m.querySelector(`[data-action="${k}"]`)!;
    return { icons: [...m.querySelectorAll(':scope > .menu-item')].every((b) => !!b.querySelector('.mi-lead svg')),
      subs: ['view', 'document', 'export'].every((k) => row(k).getAttribute('aria-haspopup') === 'menu' && !!row(k).querySelector('.mi-sub svg')),
      keys: { find: row('find').querySelector('.mi-key')?.textContent, settings: row('settings').querySelector('.mi-key')?.textContent } };
  });
  check('the top level has icons; its submenus are marked (aria-haspopup, a chevron); the keys are shown (Find, Settings)',
    looks.icons && looks.subs && /F$/.test(looks.keys.find ?? '') && /,$/.test(looks.keys.settings ?? ''), looks);
  // the keyboard: the panel has the focus, ↓ the first row, ↓ ↓ View, → into it, ← back, Escape out of a submenu only
  await page.keyboard.press('ArrowDown');
  s = await menuState();
  check('↓: the first row', s.focus === 'documents', s);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelectorAll('.main-menu[role="menu"]').length === 2);
  s = await menuState();
  check('→ on View opens its submenu, its first row focused: View options…, Focus mode, Split view, Sidebar', s.subLabel === 'View' && s.focus === 'view-options'
    && s.sub.join() === 'view-options,focus,split,sidebar', s);
  const checks = await page.evaluate(() => [...document.querySelectorAll('.main-menu.menu-sub [role="menuitemcheckbox"]')].map((b: any) => `${b.dataset.action}:${b.getAttribute('aria-checked')}`));
  check('the toggles are checkbox rows with their state (Focus mode off, Sidebar on)', checks.join() === 'focus:false,sidebar:true', checks);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelectorAll('.main-menu[role="menu"]').length === 1);
  s = await menuState();
  check('← closes the submenu, the focus back on its row', s.focus === 'view', s);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.main-menu[role="menu"]').length === 2);
  s = await menuState();
  check('Enter on Document opens it: Document settings…, Versions…, Import .tex…', s.subLabel === 'Document' && s.focus === 'doc-settings' && s.sub.filter(Boolean).join() === 'doc-settings,versions,import-tex', s);
  await page.keyboard.press('Escape');
  s = await menuState();
  check('Escape in a submenu closes only it', s.panels === 1 && s.focus === 'document', s);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.main-menu'));
  s = await menuState();
  check('Escape again closes the menu, the focus back on its button', s.expanded === 'false' && await page.evaluate(() => document.activeElement?.id === 'btn-main-menu'), s);
  // the pointer: hover opens a submenu, a pick runs and closes the menu
  await page.click('#btn-main-menu');
  await page.hover('.main-menu [data-action="export"]');
  await page.waitForSelector('.main-menu.menu-sub[aria-label="Export"]');
  s = await menuState();
  check('hover on Export opens it: .tex, .zip, PDF', s.sub.join().startsWith('export-tex,export-zip') && s.sub.includes('export-pdf'), s);
  const pdfRow = await page.evaluate(() => {
    const g = document.querySelector('.main-menu.menu-sub [data-row="export-pdf"]');
    return { role: g?.getAttribute('role'), label: g?.getAttribute('aria-label'), row: g?.querySelector(':scope > .menu-item')?.getAttribute('data-action'),
      acts: [...(g?.querySelectorAll('.mi-act') ?? [])].map((b) => `${b.getAttribute('data-act')}|${b.getAttribute('role')}|${b.getAttribute('aria-label')}|${!!b.querySelector('svg')}`) };
  });
  check('Export › PDF: a row with two actions, each a labelled menuitem with an icon (open in a new tab, download)', pdfRow.role === 'group' && pdfRow.label === 'PDF' && pdfRow.row === 'export-pdf'
    && pdfRow.acts.join() === 'open|menuitem|PDF: Open in a new tab|true,download|menuitem|PDF: Download|true', pdfRow);
  await page.click('.main-menu [data-action="keys"]');
  await page.waitForSelector('dialog.shortcuts[open]');
  check('a pick runs it (Keyboard shortcuts) and closes the menu', !(await page.$('.main-menu')));
  await page.keyboard.press('Escape');

  // the PDF row's actions by the keyboard: End on PDF, → its actions, ← back to the row, Enter on download saves the file
  const title: string = await page.evaluate(async () => { const E = (window as any).editorAPI; return (await E.store().getDoc(E.route().id))?.title ?? ''; });
  await page.focus('#btn-main-menu');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.main-menu[role="menu"]');
  await page.keyboard.press('ArrowDown');
  for (let k = 0; k < 12 && (await menuState()).focus !== 'export'; k++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.main-menu.menu-sub[aria-label="Export"]');
  await page.keyboard.press('End');
  const walk: string[] = [];
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); const m = await menuState(); walk.push(m.act ?? m.focus ?? ''); }
  check('the PDF row by the keyboard: → open, → download, → stays, ← open, ← the row; the submenu stays open', walk.join() === 'open,download,download,open,export-pdf' && (await menuState()).panels === 2, walk);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 240000 }), page.keyboard.press('Enter')]);
  check('Enter on download: the PDF saved as <title>.pdf (io/download.ts fileName), the menu closed', dl.suggestedFilename() === `${fileName(title)}.pdf` && !(await page.$('.main-menu')),
    { name: dl.suggestedFilename(), title });
  // the pointer: open opens the PDF in a new tab, as the row did before (what window.open is given is recorded: a
  // headless browser saves a PDF instead of showing it, so the new tab's own URL stays empty)
  await page.evaluate(() => { const w = window as any, o = w.open; w.__opened = []; w.open = function (u: unknown, ...r: unknown[]) { w.__opened.push(String(u)); return o.call(this, u, ...r); }; });
  await page.click('#btn-main-menu');
  await page.hover('.main-menu [data-action="export"]');
  await page.waitForSelector('.main-menu.menu-sub[aria-label="Export"]');
  const [tab] = await Promise.all([ctx.waitForEvent('page', { timeout: 240000 }), page.click('.main-menu [data-row="export-pdf"] .mi-act[data-act="open"]')]);
  const opened: string[] = await page.evaluate(() => (window as any).__opened);
  check('open: a new tab on the PDF (a blob URL), the menu closed', !!tab && opened.length === 1 && /^blob:/.test(opened[0]!) && !(await page.$('.main-menu')), opened);
  await tab.close();

  // ── the Settings panel ──
  const panel = () => page.evaluate(() => {
    const el = document.querySelector('[data-panel-view="app-settings"] .rtx-settings');
    const aside = el?.closest('aside[data-side]');
    const page = el?.querySelector('[role="tabpanel"]:not([hidden])');
    const secs = page ? [...page.querySelectorAll('.rtx-set-section')] : [];
    return { open: !!el, side: aside?.getAttribute('data-side') ?? null, w: aside ? Math.round(aside.getBoundingClientRect().width) : 0, area: Math.round(document.querySelector('.wb-root')!.getBoundingClientRect().width),
      tab: (el?.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null)?.dataset.tab ?? null,
      sections: secs.map((x: any) => x.dataset.section), hints: page ? page.querySelectorAll('.rtx-set-hint, .rtx-vp-hint').length : 0,
      rules: secs.map((x) => getComputedStyle(x).borderTopWidth),
      focusIn: !!el && !!document.activeElement?.closest('aside[data-side]') };
  });
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  await page.waitForSelector('[data-panel-view="app-settings"] .rtx-settings');
  await idle(page);
  const p = await panel();
  check('Settings… opens the Settings panel, on the right, focused, on General', p.open && p.side === 'right' && p.focusIn && p.tab === 'general', p);
  check('its column: a third of the window, between 380 and 560 px', Math.abs(p.w - Math.max(380, Math.min(560, p.area / 3))) <= 2, p);
  check('General\'s sections in order: Reading, Editing, Notes, Advanced; every row explained; a hairline between sections, none above the first',
    p.sections.join() === 'view,editing,notes,advanced' && p.hints >= 7 && p.rules[0] === '0px' && p.rules.slice(1).every((r) => r === '1px'), p);
  // a setting changed there applies: block handles off
  await page.click('[data-panel-view="app-settings"] #set-handles');
  const applied = await page.evaluate(() => ({ noHandles: document.documentElement.hasAttribute('data-no-handles'), s: (window as any).editorAPI.view().settings }));
  check('a setting changed there applies at once (block handles off)', applied.noHandles && applied.s.handles === false, applied);
  await page.evaluate(() => (window as any).editorAPI.view().set({ handles: true }));
  // line ends: an advanced setting. Off: no row here nor in the View options, justified whatever is stored; on: the row
  // back, the stored choice in force; a change there applies
  const align = () => page.evaluate(() => ({ css: document.documentElement.style.getPropertyValue('--latex-align') || 'justify', stored: (window as any).editorAPI.view().settings.align,
    row: document.querySelectorAll('[data-panel-view="app-settings"] [data-setting="view-align"]').length }));
  await page.evaluate(() => { const E = (window as any).editorAPI; E.advanced(false); E.view().set({ align: 'left' }); });
  await idle(page);
  const off = await align();
  check('advanced off: no Line ends row in Reading; ragged right stored, the text justified (the default in force)', off.row === 0 && off.stored === 'left' && off.css === 'justify', off);
  await page.evaluate(() => (window as any).editorAPI.advanced(true));
  await page.waitForSelector('[data-panel-view="app-settings"] [data-setting="view-align"]');
  const on = await align();
  check('advanced on: the row is back, the stored ragged right in force', on.row === 1 && on.css === 'left', on);
  await page.click('[data-panel-view="app-settings"] [data-a="justify"]');
  const set = await align();
  check('… a change there applies at once (Justified)', set.stored === 'justify' && set.css === 'justify', set);
  await page.evaluate(() => (window as any).editorAPI.advanced(false));
  // the close on its own tab closes it; the key opens and closes it
  const close = await page.evaluate(() => document.querySelectorAll('[data-ptab="app-settings"] [data-action="close-panel"]').length);
  check('its close is on its own tab', close === 1, close);
  await page.click('[data-ptab="app-settings"] [data-action="close-panel"]');
  await page.waitForFunction(() => !document.querySelector('[data-panel-view="app-settings"]'));
  check('the close on its tab closes it (out of the column)', !(await panel()).open);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());     // (the key on the page, no field)
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.waitForSelector('[data-panel-view="app-settings"] .rtx-settings');
  check('Ctrl/⌘ , opens it', (await panel()).open);
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.waitForFunction(() => !document.querySelector('[data-panel-view="app-settings"]'));
  check('Ctrl/⌘ , again closes it', !(await panel()).open);

  // ── the View options: a reader's options only ──
  await page.click('#btn-view');
  await page.waitForFunction(() => !document.getElementById('rtx-view-pop')!.hidden);
  const vpRows = () => page.evaluate(() => { const p = document.getElementById('rtx-view-pop')!;
    return { rows: [...p.querySelectorAll('[data-setting]')].map((x: any) => x.dataset.setting), checks: p.querySelectorAll('input[type=checkbox]').length, align: p.querySelectorAll('[data-a]').length }; });
  const vp = await vpRows();
  check('the View options: Column width, Text size, Colours; no switches; no line ends while advanced features are off', vp.rows.join() === 'view-width,view-text,view-theme' && vp.checks === 0 && vp.align === 0, vp);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).editorAPI.advanced(true));
  await page.click('#btn-view');
  await page.waitForFunction(() => !document.getElementById('rtx-view-pop')!.hidden);
  const vp2 = await vpRows();
  check('… with them on: Line ends (Justified / Ragged right) after the text size', vp2.rows.join() === 'view-width,view-text,view-align,view-theme' && vp2.align === 2, vp2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).editorAPI.advanced(false));
  await ctx.close();

  // a phone: the Settings panel takes the whole width
  const { ctx: c2, page: p2 } = await open('#/doc/sample', { width: 390, height: 844 });
  await p2.click('#btn-main-menu');
  await p2.click('.main-menu [data-action="settings"]');
  await p2.waitForSelector('[data-panel-view="app-settings"] .rtx-settings');
  const pw = await p2.evaluate(() => Math.round(document.querySelector('[data-panel-view="app-settings"]')!.closest('aside')!.getBoundingClientRect().width));
  check('a phone: the Settings panel is the window\'s whole width', pw === 390, pw);
  await c2.close();
}
