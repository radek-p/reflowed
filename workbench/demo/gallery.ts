// ?gallery: every control of the workbench's kit (src/kit) in every registered theme. Without ?theme the page shows
// one frame per theme (?gallery&theme=<id>&embed); with it, the components themselves, on that theme's tokens.
// tests/e2e.ts checks the metrics and the alignment here.
import { html, render, kit, themes } from '../src/index.ts';
import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import { THEME, setTheme } from './theme.ts';

const { Button, IconButton, Toggle, Switch, Input, Menu, MenuItem, MenuSeparator, MenuLabel, Select, Popover, Tooltip, ThemeSwitch } = kit;

const CSS = `
html, body { height: auto; min-height: 100%; margin: 0; background: var(--rfed-page); color: var(--rfed-ink); }
.gal { font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); padding: 16px; display: grid; gap: 20px; }
.gal h2 { font-size: var(--ui-text-sm); font-weight: var(--ui-semibold); color: var(--rfed-ink-2); margin: 0 0 6px; }
.gal-bar { display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 6px; --wb-btn-h: 32px; box-shadow: inset 0 -1px 0 var(--rfed-top-bar-border); }
.gal-row { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.gal-pop { position: static; box-shadow: var(--ui-shadow-pop); border-radius: var(--ui-r-md); background: var(--rfed-surface); }
.gal-frames iframe { display: block; width: 100%; height: 760px; border: 0; box-shadow: 0 0 0 1px var(--rfed-border); margin-bottom: 12px; }
`;

const DOCS = [['lemma', 'A lemma on streams'], ['graphs', 'Graphs and trees'], ['konig', 'Kőnig\'s lemma, revisited']];
const SECTIONS = [['1', 'Introduction', 0], ['2', 'Preliminaries', 0], ['2.1', 'Notation', 1], ['3', 'The main result', 0], ['4.2', 'Proof of Theorem 3', 1]];

function Components() {
  const [pressed, setPressed] = useState(true);
  const [on, setOn] = useState(true);
  const [anchor, setAnchor] = useState(null);
  const pop = useRef(null);
  useLayoutEffect(() => setAnchor(pop.current), []);
  const theme = THEME.value;
  return html`<div class="gal" data-gallery=${theme}>
    <section data-g="buttons"><h2>Buttons, in a bar (the top bar's metrics)</h2>
      <div class="gal-bar" data-g-bar>
        <${IconButton} icon="home" label="Documents" />
        <${Button} label="Preview · dev" />
        <${Button} icon="file" label="With an icon" />
        <${IconButton} icon="split" label="Split view" />
        <${Toggle} icon="sidebarLeft" label=${undefined} tip="Left panel" aria-label="Left panel" pressed=${pressed} onChange=${setPressed} />
        <${Toggle} label="Pressed" pressed=${pressed} onChange=${setPressed} />
        <${Switch} label="Switch" checked=${on} onChange=${setOn} />
        <${ThemeSwitch} value=${theme} onChange=${setTheme} />
        <${Button} label="Disabled" disabled />
        <${IconButton} icon="more" label="Menu" />
      </div>
    </section>
    <section data-g="input"><h2>Input</h2><${Input} aria-label="Name" value="A lemma on streams" /></section>
    <div class="gal-row">
      <section data-g="menu"><h2>Menu (commands)</h2><div class="wb-pop gal-pop">
        <${Menu} label="Tab actions">
          <${MenuItem} label="Rename…" shortcut="F2" />
          <${MenuItem} label="Close" shortcut="Ctrl+Alt+W" />
          <${MenuItem} label="Close others" disabled />
          <${MenuSeparator} />
          <${MenuLabel}>Theme<//>
          <${MenuItem} label="Light" active lead />
          <${MenuItem} label="Dark" lead />
          <${MenuSeparator} />
          <${MenuItem} label="Delete" danger />
        <//></div></section>
      <section data-g="select-theme"><h2>Select: the theme</h2><div class="wb-pop gal-pop">
        <${Select} label="Theme" rows=${[...themes().map((t) => ({ id: `theme-${t.id}`, label: t.label, active: t.id === theme, onSelect: () => setTheme(t.id) })), { id: 'theme-system', label: 'System' }]} /></div></section>
      <section data-g="select-docs"><h2>Select: the documents</h2><div class="wb-pop gal-pop">
        <${Select} label="Documents" rows=${DOCS.map(([id, label], i) => ({ id: `doc-${id}`, label, active: i === 0, action: { label: `Open ${label} in a new tab` } }))} /></div></section>
      <section data-g="select-sections"><h2>Select: the sections</h2><div class="wb-pop gal-pop">
        <${Select} label="Sections" rows=${SECTIONS.map(([num, label, depth], i) => ({ id: `sec-${num}`, num, label, depth, active: i === 1, action: { label: `Open ${label} in a new tab` } }))} /></div></section>
    </div>
    <div class="gal-row" style="gap: 160px">
      <section data-g="tooltip"><h2>Tooltip</h2><div class="gal-bar"><${Tooltip} open text="Split view" keys="Ctrl+K Ctrl+\\"><${IconButton} icon="split" label="Split view" /><//></div></section>
      <section data-g="popover" style="min-height: 140px"><h2>Popover</h2><div class="gal-bar"><span ref=${pop}><${Button} label="Anchor" /></span></div>
        ${anchor ? html`<${Popover} anchor=${anchor} focus=${false} label="A popover" onClose=${() => {}}>A popover: any content, on the surface token.<//>` : null}</section>
    </div>
  </div>`;
}

export function gallery(q: URLSearchParams): void {
  document.getElementById('wb-viewport-css')?.remove();     // the gallery is a page that scrolls: it does not own the window
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
  document.body.innerHTML = '';
  document.body.style.cssText = 'display:block;overflow:auto;height:auto';
  const root = document.createElement('div');
  document.body.append(root);
  if (q.has('theme')) render(html`<${Components} />`, root);
  else render(html`<div class="gal gal-frames" data-gallery="all">${themes().map((t) => html`<section><h2>${t.label}</h2>
    <iframe src=${`?gallery&theme=${t.id}&embed`} title=${`The kit in ${t.label}`} data-gallery-frame=${t.id}></iframe></section>`)}</div>`, root);
}
