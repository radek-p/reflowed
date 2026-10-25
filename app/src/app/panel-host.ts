// THE PANEL CONTRACT'S "CURRENT": what a side panel gets of the document it follows —
// the container's current document (the focused pane's). Its lists are data (doc/panels.ts computes them, app/panels.ts
// publishes them); everything a panel does goes through the document's commands. A container keeps the current one
// in root.state.panels (app/page-state.ts); a panel's ViewContext.current is that signal.
import type { ReadonlySignal } from '@preact/signals';
import type { Diagnostic, OutlineItem, ProblemKind, Todo, Block } from '../doc/panels.ts';

export interface Commands { call(id: string, input?: object): unknown; enabled(id: string, input?: object): boolean }

export interface PanelHost {
  /** the document (null while none is open) */
  readonly docId: string | null;
  readonly commands: Commands;
  readonly lists: {
    readonly outline: ReadonlySignal<OutlineItem[]>;
    readonly problems: ReadonlySignal<Diagnostic[]>;
    readonly todos: ReadonlySignal<Todo[]>;
    /** the outline's row: the section in view in the focused pane, as its crumbs name it (a jump's target until the
     *  reader scrolls: docview/in-view.ts) */
    readonly active: ReadonlySignal<string | null>;
  };
  /** the focused pane's section focus: its heading's id (null: the whole document); root.state.sectionFocus says when it changes */
  focusedSection(): string | null;
  /** the document's blocks, in order */
  blocks(): Block[];
  /** where a block is, in words ("§2.1 · Lemma", else its first words), from the outline as it is now */
  locators(): (blockId: string) => string;
  /** the preamble's entry above the outline: its problems' count */
  readonly preamble: { readonly problems: ReadonlySignal<number> } | null;
  /** the Problems list's groups, in order */
  readonly groups: [ProblemKind, string][];
  /** a problem's report, to copy; null: no reports */
  readonly report: ((p: Diagnostic) => string) | null;
  /** a problem's own action element ("Add entry…"); null: none */
  readonly problemAction: ((p: Diagnostic) => HTMLElement | null) | null;
  /** an author's colour (as their note chips) */
  colour(author: string, authors: string[]): string;
  /** the Files panel: the document's files, a block's place */
  readonly files: {
    list(): Promise<{ files: unknown[]; warnings: unknown[] } | null>;
    goTo(blockId: string): unknown;
    locator(blockId: string): string;
  } | null;
}
