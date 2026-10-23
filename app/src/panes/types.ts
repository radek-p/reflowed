// The panes' shapes, for the TypeScript modules of panes/. The JavaScript modules
// they meet (docview/document-view.js, panes/block-view.js, perf/anchor.js, panes/widths.js) are described here by
// what panes/ uses of them, nothing more.
import type { Signal } from '@preact/signals';

/** a block of the document, as the panes see it */
export interface BlockRef { id: string; kind?: string }

/** docview/document-view.js: a pane's column of block elements */
export interface DocView {
  readonly container: HTMLElement | null;
  sync(blocks: BlockRef[], elementOf: (id: string) => Element | null): unknown;
  destroy(): void;
  blocks?: Signal<unknown>;
}

/** panes/block-view.js: one block in one pane */
export interface BlockView {
  readonly id: string;
  readonly pane: string;
  readonly root: HTMLElement;
  dispose(): void;
}

/** perf/anchor.js: the reader's place, held while blocks above it change height */
export interface Keeper {
  start(): void;
  stop(): void;
  setScroller?(el: HTMLElement | null): void;
  moved?(): void;
  adjusted?(): void;
}

/** the pane's own chrome, made by the registry for a pane other than the first (docview/split-chrome.js) */
export interface Owned { destroy(): void }

export interface Box { top: number; bottom: number }

/** a pane: a view of a document (panes/pane.ts) */
export interface Pane {
  readonly id: string;
  readonly el: HTMLElement;
  readonly view: DocView;
  readonly keeper: Keeper | null;
  readonly views: Map<string, BlockView>;
  readonly scroller: HTMLElement | null;
  readonly disposed: boolean;
  /** the pane's views being made after it opened: the width governor waits for them */
  opening: Promise<void> | null;
  /** a pane added while its document loads: opened on the first sync */
  needsOpen?: boolean;
  setScroller(el: HTMLElement | null): void;
  box(): Box;
  top(): number;
  range(): { min: number; max: number };
  moving(): Element[];
  /** hold: a correction for a change of the page, not a move (perf/anchor.js appScroll) */
  scrollBy(dy: number, o?: { hold?: boolean }): void;
  contains(node: Node | null): boolean;
  viewOf(id: string): BlockView | null;
  sync(blocks: BlockRef[], make: (id: string) => BlockView): void;
  onFocus(fn: (id: string) => void): void;
  onDispose(fn: () => void): void;
  dispose(): void;
}

/** panes/layout.js: a pane's entry in the layout */
export interface LayoutEntry { id: string; doc: string | null; focus: string | null; view?: string | null; of?: unknown }

/** panes/layout.js: the layout as data (what panes/ reads and writes of it) */
export interface Layout {
  readonly panes: Signal<LayoutEntry[]>;
  readonly focused: Signal<string>;
  readonly width: Signal<number | null>;
  pane(id: string): LayoutEntry | undefined;
  ids(): string[];
  open(id: string, o?: { doc?: string | null; view?: string | null; of?: unknown }): boolean;
  close(id: string): boolean;
  focus(id: string): void;
  setWidth(px: number | null): void;
}

/** panes/widths.js: the blocks' widths while the panes change */
export interface Widths {
  transition(change: () => unknown, o?: { animate?: boolean; motion?: () => Promise<unknown> }): Promise<unknown>;
  /** every shown block laid out again (the justification switch), lazily */
  restyle(): Promise<unknown>;
  begin(): void;
  frame(): void;
  end(): void;
  /** a motion of the panes' widths (a column sliding, a splitter dragged): every block keeps its lines and
   *  width until the last hold is released; then each pane reflows once (the blocks in view, the rest lazily) */
  hold(o?: { locked?: boolean }): void;   // locked: the workbench keeps the hosts' widths for the motion (pinned at the release)
  release(): Promise<unknown> | undefined;
  idle(): Promise<unknown>;
  dispose(): void;
}
