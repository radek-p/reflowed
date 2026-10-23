// the kit's showcase (design/showcase.html; built and shot by design/showcase.ts).
import { signal } from '@preact/signals';
import { html, render, Button, IconButton, Input, Select, Tabs, Segmented, Chip, Pill, Card, Banner,
  Menu, MenuItem, MenuSeparator, MenuLabel, Toast, Icon, ICON_NAMES } from './ui/index.js';

const tab = signal('outline'), strip = signal('result'), seg = signal('medium'), chip = signal(true);
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'dark') document.documentElement.classList.add('dark');

function Row({ label, children }) {
  return html`<div class="sc-row"><div class="sc-label">${label}</div><div class="sc-items">${children}</div></div>`;
}
function App() {
  return html`<main class="sc">
    <h1 class="sc-h1">ReflowEd design kit</h1>
    <p class="sc-lead">Controls 24 / 28 / 32 px (44 on touch), type 11–16 px, radii 6 / 8 / 12, borders mixed from currentColor.</p>

    <section class="sc-sec"><h2>Button</h2>
      <${Row} label="variants"><${Button} variant="primary">New<//><${Button}>Import…<//><${Button} variant="ghost">Cancel<//><${Button} variant="danger" icon="trash">Delete<//><${Button} disabled>Disabled<//><//>
      <${Row} label="sizes"><${Button} size="sm">Small<//><${Button}>Medium<//><${Button} size="lg">Large<//><${Button} variant="primary" size="lg" icon="plus">Add a block<//><//>
      <${Row} label="pill"><${Button} pill size="sm" icon="search">Inspect<//><${Button} pill>Show changes<//><//>
    </section>

    <section class="sc-sec"><h2>IconButton</h2>
      <${Row} label="sizes"><${IconButton} size="sm" icon="plus" label="Add a block below" /><${IconButton} icon="more" label="Document menu" /><${IconButton} size="lg" icon="sidebarLeft" label="Sidebar" /><${IconButton} icon="textSize" label="View options" pressed=${true} /><${IconButton} quiet icon="close" label="Close" /><//>
      <${Row} label="icons">${ICON_NAMES.map((n) => html`<span class="sc-icon" title=${n}><${Icon[n]} /></span>`)}<//>
    </section>

    <section class="sc-sec"><h2>Input</h2>
      <${Row} label="fields"><${Input} placeholder="Search titles, authors and text" icon="search" style="width: 280px" /><${Input} placeholder="Label" /><${Input} size="sm" placeholder="Filter…" /><//>
      <${Row} label="quiet / mono"><${Input} quiet value="Functors and Their Transformations" style="width: 300px" /><${Input} mono value="\\usepackage{amsmath}" /><${Select}><option>In browser · Tectonic</option><option>None</option><//><//>
    </section>

    <section class="sc-sec"><h2>Tabs, Segmented</h2>
      <${Row} label="seg"><${Tabs} value=${tab.value} onChange=${(v) => { tab.value = v; }} items=${[{ id: 'outline', label: 'Outline' }, { id: 'problems', label: 'Problems', count: 3, tone: 'danger' }, { id: 'todos', label: 'TODOs', count: 2 }, { id: 'refs', label: 'Refs' }]} /><//>
      <${Row} label="strip"><div style="width: 360px"><${Tabs} variant="strip" value=${strip.value} onChange=${(v) => { strip.value = v; }} items=${[{ id: 'result', label: 'Result' }, { id: 'latex', label: 'LaTeX' }]} /></div><//>
      <${Row} label="segmented"><${Segmented} label="Width" value=${seg.value} onChange=${(v) => { seg.value = v; }} options=${[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }]} /><//>
    </section>

    <section class="sc-sec"><h2>Chip, Pill</h2>
      <${Row} label="chips"><${Chip} selected=${chip.value} count=${39} onClick=${() => { chip.value = !chip.value; }}>All<//><${Chip} selected=${false} count=${12}>Cited<//><${Chip} dot="#c7a100">Referee<//><${Chip} dot="#3b7dd8">Editor<//><//>
      <${Row} label="pills"><${Pill}>7<//><${Pill} tone="danger">167<//><${Pill} tone="accent">new<//><${Pill} tone="outline">About and licence<//><//>
    </section>

    <section class="sc-sec"><h2>Menu</h2>
      <${Row} label="menu"><div style="position: relative">
        <${Menu} label="Block">
          <${MenuItem} label="Edit source" shortcut="↵" /><${MenuItem} label="Duplicate" shortcut="⌘D" /><${MenuItem} label="Move up" shortcut="⌥↑" disabled />
          <${MenuSeparator} /><${MenuItem} label="Delete" shortcut="⌫" danger />
        <//></div>
        <${Menu} label="Block types">
          <${MenuLabel}>Text<//><${MenuItem} tile="¶" label="Paragraph" hint="Plain text" active /><${MenuItem} tile="§" label="Section" hint="\\section{…}" />
          <${MenuLabel}>Theorems<//><${MenuItem} tile="T" label="Theorem" hint="\\begin{theorem}" />
        <//><//>
    </section>

    <section class="sc-sec"><h2>Card, Banner, Toast</h2>
      <${Card} tabs=${html`<${Tabs} variant="strip" value="result" items=${[{ id: 'result', label: 'Result' }, { id: 'latex', label: 'LaTeX' }]} />`}>
        <p class="sc-tex"><b>Theorem 1.</b> <i>Every graph of bounded merge-width is weakly sparse or contains every biclique.</i></p>
      <//>
      <div style="height: 12px"></div>
      <${Banner} actions=${html`<${Button} size="sm">Keep mine<//><${Button} size="sm" variant="primary">Update<//>`}>This document changed in the new build. Your copy has edits.<//>
      <div style="height: 12px"></div>
      <div class="sc-toasts"><${Toast} text="Block deleted" action=${{ label: 'Undo', onClick: () => {} }} /><${Toast} text="Focus mode off" /></div>
    </section>

    <section class="sc-sec"><h2>Popover, Dialog</h2>
      <${Row} label="popover"><div class="ui-popover ui-popover--pad sc-static" role="dialog" aria-label="View">
        <div class="sc-cap">Column width</div><${Segmented} label="Width" value=${seg.value} onChange=${(v) => { seg.value = v; }} options=${[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }]} />
      </div><//>
      <${Row} label="dialog"><div class="ui-dialog sc-static" style="display: flex; position: static; width: 420px" role="dialog" aria-label="Versions">
        <div class="ui-dialog-head"><h2 class="ui-dialog-title">Versions</h2><${IconButton} quiet icon="close" label="Close" /></div>
        <div class="ui-dialog-body">A version is a copy of the whole document you can go back to.</div>
        <div class="ui-dialog-foot"><${Button} variant="ghost">Cancel<//><${Button} variant="primary">Save version<//></div>
      </div><//>
    </section>
  </main>`;
}
render(html`<${App} />`, document.getElementById('app'));
