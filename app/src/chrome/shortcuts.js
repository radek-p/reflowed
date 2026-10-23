// the keyboard-shortcuts dialog on the kit's Dialog (was hand-built in
// app/app.js). Modal (native <dialog>): Esc, the close button and "Close"
// close it; focus goes back to what had it. Rows: [keys, what they do].
import { html } from '../design/ui/core.js';
import { Dialog, openLayer } from '../design/ui/overlays.js';
import { Button } from '../design/ui/controls.js';

export function openShortcuts(rows) {
  const back = document.activeElement;
  const layer = openLayer((close) => {
    const done = () => { close(); back?.focus?.({ preventScroll: true }); };
    return html`<${Dialog} class="shortcuts" title="Keyboard shortcuts" onClose=${done}
        footer=${html`<${Button} variant="ghost" onClick=${(e) => e.currentTarget.closest('dialog').close()}>Close<//>`}>
      <dl>${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    <//>`;
  });
  return layer;
}
