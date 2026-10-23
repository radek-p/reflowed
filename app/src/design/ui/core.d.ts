// The types of core.js (JavaScript: htm's tagged templates over Preact) for the kit's TypeScript modules (views.ts).
import type { VNode, ComponentChildren } from 'preact';
export const html: (strings: TemplateStringsArray, ...values: unknown[]) => VNode;
export const h: typeof import('preact').h;
export const render: (vnode: ComponentChildren, parent: Element | DocumentFragment) => void;
