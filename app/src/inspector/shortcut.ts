// The inspector's shortcut, Alt+Shift+I (⌥⇧I), as a rule on a key event (inspector/index.ts listens and acts).
// The key is taken only when it toggles the inspector; otherwise it goes on untouched (on a Mac it types a character
// in many layouts: "ˆ" on US, a letter on Polish Pro). The public panel's script, once loaded, listens for the same key
// itself (in the capture phase on the window: it opens or focuses the panel and prevents the default); while
// that script is on the page and the key does not toggle, only that listener is stopped and the character still types.
//
//   shortcutAction(e, { canShow, panelLoaded }) -> 'toggle' | 'shield' | null
//     canShow      the inspector can show now (outside a release, the advanced switch on)
//     panelLoaded  the public panel's script is on the page (window.reflowtex.inspector)
//     'toggle'     toggle the inspector; stop the event and prevent its default
//     'shield'     stop the event before the public panel's listener; keep its default
//     null         not the shortcut, or nothing to do: leave the event alone

export type ShortcutAction = 'toggle' | 'shield' | null;
type KeyLike = Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>;

export const isShortcut = (e: KeyLike): boolean => e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI';

export function shortcutAction(e: KeyLike, { canShow, panelLoaded }: { canShow: boolean; panelLoaded: boolean }): ShortcutAction {
  if (!isShortcut(e)) return null;
  return canShow ? 'toggle' : panelLoaded ? 'shield' : null;
}
