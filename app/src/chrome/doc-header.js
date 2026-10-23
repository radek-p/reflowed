// the document's header in the bar (Documents / title / section): the document switcher is the big control, the
// name and a chevron in one button, which opens the list of documents; a pencil icon button beside it renames the
// document in place (the name becomes a field: typing renames at once, as before, Enter or a press elsewhere keeps
// it, Escape puts the old name back). Keyboard: both are buttons in the tab order; in the field Enter / Escape.
// Screen readers: the switcher says "Document: <name>, open another document" (aria-haspopup menu), the pencil
// "Rename the document".
//   html`<${DocHeader} title=${signal} onTitle=${(t) => …} openDocs=${(anchor) => …} primary=${bool} />`
// Hooks: .pb-docs.doc-switch (#doc-switch on the primary bar), .doc-name, .doc-rename (#doc-rename), and while
// renaming the field .doc-title (#doc-title).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html, cx } from '../design/ui/core.js';
import { Icon } from '../design/ui/icons.ts';
import { Input, IconButton } from '../design/ui/controls.js';

export function DocHeader({ title, onTitle, openDocs, primary = true, ids = (n) => n }) {
  const [editing, setEditing] = useState(null);       // the name before the rename began, while renaming
  const field = useRef(null), box = useRef(null), refocus = useRef(false), live = useRef(null);
  live.current = editing;
  const name = title.value;
  useLayoutEffect(() => {
    if (editing != null) { field.current?.focus(); field.current?.select(); return; }
    // the field went (Enter, Escape): the focus on the pencil, unless it went somewhere on purpose
    const a = document.activeElement;
    if (refocus.current && (!a || a === document.body || !a.isConnected)) box.current?.querySelector('.doc-rename')?.focus({ preventScroll: true });
    refocus.current = false;
  }, [editing != null]);
  const set = (v) => { title.value = v; onTitle(v); };
  const done = (keep) => {
    // once: the field's removal blurs it too (that blur must not count as a second "keep")
    const was = live.current;
    if (was == null) return;
    live.current = null;
    if (!keep && title.peek() !== was) set(was);
    refocus.current = box.current?.contains(document.activeElement) ?? false;
    setEditing(null);
  };
  const key = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
  };
  const shown = name || 'Untitled';
  return html`<span ref=${box} class=${cx('pb-title', 'doc-header', editing != null && 'is-renaming')}>
    ${editing != null
      ? html`<${Input} id=${primary ? ids('doc-title') : undefined} class="doc-title" quiet placeholder="Untitled" aria-label="Document name" spellcheck="false"
          inputRef=${field} value=${name} onInput=${(e) => set(e.currentTarget.value)} onKeyDown=${key} onBlur=${() => done(true)} />`
      : html`<button type="button" id=${primary ? ids('doc-switch') : undefined} class="pb-docs doc-switch" aria-haspopup="menu" aria-expanded="false"
          aria-label=${`Document: ${shown}, open another document`} title="Open another document" onClick=${(e) => openDocs(e.currentTarget)}>
          <span class=${cx('doc-name', !name && 'is-empty')}>${shown}</span><${Icon.chevronDown} size=${14} />
        </button>`}
    <${IconButton} id=${primary ? ids('doc-rename') : undefined} class="doc-rename" size="sm" quiet icon="pencil" label="Rename the document"
      pressed=${editing != null ? true : undefined} onPointerDown=${(e) => { if (editing != null) e.preventDefault(); }} onClick=${() => (editing != null ? done(true) : setEditing(title.peek()))} />
  </span>`;
}
