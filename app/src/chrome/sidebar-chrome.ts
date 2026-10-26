// The sidebar's chrome and the page's "+ Add a block" (were static markup in index.html), on Preact and the kit:
// the brand (a link to the Documents) and the close button (the kit's quiet icon button), the tab strip (Outline,
// Problems, TODOs, References, Files: role tab, data-panel, a .count each), the panels, the word count footer (from a
// signal), and Add a block.
// The tabs are registered side panels (design/ui/views.ts: panel left): Outline, Problems and TODOs
// here, the References pane by bibpane/, the Files panel by files/. This is their CONTAINER: the strip and the
// panels' hosts follow the registry, the active tab is the container's (slotsOf(root): app/panels.ts sets it), each
// tab's count its badge; each panel's content (its Component, or its mount) is drawn once in its host with the
// container's ViewContext (app/view-context.ts: the current document, visible, its commands).
// Hooks kept: #btn-sidebar-close, .sb-tabs [data-panel].on[aria-selected] .count, .has-errors, .sb-panel#panel-<id>,
// #word-count, #add-end (the standalone page's ids: root.id).
// Rendered once per editor, into its container's parts (app/editor-root.ts): app/mount.ts mountSidebarChrome(root, { onClose }).
import { computed, type ReadonlySignal } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import { html, render } from '../design/ui/core.js';
import { IconButton, Icon } from '../design/ui/index.js';
import { registerView, defineSlot, views, slotsOf, titleOf, FrameContext, type ViewDef, type Slots, type Mounted } from '../design/ui/views.ts';
import type { ComponentChildren } from 'preact';
import { OutlinePanel } from '../outline/index.ts';   // the panels' content: Components over the current document's lists
import { ProblemsPanel, TodosPanel } from '../sidebar/index.ts';
import { panelContext } from '../app/view-context.ts';
import type { EditorRoot } from '../app/editor-root.ts';
import type { WordCount } from '../app/page-state.ts';

// each document's count is its own (doc/results.js words); the footer shows the current one's: the
// container's current document (root.state.words, set by app/panels.ts while its document is the current one)
/** the current document's word count signal, in editor `root` */
export function showWordCount(root: EditorRoot, words: ReadonlySignal<WordCount | null> | null) { if (root.state.words.peek() !== words) root.state.words.value = words ?? null; }

const fmt = (n: number) => n.toLocaleString('en-GB');

// the sidebar slot: a view's host is a tab panel; its tab shows its title and its badge
defineSlot('sidebar', {
  host(v, owner) {
    const el = owner.doc.createElement('div');
    el.className = 'sb-panel';
    el.id = owner.id(`panel-${v.id}`);
    el.setAttribute('role', 'tabpanel');
    if (v.label) el.setAttribute('aria-label', v.label);
    el.hidden = true;
    return el;
  },
});
registerView({ id: 'outline', title: 'Outline', icon: 'outline', panel: { side: 'left', order: 10 }, Component: OutlinePanel });
registerView({ id: 'problems', title: 'Problems', icon: 'problems', panel: { side: 'left', order: 20 }, count: true, Component: ProblemsPanel });
registerView({ id: 'todos', title: 'TODOs', icon: 'todos', panel: { side: 'left', order: 30 }, count: true, Component: TodosPanel });

type Ids = (name: string) => string;
/** the sidebar container's Frame: the tab is the title, so a view's content goes in as it is (no header, no Close) */
function TabFrame({ children }: { children?: ComponentChildren }) { return html`${children}`; }
function Tab({ v, on, s, ids }: { v: ViewDef; on: boolean; s: Slots; ids: Ids }) {
  const b = v.count ? s.badge(v.id).value : null;
  return html`<button type="button" role="tab" data-panel=${v.id} class=${[on && 'on', b?.tone === 'danger' && 'has-errors'].filter(Boolean).join(' ') || undefined}
    aria-selected=${String(on)} aria-controls=${ids(`panel-${v.id}`)} title=${v.tip}
    onClick=${() => { s.active('sidebar').value = v.id; }}>${titleOf(v)}${v.count ? html` <span class="count" hidden=${!b?.n} title=${b?.title || undefined}>${b?.n ? String(b.n) : ''}</span>` : null}</button>`;
}
function Tabs({ s, ids }: { s: Slots; ids: Ids }) {
  const a = s.active('sidebar').value;
  return html`${views('sidebar').map((v) => html`<${Tab} key=${v.id} v=${v} on=${v.id === a} s=${s} ids=${ids} />`)}`;
}

/** the panels: each registered side panel's host, in the tabs' order before the footer, its content drawn there once
 *  (its Component with the container's ViewContext, or its mount); a panel unregistered (the Files panel without the
 *  advanced switch) goes with its content */
function createPanelHosts(root: EditorRoot) {
  const s = slotsOf(root);
  const drawn = new Map<string, { def: ViewDef; m: Mounted }>();
  function draw(v: ViewDef) {
    const host = s.host(v.id), ctx = panelContext(root, v.id);
    const C = v.Component;
    if (C) { render(html`<${FrameContext.Provider} value=${TabFrame}><${C} ctx=${ctx} /><//>`, host); return { unmount: () => render(null, host) }; }
    return v.mount?.(host, ctx) ?? { unmount() {} };
  }
  function sync(list: ViewDef[], before: Element, active: string | null) {
    const parent = before.parentElement;
    if (!parent) return;
    for (const [id, d] of drawn) {
      if (list.includes(d.def)) continue;
      d.m.unmount(); drawn.delete(id);
      const el = s.host(id); el.hidden = true; el.remove();     // (the container places it again when the view comes back)
    }
    for (const v of list) {
      const el = s.host(v.id);
      if (el.parentElement !== parent || el.nextElementSibling !== before) parent.insertBefore(el, before);
      if (!drawn.has(v.id)) drawn.set(v.id, { def: v, m: draw(v) });
      el.hidden = v.id !== active;
    }
  }
  root.onDispose(() => { for (const d of drawn.values()) d.m.unmount(); drawn.clear(); });
  return { sync };
}
function Panels({ before, s, hosts }: { before: Element; s: Slots; hosts: ReturnType<typeof createPanelHosts> }) {
  const list = views('sidebar');
  const a = s.active('sidebar').value;
  useLayoutEffect(() => { hosts.sync(list, before, a); });
  return null;
}

function WordCountLine({ count }: { count: { readonly value: WordCount | null } }) {
  const n = count.value;
  if (!n) return null;
  return html`<span class="wc-main">${`${fmt(n.words)} words`}</span><span class="wc-sub">${` · ${fmt(n.blocks)} blocks`}</span>`;
}
/** the current document's word count as a line of its own (the workbench's side status), its details in its tooltip */
export function WordCountStatus({ root }: { root: EditorRoot }) {
  const n = root.state.words.value?.value ?? null;
  if (!n) return null;
  return html`<span class="rtx-word-count" id="word-count" title=${titleOfCount(n)}><${WordCountLine} count=${{ value: n }} /></span>`;
}
/** the footer's tooltip follows the count (a title on the host, which Preact does not own) */
function titleOfCount(n: WordCount | null) {
  return n ? `${fmt(n.words)} words of text (texcount-like: commands and maths not counted)\n${fmt(n.inline)} inline formulas, ${fmt(n.displays)} displays\n${fmt(n.characters)} characters of text` : '';
}

export function mountSidebarChrome(root: EditorRoot, { onClose = null }: { onClose?: (() => void) | null } = {}) {
  const top = root.part('sb-top');
  if (top) {
    render(html`<a class="brand" href="#/" title="All documents"><span class="logo" aria-hidden="true">ε</span><span>ReflowEd</span></a>
      <${IconButton} id=${root.id('btn-sidebar-close')} icon="chevronLeft" quiet label="Hide the sidebar" title="Hide the sidebar (Ctrl/⌘ \\)" onClick=${() => onClose?.()} />`, top);
    root.onDispose(() => render(null, top));
  }
  const s = slotsOf(root), ids: Ids = (n) => root.id(n);
  const tabs = root.part('sb-tabs');
  if (tabs) { render(html`<${Tabs} s=${s} ids=${ids} />`, tabs); root.onDispose(() => render(null, tabs)); }
  const foot = root.part('word-count');
  if (foot?.parentElement) {
    const ph = root.doc.createElement('span');
    ph.style.display = 'none';
    foot.parentElement.append(ph);
    const hosts = createPanelHosts(root);
    render(html`<${Panels} before=${foot} s=${s} hosts=${hosts} />`, ph);
    root.onDispose(() => { render(null, ph); ph.remove(); });
    const wordCount = computed(() => root.state.words.value?.value ?? null);
    render(html`<${WordCountLine} count=${wordCount} />`, foot);
    root.onDispose(wordCount.subscribe((n) => { foot.title = titleOfCount(n); }));
    root.onDispose(() => render(null, foot));
  }
  mountAddEnd(root);
}
/** the first pane's "Add a block" (#add-end), with or without the sidebar */
export function mountAddEnd(root: EditorRoot) {
  const add = root.part('add-end');
  if (add) { render(html`<button type="button" class="add-end" id=${root.id('add-end')}><${Icon.plus} /><span>Add a block</span></button>`, add); root.onDispose(() => render(null, add)); }
}

/** "Add a block" at the end of another pane (the first pane's is #add-end above); returns its button */
export function mountAddBlock(host: HTMLElement) {
  render(html`<button type="button" class="add-end"><${Icon.plus} /><span>Add a block</span></button>`, host);
  return host.querySelector('.add-end');
}
export function unmountAddBlock(host: HTMLElement) { render(null, host); }
