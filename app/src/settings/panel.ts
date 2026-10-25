// THE SETTINGS PANEL: every preference of this browser in one side panel, a view (design/ui/views.ts) registered while it
// is open (openSettings: the main menu's Settings… and Ctrl/⌘ ,, app/wb/host.ts) and closable (panel.onClose: the close on
// its tab, Close in its menu: closeSettings), on the right, its column a third of the window wide by default (between 380
// and 560 px; a phone's whole width). Its content is apart from its container as the other panels' is. Its sections, in
// order (the common first, Advanced last):
//   Reading        the View options' rows (where 'view': width, text, colours), each with its one-line explanation
//   Editing        block handles; the edit layout (a developer's option)
//   Notes          note chips; comments as notes
//   This document  Document settings… (this document's preamble, bibliography and engine: the sheet, settings/index.js)
//   Advanced       Show advanced features (and what it shows), then what it shows here (the TeX resource server)
// Each section's rows are registrations (settings/registry.ts: a module adds a row with registerSetting, the panel is not
// edited); a section with no row drawn is left out. A row's context is a SettingsCtx (the page's preferences, `detail`,
// the current document's commands). The panel follows the preferences' signals (the view's `changed`, the advanced
// switch, the current document); the notes' two switches keep their own state (only they change those settings).
//
//   SETTINGS_PANEL                       its view id
//   openSettings() · closeSettings() · settingsOpen()
//   providePreferences({ view, notes })  the page's preferences, once made (app/services.ts: before any panel is drawn)
import type { ReadonlySignal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { Button } from '../design/ui/index.js';
import { registerView, type ViewContext, type ViewDef } from '../design/ui/views.ts';
import { registerSetting, visibleAt, type Where } from './registry.ts';
import { advanced, setAdvanced, advancedFeatures } from './advanced.js';
import { SwitchRow, Row } from './rows.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';
import type { PopoverView } from '../view/popover.ts';
import './resource-field.ts';                  // the Advanced section's TeX resource server

export const SETTINGS_PANEL = 'app-settings';

/** the page's notes (notes/index.js), as their settings need them */
export interface NotesPrefs { settings(): { hidden: boolean; comments: boolean }; setHidden(hidden: boolean): void; setComments(on: boolean): void }
/** the page's preferences: the View options (view/index.js) and the notes; null: not on this page */
export interface Preferences { view: (PopoverView & { readonly changed: ReadonlySignal<number> }) | null; notes: NotesPrefs | null }
/** a Settings panel row's context */
export interface SettingsCtx extends Preferences {
  /** each row draws its one-line explanation */
  detail: true;
  /** the current document's commands (a row acts on the document through them) */
  commands: ViewContext['commands'];
  hasDoc: boolean;
}

let prefs: Preferences = { view: null, notes: null };
export function providePreferences(p: Preferences): void { prefs = p; }

const SECTIONS: { where: Where; title: string; note?: string; view?: boolean }[] = [
  { where: 'view', title: 'Reading', view: true, note: `How documents look in this browser; the View options (Aa, ${shortcutLabel('mod+alt+v')}) have the same.` },
  { where: 'editing', title: 'Editing', view: true },
  { where: 'notes', title: 'Notes' },
  { where: 'document', title: 'This document' },
  { where: 'advanced', title: 'Advanced' },
];

type NotesCtx = SettingsCtx & { notes: NotesPrefs };
const hasNotes = (c: object) => !!(c as SettingsCtx).notes;
/** a switch of the notes' settings (no signals: its own state, from the settings when drawn) */
function NoteSwitch({ notes, id, label, hint, get, set }: { notes: NotesPrefs; id: string; label: string; hint: string; get(s: { hidden: boolean; comments: boolean }): boolean; set(on: boolean): void }) {
  const [on, setOn] = useState(() => get(notes.settings()));
  return html`<${SwitchRow} id=${id} label=${label} hint=${hint} checked=${on} onChange=${(v: boolean) => { set(v); setOn(v); }} />`;
}
registerSetting({ id: 'notes-chips', where: 'notes', order: 10, shown: hasNotes, Control: ({ notes }: NotesCtx) => html`<${NoteSwitch} notes=${notes} id="set-note-chips" label="Note chips"
    hint="A chip in the line for each \\todo and note comment. Off: no chips, the lines close up." get=${(s: { hidden: boolean }) => !s.hidden} set=${(on: boolean) => notes.setHidden(!on)} />` });
registerSetting({ id: 'notes-comments', where: 'notes', order: 20, shown: hasNotes, Control: ({ notes }: NotesCtx) => html`<${NoteSwitch} notes=${notes} id="set-comments" label="Comments as notes"
    hint="Comments on lines of their own that read as notes become chips (the blocks with them typeset again)." get=${(s: { comments: boolean }) => s.comments} set=${(on: boolean) => notes.setComments(on)} />` });
registerSetting({ id: 'doc-settings', where: 'document', order: 10, Control: ({ commands, hasDoc }: SettingsCtx) => html`<${Row} id="doc-settings" label="Document settings"
    hint=${hasDoc ? 'This document’s preamble, bibliography and engine.' : 'Open a document to change its preamble, bibliography and engine.'}>
    <${Button} size="sm" class="rtx-set-open" disabled=${!hasDoc} onClick=${() => commands.call('doc.settings')}>Open…<//>
  <//>` });
registerSetting({ id: 'advanced-switch', where: 'advanced', order: 10, Control: () => {
  const list = advancedFeatures.peek().map((f: { label: string }) => f.label.replace(/^./, (c) => c.toLowerCase()));
  return html`<${SwitchRow} id="set-advanced" label="Show advanced features" hint=${list.length ? `Tools for developers and experts: ${list.join(', ')}.` : 'Tools for developers and experts.'}
    checked=${advanced.peek()} onChange=${(on: boolean) => setAdvanced(on)} />`;
} });

function SettingsPanel({ ctx }: { ctx: ViewContext }) {
  installStyle();
  const p = prefs;
  void p.view?.changed.value; void advanced.value; void advancedFeatures.value;     // drawn again on a change
  const c: SettingsCtx = { ...p, detail: true, commands: ctx.commands, hasDoc: !!ctx.current.value };
  return html`<div class="rtx-settings">${SECTIONS.filter((s) => !s.view || p.view).map((s) => {
    const rows = visibleAt(s.where, c);
    if (!rows.length) return null;
    return html`<section key=${s.where} class="rtx-set-section" data-section=${s.where} aria-labelledby=${`set-h-${s.where}`}>
      <h3 class="rtx-set-h" id=${`set-h-${s.where}`}>${s.title}</h3>${s.note ? html`<p class="rtx-set-note">${s.note}</p>` : null}
      ${rows.map((x) => html`<${x.Control} key=${x.id} ...${c} />`)}
    </section>`;
  })}</div>`;
}

const VIEW = { id: SETTINGS_PANEL, title: 'Settings', icon: 'settings', tip: 'Settings: reading, editing, notes, advanced', Component: SettingsPanel,
  panel: { side: 'right', order: 90, width: { share: 1 / 3, min: 380, max: 560 }, onClose: () => closeSettings() } } satisfies ViewDef;
let off: (() => void) | null = null;
/** the panel registered (its containers dock it: the workbench's right column) */
export function openSettings(): void { off ??= registerView(VIEW); }
/** the panel gone (unregistered: out of its column) */
export function closeSettings(): void { const o = off; off = null; o?.(); }
export const settingsOpen = (): boolean => !!off;

// the panel's CSS (tokens only; a <style> of its own: the builds need no CSS loader); the View options' rows keep theirs
// (view/popover-style.js), with this panel's inset
const CSS = String.raw`
.rtx-settings { display: flex; flex-direction: column; gap: var(--ui-4); padding: var(--ui-2) 0 var(--ui-4); }
.rtx-set-section { display: flex; flex-direction: column; }
.rtx-set-h { margin: 0 0 var(--ui-1); padding: 0 var(--ui-2); font: var(--ui-semibold) var(--ui-text-sm)/1.4 var(--ui-font); color: var(--ui-ink); }
.rtx-set-note { margin: 0 0 var(--ui-1); padding: 0 var(--ui-2); font-size: var(--ui-text-xs); line-height: 1.4; color: var(--ui-ink-2); }
.rtx-set-row { display: flex; flex-direction: column; gap: var(--ui-2); padding: var(--ui-2); border-radius: var(--ui-r-md); }
.rtx-set-switch { flex-direction: row; align-items: flex-start; justify-content: space-between; gap: var(--ui-3); cursor: pointer; }
.rtx-set-switch:hover { background: var(--ui-hover); }
.rtx-set-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rtx-set-label { color: var(--ui-ink); font-size: var(--ui-text-md); }
.rtx-set-hint { margin: 0; color: var(--ui-ink-2); font-size: var(--ui-text-xs); line-height: 1.4; }
.rtx-set-switch input { flex: 0 0 auto; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--ui-accent); cursor: pointer; }
.rtx-set-control { display: flex; flex-direction: column; align-items: flex-start; gap: var(--ui-1); }
.rtx-set-url { width: 100%; box-sizing: border-box; }
.rtx-set-problem { color: var(--ui-danger); }
.rtx-settings .rtx-vp-row { padding: var(--ui-2); }
.rtx-settings .rtx-vp-row + .rtx-vp-row { border-top: 0; }
`;
function installStyle() {
  if (document.getElementById('rtx-settings-panel-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-settings-panel-css';
  s.textContent = CSS;
  document.head.append(s);
}
