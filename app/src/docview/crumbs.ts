// CRUMBS AS DATA: what a container draws for a document view — the document chip (its
// name) and the section chip (the section in view in that pane) — from the view's state, never from the pane bar's
// markup. The workbench draws them in its TabPill (`subtitle`, `switcher`), VS Code in the
// webview's DocCrumb bar; the standalone editor's own pane bars (docview/pane-bar.js) draw the same things.
//
//   crumbsOf({ docId, title, section })  -> { doc: { id, title }, section: { id, label, num, text, title } | null }
//     section: the outline entry in view (doc/panels.ts OutlineItem) | null; its chip's data has the workbench's
//     Subtitle shape ({ label, num, text, title }: workbench/src/types.ts), so its subtitle(tab, ctx) can return it
import type { OutlineItem } from '../doc/panels.ts';

export interface Crumbs {
  doc: { id: string | null; title: string };
  section: { id: string; label: string; num: string; text: string; title: string; kind: string } | null;
}

/** "2.1 Details", as the pane bar names a section */
export const sectionName = (it: Pick<OutlineItem, 'number' | 'title'>) => `${it.number ? `${it.number} ` : ''}${it.title || 'Untitled section'}`;

export function crumbsOf({ docId, title, section }: { docId: string | null; title: string; section: OutlineItem | null }): Crumbs {
  return {
    doc: { id: docId, title: title || 'Untitled' },
    section: section ? { id: section.id, label: sectionName(section), num: section.number, text: section.title || 'Untitled section', kind: section.kind ?? 'Section',
      title: `${section.kind ?? 'Section'} ${sectionName(section)}` } : null,
  };
}
