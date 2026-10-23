// the editor's top bar as a Preact component on the kit (was static
// markup in index.html, filled by app.js and main.js by id). It renders into
// the <header class="topbar"> already in the page, so the sticky bar's layout
// does not change. Ids and classes are the ones app.css, the tests and the
// other modules know: #btn-sidebar.sb-open, .crumbs .crumb-home,
// #doc-title.doc-title, #status[data-kind],
// .rtx-preview-pill[data-about] (about.js listens for it), #btn-doc-menu.
// "Documents / title / section" is the pane's breadcrumb bar (docview/pane-bar.js): in the single
// view it renders into the crumbs slot here (with #doc-title), in split view above each pane.
// View button goes into the slot before the menu (view/index.js).
//   const bar = mountTopBar(header, { ids })   ids(name): the element ids (the editor's container's, app/editor-root.ts)
//   bar.on: { sidebar(), menu(button), title(text), split() }   set by main.js / app.js
//   bar.model: { title, status: { text, kind } } (signals); no save status: the tab's unsaved dot is the one
//   bar.slot('view'): the element a foreign control is appended to
import { signal } from '@preact/signals';
import { html, render } from '../design/ui/core.js';
import { IconButton } from '../design/ui/controls.js';
import { buildVersion } from '../app/build-version.js';

function TopBar({ m, on, id }) {
  const status = m.status.value;
  return html`
    <${IconButton} id=${id('btn-sidebar')} class="sb-open" icon="sidebarLeft" label="Show or hide the sidebar" title="Sidebar (Ctrl/⌘ \\)"
      onClick=${() => on.sidebar?.()} />
    <span class="topbar-slot" data-slot="crumbs"></span>
    <div class="status" id=${id('status')} aria-live="polite" data-kind=${status.kind}>${status.text}</div>
    <button class="rtx-preview-pill" type="button" data-about title="About and licence">${buildVersion().label}</button>
    <${IconButton} id=${id('btn-split')} icon="split" label="Split view" title="Split view: a second pane (Ctrl/⌘ ⌥ \\)" pressed=${m.split.value}
      onClick=${() => on.split?.()} />
    <span class="topbar-slot" data-slot="view"></span>
    <${IconButton} id=${id('btn-doc-menu')} icon="more" label="Document menu" title="Menu" aria-haspopup="menu"
      onClick=${(e) => { e.stopPropagation(); on.menu?.(e.currentTarget); }} />`;
}

export function mountTopBar(host, { ids = (name) => name } = {}) {
  const bar = createTopBarModel(() => host);
  render(html`<${TopBar} m=${bar.model} on=${bar.on} id=${ids} />`, host);
  return bar;
}

/** the bar's model without its markup: a host that draws its own bar (the workbench's: app/wb/bar.ts) reads it;
 *  `el()`: the element its slots are in (null: none yet) */
/** @param {() => Element | null} [el] */
export function createTopBarModel(el = () => null) {
  const model = { split: signal(false), title: signal(''), status: signal({ text: '', kind: '' }) };
  /** @type {{ sidebar?: () => void, menu?: (button: Element) => void, title?: (text: string) => void, split?: () => void }} */
  const on = {};
  return {
    model, on, get el() { return el(); },
    slot: (name) => el()?.querySelector(`[data-slot="${name}"]`) ?? null,
    setStatus(text, kind = '') { model.status.value = { text, kind }; },
    setTitle(text) { model.title.value = text; },
    setSplit(on) { model.split.value = !!on; },
  };
}
