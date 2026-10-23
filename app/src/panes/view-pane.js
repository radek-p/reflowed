// PANES: a pane that hosts a registered VIEW (design/ui/views.js)
// instead of a document. A layout entry { id, view, of } (panes/layout.js) names the view and the props its content
// gets; the panes registry (panes/index.js) gives it the pane's chrome (the divider and its <main>) and mounts it here.
// The content is the view's own Component, as in a sheet: it renders <Frame …>, and the container it is in, a pane
// now (PaneFrame), draws what goes around it. Nothing in the content knows it is in a pane.
//
//   const vp = mountViewPane(host, { view, of, close })   host: the pane's content element; close: the pane goes
//   vp.view · vp.update(of) · vp.destroy()
//   <${PaneFrame} title onClose footer note …>            the pane container (FrameContext)
import { html, render, IconButton } from '../design/ui/index.js';
import { view as viewDef, FrameContext } from '../design/ui/views.js';

/** The pane container: a header (the view's title, Close) above the content, which scrolls in the pane. */
export function PaneFrame({ title, onClose, footer, note, children }) {
  return html`<section class="view-pane" aria-label=${title}>
    <header class="view-pane-head">
      <span class="view-pane-title">${title}</span>
      ${onClose ? html`<${IconButton} icon="close" size="sm" quiet label=${`Close ${title}`} class="view-pane-close" onClick=${onClose} />` : null}
    </header>
    <div class="view-pane-body">${children}</div>
    ${note ? html`<p class="view-pane-note">${note}</p>` : null}
    ${footer ? html`<footer class="view-pane-foot">${footer}</footer>` : null}
  </section>`;
}

function Content({ id, of, close, ctx }) {
  const v = viewDef(id);                                  // a registered view (re-rendered when the registry changes)
  if (!v?.Component) return html`<${PaneFrame} title=${v?.title ?? id} onClose=${close}><p class="view-pane-missing">This view is not available.</p><//>`;
  return html`<${FrameContext.Provider} value=${PaneFrame}><${v.Component} ...${of ?? {}} ctx=${ctx} close=${close} /><//>`;
}

/** ctx: the pane container's ViewContext (design/ui/views.ts: the current document, visible, its commands)
 *  @param {HTMLElement} host @param {{ view: string, of?: unknown, close?: () => void, ctx?: object | null }} o */
export function mountViewPane(host, { view, of = null, close = () => {}, ctx = null }) {
  ensureStyle();
  host.dataset.view = view;
  host.classList.add('view-pane-host');
  const draw = (o) => render(html`<${Content} id=${view} of=${o} close=${close} ctx=${ctx} />`, host);
  draw(of);
  return {
    view,
    update: (o) => draw(o),
    destroy() { render(null, host); delete host.dataset.view; host.classList.remove('view-pane-host'); },
  };
}

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const css = document.createElement('style');
  css.id = 'rtx-view-pane-css';
  css.textContent = `
.view-pane-host { height: 100%; }
.view-pane { display: flex; flex-direction: column; min-height: 100%; color: var(--ui-ink); font: var(--ui-text, 14px) / 1.4 var(--ui-font); }
.view-pane-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: var(--ui-2, 8px);
  padding: var(--ui-2, 8px) var(--ui-3, 12px); background: var(--ui-surface); border-bottom: 1px solid var(--ui-border); }
.view-pane-title { flex: 1; font-weight: var(--ui-semibold, 600); }
.view-pane-body { flex: 1; padding: var(--ui-3, 12px); }
.view-pane-note, .view-pane-foot { padding: var(--ui-2, 8px) var(--ui-3, 12px); border-top: 1px solid var(--ui-border); }`;
  document.head.append(css);
}
