# The editor's design language

One scale for every control, so nothing is large in one place and tiny in the
next. Tokens in `tokens.css.js`, the kit's CSS in `ui.css.js` (CSS as string modules: no CSS loader in the builds), Preact + htm
components in `ui/`. The look follows the website's example frames:
hairline borders mixed from `currentColor`, 12 px radius on frames, small
uppercase tab labels, pill buttons with a 16 % border. TeX's type stays the
loudest thing on the page; the chrome is quiet and consistent.

## Rules

1. **Heights.** A control is 24 (`sm`), 28 (`md`, the default) or 32 px
   (`lg`) tall. With a coarse pointer (`@media (pointer: coarse)`) every
   control and row is 44 px: `--ui-ctl-*` and `--ui-row` switch, so
   components need no media queries of their own.
2. **Type.** 11 / 12 / 13 / 14 / 16 / 20 / 28 px, nothing in between.
   Controls, menus and the sidebar are 13; hints and small buttons 12; counts
   and uppercase labels 11; dialog titles 16. Inputs on touch are 16 (iOS
   zooms into anything smaller). Medium (500) for buttons and tabs, semibold
   (600) for titles; mono only for LaTeX source and line numbers.
3. **Icons.** 16 px in every button, 14 in `sm` buttons and field icons, 12
   for inline marks, 20 only for a lone large affordance. Lucide icons from the one
   registry (`ui/icon-set.ts`; `ui/icons.ts` wraps it, the workbench re-exports it), stroke 1.75 on
   their 24 grid, `currentColor`; a new icon is one line there. No text glyphs as icons (`⋯`, `«`, `×`):
   use the icon set.
4. **Space.** A 4 px grid: `--ui-1` … `--ui-10`. Padding inside a control is
   8 (sm) or 12 (md/lg) horizontally; gaps 4 or 8.
5. **Radii.** 6 on controls and rows, 8 on menus, 12 on popovers, cards,
   dialogs, toasts and banners; `--ui-r-pill` for chips and pill buttons.
6. **Colour.** Never a literal. Text is `--ui-ink` / `-2` / `-3` / `-4`
   (primary, secondary, hint, disabled). Borders and tints mix
   `currentColor`, so they work on any theme (light, dark, sepia, contrast):
   `--ui-border` (13 %, frames), `--ui-border-soft` (separators),
   `--ui-border-pill` (16 %), `--ui-hover` (7 %), `--ui-press` (12 %),
   `--ui-on` (selected tab), `--ui-tint` (strips). One accent
   (`--ui-accent`) for the primary action, focus and selection; danger only
   for destructive actions and errors.
7. **Elevation.** `--ui-shadow-pop` for menus and popovers, `--ui-shadow-dialog`
   for dialogs and sheets. Nothing else floats.
8. **Focus.** Keyboard focus (`:focus-visible`) is one ring, `--ui-ring`;
   pointer focus shows nothing. Every control is reachable by Tab; menus take
   arrow keys and type-ahead; tabs take ← →; Esc closes the top layer and
   returns focus to what opened it.
9. **Motion.** 120 ms for hover and state, 180 ms for things that appear,
   `--ui-ease-out`; nothing moves under reduced motion (the tokens go to 0).
   No layout jumps: floating things are positioned before the first paint and
   stay on their side of the anchor.
10. **Labels.** Sentence case, plain words, no exclamation marks. An icon
    button always has `label` (its aria-label and tooltip).

## The kit (`ui/index.js`)

| component | use |
|---|---|
| `Button` | `variant` secondary (default, pill border) · primary (one per surface) · ghost (toolbars) · danger; `size` sm/md/lg; `pill` |
| `IconButton` | a square icon control; `label` required; `pressed` for toggles; `quiet` for idle chrome |
| `Input`, `Select` | fields; `quiet` for in-place fields (the document title); `icon` for a leading icon; `mono` for LaTeX |
| `Tabs` | `variant` seg (sidebar) or strip (the website's frame tabs); counts as `Pill`s |
| `Segmented` | one of a few values (view options) |
| `Chip` | a filter or toggle (`selected`, `dot`, `count`) |
| `Pill` | a count or badge (not a control); tones danger / accent / outline |
| `Menu`, `MenuItem`, `MenuSeparator`, `MenuLabel` | menus; items take `icon` or `tile`, `hint`, `shortcut`, `danger` |
| `Popover` | a floating panel on an anchor (fixed; follows scroll; Esc and outside press close) |
| `Dialog` | modal (native `<dialog>`): title row with close, body, footer |
| `Sheet` | THE side sheet: one width (`--ui-sheet-w`: clamp(480px, 40vw + 88px, 820px), the whole width below 640 px), header, optional `tabs`, one body layout, footer `note` + actions, scrim, motion; first focus in the body, focus back on close; the page does not scroll under it; `onClose(reason)`: escape, outside, close |
| `Toast`, `showToast()` | one message at the bottom, optional action (Undo); replaces the last; the page's one toast stack (chrome/toast.js wraps it) |
| `Island` | an element Preact renders once and never again (CodeMirror's host, the viewer's block, a DocumentView host) |
| `CopyButton`, `copyText()` | the one Copy button ("Copied" for 1.6 s, `data-copied`); the clipboard with a textarea fallback |
| `pushLayer`, `openLayer`, `owns`, `toggling` | the one overlay layer (below) |
| `registerView`, `openView`, `Frame` | views: content apart from its container (below) |
| `Tooltip` | on hover after 500 ms, at once on keyboard focus |
| `Card` | the website's example frame; `tabs` for a strip |
| `Banner` | a notice line with actions (seed changes) |

Plain-DOM code can use the same classes (`ui-btn ui-btn--ghost`, `ui-icon-btn`,
`ui-menu-item` …) and `svg('plus')` from `ui/icons.ts` while it waits for its
migration; new UI is Preact (`html\`…\`` from `ui/core.js`).

## The one overlay layer (`ui/layers.js`)

Everything that floats registers there: menus (`chrome/menu.ts`), the kit's Popover (the notes popover, bibpane and
home menus), the View popover, the reference card, Dialogs and Sheets (as `modal`), the toast stack and the Back pill.

- **Stacking:** tiers from the tokens, `--ui-z-pill` < `--ui-z-float` < `--ui-z-toast` < `--ui-z-tip`; within a tier a
  later layer is above an earlier one. The page's chrome (top bar 20, sidebar 30, drop lines 40) is below every tier;
  no module sets a z-index of its own on a layer.
- **Escape** dismisses the topmost layer only, and nothing else sees that key. With the focus inside it, its widgets
  go first (an Escape a CodeMirror completion or a field consumed, `defaultPrevented`, is theirs). After Escape the
  focus goes back to what had it when the layer opened (or the layer's `returnFocus`).
- **An outside press** dismisses, from the top, every float layer it is outside of; it stops at the layer that contains
  it, at a modal, or at a toggle anchor (the button that opened the layer: its own click toggles; `toggling(anchor)`
  tells an opener that this click began on its open layer's button). The press goes on to its target.
- **A document's own "press outside"** (the editing session) asks `owns(node)`: a layer, CodeMirror's tooltips or the
  app's chrome (`[data-ui-chrome]`: the top bar, the sidebar, the find bar) own a press; no exclusion lists.

## Views: content apart from its container (`ui/views.js`)

A panel's content is a component that renders `<Frame title tabs note footer onClose …>` and never imports Sheet; the
container it is opened in supplies the Frame (THE Sheet today; a pane or a tab later). Panels are registered with ids:
`registerView({ id, title, slot, Component })`, opened with `openView(id, props)`; `views(slot)` lists them. Document
settings (`settings`) and the title form (`title-form`) are views. No workbench yet: the layout is not data.

## Checking

The showcase (`design/showcase.js`) draws every component in light and
dark.
