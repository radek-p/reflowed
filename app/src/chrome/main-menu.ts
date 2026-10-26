// THE MAIN MENU's entries (the Re button in the window bar, app/wb/host.ts), and the document's groups the embedded
// editor's ⋯ menu shares (app/doc-menus.ts). Data only (chrome/menu.ts draws it): Node runs its tests.
//
//   mainMenu(host) -> entries
//     Documents · Find and replace · View › · Document › · Export › · Settings… · Keyboard shortcuts · About ReflowEd
//     View ›: View options… · Focus mode · Split view | Left sidebar · Right sidebar | one row per panel offered
//   panelToggles(offered, { shown, keys, toggle }) -> PanelToggle[]   the View menu's panel rows from the registry's
//                                                   on-demand panels (design/ui/views.ts offered), in their order
//   documentGroups(doc) -> { document, exports }    the Document and Export submenus' entries (Export › PDF: the row opens
//                                                   it in a new tab; its actions open it so, or download it)
//
// The document's entries are its commands (commands/editor.js, through its registry's menuItem: label, shortcut,
// enabled; a row's actions are the same command with another input); with no document current they are there all the same, disabled, as the command definitions name them (a
// submenu with nothing to choose is drawn disabled: chrome/menu-model.ts inactive). The page's entries are the host's
// actions, each with its key as people read it.
import { item, submenu, SEP, type MenuEntry, type MenuCommand, type MenuAction } from './menu-model.ts';
import { editorCommands } from '../commands/editor.js';
import { usesPackage } from '../meta/model.ts';
import type { IconName } from '../design/ui/icon-set.ts';

/** the current document's command registry (commands/registry.js), as a menu needs it */
export interface DocCommands {
  menuItem(id: string, input?: object, o?: { label?: string; disabled?: boolean }): MenuCommand;
  enabled(id: string, input?: object): boolean;
}
/** the current document, as its menu needs it */
export interface MenuDoc { commands: DocCommands; preamble: string }
/** a page action: what it does, its key (as people read it), on: a toggle's state */
export interface PageAction { run(): void; shortcut?: string; on?: boolean }
/** a side column, as the View menu shows and hides it: on, shown; empty, no panel in it (its row disabled) */
export interface SideToggle extends PageAction { side: 'left' | 'right'; empty?: boolean }
/** a panel the View menu opens and closes (an on-demand view): on, open and in view */
export interface PanelToggle extends PageAction { id: string; title: string }
/** an on-demand view, as its row needs it (design/ui/views.ts ViewDef) */
export interface OfferedPanel { id: string; title?: string | ((state: unknown) => string); panel?: { keys?: string } | null }
export interface MainMenuHost {
  /** null: no document is current (its entries disabled) */
  doc: MenuDoc | null;
  documents: PageAction;
  viewOptions: PageAction;
  /** the side columns, left then right */
  sides: readonly SideToggle[];
  /** the panels offered on demand (Files, the Inspector, Settings: as the registry has them now) */
  panels: readonly PanelToggle[];
  settings: PageAction;
  about: PageAction;
  /** the document's focus mode is on (its row's check) */
  focusMode?: boolean;
  /** the split's key on this page (the host's key table) */
  splitKey?: string;
}

type Def = { id: string; label: string; key?: string; shortcut?: string; icon?: IconName };
const DEFS = new Map(editorCommands().map((c) => [c.id, c as Def]));
/** a row's action: the row's command with this input */
type ActionOpt = { label: string; key: string; icon: IconName; input: object };
type Opts = { label?: string; shortcut?: string; checked?: boolean; actions?: readonly ActionOpt[] };
/** command `id` of the document as an entry; with no document, its definition's entry, disabled (its actions too) */
function cmd(doc: MenuDoc | null, id: string, o: Opts = {}): MenuCommand {
  const action = ({ label, key, icon, input }: ActionOpt): MenuAction => {
    if (!doc) return { label, key, icon, disabled: true };
    const m = doc.commands.menuItem(id, input);
    return { label, key, icon, ...(m.fn ? { fn: m.fn } : {}), disabled: !!m.disabled };
  };
  const extra = { ...(o.shortcut ? { shortcut: o.shortcut } : {}), ...(o.checked != null ? { checked: o.checked } : {}), ...(o.actions ? { actions: o.actions.map(action) } : {}) };
  if (doc) return { ...doc.commands.menuItem(id, {}, o.label ? { label: o.label } : {}), ...extra };
  const d = DEFS.get(id);
  if (!d) throw new Error(`main menu: no command ${id}`);
  return { label: o.label ?? d.label, key: d.key ?? id, disabled: true, shortcut: d.shortcut ?? '', ...(d.icon ? { icon: d.icon } : {}), ...extra };
}
const page = (label: string, key: string, a: PageAction, icon?: IconName, disabled = false) => item(label, key, () => a.run(), { shortcut: a.shortcut ?? '', disabled, ...(icon ? { icon } : {}), ...(a.on != null ? { checked: a.on } : {}) });
const SIDE_LABEL = { left: 'Left sidebar', right: 'Right sidebar' } as const;

/** the View menu's panel rows: one per on-demand panel registered, its title, checked while it is shown, its key */
export function panelToggles(offered: readonly OfferedPanel[], o: { shown(id: string): boolean; keys(spec: string): string; toggle(id: string): void }): PanelToggle[] {
  return offered.map((v) => ({ id: v.id, title: typeof v.title === 'function' ? v.title(null) : v.title ?? v.id, on: o.shown(v.id),
    shortcut: v.panel?.keys ? o.keys(v.panel.keys) : '', run: () => o.toggle(v.id) }));
}

/** the Document and Export submenus: Reset only for a document that has an original, the plain-title archive only with
 *  the title package */
export function documentGroups(doc: MenuDoc | null): { document: MenuEntry[]; exports: MenuEntry[] } {
  const C = doc?.commands;
  return {
    document: [
      cmd(doc, 'doc.settings', { label: 'Document settings…' }), cmd(doc, 'doc.versions'),
      ...(C?.enabled('doc.resetSeed') ? [cmd(doc, 'doc.resetSeed')] : []),
      SEP, cmd(doc, 'doc.importTex'),
    ],
    exports: [
      cmd(doc, 'doc.exportTex', { label: 'LaTeX source (.tex)' }), cmd(doc, 'doc.exportZip', { label: 'LaTeX with its files (.zip)' }),
      ...(doc && usesPackage(doc.preamble) ? [cmd(doc, 'doc.exportZipPlain', { label: 'LaTeX with plain title commands (.zip)' })] : []),
      cmd(doc, 'doc.exportPdf', { label: 'PDF', actions: [{ label: 'Open in a new tab', key: 'open', icon: 'newTab', input: {} },
        { label: 'Download', key: 'download', icon: 'download', input: { download: true } }] }),
    ],
  };
}

export function mainMenu(h: MainMenuHost): MenuEntry[] {
  const { document, exports } = documentGroups(h.doc);
  const view: MenuEntry[] = [
    page('View options…', 'view-options', h.viewOptions),
    cmd(h.doc, 'view.focusMode', { checked: !!h.focusMode }),
    cmd(h.doc, 'view.split', { ...(h.splitKey ? { shortcut: h.splitKey } : {}) }),
    SEP,
    ...h.sides.map((s) => page(SIDE_LABEL[s.side], `side-${s.side}`, { ...s, on: !s.empty && !!s.on }, undefined, !!s.empty)),
    ...(h.panels.length ? [SEP, ...h.panels.map((p) => page(p.title, `panel-${p.id}`, { ...p, on: !!p.on }))] : []),
  ];
  return [
    page('Documents', 'documents', h.documents, 'home'),
    SEP,
    cmd(h.doc, 'find.open'),
    submenu('View', 'view', view, { icon: 'textSize' }),
    submenu('Document', 'document', document, { icon: 'file' }),
    submenu('Export', 'export', exports, { icon: 'download' }),
    SEP,
    page('Settings…', 'settings', h.settings, 'settings'),
    cmd(h.doc, 'view.shortcuts'),
    page('About ReflowEd', 'about', h.about, 'info'),
  ];
}
