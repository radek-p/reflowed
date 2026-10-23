// and Back comes back to the focused section.
//
//   node tests/test-cite-card.ts dev [http://localhost:8150/] | file [dist/….html]
//
//   card      every \cite of the intro (an inline thebibliography) and of the tests' biblatex document: hovered, the
//             card lists each key's entry as the bibliography has it (authors, title, venue, year, the DOI as a link;
//             computed here with bib/bbl.ts and bib/bibitems.ts)
//   buttons   "Show in References" opens the References pane on the entry; "Go to the reference list" brings the
//             bibliography block into view; Back returns; ⌘/Ctrl-click goes to the list
//   keys      the first glyph is a link named "Citation …" with a dialog popup; Enter opens the card with the focus on
//             its first action; Escape closes it and gives the focus back; the card is a dialog named by its title
//   themes    light and dark: the card's text against its background at least 4.5:1
//   natbib    a document with natbib author-year (\citet, \citep) and one with natbib numbers: the card shows the entry
//   panes     pane B: the card opens from its citation, the list is reached in pane B, pane A does not move
//   focus a section focused, a \ref go-to into another section: the focus is left, the target in view;
//             Back: the section focused again, at the same scroll; the outline too; both panes
// Waits on events (refnav:card, refnav:jumped, refnav:back), whenIdle() and frames; never on fixed times.
import { createRequire } from 'node:module';
import { paneA, splitB, closePane } from './qa/lib/panes.ts';
import { mkdtempSync } from 'node:fs';
import { BBL as BIBLATEX_BBL, openBiblatexDoc } from './qa/fixtures/biblatex-doc.ts';
import { buildIntroSeed } from '../samples/intro/seed-intro.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBbl, nameText } from '../app/src/bib/bbl.ts';
import { bibitemsOf, bibitemFields, isBiblatexBbl } from '../app/src/bib/bibitems.ts';
import { texToText } from '../app/src/refs/tex-text.ts';
import { resultsDir } from './qa/lib/results.ts';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const TARGET = argv[0] === 'file' ? 'file' : 'dev';
// (the URL or file may come first too: `test-x.ts http://127.0.0.1:8150/` is the dev app there)
const pos = argv.find((a, i) => !a.startsWith('--') && (i > 0 || !/^(dev|file)$/.test(a))) ?? null;
const URL0 = TARGET === 'file' ? `file://${pos ?? join(HERE, 'dist/reflowtex-editor.html')}` : `${(pos ?? 'http://localhost:8150/').replace(/\/?$/, '/')}?engine`;
const pw = createRequire(join(HERE, 'app/package.json'))('playwright');
let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  n++; const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${d.slice(0, 900)}` : ''}`); if (!ok) fail++;
};
const MOD = 'Control';

/** what the card should show for each key of a seed's .bbl */
function expected(bbl: string): Map<string, { authors: string; title: string; venue: string; year: string; doi: string }> {
  const out = new Map();
  const join3 = (a: string[]) => (a.length > 2 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a.join(' and '));
  if (isBiblatexBbl(bbl)) {
    for (const e of parseBbl(bbl).entries) out.set(e.key, { authors: join3((e.names.author ?? e.names.editor ?? []).map(nameText)), title: e.card.title, venue: e.card.venue, year: e.card.year, doi: e.card.doi });
  } else {
    for (const it of bibitemsOf([bbl]).values()) {
      const f = bibitemFields(it.body);
      out.set(it.key, { authors: join3(f.author ? f.author.split(' and ').map((a) => texToText(a).trim()) : []), title: f.title ? texToText(f.title).trim() : '',
        venue: f.journal ? texToText(f.journal).trim() : '', year: f.year ?? '', doi: f.doi ?? '' });
    }
  }
  return out;
}

// the dev app's worker must carry this tree's rtx-numbering.sty (its citation slots, \\rtxbibcites): a stale one
// typesets with the old package and every check below fails for no visible reason
if (TARGET === 'dev') {
  const { workerProblem } = await import('../engine/scripts/worker-current.ts');
  const prob = workerProblem();
  if (prob) { console.log(`FAIL the dev app's engine worker is current — ${prob}`); process.exit(1); }
}
const ctx = await pw.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rtx-citecard-')), { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.setDefaultTimeout(300000);
const errors: string[] = [];
page.on('pageerror', (e: any) => errors.push(e.message.slice(0, 200)));
page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
const sep = URL0.includes('?') ? '&' : '?';
const idle = () => page.evaluate(() => (window as any).editorAPI.whenIdle());
const frames = (k = 2) => page.evaluate((k: number) => new Promise((r) => { const f = (i: number) => (i ? requestAnimationFrame(() => f(i - 1)) : r(0)); f(k); }), k);
/** open a document: a default one by its tag, 'sample' (the tests' fixture), or 'biblatex' (created here) */
async function open(doc: string) {
  await page.goto('about:blank');                         // a real load: a hash change alone would keep the old document's blocks
  if (doc === 'biblatex') {
    await page.goto(`${URL0}${sep}store=memory#/`);
    await page.waitForFunction(() => (window as any).editorAPI?.route?.());
    await openBiblatexDoc(page);
  } else await page.goto(`${URL0}${sep}store=memory${doc === 'sample' ? '&seed=sample' : ''}#/doc/${doc}`);
  await page.waitForFunction(() => (window as any).editorAPI?.whenIdle && document.querySelectorAll('[data-part="page"] .blocks > .blk').length > 2);
  await idle();
  SA = await paneA(page);
}
// the panes: pane A the document's tab, pane B the split's (their selectors); each pane scrolls
let SA = '', SB = '';
const idOf = (sel: string) => /data-pane="([^"]+)"/.exec(sel)![1];
const paneY = () => page.evaluate(() => document.querySelector('[data-part="page"]')!.scrollTop);
/** resolves on the next `name` event on document matching pred (armed before `act`) */
async function onEvent(name: string, act: () => Promise<unknown>, pred = 'true') {
  await page.evaluate(([nm, p]: string[]) => {
    (window as any).__ev = new Promise((res) => { const f = (e: any) => { const d = e.detail; if (eval(p)) { document.removeEventListener(nm, f); res(d ?? {}); } }; document.addEventListener(nm, f); });
  }, [name, pred]);
  await act();
  return page.evaluate(() => Promise.race([(window as any).__ev, new Promise((_, rej) => setTimeout(() => rej(new Error('event timeout')), 30000))]));
}
const rn = (fn: string, ...a: any[]) => page.evaluate(([f, x]: [string, any[]]) => (window as any).editorAPI.refnav()[f](...x), [fn, a]);
/** a unit's first glyph centre, the glyph brought into view first (in its pane) */
const pointOf = (id: string) => page.evaluate((i: string) => {
  const g = (window as any).editorAPI.refnav().elements(i)[0] as Element;
  g.scrollIntoView({ block: 'center' });
  const r = g.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 4), y: r.top + r.height / 2 };
}, id);
async function hoverOpen(id: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.mouse.move(5, 450);
  await page.evaluate(() => (window as any).editorAPI.refnav().closeCard());
  const p = await pointOf(id);
  await frames();
  const q = await pointOf(id);
  return onEvent('refnav:card', () => page.mouse.move(q.x ?? p.x, q.y ?? p.y), 'd.open');
}
/** every citation unit of the document (pane A): each citing block brought into view, drawn, scanned */
async function allCites() {
  const ids: string[] = await page.evaluate(() => { const api = (window as any).editorAPI, kind = new Map(api.blocks().map((b: any) => [b.id, b.kind])); return [...new Set(api.refsState().cites.filter((c: any) => !['macros', 'comment'].includes(kind.get(c.blockId) as string)).map((c: any) => c.blockId))] as string[]; });
  const out = new Map<string, any>();
  for (const id of ids) {
    await page.evaluate((i: string) => document.querySelector(`[data-part="page"] .blk[data-id="${i}"]`)?.scrollIntoView({ block: 'center' }), id);
    await idle(); await frames(3);
    await page.evaluate(() => (window as any).editorAPI.refnav().rescan());
    for (const u of await rn('units')) if (u.kind === 'cite' && u.connected && u.blockId === id) out.set(u.id, u);
  }
  return [...out.values()];
}
const cardEntries = () => page.evaluate(() => [...document.querySelectorAll('#rn-card .rn-entry')].map((li: any) => ({
  key: li.dataset.key, authors: li.querySelector('.rn-authors')?.textContent ?? '', title: li.querySelector('.rn-etitle')?.textContent ?? '',
  venue: li.querySelector('.rn-venue')?.textContent ?? '', year: li.querySelector('.rn-year')?.textContent ?? '',
  doi: (li.querySelector('a.rn-doi:not(.rn-url)') as HTMLAnchorElement | null)?.href ?? '', missing: li.classList.contains('rn-missing') })));

// ── card: every citation of the intro and of the biblatex document ──────────
const introBib = ((await buildIntroSeed()).seed.init as { bib: { source: string } }).bib.source;
for (const [doc, bib] of [['intro', introBib], ['biblatex', BIBLATEX_BBL]] as const) {
  await open(doc);
  const want = expected(bib);
  const units = await allCites();
  // (a \cite inside a definition block's macro is printed where the macro is used, not there)
  const uses = await page.evaluate(() => { const api = (window as any).editorAPI, kind = new Map(api.blocks().map((b: any) => [b.id, b.kind])); const src = new Map(api.blocks().map((b: any) => [b.id, b.source]));
    const inFootnote = (s: string, at: number) => { const i = s.lastIndexOf('\\footnote{', at); if (i < 0) return false; let d = 0; for (let j = i + 9; j < at; j++) { if (s[j] === '{') d++; else if (s[j] === '}') d--; } return d > 0; };
    return api.refsState().cites.filter((c: any) => !['macros', 'comment'].includes(kind.get(c.blockId) as string) && !inFootnote(src.get(c.blockId) as string, c.offset)).length; });
  check(`${doc}: every \\cite is a citation unit on the page (${units.length}/${uses})`, units.length === uses, { units: units.length, uses });
  const bad: string[] = [];
  let entries = 0;
  for (const u of units) {
    await hoverOpen(u.id);
    const got = await cardEntries();
    if (got.length !== u.labels.length) { bad.push(`${u.text}: ${got.length} entries for ${u.labels.length} keys`); continue; }
    for (const g of got) {
      entries++;
      const w = want.get(g.key);
      if (!w) { if (!g.missing) bad.push(`${g.key}: shown though not in the .bbl`); continue; }
      const doi = w.doi ? `https://doi.org/${w.doi.replace(/\\([_%&#$~])/g, '$1')}` : '';   // a DOI as TeX wrote it: 10.1007/x\_19
      for (const [f, a, b] of [['authors', g.authors, w.authors], ['title', g.title, w.title], ['venue', g.venue, w.venue], ['year', g.year, w.year], ['doi', g.doi && decodeURI(g.doi), doi]] as const)
        if ((a ?? '') !== (b ?? '')) bad.push(`${g.key} ${f}: "${a}" vs "${b}"`);
    }
  }
  check(`${doc}: the card shows each cited key's .bbl entry (${entries} entries in ${units.length} citations)`, bad.length === 0 && entries > 0, bad.slice(0, 6));
}

// ── buttons, keyboard, themes (the biblatex document: the References pane lists a .bbl; an inline thebibliography,
// as the intro has) ──
await open('biblatex');
{
  const u = (await allCites()).find((x: any) => x.labels.length === 1);
  await hoverOpen(u.id);
  await page.click('#rn-card .rn-show-refs');
  await page.waitForFunction((k: string) => { const s = (window as any).editorAPI.bibpane().state(); return s.open === k && !!document.querySelector(`li.bp-row[data-key="${CSS.escape(k)}"]`); }, u.labels[0], { timeout: 20000 }).then(() => true, () => false)
    .then((ok: boolean) => check('Show in References: the References pane open on the entry', ok, u.labels[0]));
  const vis = await page.evaluate((k: string) => { const r = document.querySelector(`li.bp-row[data-key="${CSS.escape(k)}"]`)!.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; }, u.labels[0]);
  check('… its row in view', vis);
  const y0 = await paneY();
  await hoverOpen(u.id);
  const y1 = await paneY();
  const ev: any = await onEvent('refnav:jumped', () => page.click('#rn-card .rn-goto-list'), 'd.list');
  const bib = await page.evaluate((id: string) => { const el = document.querySelector(`[data-part="page"] .blk[data-id="${id}"]`)!; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, ev.blockId);
  check('Go to the reference list: the bibliography block in view', bib.top < 900 && bib.bottom > 60, bib);
  const b: any = await onEvent('refnav:back', () => page.click('.rn-back'));
  check('Back returns to the citation (±10 px)', Math.abs(b.scrollY - y1) <= 10, { before: y1, after: b.scrollY, y0 });
  const p = await pointOf(u.id);
  await page.keyboard.down(MOD);
  const ev2: any = await onEvent('refnav:jumped', () => page.mouse.click(p.x, p.y), 'd.list');
  await page.keyboard.up(MOD);
  check(`${MOD}-click on a citation goes to the reference list`, !!ev2.blockId);
  await onEvent('refnav:back', () => page.keyboard.press('Alt+ArrowLeft'));
  // keyboard and names
  await page.mouse.move(5, 450);
  await page.evaluate(() => (window as any).editorAPI.refnav().closeCard());
  const a11y = await page.evaluate((i: string) => { const g = (window as any).editorAPI.refnav().elements(i)[0] as HTMLElement; g.focus(); return { role: g.getAttribute('role'), label: g.getAttribute('aria-label'), pop: g.getAttribute('aria-haspopup'), tab: g.getAttribute('tabindex'), focused: document.activeElement === g }; }, u.id);
  check('the citation\'s first glyph: a focusable link named "Citation …", popping up a dialog', a11y.role === 'link' && /^Citation \[[^\]]+\]$/.test(a11y.label ?? '') && a11y.pop === 'dialog' && a11y.tab === '0' && a11y.focused, a11y);
  await onEvent('refnav:card', () => page.keyboard.press('Enter'), 'd.open');
  const k = await page.evaluate(() => { const c = document.querySelector('#rn-card')!; const t = document.getElementById(c.getAttribute('aria-labelledby')!); const d = c.querySelector('a.rn-doi'); return { role: c.getAttribute('role'), title: t?.textContent, active: (document.activeElement as HTMLElement)?.className ?? '', doiLabel: d?.getAttribute('aria-label') ?? null, desc: (window as any).editorAPI.refnav().elements(document.activeElement && (window as any).__id) }; });
  check('Enter opens the card: a dialog named by its title, the focus on its first action', k.role === 'dialog' && /^Citation /.test(k.title ?? '') && /rn-show-refs/.test(k.active), k);
  check('… the DOI link says where it goes', k.doiLabel === null || /^DOI .*new tab/.test(k.doiLabel), k.doiLabel);
  await onEvent('refnav:card', () => page.keyboard.press('Escape'), '!d.open');
  const back = await page.evaluate((i: string) => document.activeElement === (window as any).editorAPI.refnav().elements(i)[0], u.id);
  check('Escape closes it and gives the focus back to the citation', back);
  // themes: the card's ink against its surface
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t: string) => (window as any).editorAPI.view().set({ theme: t }), theme);
    await frames(3);
    await hoverOpen(u.id);
    const c = await page.evaluate(() => {
      const lum = (s: string) => { let m = s.match(/[\d.]+/g)!.map(Number); if (/^color\(/.test(s)) m = m.map((v) => v * 255); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const card = document.querySelector('#rn-card')!, bg = getComputedStyle(card).backgroundColor;
      const r: Record<string, number> = {};
      for (const s of ['.rn-title', '.rn-etitle', '.rn-authors', '.rn-meta', '.rn-doi']) { const el = card.querySelector(s); if (el) r[s] = Math.round(ratio(getComputedStyle(el).color, bg) * 10) / 10; }
      return { bg, r, dark: lum(bg) < 0.2 };
    });
    check(`${theme}: the card's text at least 4.5:1 on its surface`, Object.values(c.r).every((x) => x >= 4.5) && c.dark === (theme === 'dark'), c);
    await page.screenshot({ path: join(resultsDir(HERE), `cite-card-${theme}.png`) });
  }
  await page.evaluate(() => (window as any).editorAPI.view().set({ theme: 'light' }));
}

// ── natbib: author-year and numbers ─────────────────────────────────────────
const NATBIB_BBL = String.raw`\begin{thebibliography}{2}
\providecommand{\natexlab}[1]{#1}
\bibitem[Doe(2001)]{doe}
Jane Doe.
\newblock A first paper.
\newblock {\em Journal of Tests}, 2001.
\bibitem[Smith et~al.(2010)Smith, Jones, and Lee]{smith}
Anne Smith, Bob Jones, and Cy Lee.
\newblock Another paper.
\newblock {\em Proceedings of Tests}, 2010.
\newblock \href {https://doi.org/10.1000/xyz}{\path{doi:10.1000/xyz}}.
\end{thebibliography}`;
for (const [style, opt, body] of [['author-year', 'authoryear', 'As \\citet{smith} show, and \\citep{doe} too.'], ['numbers', 'numbers', 'Numbers \\citep{smith,doe} here.']] as const) {
  const id = await page.evaluate(async ([o, b, bbl]: string[]) => {
    const s = (window as any).editorAPI.store();
    return s.createDoc({ title: `natbib ${o}`, preamble: `\\documentclass{article}\n\\usepackage[${o}]{natbib}`, bib: { kind: 'bbl', source: bbl, path: 'main.bbl' },
      blocks: [{ kind: 'paragraph', source: b }, { kind: 'bibliography', source: '\\bibliographystyle{plainnat}\n\\bibliography{main}' }] });
  }, [opt, body, NATBIB_BBL]);
  await page.evaluate((i: string) => { location.hash = `#/doc/${i}`; }, id);
  await page.waitForFunction((i: string) => (window as any).editorAPI.route?.().id === i && document.querySelectorAll('[data-part="page"] .blocks > .blk').length >= 2, id);
  await idle();
  await page.waitForFunction(() => (window as any).editorAPI.refnav().units().some((u: any) => u.kind === 'cite'), null, { timeout: 120000 });
  const units = (await allCites());
  const shown: string[] = [];
  for (const u of units) { await hoverOpen(u.id); for (const e of await cardEntries()) shown.push(`${e.key}:${e.authors}|${e.title}|${e.year}|${e.doi}`); }
  const ok = shown.some((s) => s === 'smith:Anne Smith, Bob Jones and Cy Lee|Another paper|2010|https://doi.org/10.1000/xyz') && shown.some((s) => s.startsWith('doe:Jane Doe|A first paper|2001'));
  check(`natbib ${style}: the card shows the entries (${units.map((u: any) => u.text).join(' / ')})`, ok && units.length >= 1, shown);
}

// ── panes: the card and the list from pane B ────────────────────────────────
await open('intro');
{
  SB = await splitB(page);
  const idB = await page.evaluate(async (sb: string) => {
    const api = (window as any).editorAPI, c = api.refsState().cites.find((x: any) => x.keys.length === 1);
    document.querySelector(`${sb} .blk[data-id="${c.blockId}"]`)?.scrollIntoView({ block: 'center' });
    await api.whenIdle(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    api.refnav().rescan();
    return api.refnav().units().find((x: any) => x.kind === 'cite' && x.blockId === c.blockId && api.refnav().elements(x.id)[0]?.closest(sb))?.id ?? null;
  }, SB);
  check('pane B: its citations are units too', !!idB);
  if (idB) {
    const aBefore = await page.evaluate((sa: string) => (document.querySelector(sa) as HTMLElement).scrollTop, SA);
    await hoverOpen(idB);
    const ev: any = await onEvent('refnav:jumped', () => page.click('#rn-card .rn-goto-list'), 'd.list');
    const r = await page.evaluate(([id, sa, sb]: string[]) => { const sc = document.querySelector(sb) as HTMLElement, el = sc.querySelector(`.blk[data-id="${id}"]`)!; const a = sc.getBoundingClientRect(), b = el.getBoundingClientRect(); return { inB: b.top < a.bottom && b.bottom > a.top, aTop: (document.querySelector(sa) as HTMLElement).scrollTop }; }, [ev.blockId, SA, SB]);
    check('pane B: "Go to the reference list" reaches the list in pane B, pane A stays', r.inB && Math.abs(r.aTop - aBefore) <= 1, { ...r, aBefore });
    await onEvent('refnav:back', () => page.click('.rn-back'));
  }
  await closePane(page, SB);
}

// ── section focus and go-to, in both panes (the fixture: references across sections) ──
await open('sample');
for (const p of ['a', 'b']) {
  if (p === 'b') SB = await splitB(page);
  const sel = p === 'a' ? SA : SB, pid = idOf(sel);
  // a reference in one section to a label in another
  const pick = await page.evaluate(async ([s]: string[]) => {
    const api = (window as any).editorAPI, st = api.refsState(), outline = api.outline().filter((x: any) => !x.special && x.level === 1);
    const blocks = api.blocks().map((b: any) => b.id);
    const secOf = (id: string) => { const i = blocks.indexOf(id); let h = null; for (const o of outline) if (blocks.indexOf(o.id) <= i) h = o.id; return h; };
    for (const r of st.refs) {
      const to = st.labels[r.keys[0]]?.blockId, from = secOf(r.blockId);
      if (!to || !from || secOf(to) === from || r.keys.length !== 1) continue;
      const el = document.querySelector(`${s} .blk[data-id="${r.blockId}"]`) as HTMLElement | null;
      if (!el) continue;
      el.scrollIntoView({ block: 'center' });
      await api.whenIdle(); await new Promise((q) => requestAnimationFrame(() => requestAnimationFrame(q)));
      api.refnav().rescan();
      const u = api.refnav().units().find((x: any) => x.blockId === r.blockId && x.labels.join() === r.keys.join() && api.refnav().elements(x.id)[0]?.closest(s));
      if (u) return { unit: u.id, label: r.keys[0], heading: from, target: to };
    }
    return null;
  }, [sel]);
  if (!pick) { check(`[${p}]: a reference across sections found`, false); continue; }
  await page.evaluate(([pp, h]: string[]) => (window as any).editorAPI.sectionFocus().set(pp, h), [pid, pick.heading]);
  await frames(3);
  // the reference in view in the focused section, the scroll noted
  await pointOf(pick.unit);
  await frames(3);
  const before = await page.evaluate(([s]: string[]) => { const sc = document.querySelector(s) as HTMLElement; return sc.scrollTop; }, [sel]);
  const ev: any = await onEvent('refnav:jumped', () => (async () => { const q = await pointOf(pick.unit); await page.keyboard.down(MOD); await page.mouse.click(q.x, q.y); await page.keyboard.up(MOD); })());
  const after = await page.evaluate(([pp, s, id]: string[]) => {
    const sc = document.querySelector(s) as HTMLElement, el = sc.querySelector(`.blk[data-id="${id}"]`) as HTMLElement;
    const box = sc.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { focus: (window as any).editorAPI.sectionFocus().get(pp), shown: el.offsetParent !== null, inView: r.top < box.bottom && r.bottom > box.top };
  }, [pid, sel, pick.target]);
  check(`[${p}]: a go-to outside the focused section leaves the focus, the target in view`, ev.blockId === pick.target && !after.focus && after.shown && after.inView, after);
  const b: any = await onEvent('refnav:back', () => page.click('.rn-back'));
  const res = await page.evaluate(([pp]: string[]) => (window as any).editorAPI.sectionFocus().get(pp), [pid]);
  check(`[${p}]: Back focuses the section again, at the same scroll (±3 px)`, res === pick.heading && Math.abs(b.scrollY - before) <= 3, { focus: res, want: pick.heading, before, after: b.scrollY });
  // the outline: a section outside the focus
  const other = await page.evaluate(([h]: string[]) => (window as any).editorAPI.outline().find((x: any) => !x.special && x.level === 1 && x.id !== h)?.id, [pick.heading]);
  await page.evaluate(([pp, i]: string[]) => { const api = (window as any).editorAPI; api.panes?.focus?.(pp); api.scrollToBlock ? api.scrollToBlock(i, pp) : null; }, [pid, other]);
  const viaApi = await page.evaluate(() => typeof (window as any).editorAPI.scrollToBlock === 'function');
  if (viaApi) {
    await frames(10);
    const st = await page.evaluate(([pp]: string[]) => ({ focus: (window as any).editorAPI.sectionFocus().get(pp), hist: (window as any).editorAPI.nav().history().length }), [pid]);
    check(`[${p}]: the outline's jump out of the focus leaves it too (Back can return)`, !st.focus && st.hist > 0, st);
    await onEvent('refnav:back', () => page.click('.rn-back'));
    const f2 = await page.evaluate(([pp]: string[]) => (window as any).editorAPI.sectionFocus().get(pp), [pid]);
    check(`[${p}]: … and Back focuses the section again`, f2 === pick.heading, f2);
  }
  await page.evaluate(([pp]: string[]) => (window as any).editorAPI.sectionFocus().set(pp, null), [pid]);
}
check('no page errors', errors.length === 0, errors);
await ctx.close();
console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
