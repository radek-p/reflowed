// THE SETTINGS PANEL: the preferences of this browser and the current document's own settings in one side panel, a
// view (design/ui/views.ts) offered on demand (panel.onDemand: open only when asked for: the main menu's Settings…,
// its View › Settings row and Ctrl/⌘ , in app/wb/host.ts, on General; a document's entry points on the document tab:
// doc.settings, app/app.js; closed by the close on its tab or Close in its menu), on the right, its column a third of the
// window wide by default (between 380 and 560 px; a phone's whole width). Its content is apart from its container as
// the other panels' is (the workbench's right column; an embedded editor's sidebar: a tab of it).
// Two tabs at its top (the kit's Tabs: tablist, tab, tabpanel; ← → Home End):
//   General        the page's preferences, in sections (the common first, Advanced last):
//                    Reading    the View options' rows (where 'view': width, text, colours), each with its explanation
//                    Editing    block handles; the edit layout (a developer's option)
//                    Notes      note chips; comments as notes
//                    Advanced   Show advanced features (and what it shows), then what it shows here (the engine, the
//                               TeX resource server)
//   the document   named after the current document (the focused pane's: ctx.current, as the other panels follow it;
//                  its full title in the tab's tooltip, "Document" while none is open): its preamble and its
//                  bibliography (settings/document.ts), the preamble's problems counted on the tab
// The tab shown is the panel's (one for the page): General each time it opens, a document's entry point the document tab
// (and the preamble, its line selected: the request is taken once, by the container that asked).
// Each General section's rows are registrations (settings/registry.ts: a module adds a row with registerSetting, the
// panel is not edited); a section with no row drawn is left out. A row's context is a SettingsCtx (the page's
// preferences, `detail`). The panel follows the preferences' signals (the view's `changed`, the advanced switch); the
// notes' two switches keep their own state (only they change those settings).
//
//   SETTINGS_PANEL                       its view id (design/ui/views.ts openPanel, closePanel, panelOpen)
//   openSettings(tab?, landing?)         opened on a tab
//     tab      'general' | 'document' (default: the one it shows); its container shows it (the workbench's showPanel,
//              an embedded editor's sidebar: the editor's shell.showPanel, app/mount.ts)
//     landing  { owner, line }: the document tab's preamble focused, line selected, by the panel in container owner
//   providePreferences({ view, notes })  the page's preferences, once made (app/services.ts: before any panel is drawn)
//   installSettingsStyle()               its CSS (the gallery draws the document tab apart)
import { signal, type ReadonlySignal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { Tabs } from '../design/ui/index.js';
import { registerView, openPanel, type SlotOwner, type ViewContext, type ViewDef } from '../design/ui/views.ts';
import { registerSetting, visibleAt, type Where } from './registry.ts';
import { advanced, setAdvanced, advancedFeatures } from './advanced.js';
import { SwitchRow } from './rows.ts';
import { DocumentSettings, type Landing } from './document.ts';
import { shortcutLabel } from '../../../workbench/src/keys.ts';
import type { PopoverView } from '../view/popover.ts';
import type { PanelHost } from '../app/panel-host.ts';
import './resource-field.ts';                  // the Advanced section's TeX resource server
import './engine.ts';                          // … and the engine

export const SETTINGS_PANEL = 'app-settings';

/** the page's notes (notes/index.js), as their settings need them */
export interface NotesPrefs { settings(): { hidden: boolean; comments: boolean }; setHidden(hidden: boolean): void; setComments(on: boolean): void }
/** the page's preferences: the View options (view/index.js) and the notes; null: not on this page */
export interface Preferences { view: (PopoverView & { readonly changed: ReadonlySignal<number> }) | null; notes: NotesPrefs | null }
/** a Settings panel row's context */
export interface SettingsCtx extends Preferences {
  /** each row draws its one-line explanation */
  detail: true;
}

let prefs: Preferences = { view: null, notes: null };
export function providePreferences(p: Preferences): void { prefs = p; }

const SECTIONS: { where: Where; title: string; note?: string; view?: boolean }[] = [
  { where: 'view', title: 'Reading', view: true, note: `How documents look in this browser; the View options (Aa, ${shortcutLabel('mod+alt+v')}) have the same.` },
  { where: 'editing', title: 'Editing', view: true },
  { where: 'notes', title: 'Notes' },
  { where: 'advanced', title: 'Advanced' },
];

export type SettingsTab = 'general' | 'document';
/** the tab shown, and a request to land on the document's preamble: n counts the requests (the panel draws again) */
const place = signal<{ tab: SettingsTab; n: number }>({ tab: 'general', n: 0 });
let request: { owner: SlotOwner; at: Landing } | null = null;
/** the request, taken by the container that asked, once */
const takeRequest = (owner: SlotOwner) => (): Landing | null => {
  if (request?.owner !== owner) return null;
  const at = request.at;
  request = null;
  return at;
};

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
registerSetting({ id: 'advanced-switch', where: 'advanced', order: 10, Control: () => {
  const list = advancedFeatures.peek().map((f: { label: string }) => f.label.replace(/^./, (c) => c.toLowerCase()));
  return html`<${SwitchRow} id="set-advanced" label="Show advanced features" hint=${list.length ? `Tools for developers and experts: ${list.join(', ')}.` : 'Tools for developers and experts.'}
    checked=${advanced.peek()} onChange=${(on: boolean) => setAdvanced(on)} />`;
} });

function General({ c }: { c: SettingsCtx }) {
  return html`${SECTIONS.filter((s) => !s.view || c.view).map((s) => {
    const rows = visibleAt(s.where, c);
    if (!rows.length) return null;
    return html`<section key=${s.where} class="rtx-set-section" data-section=${s.where} aria-labelledby=${`set-h-${s.where}`}>
      <h3 class="rtx-set-h" id=${`set-h-${s.where}`}>${s.title}</h3>${s.note ? html`<p class="rtx-set-note">${s.note}</p>` : null}
      ${rows.map((x) => html`<${x.Control} key=${x.id} ...${c} />`)}
    </section>`;
  })}`;
}

function SettingsPanel({ ctx }: { ctx: ViewContext<PanelHost> }) {
  installSettingsStyle();
  const p = prefs;
  void p.view?.changed.value; void advanced.value; void advancedFeatures.value;     // drawn again on a change
  const c: SettingsCtx = { ...p, detail: true };
  const { tab, n } = place.value;
  const host = ctx.current.value;
  const id = (name: string) => ctx.owner.id(name);
  const title = host?.docId ? host.title.value.trim() || 'Untitled' : '';
  const problems = host?.preamble?.problems.value ?? 0;
  const [ask] = useState(() => takeRequest(ctx.owner));
  const items = [
    { id: 'general', label: 'General', attrs: { 'aria-controls': id('set-page-general') } },
    { id: 'document', label: html`<span class="rtx-set-tab-name">${title || 'Document'}</span>`, ...(problems ? { count: problems, tone: 'danger' } : {}),
      attrs: { 'aria-controls': id('set-page-document'), title: title ? `${title}: its preamble and bibliography` : 'The open document’s preamble and bibliography' } },
  ];
  return html`<div class="rtx-settings">
    <${Tabs} class="rtx-set-tabs" fill=${true} label="Settings" idPrefix=${id('set-tab')} items=${items} value=${tab} onChange=${(t: SettingsTab) => { place.value = { ...place.peek(), tab: t }; }} />
    <div class="rtx-set-page" role="tabpanel" id=${id('set-page-general')} aria-labelledby=${id('set-tab-general')} data-page="general" hidden=${tab !== 'general'}>
      <${General} c=${c} />
    </div>
    <div class="rtx-set-page" role="tabpanel" id=${id('set-page-document')} aria-labelledby=${id('set-tab-document')} data-page="document" hidden=${tab !== 'document'}>
      <${DocumentSettings} key=${host?.docId ?? ''} host=${host} ask=${ask} asked=${n} />
    </div>
  </div>`;
}

const VIEW = { id: SETTINGS_PANEL, title: 'Settings', icon: 'settings', tip: 'Settings: general, and the document’s own', Component: SettingsPanel,
  // (closed, it opens on General next time)
  panel: { side: 'right', order: 90, width: { share: 1 / 3, min: 380, max: 560 }, onDemand: true, keys: 'mod+,',
    onClose: () => { if (place.peek().tab !== 'general') place.value = { tab: 'general', n: place.peek().n }; } } } satisfies ViewDef;
registerView(VIEW);
/** the panel opened (its containers dock it: the workbench's right column), on `tab` (by default the one it
 *  shows); landing: on the document tab, the preamble focused (its line selected) by the panel in container `owner`.
 *  Its container shows it (the workbench's showPanel; an embedded editor's shell.showPanel: app/mount.ts) */
export function openSettings(tab?: SettingsTab, landing?: { owner: SlotOwner; line: number | null }): void {
  openPanel(SETTINGS_PANEL);
  if (landing) request = { owner: landing.owner, at: { line: landing.line } };
  if (tab && (tab !== place.peek().tab || landing)) place.value = { tab, n: place.peek().n + 1 };
}

// the panel's CSS (tokens only; a <style> of its own: the builds need no CSS loader). One rhythm for both tabs: a section
// is a heading (more space above it than below) and its rows, a hairline between sections; a row is its label, its
// explanation beneath in the muted style, its control on the label's line (below it when it does not fit, or always for
// a wide one), all inset from the panel's edges as the heading is. The View options' rows keep their own CSS
// (view/popover-style.js), set in this panel's type and inset.
const CSS = String.raw`
.rtx-settings { display: flex; flex-direction: column; padding: var(--ui-2) 0 var(--ui-4); }
.rtx-set-tabs { margin: 0 var(--ui-2) var(--ui-1); }
.rtx-set-tabs > .ui-tab { min-width: 0; }
.rtx-set-tab-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rtx-set-page { display: flex; flex-direction: column; }
.rtx-set-page[hidden] { display: none; }
.rtx-set-section { display: flex; flex-direction: column; padding: var(--ui-4) 0 var(--ui-2); }
.rtx-set-section + .rtx-set-section { border-top: 1px solid var(--ui-border-soft); }
.rtx-set-h { display: flex; align-items: center; gap: var(--ui-2); margin: 0 0 var(--ui-1); padding: 0 var(--ui-2); font: var(--ui-semibold) var(--ui-text-md)/1.4 var(--ui-font); color: var(--ui-ink); }
.rtx-set-note { margin: 0 0 var(--ui-1); padding: 0 var(--ui-2); font-size: var(--ui-text-sm); line-height: 1.4; color: var(--ui-ink-2); }
.rtx-set-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: var(--ui-4); row-gap: var(--ui-2);
  padding: var(--ui-2); border-radius: var(--ui-r-md); }
.rtx-set-text { flex: 1 1 50%; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rtx-set-label { color: var(--ui-ink); font-size: var(--ui-text-md); line-height: 1.4; }
.rtx-set-hint { margin: 0; color: var(--ui-ink-2); font-size: var(--ui-text-sm); line-height: 1.4; }
.rtx-set-control { flex: 0 1 auto; display: flex; flex-direction: column; align-items: flex-end; gap: var(--ui-1); max-width: 100%; }
.rtx-set-control > .ui-input { max-width: 100%; }
.rtx-set-row--wide > .rtx-set-control { flex-basis: 100%; align-items: stretch; }
.rtx-set-switch { flex-wrap: nowrap; cursor: pointer; }
.rtx-set-switch:hover { background: var(--ui-hover); }
.rtx-set-switch input { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.rtx-set-url { width: 100%; box-sizing: border-box; }
.rtx-set-problem { color: var(--ui-danger); }
.rtx-set-empty { margin: var(--ui-4) var(--ui-2); color: var(--ui-ink-2); font-size: var(--ui-text-md); line-height: 1.4; }
.rtx-settings .rtx-vp-row { padding: var(--ui-2); }
.rtx-settings .rtx-vp-row + .rtx-vp-row { border-top: 0; }
.rtx-settings .rtx-vp-cap { margin: 0 0 var(--ui-1); font-size: var(--ui-text-md); font-weight: 400; line-height: 1.4; color: var(--ui-ink); }
.rtx-settings .rtx-vp-cap output { font-size: var(--ui-text-sm); }
.rtx-settings .rtx-vp-hint { margin: calc(-1 * var(--ui-1) + 2px) 0 var(--ui-2); font-size: var(--ui-text-sm); line-height: 1.4; }
/* the document tab: the preamble's editor at the panel's width, its note and actions, its problems */
.rtx-set-editor { display: flex; height: clamp(200px, 50vh, 560px); margin: var(--ui-1) var(--ui-2) 0; border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); overflow: hidden; background: var(--ui-page); }
.rtx-set-editor > .cm-editor { flex: 1 1 auto; min-width: 0; height: 100%; font-size: var(--ui-text-md); }
.rtx-set-editor .cm-editor.cm-focused { outline: none; }
.rtx-set-editor:focus-within { border-color: var(--ui-accent-border); box-shadow: var(--ui-ring); }
.rtx-set-editor .cm-scroller { font-family: var(--ui-mono); line-height: 1.6; overflow: auto; }
.rtx-set-editor .cm-content { padding: var(--ui-2) 0; caret-color: var(--ui-ink); }
.rtx-set-editor .cm-line { padding: 0 var(--ui-3); }
.rtx-set-editor .cm-activeLine { background: var(--ui-tint); }
.rtx-set-editor .cm-pre-error { text-decoration: underline wavy var(--ui-danger); text-decoration-thickness: 1px; text-underline-offset: 3px; }
.rtx-set-pre-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-3); min-height: var(--ui-ctl-sm); padding: var(--ui-2) var(--ui-2) 0; }
.rtx-set-pre-acts { flex: 0 0 auto; display: flex; gap: var(--ui-1); }
.rtx-set-pre-acts[data-shown="false"] { visibility: hidden; }
.rtx-set-errors { display: flex; flex-direction: column; gap: 2px; margin: var(--ui-2) var(--ui-2) 0; }
.rtx-set-err { display: flex; gap: var(--ui-2); align-items: baseline; padding: var(--ui-1) var(--ui-2); border: 0; border-radius: var(--ui-r-sm); font: inherit; font-size: var(--ui-text-sm);
  text-align: left; color: var(--ui-danger); background: var(--ui-danger-tint); cursor: pointer; }
.rtx-set-err:hover { background: color-mix(in srgb, var(--ui-danger) 14%, transparent); }
.rtx-set-err:focus-visible { outline: none; box-shadow: var(--ui-ring); }
.rtx-set-err-line { flex: 0 0 auto; font-family: var(--ui-mono); opacity: 0.8; }
.rtx-set-err-msg { min-width: 0; word-break: break-word; }
`;
export function installSettingsStyle(): void {
  if (document.getElementById('rtx-settings-panel-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-settings-panel-css';
  s.textContent = CSS;
  document.head.append(s);
}
