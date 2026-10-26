// THE END SPACE: the last element of every pane's <main>, after "Add a block": empty space exactly as tall as the
// pane's visible part, so the document's end can scroll up to the pane's top and every heading, of the last and
// smallest section too, can reach the reading line (docview/in-view.ts). Its height is its rule's (app.css: THE END
// SPACE), never its content's: what it holds changes nothing below or above it.
//
// It holds, centred in the column: a hairline down the middle, from a little below the document's end to a little
// above the foot, and at its foot the document's short metadata (docview/end-meta.ts: its title; its words, blocks
// and the day it was last edited), live. Not the document's text: not selectable, aria-hidden (the title and the
// count are the tab's and the status's), hidden in print and in focus mode (the text alone), never exported (the
// exports are made from the document, not the page). In section focus it ends the section's view as it ends the
// document's: the same space, the same document's metadata.
//
//   const off = mountEndSpace(pane, meta)    pane: a pane's <main>; meta: signal of { title, line }; off() removes it
//   endTextOf({ title, words, edited })      that signal, from the document's (its title; doc/results.js words, edited)
//   END_SPACE                                the element's class
// Mounted in every pane as it is made (panes/index.ts: host.end, the document editor's signals: app/app.js).
import { html, render } from '../design/ui/core.js';
import { computed, type ReadonlySignal } from '@preact/signals';
import { endMeta, type EndMetaText } from './end-meta.ts';

export const END_SPACE = 'end-space';

/** what the foot is made of: the document editor's signals */
export interface EndSources {
  title: ReadonlySignal<string>;
  words: ReadonlySignal<{ words: number; blocks: number } | null>;
  /** ms; 0: no document opened yet */
  edited: ReadonlySignal<number>;
}
/** the foot's text, live: the title, the words and blocks once counted, the day of the last edit */
export function endTextOf({ title, words, edited }: EndSources): ReadonlySignal<EndMetaText> {
  return computed(() => { const w = words.value, t = edited.value; return endMeta({ open: t > 0, title: title.value, words: w?.words, blocks: w?.blocks, edited: t }); });
}

function EndSpace({ meta }: { meta: ReadonlySignal<EndMetaText> }) {
  const m = meta.value;
  if (!m.title) return null;                                         // no document open: the space alone
  // the line: a line box of its own even while it is empty (the foot's height never changes with it)
  return html`<div class="end-rule"></div><p class="end-meta"><span class="end-title">${m.title}</span><span class="end-line">${m.line || ' '}</span></p>`;
}

export function mountEndSpace(pane: HTMLElement, meta: ReadonlySignal<EndMetaText>): () => void {
  const el = pane.ownerDocument.createElement('div');
  el.className = END_SPACE;
  el.setAttribute('aria-hidden', 'true');
  render(html`<${EndSpace} meta=${meta} />`, el);
  pane.append(el);
  return () => { render(null, el); el.remove(); };
}
