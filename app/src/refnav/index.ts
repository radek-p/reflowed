// reference navigation in the editor: refnav (listen.ts, where it is described; another page imports listenRefnav
// from there) on the editor's container, with the editor's hooks.
//
//   installRefNav({ api, numberingState, root }) -> refnav
//     root            the editor's container (app/editor-root.ts): its blocks, its keys, its state; one refnav per
//                     editor, gone with the container
//     api             { forPane(pane) -> that pane's document host (app/doc-host.js: refsState, numbering, nav, edit,
//                     blocks, readOnly), bibpane() } (main.js: the workspace's)
//     numberingState  rtx:refs's numberingState (numbers for the card's copy)
// The container's signals (app/page-state.ts: a block's result shown, a refresh) and the page's route are the hooks'
// news; its key rule (root.takesKey) says which keys pressed outside it are its own.
import { listenRefnav, type RefnavApi } from './listen.ts';
import { page, onChange } from '../app/page-state.ts';
import type { EditorRoot } from '../app/editor-root.ts';

export type { Unit, RefnavNavigator, RefnavDoc, RefnavApi, RefnavHooks, Refnav } from './listen.ts';

export function installRefNav({ api, numberingState, root }: { api: RefnavApi; numberingState?: (() => unknown) | null; root: EditorRoot }) {
  const refnav = listenRefnav(root.el, {
    api, numberingState,
    takesKey: (e) => root.takesKey(e),
    onDisplayed: (fn) => onChange(root.state.displayed, (d) => fn(d?.id ?? null)),
    onRefreshed: (fn) => onChange(root.state.refreshed, () => fn()),
    onRoute: (fn) => onChange(page.route, () => fn()),
  });
  root.onDispose(refnav.dispose);
  return refnav;
}
