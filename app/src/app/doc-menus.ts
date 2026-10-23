// A document editor's menus (out of app.js): the block's menu (its handle), the document's
// menu, and the slash menu of block kinds. Their entries are commands (commands/editor.js). A feature adds entries
// through the host's contribution lists (blockItems, docItems, slash): it never edits this file or app.js's lists.
// One menu is open at a time.
//
//   const menus = createDocMenus(host)
//     menus.openBlock(anchor, blockId) · menus.openDoc(anchor) · menus.openSlash(anchor, onPick, onCancel?)
//     menus.close(cancelled = true) · menus.open (is one open?)
import { openMenu, openSlash, item as menuEntry, SEP } from '../chrome/menu.js';
import { kindsFor } from '../doc/kinds.js';
import { usesPackage as usesMetaPackage } from '../meta/model.ts';

/** a menu entry as chrome/menu.js draws it, or its separator */
export type MenuEntry = { label: string; key: string; fn: () => void; disabled: boolean; shortcut: string } | { sep: true };
/** what a contribution makes entries with (chrome/menu.js item) */
export type Item = (label: string, key: string, fn: () => void, o?: { disabled?: boolean; shortcut?: string }) => MenuEntry;
/** a kind of the slash menu (app/kinds.js) */
export type SlashKind = { kind: string; label: string; source?: string; caret?: number };
export type SlashPick = (k: SlashKind) => void;
type Handle = { close(cancelled?: boolean): void };

export interface DocMenusHost {
  doc(): { preamble: { source: string }; blocks: unknown[] } | null;
  indexOf(id: string): number;
  commands: { menuItem(id: string, input?: object, o?: { disabled?: boolean; label?: string }): MenuEntry; enabled(id: string, input?: object): boolean };
  /** a feature's entries in a block's menu, after the block's own (nesting: split / join; svgfig: duplicate figure;
   *  the inspector) */
  blockItems: ((blockId: string, item: Item, anchor: Element | null) => MenuEntry[])[];
  /** a feature's entries in the document's menu, after find, focus mode and the shortcuts (notes) */
  docItems: ((item: Item) => MenuEntry[])[];
  /** a feature's kinds in the slash menu and what its pick does (svgfig: + Drawn figure) */
  slash: { kinds(kinds: SlashKind[]): SlashKind[]; pick(onPick: SlashPick): SlashPick }[];
}

export function createDocMenus(host: DocMenusHost) {
  let open: Handle | null = null;
  const onClosed = (m: Handle) => { if (open === m) open = null; };          // a menu that closed itself (a pick, Escape)
  const item: Item = (label, key, fn, o) => menuEntry(label, key, fn, o) as MenuEntry;
  function close(cancelled = true) {
    if (!open) return;
    const m = open;
    open = null;
    m.close(cancelled);
  }
  return {
    close,
    get open() { return !!open; },
    /** the slash menu: block kinds for this preamble, grouped; type to filter */
    openSlash(anchor: Element, onPick: SlashPick, onCancel: (() => void) | null = null) {
      close();
      const d = host.doc();
      if (!d) return;
      let kinds = kindsFor(d.preamble.source) as SlashKind[], pick = onPick;
      for (const s of host.slash) { kinds = s.kinds(kinds); pick = s.pick(pick); }
      open = openSlash({ anchor, kinds, onPick: pick, onCancel, onClosed });
    },
    openBlock(anchor: Element | null, id: string) {
      close();
      const d = host.doc();
      if (!d) return;
      const i = host.indexOf(id), C = host.commands;     // (read now: app.js defines its commands after the menus)
      const items: MenuEntry[] = [
        // the entries are commands: the same as the keys and editorAPI
        C.menuItem('block.edit', { id }),
        C.menuItem('block.duplicate', { id }),
        C.menuItem('block.moveUp', { id }, { disabled: i === 0 }),
        C.menuItem('block.moveDown', { id }, { disabled: i === d.blocks.length - 1 }),
        C.menuItem('block.merge', { id }),
        ...host.blockItems.flatMap((f) => f(id, item, anchor)),
        SEP as MenuEntry,
        C.menuItem('block.delete', { id }),
      ];
      open = openMenu({ anchor, cls: 'block-menu', items, focus: true, onClosed });
    },
    openDoc(anchor: Element | null) {
      close();
      const d = host.doc(), C = host.commands;
      if (!d) return;
      const items: MenuEntry[] = [
        C.menuItem('find.open'), C.menuItem('view.focusMode'), C.menuItem('view.shortcuts'),
        ...host.docItems.flatMap((f) => f(item)),
        SEP as MenuEntry,
        C.menuItem('doc.settings'), C.menuItem('doc.versions'),
        ...(C.enabled('doc.resetSeed') ? [C.menuItem('doc.resetSeed')] : []),
        SEP as MenuEntry,
        C.menuItem('doc.importTex'), C.menuItem('doc.exportTex'), C.menuItem('doc.exportZip'),
        ...(usesMetaPackage(d.preamble.source) ? [C.menuItem('doc.exportZipPlain')] : []),
        C.menuItem('doc.exportPdf'),
      ];
      open = openMenu({ anchor, cls: 'block-menu doc-menu', items, align: 'end', onClosed });
    },
  };
}
