// A TEST HARNESS, dev only (app/two-editors.html, bundled by scripts/w3-build.ts into lib/two-editors.js; never
// in a release): two editors mounted side by side in two plain divs, each with its own document, on one page's
// services (one store in memory, one engine worker, one refs module, notes, the View options, the inspector).
// tests/test-two-editors.ts drives it through window.twoEditors:
//
//   twoEditors.ready                         a promise: the services made, the two documents in the store
//   twoEditors.docs                          { a, b }: the two documents' ids (b: the fixture with its own heading and a block)
//   await twoEditors.mount(slot, docId?, { sidebar? })   the editor in #ed-<slot> ('a' | 'b'), on its document; -> true when
//                                            open; sidebar false: the document part alone
//   twoEditors.unmount(slot)                 that editor goes (its listeners, DOM, signals)
//   twoEditors.api(slot)                     the editor's current document editor's api (app/app.js: whenIdle, blocks, …)
//   twoEditors.mounted()                     the slots mounted · twoEditors.roots() the editor containers on the page
//   twoEditors.inspector                     the page's inspector (it inspects the editor worked in)
import { pageParams } from '../app/release-mode.js';
import { createPageServices, pageReady } from '../app/services.ts';
import { mountEditor, type MountedEditor } from '../app/mount.ts';
import { editorRoots } from '../app/editor-root.ts';
import { testFixtureDocument } from '../app/test-fixture.js';
import { inspector } from '../inspector/index.js';

type Slot = 'a' | 'b';
interface DocInit { title: string; preamble: string; bib: unknown; meta: unknown; blocks: { source: string; kind: string; file: string }[] }
interface Store { createDoc(init: DocInit): Promise<string> }
interface EditorApi { whenIdle(): Promise<unknown> }

/** the right-hand document: the fixture with its own heading and one block of its own */
export function rightDocument(): DocInit {
  const d: DocInit = testFixtureDocument();
  const blocks = d.blocks.map((b) => (b.source.startsWith('\\section{Functors and natural transformations}') ? { ...b, source: '\\section{Only on the right}\\label{sec:main}' } : b));
  blocks.splice(4, 0, { source: 'A sentence only the right document has: zebra crossings.', kind: 'paragraph', file: 'main.tex' });
  return { ...d, title: 'Right document', blocks };
}

async function start() {
  await pageReady();
  const { services } = await createPageServices({ params: pageParams(), store: 'memory' });
  const store = services.store as Store;
  const left = testFixtureDocument() as DocInit;
  const docs: Record<Slot, string> = { a: await store.createDoc({ ...left, title: 'Left document' }), b: await store.createDoc(rightDocument()) };
  const mounted = new Map<Slot, MountedEditor>();
  const host = (slot: Slot) => {
    const el = document.getElementById(`ed-${slot}`);
    if (!el) throw new Error(`two editors: no #ed-${slot}`);
    return el;
  };
  return {
    docs,
    async mount(slot: Slot, docId: string = docs[slot], o: { sidebar?: boolean } = {}) {
      if (mounted.has(slot)) return false;
      const ed = mountEditor(host(slot), services, o);
      mounted.set(slot, ed);
      const ok = await ed.open(docId);
      return ok;
    },
    unmount(slot: Slot) { mounted.get(slot)?.unmount(); mounted.delete(slot); },
    api(slot: Slot): EditorApi | null { return (mounted.get(slot)?.current() as { api?: EditorApi } | undefined)?.api ?? null; },
    editor(slot: Slot) { return mounted.get(slot) ?? null; },
    mounted: () => [...mounted.keys()],
    roots: () => editorRoots().length,
    store: () => store,
    inspector,
  };
}

const ready = start();
Object.defineProperty(window, 'twoEditors', { value: { ready: ready.then(() => true) }, configurable: true });
ready.then((h) => Object.defineProperty(window, 'twoEditors', { value: { ...h, ready: Promise.resolve(true) }, configurable: true }))
  .catch((e: unknown) => { console.error('two editors:', e); document.body.append(Object.assign(document.createElement('pre'), { textContent: `The harness could not start: ${String(e)}` })); });
