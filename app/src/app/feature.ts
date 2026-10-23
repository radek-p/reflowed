// A feature of the document editor: what a feature module (svgfig, nesting, notes, the
// inspector…) adds to every document editor, in one shape. app.js keeps one list of features and composes them; the
// menus, an opened document, a structural change, a duplicate, an export, the editor's end and the test surface all
// ask the list. A new feature is a module that returns a Feature, and one entry in that list: no other edit of app.js.
//
//   const all = composeFeatures([svgFigs, …])
//     all.blockItems · all.docItems · all.slash        the menus' contributions (app/doc-menus.ts)
//     all.blockAction(block) -> BlockAction | null    the block shell's one button (the first feature that has one)
//     all.loaded(doc) · all.sync()                     a document opened · after every structural change
//     all.duplicate(id) -> bool                        a block's Duplicate, when a feature does it itself (true: done)
//     all.forExport(doc) -> doc                         each feature's filter of what exports and read-only copies get
//     all.dispose() · all.testApi()                    the editor goes · editorAPI's probes, merged
import type { MenuEntry, Item, SlashKind, SlashPick } from './doc-menus.ts';

/** a feature's button on a block (the shell draws it: docview/block-shell.js); run(view): the view it was pressed in */
export interface BlockAction { id: string; label: string; title?: string; cls?: string; run(view: unknown): void }

export interface Feature {
  /** a name, for tests and errors (unique in the list) */
  id: string;
  /** entries of a block's menu, after the block's own */
  blockItems?(blockId: string, item: Item, anchor: Element | null): MenuEntry[];
  /** entries of the document's menu, after find, focus mode and the shortcuts */
  docItems?(item: Item): MenuEntry[];
  /** the block shell's button for this block (e.g. Edit figure), or null */
  blockAction?(block: { id: string; source: string }): BlockAction | null;
  /** the slash menu's kinds, and what a pick does */
  slash?: { kinds(kinds: SlashKind[]): SlashKind[]; pick(onPick: SlashPick): SlashPick };
  /** a document was opened (its assets, its state) */
  loaded?(doc: unknown): void;
  /** after every structural change of the document */
  sync?(): void;
  /** a block's Duplicate, when this feature duplicates it itself: true when done */
  duplicate?(blockId: string): boolean;
  /** what an export or a read-only copy gets of the stored document */
  forExport?(doc: unknown): unknown;
  /** the editor goes: its page listeners removed */
  dispose?(): void;
  /** editorAPI's probes (tests) */
  testApi?(): Record<string, unknown>;
}

export function composeFeatures(features: readonly Feature[]) {
  const ids = new Set<string>();
  for (const f of features) { if (ids.has(f.id)) throw new Error(`feature ${f.id} listed twice`); ids.add(f.id); }
  const having = <K extends keyof Feature>(k: K) => features.filter((f) => f[k] !== undefined);
  return {
    features,
    blockItems: having('blockItems').map((f) => (id: string, item: Item, anchor: Element | null) => f.blockItems!(id, item, anchor)),
    docItems: having('docItems').map((f) => (item: Item) => f.docItems!(item)),
    slash: having('slash').map((f) => f.slash!),
    blockAction(block: { id: string; source: string }): BlockAction | null { for (const f of features) { const a = f.blockAction?.(block); if (a) return a; } return null; },
    loaded(doc: unknown) { for (const f of features) f.loaded?.(doc); },
    sync() { for (const f of features) f.sync?.(); },
    duplicate(blockId: string): boolean { return features.some((f) => f.duplicate?.(blockId) ?? false); },
    forExport(doc: unknown): unknown { return features.reduce((d, f) => (f.forExport ? f.forExport(d) : d), doc); },
    dispose() { for (const f of features) f.dispose?.(); },
    testApi(): Record<string, unknown> { return Object.assign({}, ...features.map((f) => f.testApi?.() ?? {})); },
  };
}
