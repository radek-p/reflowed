// on the kit (Preact): a note's chip in the line. The viewer sizes its foreignObject (notes/index.js measure);
// the chip fills it, in the author's colour (--note-bg) with a dark shade of it as ink (--note-ink).
// Initials (AB, CD) or an icon (an authorless note, a comment, a missing figure); square for an inline note.
//   html`<${NoteChip} info=${…} fontSize=${16} open=${bool} onToggle=${(el) => …} onEscape=${() => …} />`
import { html, Icon } from '../design/ui/index.js';
import { inkOf, initials } from './colours.js';

/** What the chip shows: the author's initials, or '' (then an icon). */
export function chipText(info) {
  return info.from === 'comment' || info.from === 'figure' ? '' : initials(info.author);
}
/** The chip's width at a font size (the viewer reserves it in the line). */
export function chipWidth(info, fs) {
  const label = chipText(info), cf = 0.62 * fs;          // the chip's own font size
  return label ? Math.max(0.94 * fs, cf * (0.66 * label.length + 0.95)) : 1.1 * fs;
}

export function NoteChip({ info, label, fontSize = 16, open = false, onToggle, onEscape }) {
  const text = chipText(info);
  const icon = info.from === 'figure' ? Icon.figure : info.from === 'comment' ? Icon.comment : Icon.note;
  const stop = (e) => e.stopPropagation();
  return html`<button type="button" class=${`rtx-note-chip${open ? ' open' : ''}`} data-from=${info.from} data-author=${info.author}
      data-inline=${info.inline ? 'true' : undefined} aria-haspopup="dialog" aria-expanded=${String(open)} aria-label=${label} title=${label}
      style=${{ '--note-bg': info.colour, '--note-ink': inkOf(info.colour), fontSize: `${(0.62 * fontSize).toFixed(2)}px` }}
      onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onToggle?.(e.currentTarget); }}
      onPointerDown=${stop}
      onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') e.stopPropagation(); if (e.key === 'Escape') onEscape?.(); }}>
    ${text || html`<${icon} class="rtx-note-icon" />`}</button>`;
}
