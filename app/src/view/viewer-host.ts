// The viewer as the editor reads it: its documented host API only (reflowtex src/viewer/src/host/types.ts:
// Host, Block, Segment), typed here for the editor's modules, with nothing of the viewer's internals.
//
//   viewerHost(of?) · blockOf(el) · blockEls()         the host (of an element's window: a frame's own viewer), the
//                                                       Block of an element (by its window's viewer), every block's element
//   segmentsOf(el)                                      a block's segments (Block.segments): kind, svg, painted, walk
//   documentOf(el)                                      its decoded document (Block.document)
//   sourceWidthPt(el) · laidAt(el) · relayout(el)       the width TeX set it at; how it was last laid out; again now
//   layoutDone(el)                                      that layout done (the viewer lays out what is off the screen later)
//   layoutGeneration(el)                                bumped on every layout of the block and every paint of more of
//                                                       its lines (its 'layout' event): what a cache of its geometry keys on
//   spToPx(of?) · whenIdle(of?)                         CSS px per sp; the viewer settled (host.idle), of el's window

export interface WalkSink {
  line?(j: number, nodes: readonly ViewerNode[], x0: number, baselineY: number): void;
  node?(n: ViewerNode, x: number, baselineY: number, advance: number): void;
}
/** A node of the block's document (latex.proto's Node, decoded): the fields the editor reads. */
export interface ViewerNode { type: string; char?: number; font?: number; metrics?: number; height?: number; depth?: number; [k: string]: unknown }
export interface ViewerSegment {
  readonly kind: 'text' | 'display' | 'stream';
  readonly svg: SVGSVGElement | null;
  readonly painted: boolean;
  segments(): readonly ViewerSegment[];
  walk(sink: WalkSink): boolean;
}
export interface ViewerBlock {
  readonly el: HTMLElement;
  readonly key: string;
  readonly document: Readonly<Record<string, any>>;
  layout(): { widthPt: number; align: string; sourceWidthPt: number } | null;
  relayout(): void;
  layoutDone(): Promise<void>;
  segments(): readonly ViewerSegment[];
  on(event: 'layout', fn: () => void): () => void;
}
interface ViewerHost {
  blocks(): ViewerBlock[];
  block(el: Element): ViewerBlock | undefined;
  idle(): Promise<void>;
  readonly spToPx: number;
}

type WithHost = { reflowtex?: { host?: ViewerHost } };
/** the viewer's host of `of`'s window (a frame's own viewer), else of this window */
export const viewerHost = (of?: Element | null): ViewerHost | null =>
  ((of?.ownerDocument?.defaultView ?? globalThis) as WithHost).reflowtex?.host ?? null;
export function blockOf(el: Element | null | undefined): ViewerBlock | null {
  if (!el) return null;
  try { return viewerHost(el)?.block(el) ?? null; } catch { return null; }
}
export const blockEls = (): HTMLElement[] => viewerHost()?.blocks().map((b) => b.el) ?? [];
export const segmentsOf = (el: Element | null | undefined): readonly ViewerSegment[] => blockOf(el)?.segments() ?? [];
export const documentOf = (el: Element | null | undefined): Readonly<Record<string, any>> | null => blockOf(el)?.document ?? null;
/** the width (pt) the block was typeset at (TeX's \hsize there: \textwidth for a paragraph), 0 if unknown */
export function sourceWidthPt(el: Element | null | undefined): number {
  const w = Number(documentOf(el)?.source_width ?? 0);
  return w > 0 ? w / 65536 : 0;
}
/** the width (pt) and alignment the viewer last laid the block out at, or null before its first layout */
export function laidAt(el: Element | null | undefined): { widthPt: number; align: string } | null {
  const l = blockOf(el)?.layout();
  return l ? { widthPt: l.widthPt, align: l.align } : null;
}
/** lay the block out again (after a change the viewer cannot see, like --latex-align) */
export function relayout(el: Element | null | undefined): void { try { blockOf(el)?.relayout(); } catch { /* gone */ } }
/** resolved once the viewer has laid out all of the block's last layout (what is off the screen it lays out in its idle
 *  slices: Block.layoutDone); at once when nothing is under way or the block is gone */
export function layoutDone(el: Element | null | undefined): Promise<void> {
  try { return blockOf(el)?.layoutDone() ?? Promise.resolve(); } catch { return Promise.resolve(); }
}

const generations = new WeakMap<ViewerBlock, { n: number }>();
export function layoutGeneration(el: Element | null | undefined): number {
  const b = blockOf(el);
  if (!b) return -1;
  let g = generations.get(b);
  if (!g) { const gen = { n: 0 }; g = gen; generations.set(b, gen); b.on('layout', () => { gen.n++; }); }
  return g.n;
}
export const spToPx = (of?: Element | null): number => viewerHost(of)?.spToPx ?? 0;
export const whenIdle = (of?: Element | null): Promise<void> => viewerHost(of)?.idle() ?? Promise.resolve();
