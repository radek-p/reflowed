// THE STANDALONE EDITOR'S VIEW CONTEXT: what this host's containers give a view — the
// editor's sidebar for its side panels. The workbench makes its own (workbench: makeViewContext), VS Code's webview
// its own; a view sees only the contract (design/ui/views.ts ViewContext), never which host it is in.
//
//   panelContext(root, viewId, { visible? }) -> ViewContext<PanelHost, EditorRoot>
//     current    the container's current document's panel host (root.state.panels: app/panels.ts)
//     visible    its tab is the sidebar's active one (a pane showing the view: given, always)
//     commands   the current document's (a panel acts through them)
//     can        what the container allows: a sidebar tab nothing (no split, rename, close, open beside); a pane: close
//     openAt     given (o.openAt): the document at a block in a new tab, and can.openBeside (the workbench's side panels)
import { computed, type ReadonlySignal } from '@preact/signals';
import { slotsOf, type ViewContext } from '../design/ui/views.ts';
import { showToast } from '../chrome/toast.js';
import type { EditorRoot } from './editor-root.ts';
import type { PanelHost } from './panel-host.ts';

type Can = ViewContext['can'];
export function panelContext(root: EditorRoot, viewId: string, o: { visible?: ReadonlySignal<boolean>; can?: Partial<Can>; openAt?: (doc: string, at: string) => void } = {}): ViewContext<PanelHost, EditorRoot> {
  const current = computed(() => root.state.panels.value);
  const active = slotsOf(root).active('sidebar');
  return {
    viewId,
    current,
    visible: o.visible ?? computed(() => active.value === viewId),
    commands: {
      call: (id, input = {}) => current.peek()?.commands.call(id, input),
      enabled: (id, input = {}) => !!current.peek()?.commands.enabled(id, input),
    },
    can: { split: false, rename: false, close: false, openBeside: !!o.openAt, ...o.can },
    ...(o.openAt ? { openAt: o.openAt } : {}),
    announce: (text) => { showToast(text); },
    owner: root,
  };
}
