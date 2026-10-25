// The main menu's entries (chrome/main-menu.ts): its top level in order, its submenus, the keys shown, the document's
// entries disabled with no document (their submenus too), Reset and the plain-title archive only when they apply, the
// inspector only when given, the page's toggles checked.
//   node app/src/chrome/main-menu.test.ts      (Node; exit 1 on a failure)
import { mainMenu, documentGroups, type MainMenuHost, type DocCommands } from './main-menu.ts';
import { inactive, isSep, type MenuEntry, type MenuCommand } from './menu-model.ts';
import { createCommands, editorCommands } from '../commands/index.js';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d !== '' && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };
const keys = (l: readonly MenuEntry[]) => l.map((e) => (isSep(e) ? '-' : e.key)).join(' ');
const by = (l: readonly MenuEntry[], key: string) => l.find((e) => !isSep(e) && e.key === key) as MenuCommand;

const ran: string[] = [];
const act = (name: string, o: { shortcut?: string; on?: boolean } = {}) => ({ run: () => { ran.push(name); }, ...o });
const page = (o: Partial<MainMenuHost> = {}): MainMenuHost => ({
  doc: null, documents: act('documents', { shortcut: '⌥⌘N' }), viewOptions: act('view', { shortcut: '⌥⌘V' }), sidebar: act('sidebar', { on: true, shortcut: '⌘B' }),
  settings: act('settings', { shortcut: '⌘,' }), about: act('about'), splitKey: '⌥⌘\\', ...o,
});
// a document's registry: the editor's commands, with a page that says what it can do
const can = { resetSeed: false, exportZip: true, exportPdf: true };
const C = createCommands({ context: () => ({ page: { can: { resetSeed: () => can.resetSeed, importTex: () => true, exportZip: () => can.exportZip, exportPdf: () => can.exportPdf },
  find: () => ran.push('find'), exportTex: () => ran.push('tex'), exportPdf: (o: object) => ran.push(`pdf ${JSON.stringify(o)}`) } }) }).define(editorCommands('mac')) as unknown as DocCommands;
const doc = (preamble = '\\documentclass{article}') => ({ commands: C, preamble });

{
  const m = mainMenu(page());
  check('top level: Documents, Find, View ›, Document ›, Export ›, Settings…, Keyboard shortcuts, About', keys(m) === 'documents - find view document export - settings keys about', keys(m));
  check('the top level has icons; the submenus are View, Document, Export', m.every((e) => isSep(e) || !!e.icon) && ['view', 'document', 'export'].every((k) => !!by(m, k).items), m);
  check('no document: Find, Keyboard shortcuts and the Document and Export submenus disabled; Documents, Settings, About not', inactive(by(m, 'find')) && inactive(by(m, 'keys'))
    && inactive(by(m, 'document')) && inactive(by(m, 'export')) && !inactive(by(m, 'documents')) && !inactive(by(m, 'settings')) && !inactive(by(m, 'about')));
  check('no document: the View submenu can still be used (View options, Sidebar)', !inactive(by(m, 'view')) && !inactive(by(by(m, 'view').items!, 'view-options')) && inactive(by(by(m, 'view').items!, 'focus')));
  const findKey = (editorCommands() as { id: string; shortcut?: string }[]).find((c) => c.id === 'find.open')?.shortcut;   // (this platform's)
  check('the keys shown: Settings ⌘,, Documents ⌥⌘N, Find its command\'s, the split the host\'s', by(m, 'settings').shortcut === '⌘,' && by(m, 'documents').shortcut === '⌥⌘N'
    && by(m, 'find').shortcut === findKey && !!findKey && by(by(m, 'view').items!, 'split').shortcut === '⌥⌘\\', [by(m, 'find').shortcut, by(by(m, 'view').items!, 'split').shortcut]);
  check('View: View options…, Focus mode, Split view, Sidebar (no Inspector unless given)', keys(by(m, 'view').items!) === 'view-options focus split sidebar', keys(by(m, 'view').items!));
  check('the toggles are checked as they are: Sidebar on, Focus mode off', by(by(m, 'view').items!, 'sidebar').checked === true && by(by(m, 'view').items!, 'focus').checked === false);
  by(m, 'settings').fn!(); by(m, 'about').fn!();
  check('a page entry runs its action', ran.join() === 'settings,about', ran);
}
{
  ran.length = 0;
  const m = mainMenu(page({ doc: doc(), focusMode: true, inspector: act('inspector', { on: true, shortcut: '⌥⇧I' }) }));
  check('a document: its entries enabled', !inactive(by(m, 'find')) && !inactive(by(m, 'document')) && !inactive(by(m, 'export')) && !inactive(by(m, 'keys')));
  check('Document: Document settings…, Versions…, Import .tex… (no Reset for a document without an original)', keys(by(m, 'document').items!) === 'doc-settings versions - import-tex', keys(by(m, 'document').items!));
  check('Export: .tex, .zip, PDF (no plain-title archive without the title package)', keys(by(m, 'export').items!) === 'export-tex export-zip export-pdf', keys(by(m, 'export').items!));
  check('the inspector given: its row, checked, with its key', keys(by(m, 'view').items!).endsWith('inspector') && by(by(m, 'view').items!, 'inspector').checked === true && by(by(m, 'view').items!, 'inspector').shortcut === '⌥⇧I');
  check('focus mode on: its row checked', by(by(m, 'view').items!, 'focus').checked === true);
  by(m, 'find').fn!(); by(by(m, 'export').items!, 'export-tex').fn!();
  check('a document entry runs its command', ran.join() === 'find,tex', ran);
  ran.length = 0;
  const pdf = by(by(m, 'export').items!, 'export-pdf');
  check('Export › PDF: two actions, open in a new tab and download, with their icons', pdf.actions?.map((a) => `${a.key}:${a.icon}:${a.label}`).join() === 'open:newTab:Open in a new tab,download:download:Download', pdf.actions);
  pdf.fn!(); pdf.actions![0]!.fn!(); pdf.actions![1]!.fn!();
  check('… the row and "open" open it in a new tab, "download" saves it: one command, its input', ran.join('|') === 'pdf {"download":false}|pdf {"download":false}|pdf {"download":true}', ran);
  const none = by(by(mainMenu(page()), 'export').items!, 'export-pdf');
  check('no document: the PDF row and its actions disabled', !!none.disabled && none.actions?.length === 2 && none.actions.every((a) => a.disabled && !a.fn), none);
  can.resetSeed = true; can.exportPdf = false;
  const g = documentGroups(doc('\\documentclass{article}\n\\usepackage{reflowed-meta}'));
  check('Reset to original when the document has one; the plain-title archive with the title package; PDF disabled when it cannot', keys(g.document) === 'doc-settings versions reset-seed - import-tex'
    && keys(g.exports) === 'export-tex export-zip export-zip-plain export-pdf' && inactive(by(g.exports, 'export-pdf')) && !!by(g.exports, 'export-pdf').actions?.every((a) => a.disabled), [keys(g.document), keys(g.exports)]);
}

console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
