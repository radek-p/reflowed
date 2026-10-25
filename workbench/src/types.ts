// The workbench's shared types: the view type a host registers, the context a view gets, the document status, the
// events. Types only (erased): the modules import them with `import type`.
import type { ComponentType } from 'preact';
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { Tab, ViewState, SideName, Side, PanelWidth } from './model.ts';
import type { IconName } from './kit/icons.ts';
import type { Crumb } from './crumbs.ts';
import type { DragInfo, DragResult, DragSpec, DropHandlers, PointerSession } from './drag.ts';
import type { Workbench } from './workbench.ts';

/** What a chip's dropdown is opened with: the element it opens on, and where the focus goes back. */
export type ChipEvent = { currentTarget: Element; anchor?: Element; returnFocus?: Element | null };
/** A tab's section, chapter or part (its second line, or after the "›"): the view type's subtitle(tab, ctx). `num` its number
 *  (kept when the text truncates), `kind` the level as the host names it ("Section", "Chapter", "Part"; default "Section"):
 *  the chip's accessible name says it ("Go to chapter: 2  Minors"). */
export type Subtitle = { label: string; num?: string; text?: string; kind?: string; title?: string; onSelect?(e: ChipEvent): void };
/** The document switcher on a tab's name (the view type's switcher(tab, ctx)). */
export type Switcher = { onSelect(e: ChipEvent): void };
/** Where an open goes: a group (default the focused one), an index, activated or not, a preview, the focus into it. */
export type OpenSpec = { id?: string; view: string; state?: ViewState };
export type OpenOpts = { group?: string | null; index?: number | null; activate?: boolean; preview?: boolean; focus?: boolean };

/**
 * A view's context: the same members wherever the view is (a tab, a side panel, the home panel); what a container
 * cannot do is a capability set to false, never a function that does nothing.
 */
export type ViewContext = {
  /** The view's own id in its container: a tab's id, `side-<panel>` for a panel, `home:<group>` for home. */
  readonly viewId: string;
  /** Which container: a tab in a group, a side panel, or the home panel over (or instead of) a group's tab. */
  readonly kind: 'tab' | 'panel' | 'home';
  readonly wb: Workbench;
  /** The tab as the layout has it (a panel and home: a stand-in with their state). */
  readonly tab: ReadonlySignal<Tab | null>;
  readonly state: ReadonlySignal<ViewState>;
  /** The group the view is in (a panel: none). */
  readonly groupId: ReadonlySignal<string | null>;
  /** The side column a panel is docked in (others: none). */
  readonly side: ReadonlySignal<SideName | null>;
  /** The view is alone (one tab, no strip): its crumbs name the document. */
  readonly solo: ReadonlySignal<boolean>;
  readonly visible: Signal<boolean>;
  readonly resizing: Signal<boolean>;
  readonly size: Signal<{ w: number; h: number }>;
  /** What this container lets the view do (false: the member below does nothing here). */
  readonly can: { readonly keep: boolean; readonly replace: boolean; readonly close: boolean; readonly openBeside: boolean };
  setState(patch: Partial<ViewState> | ((s: ViewState) => ViewState)): void;
  /** A preview tab becomes a normal one. */
  keep(): void;
  /** Another view in this place (home: the tab it is over, or a new one). */
  replace(spec: OpenSpec): void;
  /** Open a view where this one is: a tab, a new tab in its group; a panel, in the focused group; home, in its place (the
   *  tab it is over), or with `beside` (or a preview) a new tab next to it. */
  open(spec: OpenSpec, opts?: OpenOpts & { beside?: boolean }): void;
  close(): void;
  announce(text: string): void;
  dropTarget(el: Element, handlers: DropHandlers): () => void;
  startDrag(e: PointerEvent, spec: DragSpec): PointerSession | null;
};

/** A registered view type: how its tabs read, what they show, and its Component. S: its state. */
export type ViewType<S extends ViewState = ViewState> = {
  id: string;
  title?(state: S, tab?: Tab): string;
  label?: string;
  icon?: IconName | ((state: S) => IconName);
  /** false: a document (no icon in its tab, the icon only when there is no room for its name). */
  tabIcon?: boolean;
  /** Hidden, the view stays mounted (inert, not laid out). */
  keepAlive?: boolean;
  /** A split copies the tab (default) or moves it. */
  split?: 'copy' | 'move';
  docId?(state: S, tab: Tab): string | null;
  crumbs?(tab: Tab, ctx: ViewContext): Crumb[] | null;
  subtitle?(tab: Tab, ctx: ViewContext): Subtitle | null;
  switcher?(tab: Tab, ctx: ViewContext): Switcher | null;
  rename?(tab: Tab, name: string, ctx: ViewContext | undefined): void;
  focus?(ctx: ViewContext): void;
  /** Where its host sits in its group while the groups' widths move (the host kept at its width `w`: workbench.ts lockHosts),
   *  as a CSS `left` whose percentages are of the group's width (which moves every frame). Read once, as the motion
   *  begins: no layout read in it. None: the host's left edge stays where it is. */
  lockedLeft?(ctx: ViewContext, w: number): string | null;
  /** A side panel: docked on this side by default (below: as its own group at the column's bottom). width: its column's
   *  default width while the user has not sized it: { share, min?, max? }, a share of the workbench's width within px
   *  bounds (the widest share of the column's panels wins; none of them: SIDE_SIZE px); a column with such a default
   *  takes the whole width in a narrow window (an overlay). onClose: the panel is closable (a close button on its own
   *  tab, Close in its menu), and this is what closing it does (the host takes it away: unregisters its type). */
  panel?: { side?: SideName; below?: boolean; index?: number; width?: PanelWidth; onClose?(): void };
  /** A side panel's count on its tab (may read signals: the strip follows): the Problems, the TODOs. */
  badge?(): { n: number; title?: string; tone?: 'danger' } | null;
  Component: ComponentType<{ tab: Tab; ctx: ViewContext }>;
};

/** k of n blocks typeset: the bar the host asks for, when the run began, when k last changed. */
export type Progress = { done: number; total: number; bar: 'full' | 'band'; run: number; since: number };
export type DocStatus = { typesetting: boolean; errors: number; unsaved: boolean; progress?: Progress };
/** What a host sets: typesetting true, or k of n (the progress fill). */
export type DocStatusInput = { typesetting?: boolean | { done?: number; total?: number; bar?: 'full' | 'band' }; errors?: number; unsaved?: boolean; progress?: unknown };

/** A tab drag's drop hint: into a strip at an index (the insertion bar at x), or a group's body (its centre or an edge). */
export type TabHint = { tabId: string; group: string; kind: 'strip'; index: number; x: number; side?: undefined }
  | { tabId: string; group: string; kind: 'body'; side: Side | null; index?: undefined; x?: undefined };
/** While a tab drag is over nothing: its id only. */
export type TabDnd = TabHint | { tabId: string; kind: null; group?: undefined; index?: undefined; side?: undefined; x?: undefined };
/** A panel drag's drop hint: a group's strip at an index, or a new group above or below a group (or a closed column's edge). */
export type PanelHint = { id: string; side: SideName; group: string | null; index: number | null; x?: number; where?: 'top' | 'bottom'; edge?: boolean };

/** The workbench's events and their details (wb.on). */
export type WorkbenchEvents = {
  change: { layout: import('./model.ts').Layout; prev: import('./model.ts').Layout; why: string };
  open: { tabId: string }; close: { tabId: string }; activate: { tabId: string };
  mount: { tabId: string }; unmount: { tabId: string };
  resizestart: { split?: string; groups?: string[]; side?: SideName; how: string };
  resizeend: { split?: string; groups?: string[]; side?: SideName; how: string; sizes?: number[]; size?: number };
  tabdrop: { tabId: string; noop: boolean }; paneldrop: { id: string; noop: boolean };
  tabdragstart: { tabId: string }; tabdragend: { tabId: string; dropped: boolean; hint?: TabHint | null; cancelled?: boolean };
  paneldragstart: { id: string }; paneldragend: { id: string; dropped: boolean; hint?: PanelHint | null; cancelled?: boolean };
  dragstart: DragInfo; dragend: DragInfo & Partial<DragResult>;
  home: { group: string; on: boolean }; rename: { tabId: string; name: string };
  docflashend: { docId: string };
  tabsplace: { inbar: boolean }; tabsplaced: { inbar: boolean };
  tabform: { group: string; form: 'one' | 'two' };
  tabsmove: { group: string; how: 'reorder' | 'open' | 'close' }; tabsdivide: { group: string };
  barmark: { part: string; on: boolean };
};
