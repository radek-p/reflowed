// the chips' and the popover's CSS, put in the page by installNotes() (a <style> of its own, so the
// single-file build needs nothing for it). On the kit's tokens: the popover is the kit's
// Popover (.ui-popover) with the author's colour as its top edge. The chip sits in a foreignObject the viewer
// sizes; its colour is the author's (--note-bg), its ink a dark shade of it (--note-ink); a comment's chip is
// a tint of the theme's ink, so it follows light and dark.
export const NOTES_CSS = String.raw`.rtx-note-chip {
  all: unset;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  border-radius: var(--ui-r-pill, 999px);
  background: var(--note-bg, #f6c343);
  color: var(--note-ink, #4a3a0a);
  font-family: var(--ui-font);
  font-weight: var(--ui-semibold, 600); line-height: 1; letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 8%, transparent);
  transition: filter var(--ui-fast, 120ms), box-shadow var(--ui-fast, 120ms);
  user-select: none; -webkit-user-select: none;
}
.rtx-note-chip:hover { filter: brightness(0.96) saturate(1.1); }
.rtx-note-chip[data-from="comment"] { background: color-mix(in srgb, var(--ui-ink) 10%, var(--ui-page)); color: var(--ui-ink-2); box-shadow: inset 0 0 0 1px var(--ui-border); }
/* after the comment's own edge: the ring shows on every kind */
.rtx-note-chip:focus-visible, .rtx-note-chip.open { box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 12%, transparent), 0 0 0 2px var(--ui-page), 0 0 0 3.5px var(--ui-accent); }
.rtx-note-chip[data-inline="true"] { border-radius: 4px; }
.rtx-note-chip .rtx-note-icon { display: block; width: 1.25em; height: 1.25em; }
html[data-notes-hidden] .rtx-note-chip { display: none; }

.rtx-note-pop {
  width: min(360px, calc(100vw - 16px));
  border-top: 3px solid var(--note-bg, #f6c343);
  padding: var(--ui-3) var(--ui-3) var(--ui-2);
  outline: none;
}
.rtx-note-head { display: flex; align-items: center; gap: var(--ui-2); margin-bottom: var(--ui-2); }
.rtx-note-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--note-bg, #f6c343); box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 10%, transparent); flex: none; }
.rtx-note-who { font-weight: var(--ui-semibold); color: var(--ui-ink); }
.rtx-note-tag { margin-left: auto; color: var(--ui-ink-2); font-size: var(--ui-text-sm); }
.rtx-note-body { font-size: 15px; min-height: 1.2em; max-height: 50vh; overflow: auto; color: var(--ui-ink); }
.rtx-note-actions { display: flex; gap: var(--ui-1); justify-content: flex-end; margin-top: var(--ui-2); border-top: 1px solid var(--ui-border-soft); padding-top: var(--ui-2); }
`;

export function installStyle() {
  if (document.getElementById('rtx-notes-css')) return;
  const s = document.createElement('style');
  s.id = 'rtx-notes-css';
  s.textContent = NOTES_CSS;
  document.head.append(s);
}
