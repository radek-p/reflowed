// SURFACES: the one Copy button and the clipboard write behind it (were two copies: edit/panel.js's
// error rows and sidebar/index.ts's Problems panel).
//
//   copyText(text) -> Promise<boolean>          the clipboard, else a hidden textarea and the copy command
//   html`<${CopyButton} text=${() => report} label="Copy" title="…" class="err-copy" />`
// The button says "Copied" (or "Copy failed") for 1.6 s, as data-copied="1"/"0" too; a press on it neither leaves an
// edit nor starts a drag (pointerdown and click stop there). `text` is a function: the report is made on the click.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, cx } from './core.js';

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* no permission, or not a secure context */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function CopyButton({ text, label = 'Copy', title = 'Copy', class: c = '', ...rest }) {
  const [done, setDone] = useState(null);
  const t = useRef(0);
  useEffect(() => () => clearTimeout(t.current), []);
  const click = async (e) => {
    e.stopPropagation();
    const ok = await copyText(typeof text === 'function' ? text() : String(text ?? ''));
    setDone(ok ? '1' : '0');
    clearTimeout(t.current);
    t.current = setTimeout(() => setDone(null), 1600);
  };
  return html`<button type="button" class=${cx('ui-copy', c)} title=${title} data-copied=${done ?? undefined} aria-live="polite" ...${rest}
    onClick=${click} onPointerDown=${(e) => e.stopPropagation()}>${done === '1' ? 'Copied' : done === '0' ? 'Copy failed' : label}</button>`;
}
