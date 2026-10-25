# workbench

Tabs and splits for ReflowEd, like VS Code or IntelliJ: a layout tree of split groups → tab groups →
tabs, each tab a registered view (`view` + `state`), the whole layout plain JSON. A standalone module in TypeScript (strict; `tsconfig.json`, checked by `scripts/typecheck.ts`; Node runs the tests and scripts as they are, esbuild bundles the demo): Preact,
@preact/signals and htm (resolved from `../app/node_modules`), on the design kit's tokens; it imports nothing


| file | what |
|---|---|
| `src/model.ts` | the layout as data: pure operations, invariants (`validate`), persistence; no DOM |
| `src/types.ts` | the shared types: the view type, its context, the document status, the drop hints, the events |
| `src/workbench.ts` | `createWorkbench()`: the store (a signal), view types, panel hosts, focus, keymap, events |
| `src/ui.ts` | `<Workbench>`: the root, the groups (strip + body), home over a group; attaches the container (`wb.attach`) |
| `src/strip.ts`, `src/bar.ts`, `src/split.ts` | THE tab strip (both hosts, the one- or two-line form); the window bar (its tabs, the mark); the splitter (groups and side stacks) |
| `src/tab/` | the tab: `pill.ts` (TabPill, the shell in a strip), `parts.ts` (the parts every shell shares: DocChip, SectionChip, ChipLine, StatusLayer, DirtyDot, RenameField, the status words), `info.ts`, `actions.ts` (its drag and menu) |
| `src/ui-state.ts`, `src/ticker.ts`, `src/measure.ts` | the UI's own state per drawn workbench; the status's progress ticker (per store); canvas text widths |
| `src/drag.ts` | the pointer session, the ghost (top layer), content drags (spring-loading, auto-scroll) |
| `src/keys.ts` | the keymap (the table below), chords, the browser-reserved and AltGr lists |
| `src/sides.ts` | the sidebars: tool-window panels left and right |
| `src/scrollbars.ts`, `src/overlay-scrollbar.ts` | the platform's kind of scrollbars (classic: styled by `css.ts`, their track below the glass header); where they are overlay ones (macOS, iOS) and in Firefox, the workbench's own overlay bar over every view, the home panel and a host's `[data-wb-scroll]` scroller: its track inside the scroller's scroll-padding (below the header), shown while scrolling or hovered, draggable, presentational; scrolling stays native |
| `src/viewport.ts` | `ownViewport()`: the page never scrolls (Safari). A host puts `VIEWPORT_CSS` in its page's head as `<style id="wb-viewport-css">` (clipped from the first frame, before any script; the demo's server fills it: `scripts/bundle.ts` `demoHtml()`); `ownViewport()` then adopts it and only adds the guard |
| `src/shortcuts.ts` | the Keyboard shortcuts view (a built-in view type, generated from the keymap) |
| `src/crumbs.ts` | the breadcrumbs bar of document tabs |
| `src/kit/` | the control library: buttons, Input, Popover, Tooltip, Menu, Select, ThemeSwitch, layers (every control comes from here); `kit/icons.ts`, the icons: the one registry (app/src/design/ui/icon-set.ts: our names → Lucide), shared with the editor kit and the figure editor |
| `src/themes.ts` | JSON themes: the tokens, the built-ins, registerTheme, setTheme |
| `src/css.ts`, `src/html.ts` | CSS on the kit's tokens, htm + styles |
| `demo/` | the demo page and its fake views (home, document, list, note) |
| `scripts/` | `serve.ts` (the demo, bundled per request), `bundle.ts`, `shots.ts`, `scenario.ts`, `hybrid.ts`, `round4.ts` (screenshots for review), `blur-bench.ts` (glass stability), `keys-table.ts` (the table below) |
| `tests/` | `model.test.ts`, `keys.test.ts`, `arch.test.ts` (one TabStrip for both hosts), `overlay-scrollbar.test.ts` (the own bar's thumb) (node:test), `e2e.ts` (Playwright on the demo, its areas in `tests/e2e/`: store, keys, layout, sides, tabs, bar, chips, looks, status; `--area`, `--browser chromium\|firefox\|webkit`) |

```
node workbench/scripts/serve.ts 8159      # the demo: http://localhost:8159/
node --test workbench/tests/model.test.ts workbench/tests/keys.test.ts workbench/tests/arch.test.ts workbench/tests/viewport.test.ts workbench/tests/themes.test.ts workbench/tests/overlay-scrollbar.test.ts   # units + guards
node workbench/scripts/smoke.ts             # every demo page loads, no page error (before each commit)
node workbench/tests/e2e.ts [--area keys,bar] [--only <regex>] # the browser suite (by area: tests/e2e/<area>.ts)
node workbench/scripts/shots.ts              # screenshots → test-results/workbench/
```

The demo keeps its layout in this browser's storage. Switches: `?fresh` starts anew, `?theme=light|dark|sepia|hc` (or any registered id),
`?scenario=paper` (one paper open three times), `?single` (one document),
`?sides=0` (no sidebars), `?bar=0` (no top bar: the workbench alone),
`?gallery` (the kit in every theme), `?viewicon=sliders` (the alternative View icon). Document status in the tabs:
`?simulate=<doc>:<n>` (a looping typesetting run; `&simerr=1` adds errors, `&simbar=full|band|alt`), `?docstatus=konig:typesetting,graphs:errors=2,lemma:unsaved`. The wordmark: placeholders, no switches. The bar's Theme menu
(Light, Dark, Sepia, High contrast, any registered theme, System) is remembered; `?theme` wins.

## Keyboard shortcuts

VS Code's default keybindings, checked in its source (microsoft/vscode, `src/vs/workbench/browser/parts/editor/
editorActions.ts`, `editorCommands.ts`, `browser/actions/navigationActions.ts`, `layoutActions.ts`,
`auxiliarybar/auxiliaryBarActions.ts`, `contrib/files/browser/fileCommands.ts` for the web-only new-file key), and
the VS Code for the Web page (code.visualstudio.com/docs/setup/vscode-web, "Keyboard shortcuts"). Where a
browser keeps a key, a replacement:

- **Keys a page never gets** (Chromium, `BrowserCommandController::IsReservedCommandOrKey`): close tab and window
  (Ctrl+W, Ctrl+F4, Ctrl+Shift+W, ⌘W), new tab and window (Ctrl+T, Ctrl+N, Ctrl+Shift+N), reopen closed tab
  (Ctrl+Shift+T, ⌘⇧T), select next or previous tab (Ctrl+Tab, Ctrl+PageDown/PageUp, ⌘⌥→/←, ⌘⇧]/[). None is bound;
  `tests/keys.test.ts` checks it.
- **Polish (ą ć ę ł ń ó ś ź ż) and other layouts with AltGr letters:** no Alt+letter binding anywhere; on Windows and Linux AltGr is
  Ctrl+Alt, so no Ctrl+Alt(+Shift)+a c e l n o s x z (checked too). macOS uses ⌘⌥.
- **Chords** (Ctrl+K, then a key) as VS Code; the first key shows "Ctrl+K was pressed" and is announced; any
  other key cancels.
- Keys match the physical key (`e.code`), so a layout or AltGr does not change what they do.
- Hosts override or unbind any of them: `createWorkbench({ keymap: { close: 'f4', 'focusGroup:0': null } })`.

| action | macOS | Windows, Linux | VS Code (command: its keys) | ours |
|---|---|---|---|---|
| Focus group N | ⌘1 … ⌘8 | Ctrl+1 … Ctrl+8 | workbench.action.focusFirstEditorGroup … Eighth: Ctrl+1 … Ctrl+8 / ⌘1 … ⌘8 | same |
| Focus the group on the left / right / above / below: left | ⌘K ⌘← | Ctrl+K Ctrl+← | workbench.action.focusLeftGroup: Ctrl+K Ctrl+← | same |
| Focus the group on the left / right / above / below: right | ⌘K ⌘→ | Ctrl+K Ctrl+→ | workbench.action.focusRightGroup: Ctrl+K Ctrl+→ | same |
| Focus the group on the left / right / above / below: top | ⌘K ⌘↑ | Ctrl+K Ctrl+↑ | workbench.action.focusAboveGroup: Ctrl+K Ctrl+↑ | same |
| Focus the group on the left / right / above / below: bottom | ⌘K ⌘↓ | Ctrl+K Ctrl+↓ | workbench.action.focusBelowGroup: Ctrl+K Ctrl+↓ | same |
| Next tab | ⌥⌘PageDown | Ctrl+Alt+PageDown | workbench.action.nextEditor: Ctrl+PageDown / ⌘⌥→ | Chrome keeps Ctrl+PageDown and ⌘⌥→ (select next tab); Alt added, a page key (no letter) |
| Previous tab | ⌥⌘PageUp | Ctrl+Alt+PageUp | workbench.action.previousEditor: Ctrl+PageUp / ⌘⌥← | Chrome keeps Ctrl+PageUp and ⌘⌥← (select previous tab) |
| Recently used tabs | — | — | workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup: Ctrl+Tab / ⌃Tab | unbound: every browser keeps Ctrl+Tab; the action stays for a host that can have it (a desktop app) |
| Move tab left in its group | ⌘K ⇧⌘← | Ctrl+Shift+PageUp | workbench.action.moveEditorLeftInGroup: Ctrl+Shift+PageUp / ⌘K ⌘⇧← | same |
| Move tab right in its group | ⌘K ⇧⌘→ | Ctrl+Shift+PageDown | workbench.action.moveEditorRightInGroup: Ctrl+Shift+PageDown / ⌘K ⌘⇧→ | same |
| Move tab to the group on the left / right / above / below: left | ⌃⌘← | Ctrl+Alt+← | workbench.action.moveEditorToPreviousGroup: Ctrl+Alt+← / ⌃⌘← | ours moves to the group on the left (geometry), or splits that way if there is none |
| Move tab to the group on the left / right / above / below: right | ⌃⌘→ | Ctrl+Alt+→ | workbench.action.moveEditorToNextGroup: Ctrl+Alt+→ / ⌃⌘→ | same |
| Move tab to the group on the left / right / above / below: top | ⌃⌘↑ | Ctrl+Alt+↑ | workbench.action.moveEditorToAboveGroup: no default | VS Code has the command without a key; the pattern of ← → |
| Move tab to the group on the left / right / above / below: bottom | ⌃⌘↓ | Ctrl+Alt+↓ | workbench.action.moveEditorToBelowGroup: no default | same |
| Split right (the same document) | ⌘K ⌘\ | Ctrl+K Ctrl+\ | workbench.action.splitEditor: Ctrl+\ / ⌘\ | Ctrl/⌘ \ is ReflowEd’s own sidebar key (the app’s top bar): kept for the sidebars; split takes VS Code’s orthogonal chord |
| Split down | ⌘K ⇧⌘\ | Ctrl+K Ctrl+Shift+\ | workbench.action.splitEditorOrthogonal: Ctrl+K Ctrl+\ | Shift added (Ctrl+K Ctrl+\ splits right here) |
| Close tab | ⌥⌘W | Ctrl+Alt+W | workbench.action.closeActiveEditor: Ctrl+W, Ctrl+F4 / ⌘W | browsers keep Ctrl+W, Ctrl+F4 and ⌘W (close tab). VS Code for the Web's documented workaround, Ctrl+Shift+Alt+N, is its New Window key in the source and types Ń with AltGr on Windows and Linux; Alt added instead (W types no Polish letter) |
| Close the tabs of the group | ⌘K W | Ctrl+K W | workbench.action.closeEditorsInGroup: Ctrl+K W | same |
| Close other tabs | ⌥⌘T | — | workbench.action.closeOtherEditors: ⌥⌘T (macOS only) | same |
| Reopen closed tab | ⌥⇧⌘T | Ctrl+Alt+Shift+T | workbench.action.reopenClosedEditor: Ctrl+Shift+T / ⌘⇧T | browsers keep Ctrl+Shift+T and ⌘⇧T (reopen closed tab); Alt added, as VS Code for the Web does for new file |
| Show / hide the home panel of the focused group | ⌥⌘N | Ctrl+K N | workbench.action.files.newUntitledFile, in the web: Ctrl+Alt+N / ⌘⌥N, Windows Ctrl+K N | Ctrl+Alt+N is AltGr+N = ń on Windows and Linux: VS Code for the Web itself uses Ctrl+K N on Windows; we do on Linux too |
| Go to section (the section menu of the focused tab) | ⌘K S | Ctrl+K S | no such command (the breadcrumbs: breadcrumbs.focusAndSelect, Ctrl+Shift+.); Ctrl+K S is its Save All | on the focused active tab; was Alt+↓, which macOS keeps (Option+↓ moves the caret and scrolls the page); ↓ on the tab still opens it |
| Switch document (the document menu of the focused tab) | ⌘K D | Ctrl+K D | no such command; Ctrl+K D is its Compare with Saved | on the focused active tab; was Alt+Shift+↓, which macOS keeps |
| Keyboard shortcuts | ⌘K ⌘S | Ctrl+K Ctrl+S | workbench.action.openGlobalKeybindings: Ctrl+K Ctrl+S | same |
| Maximise / restore group | ⌘K ⌘M | Ctrl+K Ctrl+M | workbench.action.toggleMaximizeEditorGroup: Ctrl+K Ctrl+M | same |
| Pin / unpin tab | ⌘K ⇧↵ | Ctrl+K Shift+Enter | workbench.action.pinEditor / unpinEditor: Ctrl+K Shift+Enter | same |
| Keep a preview tab | ⌘K ↵ | Ctrl+K Enter | workbench.action.keepEditor: Ctrl+K Enter | same |
| Show / hide the left / right sidebar: left | ⌘B or ⌘\ | Ctrl+B or Ctrl+\ | workbench.action.toggleSidebarVisibility: Ctrl+B / ⌘B | VS Code's key first (the one shown); ReflowEd's own Ctrl/⌘ \ too (the app's top bar). In a LaTeX field the host's bold wins: its row { key: 'ctrl+b', mac: 'meta+b', when: 'reflowed.field' } |
| Show / hide the left / right sidebar: right | ⌥⌘B or ⇧⌘\ | Ctrl+Alt+B or Ctrl+Shift+\ | workbench.action.toggleAuxiliaryBar: Ctrl+Alt+B / ⌥⌘B | VS Code's key first; the app's key with Shift for the right too |
| Next / previous part (sidebars, groups): 1 | F6 | F6 | workbench.action.focusNextPart: F6 | same |
| Next / previous part (sidebars, groups): -1 | ⇧F6 | Shift+F6 | workbench.action.focusPreviousPart: Shift+F6 | same |

In a strip (WAI-ARIA tabs): ← → Home End move and activate, Delete closes, Shift+F10 or the Menu key opens the tab
menu, ↓ opens the section menu, Enter goes into the view; on a separator: ← → (↑ ↓) 16 px, Shift 64 px, Home End, Enter equalises.

Not done the VS Code way, on purpose: Ctrl+K N on Linux too (VS Code for the Web uses Ctrl+Alt+N there, which
is ń); close tab Ctrl+Alt+W / ⌥⌘W (VS Code for the Web documents Ctrl+Shift+Alt+N, which its source binds to New
Window); recently used tabs unbound (Ctrl+Tab is the browser's). Safari also keeps ⌘1–9 for its tabs and ⌥⌘W for
