// The gallery: the workbench's kit (workbench/src/kit), every control on the theme's tokens: the buttons in a bar
// (the top bar's metrics), the input, a menu, the three selects (theme, documents, sections), a tooltip and a popover.
// tests/test-gallery.ts checks the metrics here: one button height and radius in the bar, one row metric for the
// menus and selects, the selects' text at one x (was workbench/demo's ?gallery, checked by workbench/tests/e2e).
import { useState, useRef } from 'preact/hooks';
import { kit, themes, html } from '../../../workbench/src/index.ts';
import { Section, Group, useInView } from './parts.ts';
import { THEMES, type Gallery } from './main.ts';

const { Button, IconButton, Toggle, Switch, Input, Menu, MenuItem, MenuSeparator, MenuLabel, Select, Popover, Tooltip, ThemeSwitch } = kit;

const DOCS: readonly [string, string][] = [['lemma', 'A lemma on streams'], ['graphs', 'Graphs and trees'], ['konig', 'Kőnig\'s lemma, revisited']];
const SECTIONS: readonly [string, string, number][] = [['1', 'Introduction', 0], ['2', 'Preliminaries', 0], ['2.1', 'Notation', 1], ['3', 'The main result', 0], ['4.2', 'Proof of Theorem 3', 1]];

export function WbKitSection({ g }: { g: Gallery }) {
  const [pressed, setPressed] = useState(true);
  const [on, setOn] = useState(true);
  const pop = useRef<HTMLSpanElement>(null), tip = useRef<HTMLDivElement>(null);
  const popSeen = useInView(pop), tipSeen = useInView(tip);
  const wbTheme = THEMES.find((t) => t.value === g.theme.value)?.wb ?? 'light';
  return html`<${Section} g=${g} id="wb-kit" title="Workbench kit" lead="workbench/src/kit: the tabs' and the bar's controls, on the theme tokens (--rfed-*).">
    <div class="gal-wb" data-gallery=${wbTheme}>
      <${Group} title="Buttons, in a bar (the top bar's metrics)" g="buttons">
        <div class="gal-wb-bar" data-g-bar>
          <${IconButton} icon="home" label="Documents" />
          <${Button} label="Preview · dev" />
          <${Button} icon="file" label="With an icon" />
          <${IconButton} icon="split" label="Split view" />
          <${Toggle} icon="sidebarLeft" label=${undefined} tip="Left panel" aria-label="Left panel" pressed=${pressed} onChange=${setPressed} />
          <${Toggle} label="Pressed" pressed=${pressed} onChange=${setPressed} />
          <${Switch} label="Switch" checked=${on} onChange=${setOn} />
          <${ThemeSwitch} value=${wbTheme} onChange=${(id: string) => g.setTheme(id)} />
          <${Button} label="Disabled" disabled />
          <${IconButton} icon="more" label="Menu" />
        </div>
      <//>
      <${Group} title="Input" g="input"><${Input} aria-label="Name" value="A lemma on streams" /><//>
      <div class="gal-wb-row">
        <${Group} title="Menu (commands)" g="menu"><div class="wb-pop gal-wb-pop">
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
          <//></div><//>
        <${Group} title="Select: the theme" g="select-theme"><div class="wb-pop gal-wb-pop">
          <${Select} label="Theme" rows=${[...themes().map((t) => ({ id: `theme-${t.id}`, label: t.label, active: t.id === wbTheme, onSelect: () => g.setTheme(t.id) })), { id: 'theme-system', label: 'System' }]} /></div><//>
        <${Group} title="Select: the documents" g="select-docs"><div class="wb-pop gal-wb-pop">
          <${Select} label="Documents" rows=${DOCS.map(([id, label], i) => ({ id: `doc-${id}`, label, active: i === 0, action: { label: `Open ${label} in a new tab` } }))} /></div><//>
        <${Group} title="Select: the sections" g="select-sections"><div class="wb-pop gal-wb-pop">
          <${Select} label="Sections" rows=${SECTIONS.map(([num, label, depth], i) => ({ id: `sec-${num}`, num, label, depth, active: i === 1, action: { label: `Open ${label} in a new tab` } }))} /></div><//>
      </div>
      <div class="gal-wb-row gal-wb-row--far">
        <${Group} title="Tooltip" g="tooltip"><div class="gal-wb-bar" ref=${tip}>${tipSeen ? html`<${Tooltip} open text="Split view" keys="Ctrl+K Ctrl+\\"><${IconButton} icon="split" label="Split view" /><//>` : html`<${IconButton} icon="split" label="Split view" />`}</div><//>
        <${Group} title="Popover" g="popover"><div class="gal-wb-bar gal-wb-pop-room"><span ref=${pop}><${Button} label="Anchor" /></span></div>
          ${popSeen && pop.current ? html`<${Popover} anchor=${pop.current} focus=${false} label="A popover" onClose=${() => {}}>A popover: any content, on the surface token.<//>` : null}<//>
      </div>
    </div>
  <//>`;
}
