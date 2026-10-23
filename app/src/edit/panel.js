// the editing popover's chrome as Preact components on the kit: the source panel (CodeMirror's host,
// an island Preact never touches, and the stacked layout's error note under it), the error rows (selectable
// text, a Copy button each) and the live error note (one quiet line that opens to the rows; Show changes and
// .err-row .err-line .err-msg .err-copy, .live-note(-icon|-text|-hint|-actions|-box), .live-diff.
//
//   renderErrors(box, problems, { report(p), open(p) })     a block's error rows (empty: none)
//   renderSourcePanel(box, session)                          CodeMirror's host + the stacked note (session.note)
//   renderErrorsPanel(box, session)                          side by side: the note in the block's .errors
//   (session: { note: signal(null | { errors, good, current(), report(p), open(p), revert() }), rows: signal([]), layout: signal(mode), report(p), open(p) })
import { html, render } from '../design/ui/core.js';
import { Island } from '../design/ui/island.js';
import { Button } from '../design/ui/controls.js';
import { useState } from 'preact/hooks';
import { CopyButton } from '../design/ui/copy.js';
import { selecting } from '../view/copy-errors.js';
import { DiffView } from '../view/diff-view.js';

const COPY_TITLE = 'Copy a report of this error (message, line, source, TeX log)';

/** One problem: its line, its message, Copy. A click that ends a text selection is a selection, not a jump. */
export function ErrorRow({ p, report, open }) {
  return html`<div class="err-row" title=${p.detail || p.message} onClick=${(e) => { if (!selecting(e.currentTarget)) open?.(p); }}>
    ${p.line ? html`<span class="err-line">line ${p.line}</span>` : null}<span class="err-msg">${p.message}</span><${CopyButton} class="err-copy" title=${COPY_TITLE} text=${() => report(p)} />
  </div>`;
}
export function ErrorRows({ problems, report, open }) {
  return html`${problems.map((p, i) => html`<${ErrorRow} key=${`${i}:${p.line}:${p.message}`} p=${p} report=${report} open=${open} />`)}`;
}

/** The error while editing: one line (the first message, how many more), opening to the rows; the way back. */
export function LiveNote({ note }) {
  const [diff, setDiff] = useState(false);
  const { errors, good } = note;
  const first = errors[0];
  const current = note.current();
  const changed = good != null && current != null && good !== current;
  return html`<details class="live-note">
      <summary><span class="live-note-icon" aria-hidden="true">!</span><span class="live-note-text">${first.message}${first.line ? ` (line ${first.line})` : ''}${errors.length > 1 ? ` and ${errors.length - 1} more` : ''}</span><span class="live-note-hint">the preview shows the last version that compiled</span></summary>
      <${ErrorRows} problems=${errors} report=${note.report} open=${note.open} />
    </details>
    ${changed ? html`<div class="live-note-actions">
      <${Button} size="sm" variant="ghost" title="What changed since the version the preview shows" onClick=${() => setDiff(!diff)}>${diff ? 'Hide changes' : 'Show changes'}</${Button}>
      <${Button} size="sm" variant="ghost" title="Back to the source the preview shows (undo with ⌘Z)" onClick=${() => note.revert()}>Revert to last working version</${Button}>
    </div>` : null}
    ${changed && diff ? html`<${DiffView} a=${good} b=${current} />` : null}`;
}

function SourcePanel({ session }) {
  const note = session.note.value, stacked = session.layout.value === 'stacked';
  return html`<${Island} class="cm-island" />${note && stacked ? html`<div class="live-note-box"><${LiveNote} note=${note} /></div>` : null}`;
}
function ErrorsPanel({ session }) {
  const note = session.note.value, stacked = session.layout.value === 'stacked', rows = session.rows.value;
  if (note && !stacked) return html`<${LiveNote} note=${note} />`;
  // a first compile failing with nothing shown yet (a new block): the rows, under the editor
  return rows.length ? html`<${ErrorRows} problems=${rows} report=${(p) => session.report?.(p) ?? ''} open=${(p) => session.open?.(p)} />` : null;
}

export function renderErrors(box, problems, o) {
  if (!box) return;
  render(problems.length ? html`<${ErrorRows} problems=${problems} report=${o.report} open=${o.open} />` : null, box);
}
export function renderSourcePanel(box, session) { render(html`<${SourcePanel} session=${session} />`, box); }
export function renderErrorsPanel(box, session) { render(html`<${ErrorsPanel} session=${session} />`, box); }
export function clearPanel(box) { if (box) render(null, box); }
