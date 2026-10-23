// the Versions dialog on the kit's Dialog (was hand-built in app/app.js).
// panel (home/versions.js mountVersions) mounts into its body. Kept for
// tests: dialog.versions-dialog, and dialog._versions (the panel: idle()).
//   const v = openVersionsDialog(mount)    mount(bodyEl) -> the panel ({ destroy?, idle? })
//   v.close()                              closes it (the panel is destroyed, the dialog leaves)
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { Dialog, openLayer } from '../design/ui/overlays.js';

function Body({ mount }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const panel = mount(ref.current);
    const d = ref.current.closest('dialog');
    if (d) d._versions = panel;
    return () => { panel?.destroy?.(); };
  }, []);
  return html`<div ref=${ref} class="versions-body"></div>`;
}

/** @param {(body: HTMLElement) => void} mount @param {{ onClosed?: (() => void) | null }} [o] */
export function openVersionsDialog(mount, { onClosed = null } = {}) {
  const back = document.activeElement;
  let layer = null;
  layer = openLayer((close) => html`<${Dialog} class="versions-dialog" title="Versions" wide onClose=${() => { close(); onClosed?.(); back?.focus?.({ preventScroll: true }); }}>
    <${Body} mount=${mount} />
  <//>`);
  return {
    get el() { return layer.el.querySelector('dialog'); },
    close() { const d = layer.el.querySelector('dialog'); if (d?.open) d.close(); else layer.close(); },
  };
}
