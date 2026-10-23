// The integrated page's test surface (window.editorAPI, as main.js makes it for the old page): the current document's
// api (its editor's test surface, app/app.js), and the workbench's parts. Tests only; product code acts through
// commands and document hosts (tests/test-arch-units.ts, 5a).
import { layerState, views as registeredViews } from '../design/ui/index.js';
import { inspector } from '../inspector/index.js';
import { editorRoots } from '../app/editor-root.ts';
import { createDocumentView } from '../docview/document-view.js';   // tests: a second instance
import type { WorkbenchStore } from '../../../workbench/src/index.ts';
import type { DocTabs } from '../app/doc-tabs.ts';
import type { ViewDef } from '../design/ui/views.ts';

interface StoreLike { listDocs(o?: object): Promise<{ id: string; title?: string }[]> }
let lastHome: { idle?(): Promise<void> } | null = null;
/** the Documents view drawn last (its idle: the tests' homeIdle); null with `was`: that one went */
export function setLastHome(h: { idle?(): Promise<void> } | null, was: object | null = null) { if (!was || lastHome === was) lastHome = h; }

export function installTestSurface({ wb, tabs, store, services, kinds, openDoc, route, statusIdle }: {
  wb: WorkbenchStore; tabs: DocTabs; store: StoreLike; services: { backends: { id: string }[]; notes: unknown; view: unknown; io: unknown };
  kinds: object; openDoc(id: string, o?: { beside?: boolean }): Promise<string>; route(): object;
  /** the tabs' status no longer held (wb/status-hold.ts) */
  statusIdle?(): Promise<void>;
}) {
  const cur = () => tabs.currentEditor()?.api ?? null;
  const own: Record<string, unknown> = {
    workbench: () => wb, tabs: () => tabs,
    route,
    /** every open document's editor opened and idle, and the workbench at rest (tests wait on state, never on time) */
    async whenIdle() {
      for (let k = 0; k < 3; k++) {
        await wb.idle();
        for (const [p, e] of tabs.editors()) { await tabs.pane(p)?.ready; await (e.api.whenIdle as () => Promise<void>)(); }
      }
      await statusIdle?.();
    },
    async open(id: string) { const t = await openDoc(id); await tabs.pane(t)?.ready; return t; },
    home() { wb.toggleHome(undefined, true); },
    homeIdle: () => lastHome?.idle?.() ?? Promise.resolve(),
    modules: () => ({ ...kinds }),
    backends: () => services.backends.map((b) => b.id),
    store: () => store,
    current: () => cur(),
    forPane: (pane: string) => tabs.editorOf(pane)?.api ?? cur(),
    editors: () => Object.fromEntries(tabs.editors().map(([p, e]) => [p, { doc: e.doc?.id ?? null, api: e.api, current: e === tabs.currentEditor() }])),
    docSessions: () => Object.fromEntries([...tabs.sessions()].map(([d, x]) => [d, { panes: x.panes, api: x.editor.api }])),
    notes: () => services.notes, io: () => services.io, view: () => services.view, bibpane: () => tabs.bibpane, refnav: () => tabs.refnav,
    views: () => registeredViews().map((v: ViewDef) => ({ id: v.id, title: v.title, slot: v.slot })),
    layers: () => layerState().map((l: { kind: string; z: string }) => ({ kind: l.kind, z: l.z })),
    inspector: () => inspector,
    refsState: () => (cur() as { refsState?(): unknown } | null)?.refsState?.() ?? null,
    /** the backend object of the current document (PDF export, stats) */
    backendObject: () => { const id = tabs.currentEditor()?.backendId() ?? null; return services.backends.find((b) => b.id === id) ?? null; },
    /** the current pane's DocumentView (its container, blocks) */
    docView: () => { const p = tabs.current.peek().pane; return p ? tabs.editorOf(p)?.panes().get(p)?.view ?? null : null; },
    createDocumentView,
    editorRoots: () => editorRoots().length,
  };
  (window as unknown as { editorAPI: unknown }).editorAPI = new Proxy(own, {
    get(t, k: string) {
      if (k in t) return t[k];
      const a = cur() as Record<string, unknown> | null;
      const f = a?.[k];
      return typeof f === 'function' ? (f as (...x: unknown[]) => unknown).bind(a) : f;
    },
  });
}
