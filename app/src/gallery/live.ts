// The gallery: the editor live (app/mount.ts mountEditor on the fixture document, app/src/app/test-fixture.js; the
// page's backend is none: the blocks show their sources, nothing is typeset) and the workbench's tabs.
//   the editor          with its sidebar: the top bar, the sidebar's tabs, the outline, TODO markers in the margin,
//                       a heading's block controls (wide mode: beside the column) and the find bar open on a query
//   the code popover    a paragraph opened for editing (CodeMirror in the popover)
//   narrow controls     a narrow pane: a block's controls in a floating bar over it
//   the panels          every registered side panel (Outline, Problems, TODOs, References; Files with the advanced
//                       switch) drawn with the editor's ViewContext (app/view-context.ts), as a host draws them
//   View options        its panel (view/popover.js), on the page's View options
//   tab status          workbench tabs: saved, typesetting (progress), errors, unsaved
// The states are reached the way a person reaches them (a pointer over a block, the find command, the edit command).
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { html, views, FrameContext, type ViewDef } from '../design/ui/index.js';
import { mountEditor, type MountedEditor } from '../app/mount.ts';
import type { EditorRoot } from '../app/editor-root.ts';
import { panelContext } from '../app/view-context.ts';
import { testFixtureDocument } from '../app/test-fixture.js';
import { Panel as ViewPanel } from '../view/popover.ts';
import { createWorkbench, Workbench, html as wbHtml, type DocStatusInput, type Tab } from '../../../workbench/src/index.ts';
import { Section, Group, Cell } from './parts.ts';
import type { Gallery } from './main.ts';

interface Store { createDoc(init: object): Promise<string> }
interface EditorApi { whenIdle(): Promise<unknown>; blocks(): { id: string; kind: string; source: string }[]; edit(id: string): unknown; find(q: string): unknown }
const apiOf = (ed: MountedEditor) => (ed.current() as { api?: EditorApi } | null | undefined)?.api ?? null;
const frames = (n = 2) => new Promise<void>((r) => { const f = (k: number) => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n); });

/** a pointer over block `blk`, as the mouse moves there: its controls show (docview/controls.js) */
function hover(blk: Element | null | undefined) {
  if (!blk) return;
  const r = blk.getBoundingClientRect();
  blk.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 12, clientY: r.top + Math.min(8, r.height / 2), pointerType: 'mouse' }));
}
/** a block scrolled to the middle of its editor (the window put back by inPlace) */
function reveal(el: Element | null | undefined) { el?.scrollIntoView({ block: 'center' }); }
/** run `f` without the page scrolling to what it focuses (the gallery is read top to bottom) */
async function inPlace(f: () => unknown) {
  const x = scrollX, y = scrollY;
  await f();
  scrollTo(x, y);
  await frames(1);
  scrollTo(x, y);
}

/** a side panel as a host draws it: its content with the editor's ViewContext, in the sidebar's panel element */
function SidePanel({ root, v }: { root: EditorRoot; v: ViewDef }) {
  const ref = useRef<HTMLDivElement>(null);
  const ctx = useMemo(() => panelContext(root, v.id, { visible: signal(true) }), []);
  const cur = ctx.current.value;
  useLayoutEffect(() => {
    if (v.Component || !v.mount || !cur || !ref.current) return;
    const m = v.mount(ref.current, ctx);
    return () => m.unmount();
  }, [cur]);
  const C = v.Component as unknown as ((p: { ctx: unknown }) => ComponentChildren) | undefined;
  const Bare = ({ children }: { children?: ComponentChildren }) => html`${children}`;
  return html`<div class="sb-panel rtx-wb-panel gal-panel" data-panel-view=${v.id} ref=${ref}>${C ? html`<${FrameContext.Provider} value=${Bare}><${C} ctx=${ctx} /><//>` : null}</div>`;
}

export function EditorSection({ g }: { g: Gallery }) {
  const main = useRef<HTMLDivElement>(null), code = useRef<HTMLDivElement>(null), narrow = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<EditorRoot | null>(null);
  useLayoutEffect(() => {
    const eds: MountedEditor[] = [];
    let gone = false;
    (async () => {
      const store = g.services.store as Store;
      const make = (title: string) => store.createDoc({ ...testFixtureDocument(), title });
      const mount = async (el: HTMLDivElement | null, title: string, sidebar: boolean) => {
        if (!el) throw new Error('gallery: no host for an editor');
        const ed = mountEditor(el, g.services, { sidebar });
        eds.push(ed);
        if (!await ed.open(await make(title))) throw new Error(`gallery: the editor did not open ${title}`);
        await apiOf(ed)?.whenIdle();
        return ed;
      };
      const e1 = await mount(main.current, 'Editor test fixture', true);
      const e2 = await mount(code.current, 'The code popover', false);
      const e3 = await mount(narrow.current, 'Narrow controls', false);
      if (gone) return;
      await frames();
      // the find command, then a query typed
      await inPlace(async () => {
        e1.root.state.panels.value?.commands.call('find.open', {});
        const input = e1.root.el.querySelector<HTMLInputElement>('.find-bar .find-input');
        if (input) { input.value = 'functor'; input.dispatchEvent(new Event('input', { bubbles: true })); input.blur(); }
      });
      // a paragraph opened for editing: the code popover
      const a2 = apiOf(e2);
      const para = a2?.blocks().find((b) => b.kind === 'paragraph' && b.source.startsWith('All categories'));
      if (a2 && para) await inPlace(async () => { a2.edit(para.id); await a2.whenIdle(); await frames(); reveal(e2.root.el.querySelector('.blk.editing')); });
      // the sidebar's first panel chosen (an embedded editor starts with none chosen)
      e1.root.el.querySelector<HTMLElement>('.sb-tabs [role="tab"][data-panel="outline"]')?.click();
      // the block controls: a heading's (wide), a paragraph's in the narrow pane
      hover(e1.root.el.querySelector('.blk[data-kind="heading"]:not(:first-child)'));
      const p3 = e3.root.el.querySelectorAll('.blk[data-kind="paragraph"]')[1];
      await inPlace(() => reveal(p3));
      await frames();
      hover(p3);
      setRoot(e1.root);
      await frames();
      g.ready('editor');
    })().catch((e: unknown) => { console.error('gallery: the editor', e); });
    return () => { gone = true; for (const ed of eds) ed.unmount(); };
  }, []);
  const panels = root ? views('sidebar') : [];
  return html`<${Section} g=${g} id="editor" auto=${false} title="The editor, live" lead="mountEditor on the fixture document, without the TeX engine (backend none: the blocks show their sources). Everything here works: click, type, open menus.">
    <${Group} title="The editor" g="editor-main" note="The top bar, the sidebar and its tabs, the outline, TODO markers in the margin, a heading's controls (focus, +, the handle) and the find bar on a query.">
      <div class="gal-editor gal-editor--main" ref=${main}></div>
    <//>
    <div class="gal-cells gal-cells--top">
      <${Cell} label="the code popover: a paragraph being edited"><div class="gal-editor gal-editor--code" ref=${code}></div><//>
      <${Cell} label="a narrow pane: the controls in a floating bar"><div class="gal-editor gal-editor--narrow" ref=${narrow}></div><//>
    </div>
    <${Group} title="The side panels" g="panels" note="Every registered side panel, drawn with the editor's ViewContext as a host draws it. Problems: none here (no engine, no compile).">
      <div class="gal-cells gal-cells--top">${root ? panels.map((v: ViewDef) => html`<${Cell} label=${typeof v.title === 'string' ? v.title : v.id}><${SidePanel} root=${root} v=${v} /><//>`) : null}</div>
    <//>
    <${Group} title="View options" g="view" note="view/popover.js: the panel the top bar's View button opens, on the page's View options.">
      ${root ? html`<div class="rtx-vp ui-popover gal-static gal-vp" role="dialog" aria-label="View options"><${ViewPanel} view=${g.services.view} /></div>` : null}
    <//>
  <//>`;
}

// ── the workbench's tabs, each document's status ──
type DocState = { readonly doc?: string; readonly [key: string]: unknown };
const STATUS: { doc: string; title: string; status: DocStatusInput }[] = [
  { doc: 'saved', title: 'Saved and idle', status: {} },
  { doc: 'typesetting', title: 'Typesetting 5 of 12', status: { typesetting: { done: 5, total: 12, bar: 'full' } } },
  { doc: 'band', title: 'A few blocks', status: { typesetting: { done: 1, total: 3, bar: 'band' } } },
  { doc: 'errors', title: 'Two errors', status: { errors: 2 } },
  { doc: 'unsaved', title: 'Unsaved', status: { unsaved: true } },
  { doc: 'both', title: 'Errors, unsaved', status: { errors: 1, unsaved: true } },
];
function DocView({ tab }: { tab: Tab }) {
  const doc = (tab.state as DocState).doc;
  return wbHtml`<div class="gal-wb-doc">${STATUS.find((s) => s.doc === doc)?.title ?? ''}</div>`;
}

export function TabsSection({ g }: { g: Gallery }) {
  const wb = useMemo(() => {
    const w = createWorkbench({ idPrefix: 'gal' });
    w.registerView<DocState>({ id: 'document', title: (s) => STATUS.find((x) => x.doc === s.doc)?.title ?? 'Document', docId: (s) => s.doc ?? null, icon: 'file', tabIcon: false, Component: DocView });
    for (const s of STATUS) w.open({ view: 'document', state: { doc: s.doc } });
    for (const s of STATUS) w.setDocStatus(s.doc, s.status);
    return w;
  }, []);
  useLayoutEffect(() => {
    let gone = false;
    wb.idle().then(() => { if (!gone) g.ready('tabs'); });
    return () => { gone = true; wb.dispose(); };
  }, []);
  return html`<${Section} g=${g} id="tabs" auto=${false} title="Tab status" lead="workbench/src: the tabs of a workbench with fixture documents, each with its status (doc status: typesetting with its progress, errors, unsaved).">
    <div class="gal-wb-host">${wbHtml`<${Workbench} wb=${wb} label="Gallery workbench" />`}</div>
  <//>`;
}
