// on the kit (Preact): the note's popover, in the page (never in the text: viewer README, Widgets). The kit's
// Popover on the chip (fixed, follows the scroll, keeps its side; Esc and a press outside close it, the focus goes
// back to the chip). Author, kind, the message (the note's part `text`, mounted by the viewer at the popover's
// width: TeX's maths), and the actions (data: Edit, Resolve).
//
//   const layer = createNoteLayer()
//   layer.show({ chip, info, title, mountText(el) -> surface|null, fallback, actions: [{ id, label, run, disabled? }], onClosed(focus) })
//   layer.hide({ focus }) · layer.current (the shown state or null)
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useCallback } from 'preact/hooks';
import { html, render, Popover, Button } from '../design/ui/index.js';
import { inkOf } from './colours.js';

function kindOf(info) {
  return info.from === 'comment' ? '%' : info.from === 'figure' ? 'missing figure' : info.inline ? 'inline note' : 'margin note';
}
function whoOf(info) {
  return info.from === 'comment' ? 'Comment in the source' : info.author || 'Note';
}

function NoteBody({ mountText, fallback }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    let surface = null;
    try { surface = mountText?.(el) ?? null; } catch (e) { console.warn('note text:', e.message); }
    if (!surface) el.textContent = fallback ?? '';
    // the popover takes the focus itself (not its first button: Enter right after opening must not edit)
    el.closest('.rtx-note-pop')?.focus({ preventScroll: true });
    return () => { try { surface?.dispose(); } catch { /* gone */ } };
  }, [mountText]);
  return html`<div class="rtx-note-body" ref=${ref}></div>`;
}

function NotePopover({ state, onClose }) {
  const { chip, info, title, actions } = state;
  return html`<${Popover} anchor=${chip} placement="bottom-start" focus=${false} pad=${false} class="rtx-note-pop" label=${title} onClose=${onClose}
      style=${{ '--note-bg': info.colour, '--note-ink': inkOf(info.colour) }}
      onKeyDown=${(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
    <div class="rtx-note-head">
      <span class="rtx-note-dot" aria-hidden="true"></span>
      <span class="rtx-note-who">${whoOf(info)}</span>
      <span class="rtx-note-tag">${kindOf(info)}</span>
    </div>
    <${NoteBody} mountText=${state.mountText} fallback=${state.fallback} />
    <div class="rtx-note-actions">
      ${actions.map((a) => html`<${Button} key=${a.id} size="sm" variant=${a.variant ?? 'ghost'} class="rtx-note-btn" data-action=${a.id} disabled=${!!a.disabled}
        onClick=${(e) => { e.stopPropagation(); a.run(); }}>${a.label}<//>`)}
    </div>
  <//>`;
}

export function createNoteLayer() {
  const shown = signal(null);
  const host = document.createElement('div');
  host.className = 'rtx-note-layer';
  document.body.append(host);

  function hide({ focus = true } = {}) {
    const s = shown.peek();
    if (!s) return;
    shown.value = null;
    s.onClosed?.(focus);
  }
  function Layer() {
    // reason 'escape': the kit puts the focus back on the chip itself; 'outside': the press goes where it goes
    const onClose = useCallback(() => hide({ focus: false }), []);
    const s = shown.value;
    return s ? html`<${NotePopover} key=${s.seq} state=${s} onClose=${onClose} />` : null;
  }
  render(html`<${Layer} />`, host);
  let seq = 0;
  return {
    show(state) { hide({ focus: false }); shown.value = { ...state, seq: ++seq }; },
    hide,
    get current() { return shown.peek(); },
  };
}
