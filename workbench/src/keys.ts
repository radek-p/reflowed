// The workbench's keymap: VS Code's default
// keybindings where a page may have them, browser-safe replacements where the browser keeps the key, and no key
// that types a Polish letter. Pure: no DOM; the platform is a parameter (unit-tested for both).
//
// A key is 'ctrl+alt+w', 'meta+shift+t', 'f6'; a chord is two keys with a space ('ctrl+k ctrl+m'). Letters,
// digits and the backslash match by physical key (e.code), so a layout or AltGr never changes what a key does.
import type { Side, SideName } from './model.ts';

export const isMacPlatform = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The platforms a keymap entry names keys for ('other': Windows and Linux alike). */
export type Platform = 'mac' | 'win' | 'linux' | 'other';
/** One key ('ctrl+alt+w'), or a chord of two ('ctrl+k ctrl+m'); several alternatives as a list; null: unbound. */
export type Keys = string | readonly string[] | null;
/** The workbench's actions (wb.run): their argument where they take one. */
export type ActionArgs = {
  focusGroup: number; focusSide: Side; nextTab: undefined; prevTab: undefined; cycleMru: undefined; shiftLeft: undefined; shiftRight: undefined;
  moveToward: Side; splitRight: undefined; splitDown: undefined; close: undefined; closeGroup: undefined; closeOthers: undefined; reopen: undefined;
  home: undefined; sectionMenu: undefined; docSwitcher: undefined; shortcuts: undefined; maximize: undefined; pin: undefined; keep: undefined;
  toggleSide: SideName; focusPart: 1 | -1;
};
export type Action = keyof ActionArgs;
/**
 * action, arg?, mac, other (Windows and Linux; `win`/`linux` override it), vscode (the VS Code command and its
 * desktop keys), note (why ours differs), own (no VS Code command: the note says why). Keys absent on a platform: null.
 */
export type KeymapEntry = { action: Action; arg?: ActionArgs[Action]; mac: Keys; other: Keys; win?: Keys; linux?: Keys; vscode: string; note?: string; own?: boolean };
export const KEYMAP: readonly KeymapEntry[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): KeymapEntry => ({ action: 'focusGroup', arg: n - 1, mac: `meta+${n}`, other: `ctrl+${n}`,
    vscode: `workbench.action.focus${['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'][n - 1]}EditorGroup: Ctrl+${n} / ⌘${n}` })),
  { action: 'focusSide', arg: 'left', mac: 'meta+k meta+arrowleft', other: 'ctrl+k ctrl+arrowleft', vscode: 'workbench.action.focusLeftGroup: Ctrl+K Ctrl+←' },
  { action: 'focusSide', arg: 'right', mac: 'meta+k meta+arrowright', other: 'ctrl+k ctrl+arrowright', vscode: 'workbench.action.focusRightGroup: Ctrl+K Ctrl+→' },
  { action: 'focusSide', arg: 'top', mac: 'meta+k meta+arrowup', other: 'ctrl+k ctrl+arrowup', vscode: 'workbench.action.focusAboveGroup: Ctrl+K Ctrl+↑' },
  { action: 'focusSide', arg: 'bottom', mac: 'meta+k meta+arrowdown', other: 'ctrl+k ctrl+arrowdown', vscode: 'workbench.action.focusBelowGroup: Ctrl+K Ctrl+↓' },
  { action: 'nextTab', mac: 'meta+alt+pagedown', other: 'ctrl+alt+pagedown', vscode: 'workbench.action.nextEditor: Ctrl+PageDown / ⌘⌥→',
    note: 'Chrome keeps Ctrl+PageDown and ⌘⌥→ (select next tab); Alt added, a page key (no letter)' },
  { action: 'prevTab', mac: 'meta+alt+pageup', other: 'ctrl+alt+pageup', vscode: 'workbench.action.previousEditor: Ctrl+PageUp / ⌘⌥←',
    note: 'Chrome keeps Ctrl+PageUp and ⌘⌥← (select previous tab)' },
  { action: 'cycleMru', mac: null, other: null, vscode: 'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup: Ctrl+Tab / ⌃Tab',
    note: 'unbound: every browser keeps Ctrl+Tab; the action stays for a host that can have it (a desktop app)' },
  { action: 'shiftLeft', mac: 'meta+k meta+shift+arrowleft', other: 'ctrl+shift+pageup', vscode: 'workbench.action.moveEditorLeftInGroup: Ctrl+Shift+PageUp / ⌘K ⌘⇧←' },
  { action: 'shiftRight', mac: 'meta+k meta+shift+arrowright', other: 'ctrl+shift+pagedown', vscode: 'workbench.action.moveEditorRightInGroup: Ctrl+Shift+PageDown / ⌘K ⌘⇧→' },
  { action: 'moveToward', arg: 'left', mac: 'ctrl+meta+arrowleft', other: 'ctrl+alt+arrowleft', vscode: 'workbench.action.moveEditorToPreviousGroup: Ctrl+Alt+← / ⌃⌘←',
    note: 'ours moves to the group on the left (geometry), or splits that way if there is none' },
  { action: 'moveToward', arg: 'right', mac: 'ctrl+meta+arrowright', other: 'ctrl+alt+arrowright', vscode: 'workbench.action.moveEditorToNextGroup: Ctrl+Alt+→ / ⌃⌘→' },
  { action: 'moveToward', arg: 'top', mac: 'ctrl+meta+arrowup', other: 'ctrl+alt+arrowup', vscode: 'workbench.action.moveEditorToAboveGroup: no default',
    note: 'VS Code has the command without a key; the pattern of ← →' },
  { action: 'moveToward', arg: 'bottom', mac: 'ctrl+meta+arrowdown', other: 'ctrl+alt+arrowdown', vscode: 'workbench.action.moveEditorToBelowGroup: no default' },
  { action: 'splitRight', mac: 'meta+k meta+\\', other: 'ctrl+k ctrl+\\', vscode: 'workbench.action.splitEditor: Ctrl+\\ / ⌘\\',
    note: 'Ctrl/⌘ \\ is ReflowEd’s own sidebar key (the app’s top bar): kept for the sidebars; split takes VS Code’s orthogonal chord' },
  { action: 'splitDown', mac: 'meta+k meta+shift+\\', other: 'ctrl+k ctrl+shift+\\', vscode: 'workbench.action.splitEditorOrthogonal: Ctrl+K Ctrl+\\', note: 'Shift added (Ctrl+K Ctrl+\\ splits right here)' },
  { action: 'close', mac: 'meta+alt+w', other: 'ctrl+alt+w', vscode: 'workbench.action.closeActiveEditor: Ctrl+W, Ctrl+F4 / ⌘W',
    note: 'browsers keep Ctrl+W, Ctrl+F4 and ⌘W (close tab). VS Code for the Web\'s documented workaround, Ctrl+Shift+Alt+N, is its New Window key in the source and types Ń with AltGr on Windows and Linux; Alt added instead (W types no Polish letter)' },
  { action: 'closeGroup', mac: 'meta+k w', other: 'ctrl+k w', vscode: 'workbench.action.closeEditorsInGroup: Ctrl+K W' },
  { action: 'closeOthers', mac: 'meta+alt+t', other: null, vscode: 'workbench.action.closeOtherEditors: ⌥⌘T (macOS only)' },
  { action: 'reopen', mac: 'meta+alt+shift+t', other: 'ctrl+alt+shift+t', vscode: 'workbench.action.reopenClosedEditor: Ctrl+Shift+T / ⌘⇧T',
    note: 'browsers keep Ctrl+Shift+T and ⌘⇧T (reopen closed tab); Alt added, as VS Code for the Web does for new file' },
  { action: 'home', mac: 'meta+alt+n', other: 'ctrl+k n', vscode: 'workbench.action.files.newUntitledFile, in the web: Ctrl+Alt+N / ⌘⌥N, Windows Ctrl+K N',
    note: 'Ctrl+Alt+N is AltGr+N = ń on Windows and Linux: VS Code for the Web itself uses Ctrl+K N on Windows; we do on Linux too' },
  { action: 'sectionMenu', own: true, mac: 'meta+k s', other: 'ctrl+k s', vscode: 'no such command (the breadcrumbs: breadcrumbs.focusAndSelect, Ctrl+Shift+.); Ctrl+K S is its Save All',
    note: 'on the focused active tab; was Alt+↓, which macOS keeps (Option+↓ moves the caret and scrolls the page); ↓ on the tab still opens it' },
  { action: 'docSwitcher', own: true, mac: 'meta+k d', other: 'ctrl+k d', vscode: 'no such command; Ctrl+K D is its Compare with Saved',
    note: 'on the focused active tab; was Alt+Shift+↓, which macOS keeps' },
  { action: 'shortcuts', mac: 'meta+k meta+s', other: 'ctrl+k ctrl+s', vscode: 'workbench.action.openGlobalKeybindings: Ctrl+K Ctrl+S' },
  { action: 'maximize', mac: 'meta+k meta+m', other: 'ctrl+k ctrl+m', vscode: 'workbench.action.toggleMaximizeEditorGroup: Ctrl+K Ctrl+M' },
  { action: 'pin', mac: 'meta+k shift+enter', other: 'ctrl+k shift+enter', vscode: 'workbench.action.pinEditor / unpinEditor: Ctrl+K Shift+Enter' },
  { action: 'keep', mac: 'meta+k enter', other: 'ctrl+k enter', vscode: 'workbench.action.keepEditor: Ctrl+K Enter' },
  { action: 'toggleSide', arg: 'left', mac: ['meta+b', 'meta+\\'], other: ['ctrl+b', 'ctrl+\\'], vscode: 'workbench.action.toggleSidebarVisibility: Ctrl+B / ⌘B',
    note: 'VS Code\'s key first (the one shown); ReflowEd\'s own Ctrl/⌘ \\ too (the app\'s top bar). In a LaTeX field the host\'s bold wins: its row { key: \'ctrl+b\', mac: \'meta+b\', when: \'reflowed.field\' }' },
  { action: 'toggleSide', arg: 'right', mac: ['meta+alt+b', 'meta+shift+\\'], other: ['ctrl+alt+b', 'ctrl+shift+\\'], vscode: 'workbench.action.toggleAuxiliaryBar: Ctrl+Alt+B / ⌥⌘B',
    note: 'VS Code\'s key first; the app\'s key with Shift for the right too' },
  { action: 'focusPart', arg: 1, mac: 'f6', other: 'f6', vscode: 'workbench.action.focusNextPart: F6' },
  { action: 'focusPart', arg: -1, mac: 'shift+f6', other: 'shift+f6', vscode: 'workbench.action.focusPreviousPart: Shift+F6' },
];

/** Each action's name (the shortcuts view, the README table) and its area. */
export const NAMES: Record<Action, string> = {
  focusGroup: 'Focus group N', focusSide: 'Focus the group on the left / right / above / below', nextTab: 'Next tab', prevTab: 'Previous tab',
  cycleMru: 'Recently used tabs', shiftLeft: 'Move tab left in its group', shiftRight: 'Move tab right in its group',
  moveToward: 'Move tab to the group on the left / right / above / below', splitRight: 'Split right (the same document)', splitDown: 'Split down',
  close: 'Close tab', closeGroup: 'Close the tabs of the group', closeOthers: 'Close other tabs', reopen: 'Reopen closed tab', home: 'Show / hide the home panel of the focused group',
  sectionMenu: 'Go to section (the section menu of the focused tab)', docSwitcher: 'Switch document (the document menu of the focused tab)', shortcuts: 'Keyboard shortcuts',
  maximize: 'Maximise / restore group', pin: 'Pin / unpin tab', keep: 'Keep a preview tab', toggleSide: 'Show / hide the left / right sidebar',
  focusPart: 'Next / previous part (sidebars, groups)',
};
export const AREAS: Record<Action, string> = {
  focusGroup: 'Groups', focusSide: 'Groups', splitRight: 'Groups', splitDown: 'Groups', maximize: 'Groups', closeGroup: 'Groups',
  nextTab: 'Tabs', prevTab: 'Tabs', cycleMru: 'Tabs', shiftLeft: 'Tabs', shiftRight: 'Tabs', moveToward: 'Tabs', close: 'Tabs', closeOthers: 'Tabs', reopen: 'Tabs', pin: 'Tabs', keep: 'Tabs',
  sectionMenu: 'Navigation', docSwitcher: 'Navigation', home: 'Navigation', shortcuts: 'Navigation',
  toggleSide: 'Sidebars and parts', focusPart: 'Sidebars and parts',
};
const SIDE: Record<Side, string> = { left: 'on the left', right: 'on the right', top: 'above', bottom: 'below' };
/** One entry's own name: its action's, with its argument (Focus group 3, Move tab to the group below). */
export function describe(e: KeymapEntry): string {
  switch (e.action) {
    case 'focusGroup': return `Focus group ${(e.arg as number) + 1}`;
    case 'focusSide': return `Focus the group ${SIDE[e.arg as Side]}`;
    case 'moveToward': return `Move tab to the group ${SIDE[e.arg as Side]}`;
    case 'toggleSide': return `Show / hide the ${e.arg as string} sidebar`;
    case 'focusPart': return (e.arg as number) > 0 ? 'Next part (sidebars, groups)' : 'Previous part (sidebars, groups)';
    default: return NAMES[e.action] ?? e.action;
  }
}
/** The keys of an entry on a platform ('mac' | 'win' | 'linux'), or null. */
export const keysOf = (entry: KeymapEntry, platform: Platform): Keys => (platform === 'mac' ? entry.mac : platform !== 'other' && entry[platform] !== undefined ? entry[platform] : entry.other);
/** The first key of an entry (menus and tooltips show one). */
export const firstKey = (keys: Keys): string | null => (typeof keys === 'string' || keys == null ? keys : keys[0] ?? null);

// The browsers' own keys a page never receives (Chromium: BrowserCommandController::IsReservedCommandOrKey:
// close tab and window, new tab, window and incognito window, restore tab, select and cycle next/previous tab).
export const RESERVED: { other: readonly string[]; mac: readonly string[] } = {
  other: ['ctrl+w', 'ctrl+f4', 'ctrl+shift+w', 'ctrl+t', 'ctrl+n', 'ctrl+shift+n', 'ctrl+shift+t', 'ctrl+tab', 'ctrl+shift+tab', 'ctrl+pagedown', 'ctrl+pageup'],
  mac: ['meta+w', 'meta+shift+w', 'meta+t', 'meta+n', 'meta+shift+n', 'meta+shift+t', 'ctrl+tab', 'ctrl+shift+tab', 'meta+alt+arrowright', 'meta+alt+arrowleft', 'meta+shift+]', 'meta+shift+[', 'meta+q'],
};
/** Letters AltGr (= Ctrl+Alt on Windows and Linux) turns into Polish letters: ą ć ę ł ń ó ś ź ż. */
export const POLISH_ALTGR: readonly string[] = ['a', 'c', 'e', 'l', 'n', 'o', 's', 'x', 'z'];

/** One key of a binding: the key's name (keyName) and its modifiers. */
export type Key = { key: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean };
/** The part of a keyboard event a key is matched on (a KeyboardEvent, or a test's plain object). */
export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;
/** 'ctrl+alt+w' → { key, ctrl, meta, alt, shift } */
export function parseKey(s: string): Key {
  const parts = s.toLowerCase().split('+');
  const key = parts.pop() || '+';
  const m = new Set(parts);
  return { key, ctrl: m.has('ctrl'), meta: m.has('meta'), alt: m.has('alt'), shift: m.has('shift') };
}
export const parseChord = (s: string): Key[] => s.trim().split(/\s+/).map(parseKey);

/** The key an event names: physical letters, digits and the backslash (AltGr, Alt and layouts change e.key). */
export function keyName(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (e.code === 'Backslash') return '\\';
  if (e.code === 'BracketLeft') return '[';
  if (e.code === 'BracketRight') return ']';
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return (e.key || '').toLowerCase();
}
const MODS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os']);
export const isModifier = (e: Pick<KeyboardEvent, 'key'>): boolean => MODS.has((e.key || '').toLowerCase());
export const keyId = (k: Key): string => `${k.ctrl ? 'ctrl+' : ''}${k.meta ? 'meta+' : ''}${k.alt ? 'alt+' : ''}${k.shift ? 'shift+' : ''}${k.key}`;
export const matches = (e: KeyEventLike, k: Key): boolean => keyName(e) === k.key && !!e.ctrlKey === k.ctrl && !!e.metaKey === k.meta && !!e.altKey === k.alt && !!e.shiftKey === k.shift;

/** A platform's binding of an action: its key or chord, parsed, and as written. */
export type Binding = { action: Action; arg?: ActionArgs[Action]; chord: Key[]; text: string };
/** A host's overrides: { action or 'action:arg': keys, or null to unbind }. */
export type KeyOverrides = { readonly [id: string]: Keys };
/** The platform's bindings: [{ action, arg, chord: [k1, k2?], text }] (overrides: { action[:arg]: keys | null }). */
export function bindings(platform: Platform, overrides: KeyOverrides = {}): Binding[] {
  const out: Binding[] = [];
  for (const e of KEYMAP) {
    const id = e.arg != null ? `${e.action}:${e.arg}` : e.action;
    const keys = id in overrides ? overrides[id] : e.action in overrides && e.arg == null ? overrides[e.action] : keysOf(e, platform);
    if (!keys) continue;
    for (const k of typeof keys === 'string' ? [keys] : keys) out.push({ action: e.action, arg: e.arg, chord: parseChord(k), text: k });
  }
  return out;
}

export type Matcher<B extends { chord: Key[] } = Binding> = { readonly pending: string | null; reset(): void; feed(e: KeyEventLike, applies?: (b: B) => boolean): B | 'pending' | 'cancelled' | null };
/** A chord-aware matcher: feed(e) → the first entry the key (or the chord's second key) matches and that `applies` (its
 *  when clause) | 'pending' | 'cancelled' | null. */
export function createMatcher<B extends { chord: Key[] } = Binding>(list: readonly B[]): Matcher<B> {
  let prefix: string | null = null;
  return {
    get pending() { return prefix; },
    reset() { prefix = null; },
    feed(e, applies = () => true) {
      if (isModifier(e)) return prefix ? 'pending' : null;
      if (prefix) {
        const p = prefix; prefix = null;
        const hit = list.find((b) => b.chord.length === 2 && keyId(b.chord[0]!) === p && matches(e, b.chord[1]!) && applies(b));
        return hit ?? 'cancelled';
      }
      const one = list.find((b) => b.chord.length === 1 && matches(e, b.chord[0]!) && applies(b));
      if (one) return one;
      const first = list.find((b) => b.chord.length === 2 && matches(e, b.chord[0]!) && applies(b));
      if (first) { prefix = keyId(first.chord[0]!); return 'pending'; }
      return null;
    },
  };
}

// ── the keymap as data: one table for the workbench's actions and a host's commands ──
/** The hosts a row is for: the standalone app (the workbench draws the tabs) or VS Code (its own tabs: the workbench's
 *  tab keys are not its; a generated contributes.keybindings carries the rest). */
export type HostKind = 'standalone' | 'vscode';
/**
 * One row: a key or a chord (`key`, and `mac` where macOS differs), the command it runs (a workbench action is
 * `workbench.<action>` with its argument as `args`; a host's command is its own id), when it applies (a context-key
 * expression in VS Code's form: `reflowed.field && !reflowed.readOnly`; none: always) and the hosts it is for (none: all).
 */
export type KeyRow = { key: string; mac?: string; command: string; args?: unknown; when?: string; hosts?: readonly HostKind[] };
export const WB_COMMAND = 'workbench.';
/** The workbench's own rows on a platform (its keymap with the host's overrides): the standalone host's only. */
export function keyRows(platform: Platform, overrides: KeyOverrides = {}): KeyRow[] {
  return bindings(platform, overrides).map((b) => ({ key: b.text, command: `${WB_COMMAND}${b.action}`, ...(b.arg !== undefined ? { args: b.arg } : {}), hosts: ['standalone'] as const }));
}
/** A row's key on a platform. */
export const rowKey = (r: KeyRow, platform: Platform): string => (platform === 'mac' && r.mac ? r.mac : r.key);
/**
 * A when clause, VS Code's subset: context keys (`reflowed.field`), `!`, `&&`, `||`, parentheses, `key == value` and
 * `key != value` (a word or a quoted string). True when there is none; an unknown key is falsy.
 */
export function evalWhen(expr: string | undefined, ctx: (key: string) => unknown): boolean {
  if (!expr || !expr.trim()) return true;
  const toks = expr.match(/\s*(\|\||&&|==|!=|!|\(|\)|'[^']*'|"[^"]*"|[\w.-]+)/g)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const value = (t: string | undefined) => (t && /^['"]/.test(t) ? t.slice(1, -1) : t);
  function atom(): boolean {
    const t = next();
    if (t === '!') return !atom();
    if (t === '(') { const v = or(); next(); return v; }
    if (peek() === '==' || peek() === '!=') { const op = next(), want = value(next()), have = ctx(t ?? ''); return op === '==' ? String(have) === want : String(have) !== want; }
    return !!ctx(t ?? '');
  }
  function and(): boolean { let v = atom(); while (peek() === '&&') { next(); const w = atom(); v = v && w; } return v; }
  function or(): boolean { let v = and(); while (peek() === '||') { next(); const w = and(); v = v || w; } return v; }
  return or();
}
/** VS Code's contributes.keybindings from the rows for VS Code: ⌘ is `cmd` there; each `when`
 *  ANDed with the editor's own clause (`activeCustomEditorId == 'reflowed.rtex'`). */
export function vscodeKeybindings(rows: readonly KeyRow[], editorWhen = "activeCustomEditorId == 'reflowed.rtex'"): { key: string; mac?: string; command: string; args?: unknown; when: string }[] {
  const vs = (k: string) => k.split(' ').map((p) => p.split('+').map((m) => (m === 'meta' ? 'cmd' : m)).join('+')).join(' ');
  return rows.filter((r) => !r.hosts || r.hosts.includes('vscode')).map((r) => ({ key: vs(r.key), ...(r.mac ? { mac: vs(r.mac) } : {}), command: r.command,
    ...(r.args !== undefined ? { args: r.args } : {}), when: r.when ? `${editorWhen} && (${r.when})` : editorWhen }));
}

/** How a key reads to people: ⌘⌥W on macOS, Ctrl+Alt+W elsewhere. */
export function label(text: string, platform: Platform): string {
  const mac = platform === 'mac';
  const names: Record<string, string> = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', pagedown: 'PageDown', pageup: 'PageUp', enter: 'Enter', '\\': '\\', f6: 'F6' };
  return text.split(' ').map((k) => {
    const p = parseKey(k);
    const key = names[p.key] ?? p.key.toUpperCase();
    if (mac) return `${p.ctrl ? '⌃' : ''}${p.alt ? '⌥' : ''}${p.shift ? '⇧' : ''}${p.meta ? '⌘' : ''}${key}`;
    return [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.meta && 'Meta', key].filter(Boolean).join('+');
  }).join(' ');
}
