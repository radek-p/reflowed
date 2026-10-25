// ── the main menu (the Re button) and the Settings panel: the menu's top level and submenus, by the pointer and the
// keyboard (↓ ↑ → ← Escape), its keys shown; Settings… and Ctrl/⌘ , open the panel (on the right, a third of the window
// within its bounds), the key again and the close on its tab close it; its sections in order; a setting changed there
// applies; the View options keep only what a reader changes while reading ──
//   a section of tests/test-integrate.ts: node tests/test-integrate.ts [base] --only '^main-menu$'
import type { Harness } from './harness.ts';

export default async function (h: Harness): Promise<void> {
  const { check, open, idle } = h;
  const { ctx, page } = await open('#/doc/sample', { width: 1440, height: 900 });
  const menuState = () => page.evaluate(() => {
    const panels = [...document.querySelectorAll('.main-menu[role="menu"]')];
    const rows = (p: Element) => [...p.querySelectorAll(':scope > .menu-item')].map((b: any) => b.dataset.action);
    return { panels: panels.length, root: panels[0] ? rows(panels[0]) : [], sub: panels[1] ? rows(panels[1]) : [], subLabel: panels[1]?.getAttribute('aria-label') ?? null,
      focus: (document.activeElement as HTMLElement | null)?.dataset?.action ?? null, expanded: document.getElementById('btn-main-menu')!.getAttribute('aria-expanded') };
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
  await page.click('.main-menu [data-action="keys"]');
  await page.waitForSelector('dialog.shortcuts[open]');
  check('a pick runs it (Keyboard shortcuts) and closes the menu', !(await page.$('.main-menu')));
  await page.keyboard.press('Escape');

  // ── the Settings panel ──
  const panel = () => page.evaluate(() => {
    const el = document.querySelector('[data-panel-view="app-settings"] .rtx-settings');
    const aside = el?.closest('aside[data-side]');
    return { open: !!el, side: aside?.getAttribute('data-side') ?? null, w: aside ? Math.round(aside.getBoundingClientRect().width) : 0, area: Math.round(document.querySelector('.wb-root')!.getBoundingClientRect().width),
      sections: el ? [...el.querySelectorAll('.rtx-set-section')].map((x: any) => x.dataset.section) : [], hints: el ? el.querySelectorAll('.rtx-set-hint, .rtx-vp-hint').length : 0,
      focusIn: !!el && !!document.activeElement?.closest('aside[data-side]') };
  });
  await page.click('#btn-main-menu');
  await page.click('.main-menu [data-action="settings"]');
  await page.waitForSelector('[data-panel-view="app-settings"] .rtx-settings');
  await idle(page);
  let p = await panel();
  check('Settings… opens the Settings panel, on the right, focused', p.open && p.side === 'right' && p.focusIn, p);
  check('its column: a third of the window, between 380 and 560 px', Math.abs(p.w - Math.max(380, Math.min(560, p.area / 3))) <= 2, p);
  check('its sections in order: Reading, Editing, Notes, This document, Advanced; every row explained', p.sections.join() === 'view,editing,notes,document,advanced' && p.hints >= 7, p);
  // a setting changed there applies: ragged right (the viewer's alignment), block handles off
  await page.click('[data-panel-view="app-settings"] [data-a="left"]');
  await page.click('[data-panel-view="app-settings"] #set-handles');
  const applied = await page.evaluate(() => ({ align: document.documentElement.style.getPropertyValue('--latex-align'), noHandles: document.documentElement.hasAttribute('data-no-handles'),
    s: (window as any).editorAPI.view().settings }));
  check('a setting changed there applies at once (ragged right, block handles off)', applied.align === 'left' && applied.noHandles && applied.s.align === 'left' && applied.s.handles === false, applied);
  await page.evaluate(() => (window as any).editorAPI.view().set({ align: 'justify', handles: true }));
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
  const vp = await page.evaluate(() => { const p = document.getElementById('rtx-view-pop')!;
    return { rows: [...p.querySelectorAll('[data-setting]')].map((x: any) => x.dataset.setting), checks: p.querySelectorAll('input[type=checkbox]').length, align: p.querySelectorAll('[data-a]').length }; });
  check('the View options: Column width, Text (size, Justified / Ragged right), Colours; no switches', vp.rows.join() === 'view-width,view-text,view-theme' && vp.checks === 0 && vp.align === 2, vp);
  await page.keyboard.press('Escape');
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
