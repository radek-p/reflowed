// Loose types for the kit (index.js), so strict TypeScript modules (io/) can use it. Components take any
// props and return a vnode; GUIDE.md documents the props.
type Component = (props: any) => any;
export const html: (strings: TemplateStringsArray, ...values: any[]) => any;
export const h: (...a: any[]) => any;
export const render: (vnode: any, parent: Element | DocumentFragment) => void;
export const Fragment: Component;
export function cx(...a: any[]): string;
export function ensureStyles(doc?: Document): void;
export function mountInto(vnode: any, parent?: Element, tag?: string): { el: HTMLElement; update(v: any): void; destroy(): void };
export function nextId(prefix?: string): string;
/** an element Preact renders once and never again (contents owned elsewhere); `tag` default div */
export const Island: Component;
/** the one Copy button: text() on the click, "Copied" for 1.6 s (data-copied) */
export const CopyButton: Component;
export function copyText(text: string): Promise<boolean>;
export { Icon, svg, ICON_NAMES, type IconName } from './icons.ts';
export const Button: Component, IconButton: Component, Input: Component, Select: Component, Tabs: Component, Segmented: Component,
  Chip: Component, Pill: Component, Card: Component, Banner: Component;
export const Popover: Component, Menu: Component, MenuItem: Component, MenuSeparator: Component, MenuLabel: Component,
  Dialog: Component, Sheet: Component, Toast: Component, Tooltip: Component;
export function showToast(text: string, o?: { action?: { key?: string; label: string; onClick?(): void } | null; duration?: number; stack?: boolean; class?: string; [k: string]: any }):
  { close(): void; readonly element: HTMLElement | null; onGone: (() => void) | undefined };
export function openLayer(make: (close: () => void) => any, o?: { kind?: 'menu' | 'popover' | 'card' | 'modal' | 'toast' | 'pill' | null; anchor?: Element | null; toggle?: boolean; onDismiss?: ((reason: string) => void) | null; returnFocus?: any }): { close(): void; el: HTMLElement; update(): void; contains(n: Node | null): boolean };
export function pushLayer(o: { el: HTMLElement; kind?: 'menu' | 'popover' | 'card' | 'modal' | 'toast' | 'pill'; anchor?: Element | null; toggle?: boolean; onDismiss?: ((reason: string, e?: Event) => void) | null; returnFocus?: any }): { el: HTMLElement; remove(): void; contains(n: Node | null): boolean };
export function owns(node: Node | null | undefined): boolean;
export function toggling(anchor: Element | null | undefined): boolean;
export function layerState(): { kind: string; z: string; el: HTMLElement }[];
export function place(el: HTMLElement, anchor: any, o?: { placement?: string; keep?: boolean | null }): boolean | null;
export interface ViewDef { id: string; title?: string; slot?: string | null; Component?: Component; [k: string]: any }
export function registerView(v: ViewDef): () => void;
export function openView(id: string, props?: Record<string, any>, o?: { in?: string | null }): { close(): void; el: HTMLElement | null };
export function view(id: string): ViewDef | null;
export function views(slot?: string): ViewDef[];
export function isOpen(id: string): boolean;
export const Frame: Component, SheetFrame: Component;
export const FrameContext: any;
export { defineSlot, slotsOf } from './views.ts';
