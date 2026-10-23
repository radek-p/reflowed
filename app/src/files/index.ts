// The Files panel: a side panel behind "Show advanced features". With the switch on it is a registered
// side panel (its container draws its tab and its content); off, it is unregistered and its tab goes (each
// editor showing it shows its Outline). The content (panel.js) lists the CURRENT document's files (ctx.current: the
// document's panel host, app/panel-host.ts), only while its tab is shown (it lists them when drawn).
import { effect, untracked } from '@preact/signals';
import { html } from '../design/ui/core.js';
import { registerView, slotsOf, Frame, type ViewContext } from '../design/ui/views.ts';
import { advanced, registerAdvanced } from '../settings/advanced.js';
import { editorRoots, type EditorRoot } from '../app/editor-root.ts';
import { FilesContent } from './panel.js';
import { installFilesStyle } from './style.js';
import type { PanelHost } from '../app/panel-host.ts';

registerAdvanced({ id: 'files-panel', label: 'The Files panel (every file the document uses)', where: 'Sidebar' });

const ID = 'files';

/** the Files view's content: the current document's files, while it is shown (its container's Frame around it: the
 *  sidebar's tab, a pane's header with Close); its count is the tab's badge */
function FilesPanel({ ctx, close }: { ctx: ViewContext<PanelHost, EditorRoot>; close?: () => void }) {
  const files = ctx.current.value?.files ?? null;
  if (!files || !ctx.visible.value) return null;
  const badge = slotsOf(ctx.owner).badge(ID);
  const host = { ...files, state: ctx.owner.state, onCount: (n: number) => { badge.value = n ? { n, title: `${n} file${n === 1 ? '' : 's'}` } : null; } };
  return html`<${Frame} title="Files" onClose=${close}><${FilesContent} host=${host} /><//>`;
}

let unregister: (() => void) | null = null;
function on() {
  if (unregister) return;
  installFilesStyle();
  unregister = registerView({ id: ID, title: 'Files', label: 'Files', tip: 'Every file the document uses (as Export .zip writes them)', panel: { side: 'left', order: 50 }, count: true, Component: FilesPanel });
}
function off() {
  if (!unregister) return;
  for (const r of editorRoots()) {
    const s = slotsOf(r);
    if (s.active('sidebar').peek() === ID) s.active('sidebar').value = 'outline';
    s.badge(ID).value = null;
  }
  unregister(); unregister = null;
}
// the switch is the page's (a user preference): the panel type follows it, for every editor
effect(() => { const a = advanced.value; untracked(() => (a ? on() : off())); });
