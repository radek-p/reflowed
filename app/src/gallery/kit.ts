// The gallery: the editor's design kit (app/src/design/ui). Every component in its states;
// the floating ones (Popover, Tooltip, Dialog, Sheet, Toast) also live, on a button.
import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import { html, Button, IconButton, Input, Select, Tabs, Segmented, Chip, Pill, Card, Banner, Menu, MenuItem, MenuSeparator, MenuLabel,
  Popover, Dialog, Sheet, Toast, Tooltip, CopyButton, showToast, Icon, ICON_NAMES } from '../design/ui/index.js';
import { Section, Group, Row, useInView } from './parts.ts';
import type { Gallery } from './main.ts';

/** Every icon of the one registry (design/ui/icon-set.ts), numbered in its order, with its name, at 16, 20 and 32 px:
 *  the catalogue. */
function IconCatalogue() {
  return html`<ol class="gal-icons" data-icon-count=${ICON_NAMES.length}>${ICON_NAMES.map((n, i) => { const I = Icon[n]; return html`<li key=${n} class="gal-ic" data-icon=${n} title=${n}>
    <span class="gal-ic-n">${i + 1}</span><span class="gal-ic-row"><${I} class="gal-ic-16" /><${I} class="gal-ic-20" /><${I} class="gal-ic-32" /></span><code class="gal-ic-name">${n}</code></li>`; })}</ol>`;
}

const WIDTHS = [{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }];

/** The kit's Dialog, shown in place (non-modal, in the flow): the real component, its own markup. */
function DialogInPlace() {
  const ref = useRef<HTMLDivElement>(null);
  // show() focuses the dialog's first control: the page stays where it is, and the focus is not taken
  const show = () => {
    const d = ref.current?.querySelector('dialog');
    if (!d || d.open) return;
    const x = scrollX, y = scrollY;
    d.show();
    if (d.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    scrollTo(x, y);
  };
  useLayoutEffect(show, []);
  return html`<div class="gal-inplace" ref=${ref}>
    <${Dialog} open=${false} title="Versions" onClose=${() => requestAnimationFrame(show)}
      footer=${html`<${Button} variant="ghost">Cancel<//><${Button} variant="primary">Save version<//>`}>
      A version is a copy of the whole document you can go back to.
    <//></div>`;
}

function Floating() {
  const [pop, setPop] = useState(true);
  const anchor = useRef<HTMLSpanElement>(null);
  const seen = useInView(anchor);
  const [modal, setModal] = useState<'dialog' | 'sheet' | null>(null);
  const [seg, setSeg] = useState('medium');
  return html`
    <${Row} label="popover"><span ref=${anchor}><${Button} data-kit="popover-anchor" onClick=${() => setPop(!pop)} aria-expanded=${String(pop)}>${pop ? 'Hide' : 'Show'} the popover<//></span>
      <div class="gal-pop-space"></div>
      ${pop && seen && anchor.current ? html`<${Popover} anchor=${anchor.current} focus=${false} label="View" class="gal-kit-pop" onClose=${() => setPop(false)}>
        <div class="gal-cap">Column width</div><${Segmented} label="Width" value=${seg} onChange=${setSeg} options=${WIDTHS} /><//>` : null}<//>
    <${Row} label="tooltip"><${Tooltip} text="Split view" keys="⌘\\"><${IconButton} icon="split" label="Split view" /><//>
      <${Tooltip} text="Document menu"><${IconButton} icon="more" label="Document menu" /><//><span class="gal-note">hover or focus</span><//>
    <${Row} label="dialog"><${DialogInPlace} /><//>
    <${Row} label="live"><${Button} onClick=${() => setModal('dialog')}>Open a dialog<//><${Button} onClick=${() => setModal('sheet')}>Open a sheet<//>
      <${Button} onClick=${() => showToast('Block deleted', { action: { label: 'Undo', onClick: () => {} } })}>Show a toast<//><//>
    ${modal === 'dialog' ? html`<${Dialog} title="Delete the document?" onClose=${() => setModal(null)}
      footer=${html`<${Button} variant="ghost" onClick=${() => setModal(null)}>Cancel<//><${Button} variant="danger" onClick=${() => setModal(null)}>Delete<//>`}>
      The document and its versions go. This cannot be undone.<//>` : null}
    ${modal === 'sheet' ? html`<${Sheet} title="A sheet" onClose=${() => setModal(null)} note="No changes"
      footer=${html`<${Button} variant="primary" onClick=${() => setModal(null)}>Done<//>`}>
      <p>The one side sheet: Document settings and the title form are drawn in it.</p><//>` : null}`;
}

export function KitSection({ g }: { g: Gallery }) {
  const [tab, setTab] = useState('outline'), [strip, setStrip] = useState('result'), [seg, setSeg] = useState('medium'), [chip, setChip] = useState(true);
  return html`<${Section} g=${g} id="kit" title="Editor kit" lead="app/src/design/ui: controls 24 / 28 / 32 px (44 on touch), type 11–16 px, radii 6 / 8 / 12, borders mixed from currentColor.">
    <${Group} title="Button" g="kit-button">
      <${Row} label="variants"><${Button} variant="primary">New<//><${Button}>Import…<//><${Button} variant="ghost">Cancel<//><${Button} variant="danger" icon="trash">Delete<//><//>
      <${Row} label="disabled"><${Button} variant="primary" disabled>New<//><${Button} disabled>Import…<//><${Button} variant="ghost" disabled>Cancel<//><${Button} variant="danger" disabled>Delete<//><//>
      <${Row} label="sizes"><${Button} size="sm">Small<//><${Button}>Medium<//><${Button} size="lg">Large<//><${Button} variant="primary" size="lg" icon="plus">Add a block<//><//>
      <${Row} label="pill, block"><${Button} pill size="sm" icon="search">Inspect<//><${Button} pill>Show changes<//><div style="width: 220px"><${Button} block variant="primary">Full width<//></div><//>
      <${Row} label="copy"><${CopyButton} text=${() => 'Copied from the gallery'} /><//>
    <//>
    <${Group} title="IconButton" g="kit-icon-button">
      <${Row} label="sizes"><${IconButton} size="sm" icon="plus" label="Add a block below" /><${IconButton} icon="more" label="Document menu" /><${IconButton} size="lg" icon="sidebarLeft" label="Sidebar" /><//>
      <${Row} label="states"><${IconButton} icon="textSize" label="View options" pressed=${true} /><${IconButton} icon="textSize" label="View options" pressed=${false} /><${IconButton} quiet icon="close" label="Close" /><${IconButton} icon="trash" label="Delete" disabled /><//>
    <//>
    <${Group} title=${`Icons (${ICON_NAMES.length})`} g="kit-icons">
      <${Row} label="the registry"><${IconCatalogue} /><//>
    <//>
    <${Group} title="Input, Select" g="kit-input">
      <${Row} label="fields"><${Input} placeholder="Search titles, authors and text" icon="search" style="width: 280px" /><${Input} placeholder="Label" /><${Input} size="sm" placeholder="Filter…" /><//>
      <${Row} label="states"><${Input} value="Disabled" disabled /><${Input} value="not-a-url" aria-invalid="true" /><${Input} quiet value="Functors and Their Transformations" style="width: 300px" /><${Input} mono value="\\usepackage{amsmath}" /><//>
      <${Row} label="select"><${Select}><option>In browser · Tectonic</option><option>None</option><//><${Select} size="sm"><option>Small</option><//><${Select} disabled><option>Disabled</option><//><//>
    <//>
    <${Group} title="Tabs, Segmented" g="kit-tabs">
      <${Row} label="seg"><${Tabs} value=${tab} onChange=${setTab} items=${[{ id: 'outline', label: 'Outline' }, { id: 'problems', label: 'Problems', count: 3, tone: 'danger' }, { id: 'todos', label: 'TODOs', count: 2 }, { id: 'refs', label: 'Refs' }]} /><//>
      <${Row} label="strip"><div style="width: 360px"><${Tabs} variant="strip" value=${strip} onChange=${setStrip} items=${[{ id: 'result', label: 'Result' }, { id: 'latex', label: 'LaTeX' }]} /></div><//>
      <${Row} label="segmented"><${Segmented} label="Width" value=${seg} onChange=${setSeg} options=${WIDTHS} /><//>
    <//>
    <${Group} title="Chip, Pill" g="kit-chip">
      <${Row} label="chips"><${Chip} selected=${chip} count=${39} onClick=${() => setChip(!chip)}>All<//><${Chip} selected=${false} count=${12}>Cited<//><${Chip} dot="#c7a100">Referee<//><${Chip} dot="#3b7dd8">Editor<//><//>
      <${Row} label="pills"><${Pill}>7<//><${Pill} tone="danger">167<//><${Pill} tone="accent">new<//><${Pill} tone="outline">About and licence<//><//>
    <//>
    <${Group} title="Menu" g="kit-menu">
      <${Row} label="menus"><div class="gal-menu-box">
        <${Menu} label="Block">
          <${MenuItem} label="Edit source" shortcut="↵" /><${MenuItem} label="Duplicate" shortcut="⌘D" /><${MenuItem} label="Move up" shortcut="⌥↑" disabled />
          <${MenuSeparator} /><${MenuItem} label="Delete" shortcut="⌫" danger />
        <//></div>
        <div class="gal-menu-box"><${Menu} label="Block types">
          <${MenuLabel}>Text<//><${MenuItem} tile="¶" label="Paragraph" hint="Plain text" active /><${MenuItem} tile="§" label="Section" hint="\\section{…}" />
          <${MenuLabel}>Theorems<//><${MenuItem} tile="T" label="Theorem" hint="\\begin{theorem}" />
        <//></div><//>
    <//>
    <${Group} title="Card, Banner, Toast" g="kit-card">
      <${Card} tabs=${html`<${Tabs} variant="strip" value="result" items=${[{ id: 'result', label: 'Result' }, { id: 'latex', label: 'LaTeX' }]} />`}>
        <p class="gal-tex"><b>Theorem 1.</b> <i>Every presheaf is a colimit of representable presheaves.</i></p>
      <//>
      <div class="gal-gap"></div>
      <${Banner} actions=${html`<${Button} size="sm">Keep mine<//><${Button} size="sm" variant="primary">Update<//>`}>This document changed in the new build. Your copy has edits.<//>
      <div class="gal-gap"></div>
      <div class="gal-toasts"><${Toast} text="Block deleted" action=${{ label: 'Undo', onClick: () => {} }} /><${Toast} text="Focus mode off" /></div>
    <//>
    <${Group} title="Popover, Tooltip, Dialog, Sheet" g="kit-floating"><${Floating} /><//>
  <//>`;
}
