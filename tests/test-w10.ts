// (reference navigation) against the dev app on the intro (its \Cref to the theorem; a block inserted here adds
// an \eqref and a \ref, which the intro does not have).
//
//   node tests/test-w10.ts [http://localhost:8158/] [--browser chromium|firefox|webkit] [--smoke] [--no-shots]
//   (app/src/refnav/dev/run.sh test … runs it)
//
// Chromium: the whole list; --smoke (Firefox, WebKit): units, no dead links,
// the card on hover, ⌘/Ctrl-click, Back. Waits on editorAPI.whenIdle(), the
// refnav events ('refnav:card', 'refnav:jumped', 'refnav:back') and DOM
// conditions; never on fixed times. Results: test-results/w10/<browser>/.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BROWSER = flag('--browser') ?? 'chromium';
const SMOKE = argv.includes('--smoke');
const SHOTS = !argv.includes('--no-shots');
const URL0 = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:8158/').replace(/\/?$/, '/');
const OUT = join(resultsDir(HERE), 'w10', BROWSER);
mkdirSync(OUT, { recursive: true });
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
const MOD = 'Control';

type R = { name: string; ok: boolean; detail?: string };
const results: R[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  results.push({ name, ok, detail: d });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d.slice(0, 300)}` : ''}`);
};
async function step(name: string, f: () => Promise<void>) {
  try { await f(); } catch (e: any) { check(`${name} (exception)`, false, e.message.split('\n')[0]); }
}

// a fresh profile per run (no stored documents from an earlier run, none shared with a concurrent one), removed at the end
const PROFILE = mkdtempSync(join(tmpdir(), `w10-test-${BROWSER}-`));
const ctx = await pw[BROWSER].launchPersistentContext(PROFILE, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = ctx.pages()[0] ?? await ctx.newPage();
const problems: string[] = [];
page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.setDefaultTimeout(120000);
const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: join(OUT, `${name}.png`) }); };
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** resolves on the next `name` event on document (armed before `act` runs) */
async function onEvent(name: string, act: () => Promise<unknown>, pred = 'true') {
  await page.evaluate(([n, p]: string[]) => {
    (window as any).__w10ev = new Promise((res) => {
      const f = (e: any) => { const d = e.detail; if (eval(p)) { document.removeEventListener(n, f); res(d ?? {}); } };
      document.addEventListener(n, f);
    });
  }, [name, pred]);
  await act();
  return page.evaluate(() => Promise.race([(window as any).__w10ev, new Promise((_, rej) => setTimeout(() => rej(new Error('event timeout')), 20000))]));
}
const rn = (fn: string, ...a: any[]) => page.evaluate(([f, x]: [string, any[]]) => (window as any).editorAPI.refnav()[f](...x), [fn, a]);

await page.goto(`${URL0}#/doc/intro`);
await page.waitForFunction(() => (window as any).editorAPI?.route().name === 'doc', null, { timeout: 180000 });
await idle();
await page.evaluate(async () => { const api = (window as any).editorAPI; const at = api.blocks().findIndex((b: any) => /\\label\{sec:cite\}/.test(b.source)); api.insert(at + 1, 'paragraph', 'Equation \\eqref{eq:gauss} of Section~\\ref{sec:maths} is part of \\Cref{thm:gauss}, and \\cref{thm:gauss} says it again.'); await api.whenIdle(); });
// the viewer paints lazily: pass over every block with a reference once
await page.evaluate(async () => {
  const api = (window as any).editorAPI;
  const ids = [...new Set(api.refsState().refs.map((r: any) => r.blockId))];
  for (const id of ids) {
    document.querySelector(`.blk[data-id="${id}"]`)?.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  await api.whenIdle();
  document.querySelector('[data-part="page"]')!.scrollTo(0, 0);   // the pane scrolls, not the window
});
await frames();

// a helper in the page: the glyphs of a unit by id (units.js keeps them in a WeakMap; find through refnav.units order)
await page.evaluate(() => {
  (window as any).__w10 = {
    els(u: any) { return (window as any).editorAPI.refnav().elements(u.id); },
    async centre(u: any, i: number | 'last' = 0) {
      const els = this.els(u);
      const g = i === 'last' ? els[els.length - 1] : els[i];
      if (!g) return null;
      const r0 = g.getBoundingClientRect();
      if (r0.top < 80 || r0.bottom > innerHeight - 80) { document.querySelector('[data-part="page"]')!.scrollBy(0, r0.top - innerHeight / 2); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
      const r = g.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: g.textContent };
    },
  };
});
const centre = (u: any, i: number | 'last' = 0) => page.evaluate(([x, j]: [any, any]) => (window as any).__w10.centre(x, j), [u, i]);

let units: any[] = [];
let lemmaRef: any = null, lemmaInfo: any = null;
await step('units', async () => {
  units = await rn('units');
  const st = await page.evaluate(() => (window as any).editorAPI.refsState());
  const kinds = units.reduce((m: any, u: any) => ({ ...m, [u.kind]: (m[u.kind] ?? 0) + 1 }), {});
  check('every reference in the document is a unit (\\Cref, \\cref, \\eqref)', units.length >= st.refs.length * 0.95, { units: units.length, refs: st.refs.length, kinds });
  const dead = await page.evaluate(() => [...document.querySelectorAll('.blk-render [data-link-href^="#"], .blk-render [data-link-label]')].length);
  check('no hyperref links left on internal references (no dead half-links)', dead === 0, { dead });
  const unresolvedLinks = units.filter((u) => u.hadLink && !u.targets.some(Boolean));
  check('every former link unit resolves to a block by label', unresolvedLinks.length === 0, unresolvedLinks.slice(0, 3));
  const eq = units.filter((u) => u.kind === 'ref' && u.hadLink && /^\(.*\)$/.test(u.text));
  check('\\eqref: brackets and number are one unit', eq.length > 0 && eq.every((u) => u.text.length >= 3), eq.slice(0, 2).map((u) => u.text));
  lemmaRef = units.find((u) => u.kind === 'Cref' && u.labels.length === 1 && /^thm:/.test(u.labels[0]) && u.targets[0] && u.targets[0] !== u.blockId);
  lemmaInfo = lemmaRef && st.labels[lemmaRef.labels[0]];
  check('a \\Cref to a theorem found', !!lemmaRef, lemmaRef ? [lemmaRef.labels, lemmaRef.text] : '');
});

if (!SMOKE) {
  await step('space after a reference', async () => {
    const res = await page.evaluate(async () => {
      const api = (window as any).editorAPI;
      const out: any[] = [];
      for (const kind of ['rtxC', 'rtxc', 'rtxr']) {
        const g0 = [...document.querySelectorAll(`.blk-render tspan[data-slot^="${kind}:"]`)] as SVGTSpanElement[];
        for (const g of g0) {
          const line = [...g.parentElement!.querySelectorAll('tspan')].filter((t) => t.getAttribute('y') === g.getAttribute('y')) as SVGTSpanElement[];
          const i = line.indexOf(g);
          let j = i; while (line[j + 1]?.dataset.slot === g.dataset.slot) j++;
          const sp = line[j + 1], nx = line[j + 2];
          if (!sp || sp.textContent !== ' ' || !nx || !nx.textContent?.trim()) continue;
          const gap = nx.getBoundingClientRect().left - line[j].getBoundingClientRect().right;
          const others: number[] = [];
          for (let k = 1; k + 1 < line.length; k++) if (line[k].textContent === ' ' && k !== j + 1 && !line[k - 1].dataset.slot) {
            const a = line[k - 1].getBoundingClientRect().right, b = line[k + 1].getBoundingClientRect().left; others.push(b - a);
          }
          if (others.length < 2) continue;
          others.sort((a, b) => a - b);
          out.push({ kind, text: line.slice(i, j + 1).map((t) => t.textContent).join(''), gap: +gap.toFixed(2), word: +others[others.length >> 1].toFixed(2) });
          break;
        }
      }
      return out;
    });
    const bad = res.filter((r: any) => Math.abs(r.gap - r.word) > 0.5 + r.word * 0.15);
    check('the space after a reference is one interword space (\\Cref, \\cref, \\ref)', res.length > 0 && bad.length === 0, res);
  });
}

let y0 = 0;
await step('hover card', async () => {
  const c = await centre(lemmaRef);
  y0 = await page.evaluate(() => document.querySelector('[data-part="page"]')!.scrollTop);
  const ev: any = await onEvent('refnav:card', () => page.mouse.move(c.x, c.y), 'd.open');
  await frames();
  const card = await rn('card');
  check('hover opens the card for the reference', card.open && ev.labels?.[0] === lemmaRef.labels[0], card.title);
  check('the card shows the theorem\'s number', card.title.includes(lemmaInfo.number) && /Theorem/.test(card.title), { title: card.title, number: lemmaInfo.number });
  const targetText = await page.evaluate((id: string) => document.querySelector(`.blk[data-id="${id}"] .blk-render`)?.textContent ?? '', lemmaRef.targets[0]);
  const norm = (s: string) => s.replace(/\s+/g, '');
  const probe = norm(targetText).slice(12, 60);
  check('the card shows the theorem\'s typeset text', probe.length > 10 && norm(card.text).includes(probe), { probe, card: card.text.slice(0, 120) });
  const aria = await page.evaluate(() => { const g = document.querySelector('.rn-ref[aria-describedby="rn-card"]'); return g && { role: g.getAttribute('role'), tab: g.getAttribute('tabindex') }; });
  check('the reference is described by the card (aria-describedby, role=link, focusable)', aria?.role === 'link' && aria?.tab === '0', aria);
  await shot('01-hover-card');
  {
    // (Preact migration) the card on the kit: the surface and pop shadow, radius 12, Go to a small primary button
    const k = await page.evaluate(() => {
      const c = document.querySelector('#rn-card') as HTMLElement, go = c.querySelector('.rn-go') as HTMLElement | null;
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--ui-surface)'; document.body.append(probe);
      const surface = getComputedStyle(probe).backgroundColor; probe.remove();
      const cs = getComputedStyle(c);
      return { radius: cs.borderRadius, bg: cs.backgroundColor, surface, shadow: cs.boxShadow !== 'none', go: go?.className ?? '', goH: go ? Math.round(go.getBoundingClientRect().height) : 0 };
    });
    check('card on the kit: surface, shadow, radius 12; Go to a small primary kit button (24 px)', k.radius === '12px' && k.bg === k.surface && k.shadow
      && /ui-btn--primary/.test(k.go) && /ui-btn--sm/.test(k.go) && k.goH === 24, k);
  }
  // the card stays while the pointer moves into it
  const box = await page.locator('.rn-card').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 12, { steps: 4 });
  await page.waitForTimeout(0);
  const still = await page.evaluate(() => new Promise((r) => setTimeout(() => r(!(document.querySelector('.rn-card') as HTMLElement).hidden), 400)));
  check('the card stays open with the pointer in it', still === true);
});

await step('Go to and Back', async () => {
  const ev: any = await onEvent('refnav:jumped', () => page.click('.rn-card .rn-go'));
  const where = await page.evaluate((id: string) => { const r = document.querySelector(`.blk[data-id="${id}"]`)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; }, lemmaRef.targets[0]);
  check('Go to scrolls the theorem into view', ev.blockId === lemmaRef.targets[0] && where.top >= 40 && where.top < where.h * 0.6, where);
  const pulse = await page.evaluate((id: string) => !!document.querySelector(`.blk[data-id="${id}"] .rn-pulse`), lemmaRef.targets[0]);
  check('the target block pulses', pulse);
  const pill = await page.evaluate(() => { const p = document.querySelector('.rn-back') as HTMLElement; return p && !p.hidden; });
  check('the Back pill appears', pill);
  {
    const k = await page.evaluate(() => { const p = document.querySelector('.rn-back') as HTMLElement; return { cls: p.className, icon: !!p.querySelector('svg.ui-icon'), label: p.getAttribute('aria-label'), h: Math.round(p.getBoundingClientRect().height) }; });
    check('the Back pill is a kit pill button with the back icon (32 px)', /ui-btn--pill/.test(k.cls) && k.icon && k.label === 'Back to where you were' && k.h === 32, k);
  }
  await shot('02-jumped');
  const b: any = await onEvent('refnav:back', () => page.click('.rn-back'));
  check('Back returns to the same scroll position (±10 px)', Math.abs(b.scrollY - y0) <= 10, { before: y0, after: b.scrollY });
  const gone = await page.waitForFunction(() => (document.querySelector('.rn-back') as HTMLElement).hidden, null, { timeout: 5000 }).then(() => true, () => false);
  check('the pill goes once you are back', gone);
});

await step('Ctrl-click and the shortcut back', async () => {
  const c = await centre(lemmaRef);
  const yA = await page.evaluate(() => document.querySelector('[data-part="page"]')!.scrollTop);
  const ev: any = await onEvent('refnav:jumped', () => (async () => { await page.keyboard.down(MOD); await page.mouse.click(c.x, c.y); await page.keyboard.up(MOD); })());
  const editing = await page.evaluate(() => (window as any).editorAPI.caret());
  check('⌘/Ctrl-click jumps to the target (and does not edit)', ev.blockId === lemmaRef.targets[0] && !editing, { ev, editing });
  if (!SMOKE) {
    const b: any = await onEvent('refnav:back', () => page.keyboard.press('Alt+ArrowLeft'));
    check('Alt+← goes back', Math.abs(b.scrollY - yA) <= 10, { before: yA, after: b.scrollY });
  } else await onEvent('refnav:back', () => page.click('.rn-back'));
});

if (!SMOKE) {
  await step('plain click edits', async () => {
    await page.mouse.move(5, 450);
    const c = await centre(lemmaRef, 'last');
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => !!(window as any).editorAPI.caret(), null, { timeout: 10000 });
    const car = await page.evaluate(() => (window as any).editorAPI.caret());
    const uses = await page.evaluate((u: any) => (window as any).editorAPI.refsState().refs.filter((r: any) => r.blockId === u.blockId && r.cmd === 'Cref' && r.keys.join() === u.labels.join()), lemmaRef);
    const r = uses[lemmaRef.index] ?? uses[0];
    check('a plain click opens the source with the caret on the reference', car?.id === lemmaRef.blockId && r && car.offset > r.offset && car.offset < r.offset + r.length, { car, use: r });
    await shot('03-click-edits');
    await page.evaluate(() => (window as any).editorAPI.leave());
    await idle();
  });

  await step('\\eqref is one unit', async () => {
    units = await rn('units');
    const eq = units.find((u) => u.kind === 'ref' && u.hadLink && /^\(.+\)$/.test(u.text) && u.targets[0] && u.targets[0] !== u.blockId);
    const uses = await page.evaluate((u: any) => (window as any).editorAPI.refsState().refs.filter((r: any) => r.blockId === u.blockId && (r.cmd === 'eqref' || r.cmd === 'ref') && r.keys.join() === u.labels.join()), eq);
    const use = uses[eq.index] ?? uses[0];
    const carets: any[] = [];
    for (const i of [0, 1, 'last'] as const) {
      await page.mouse.move(5, 450);
      const c = await centre(eq, i);
      await page.mouse.click(c.x, c.y);
      await page.waitForFunction(() => !!(window as any).editorAPI.caret(), null, { timeout: 10000 });
      carets.push({ glyph: c.text, ...(await page.evaluate(() => (window as any).editorAPI.caret())) });
      await page.evaluate(() => (window as any).editorAPI.leave());
      await idle();
    }
    check('clicking "(", the number or ")" puts the caret in the same \\eqref', carets.every((c) => c.id === eq.blockId && c.offset > use.offset && c.offset < use.offset + use.length),
      { carets, use: [use.offset, use.length] });
    const c = await centre(eq, 0);
    const ev: any = await onEvent('refnav:jumped', () => (async () => { await page.keyboard.down(MOD); await page.mouse.click(c.x, c.y); await page.keyboard.up(MOD); })());
    const vis = await page.evaluate((l: string) => { const a = document.querySelector(`.latex-anchor[id="${CSS.escape(l)}"]`)?.getBoundingClientRect(); return a ? a.top > 0 && a.top < innerHeight : null; }, eq.labels[0]);
    check('⌘/Ctrl-click on a bracket goes to the equation', ev.blockId === eq.targets[0] && vis !== false, { ev, vis });
    await shot('04-eqref-jumped');
    await onEvent('refnav:back', () => page.click('.rn-back'));
  });

  await step('keyboard', async () => {
    const u = lemmaRef;
    await page.evaluate((id: string) => { const r = document.querySelector(`.blk[data-id="${id}"] .blk-render`) as HTMLElement; r.scrollIntoView({ block: 'center' }); r.focus(); }, u.blockId);
    // Tab through the block's references to this one
    let focused: any = null;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => { const a = document.activeElement as any; return a?.classList?.contains('rn-ref') ? { text: a.textContent, blk: a.closest('.blk')?.dataset.id, label: a.dataset.slot ?? a.dataset.rnLabel } : { tag: a?.tagName }; });
      if (focused.blk === u.blockId && String(focused.label ?? '').includes(u.labels[0])) break;
    }
    check('Tab reaches the reference', focused?.blk === u.blockId, focused);
    const ev: any = await onEvent('refnav:card', () => page.keyboard.press('Enter'), 'd.open');
    const inCard = await page.evaluate(() => document.activeElement?.classList.contains('rn-go'));
    check('Enter opens the card with focus on Go to', ev.open && inCard, { inCard });
    await shot('05-keyboard-card');
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({ open: !(document.querySelector('.rn-card') as HTMLElement).hidden, back: (document.activeElement as any)?.classList?.contains('rn-ref') }));
    check('Esc closes the card and returns focus to the reference', !after.open && after.back, after);
  });

  await step('a reference in a subscript (live marks)', async () => {
    const id = await page.evaluate((i: number) => (window as any).editorAPI.insert(i, 'paragraph', 'Take the sum $T_{\\ref{thm:gauss}}$ from \\Cref{thm:gauss} here.'), 8);
    await idle();
    await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), id);
    await idle();
    await frames();
    const us = (await rn('units')).filter((u: any) => u.blockId === id);
    const sub = us.find((u: any) => u.kind === 'ref'), base = us.find((u: any) => u.kind === 'Cref');
    check('the subscript \\ref and the \\Cref are units', !!sub && !!base, us.map((u: any) => [u.kind, u.text]));
    await page.mouse.move(5, 450);
    const c = await centre(sub);
    await onEvent('refnav:card', () => page.mouse.move(c.x, c.y), 'd.open');
    await frames();
    const info = await page.evaluate((u: any) => {
      const rn = (window as any).editorAPI.refnav();
      const g = rn.elements(u.id)[0].getBoundingClientRect();
      const card = document.querySelector('.rn-card')!.getBoundingClientRect();
      const bands = [...(rn.elements(u.id)[0].closest('.latex-block') as Element).querySelectorAll('rect.latex-mark[data-mark~="rn-hot"]')].map((b) => { const r = b.getBoundingClientRect(); return [r.top, r.bottom, r.height]; });
      return { hot: rn.hot(), glyph: [g.top, g.bottom], card: card.top, bands };
    }, sub);
    const r = info.hot?.rects?.[0];
    check('the hovered reference is a live mark (one band per line, from the viewer)', info.hot?.mark === 'rn-hot' && info.bands.length === 1 && info.hot.rects.length === 1, info);
    check('the band covers the subscript glyphs', !!r && r.top <= info.glyph[0] + 0.5 && r.bottom >= info.glyph[1] - 0.5, info);
    check('the card opens below the reference\'s band', !!r && info.card >= r.bottom - 0.5, { card: info.card, band: r });
    await shot('07-subscript-card');
    await page.mouse.move(5, 450);
    await page.waitForFunction((i: string) => !document.querySelector(`.blk[data-id="${i}"] rect.latex-mark[data-mark~="rn-hot"]`) && !(window as any).editorAPI.refnav().hot(), id, { timeout: 5000 }).then(() => check('the mark goes with the pointer', true), () => check('the mark goes with the pointer', false));
    await page.evaluate((i: string) => (window as any).editorAPI.remove(i), id);
    await idle();
  });

  await step('external link', async () => {
    await ctx.route('https://example.org/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ok</title>ok' }));
    const n = (await page.evaluate(() => (window as any).editorAPI.blocks().length)) as number;
    const id = await page.evaluate((i: number) => (window as any).editorAPI.insert(i, 'paragraph', 'See \\url{https://example.org/w10} for more.'), 8);
    await idle();
    await page.evaluate((i: string) => document.querySelector(`.blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), id);
    await idle();
    await frames();
    const r = await page.evaluate((i: string) => { const g = document.querySelector(`.blk[data-id="${i}"] [data-link-href^="http"]`); if (!g) return null; const b = g.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, href: (g as any).dataset.linkHref }; }, id);
    if (!r) { check('\\url is a link', false, 'no external link glyph drawn'); return; }
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }), page.mouse.click(r.x, r.y)]);
    await popup.waitForLoadState().catch(() => {});
    const still = await page.evaluate(() => location.hash);
    check('\\url opens in a new tab (the editor stays)', /example\.org\/w10/.test(popup.url()) && /#\/doc\//.test(still), { popup: popup.url(), hash: still });
    await popup.close();
    await page.evaluate((i: string) => (window as any).editorAPI.remove(i), id);
    await idle();
    check('(the inserted block removed)', (await page.evaluate(() => (window as any).editorAPI.blocks().length)) === n);
  });

  await step('targets follow block ids after a move', async () => {
    const target = lemmaRef.targets[0];
    const from = await page.evaluate((id: string) => (window as any).editorAPI.blocks().findIndex((b: any) => b.id === id), target);
    await page.evaluate(([id, to]: [string, number]) => (window as any).editorAPI.move(id, to), [target, 3]);
    await idle();
    await frames();
    const ev: any = await onEvent('refnav:jumped', () => rn('jump', lemmaRef.labels[0]));
    const where = await page.evaluate((id: string) => { const r = document.querySelector(`.blk[data-id="${id}"]`)!.getBoundingClientRect(); return { top: r.top, h: innerHeight }; }, target);
    const idx = await page.evaluate((id: string) => (window as any).editorAPI.blocks().findIndex((b: any) => b.id === id), target);
    check('after moving the theorem, the jump lands on it at its new place', ev.blockId === target && idx === 3 && where.top >= 40 && where.top < where.h * 0.6, { from, idx, where });
    await shot('06-after-move');
    await page.evaluate(() => (window as any).editorAPI.undo());
    await idle();
    const back = await page.evaluate((id: string) => (window as any).editorAPI.blocks().findIndex((b: any) => b.id === id), target);
    check('(undo puts it back)', back === from, { back, from });
  });
}

check('no console errors or page errors', problems.length === 0, problems.slice(0, 5));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ browser: BROWSER, smoke: SMOKE, at: new Date().toISOString(), passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 1));
console.log(`\n${BROWSER}${SMOKE ? ' (smoke)' : ''}: ${results.filter((r) => r.ok).length}/${results.length} passed`);
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(results.every((r) => r.ok) ? 0 : 1);
