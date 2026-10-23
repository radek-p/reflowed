// The types of layers.js (the one overlay layer) for the kit's TypeScript modules (views.ts).
import type { VNode } from 'preact';
export type LayerKind = 'menu' | 'popover' | 'card' | 'modal' | 'toast' | 'pill';
export function openLayer(make: (close: () => void) => VNode | null, o?: { kind?: LayerKind | null; anchor?: Element | null; toggle?: boolean; onDismiss?: ((reason: string) => void) | null; returnFocus?: Element | (() => Element | null) | null }): { close(): void; el: HTMLElement; update(): void; contains(n: Node | null): boolean };
export function pushLayer(o: { el: HTMLElement; kind?: LayerKind; anchor?: Element | null; toggle?: boolean; onDismiss?: ((reason: string, e?: Event) => void) | null; returnFocus?: Element | (() => Element | null) | null }): { el: HTMLElement; remove(): void; contains(n: Node | null): boolean };
export function owns(node: Node | null | undefined): boolean;
export function toggling(anchor: Element | null | undefined): boolean;
export function layerState(): { kind: string; z: string; el: HTMLElement }[];
