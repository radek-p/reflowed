// notes in the reflowed document. Every \todo (and the preamble's
// macros on it, \editor → Editor), \missingfigure, and — a setting, on by
// default — comments on their own lines that read as notes, become a small
// chip in the line, in the author's colour, that opens to the message
// (typeset by TeX: maths renders), who wrote it, and Edit / Resolve.
//
// TeX side: tex/rtx-notes.sty makes each note \webwidget{rtxnote}
// with its text as the part `text` (web mode only; print is left alone).
// This module:
//   - wraps the backends that draw the companion's widgets (webFeatures: the
//     LuaLaTeX dev backend now; engine once it says so) so that a
//     compile loads rtx-notes.sty after the preamble, declares the authors
//     of its macros, and turns note comments into \rtxcomment line for line;
//   - defines the kind `rtxnote` with the viewer (reflowtex.host.define):
//     the chip in the line, and a popover in the page;
//   - gives the app a colour per author, a way to open a note from the TODO
//     panel, and its two settings (settings(), setHidden, setComments: the Settings panel's Notes section).
//
// UI (Preact on the design kit): chip.js (the chip), popover.js (the kit's Popover with the message and the
// actions), colours.js (author colours, ink, initials), style.js (tokens). This module keeps the logic.
//
// Wiring: main.js installNotes() before the backend is
// chosen and notes.attach(hosts) after (the workspace's document hosts, app/doc-host.js); app.js passes ctx.notes on to the
// panels, the menu and the cache key.
import { showToast } from '../chrome/toast.js';
import { notesIn, transformComments, notesPreamble, resolveNote, todoMacros } from './scan.js';
import { luaBackend } from './backend-lua.js';
import { texToText } from '../tex/texscan.js';
import { installStyle } from './style.js';
import { html, render } from '../design/ui/core.js';
import { authorColour, tint, NEUTRAL } from './colours.js';
import { NoteChip, chipWidth } from './chip.js';
import { createNoteLayer } from './popover.js';
import { signal } from '@preact/signals';
import { shownBlock } from '../view/shown.ts';
export { authorColour } from './colours.js';

const KIND = 'rtxnote';
const KEY_HIDDEN = 'rtx-editor.notes.hidden', KEY_COMMENTS = 'rtx-editor.notes.comments';
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

/** @param {{ backends?: { id: string, webFeatures?: boolean }[], params?: URLSearchParams }} [o] */
export function installNotes({ backends = [], params = new URLSearchParams(location.search) } = {}) {
  installStyle();
  const settings = { hidden: safeGet(KEY_HIDDEN) === '1', comments: safeGet(KEY_COMMENTS) !== '0' };
  // the workspaces' document hosts (app/doc-host.js): at(node), current(), all(); one workspace per editor on
  // the page, so the note chips (the viewer's kind and the compile wrapper: the page's) act in the editor they are in
  const workspaces = new Set();
  const hosts = {
    at: (node) => { for (const h of workspaces) { const x = h.at(node); if (x) return x; } return null; },
    all: () => [...workspaces].flatMap((h) => h.all()),
  };
  // instance id -> weak refs to the InlineEnvs of its pieces (invalidate on hide/show). Weak: a
  // closed pane's pieces (or a block drawn again) must not stay alive here.
  const envs = new Map();
  const known = new WeakSet();             // the envs already in envs
  const chips = new Map();                 // instance id -> [chip button]
  let open = null;                         // { instance, chip }: the popover shown (layer.current has the rest)
  const openKey = signal(null);            // the open chip's key (its aria-expanded, .open)
  let chipSeq = 0;
  const chipKeys = new WeakMap();          // chip element -> its key
  const layer = createNoteLayer();
  const seen = new Map();                  // author -> the colour their chips have (todonotes' color= wins)

  // ── The dev backend and the compile wrapper ───────────────────────────────
  if (params.get('backend') === 'lua' && !backends.some((b) => b.id === 'lua')) backends.unshift(luaBackend);
  const wants = (b) => b?.webFeatures === true || b?.id === 'lua';
  const macroNames = (pre) => [...todoMacros(pre ?? '').keys()];
  for (const b of backends) {
    if (!wants(b) || b.__rtxNotes) continue;
    b.__rtxNotes = true;
    const compile = b.compile.bind(b);
    b.compile = (req) => {
      // a snippet (figure labels: backend.compileSnippet) has no preamble: the backend's own stands
      const names = req.preamble == null ? [] : macroNames(req.preamble);
      return compile({ ...req, preamble: req.preamble == null ? req.preamble : notesPreamble(req.preamble),
        blocks: req.blocks.map((x) => ({ ...x, source: settings.comments ? transformComments(x.source, names) : x.source })) });
    };
    if (b.setPreamble) { const sp = b.setPreamble.bind(b); b.setPreamble = (p) => sp(notesPreamble(p)); }
  }

  // ── Where an instance is: its block, its note in the source ──────────────
  const blockRootOf = (instance) => instance.block?.el?.closest?.('.blk') ?? null;
  function noteOf(instance) {
    const root = blockRootOf(instance);
    const id = root?.dataset.id;
    // the document of the pane the chip is in (a pane may show another document)
    const host = (root && hosts?.at(root)) || null;
    const b = id && host?.block(id);
    const a = instance.attrs ?? {};
    let note = null, index = -1;
    if (b) {
      const list = notesIn(b.source, todoMacros(host.preamble()), { comments: settings.comments && wants(backendOf(host)) });
      const all = instance.block.instances({ kind: KIND });
      index = a.n ? Number(a.n) - 1 : all.indexOf(instance);
      note = list[index] ?? null;
      if (note && a.from && note.from !== a.from) note = null;        // out of step with the source (an edit not typeset yet)
    }
    const from = a.from || note?.from || 'todo';
    const author = from === 'comment' ? '' : (note?.author && note.author !== 'Unassigned' ? note.author : a.author || '');
    return { host, blockId: id ?? null, note, index, from, author, inline: a.inline === 'true', colour: from === 'comment' ? NEUTRAL : authorColour(author, a.color || (author ? '' : tint(a.todocolor, 0.55))) };
  }
  const backendOf = (host) => { try { return backends.find((b) => b.id === host?.backendId()) ?? null; } catch { return null; } };

  // ── The kind: a chip in the line ──────────────────────────────────────────
  const size = (env) => {
    const fs = env.fontSize || 16;
    return { h: 0.74 * fs, d: 0.2 * fs, fs };
  };
  const def = {
    measure(instance, env) {
      if (!known.has(env)) {
        known.add(env);
        let set = envs.get(instance.id);
        if (!set) envs.set(instance.id, (set = new Set()));
        for (const r of set) if (!r.deref()) set.delete(r);
        set.add(new WeakRef(env));
      }
      if (settings.hidden) return { width: 0, height: 0, depth: 0 };
      const { h, d, fs } = size(env);
      return { width: chipWidth(noteOf(instance), fs), height: h, depth: d };
    },
    render(instance, host) {
      if (host.type !== 'piece') return;
      const info = noteOf(instance);
      if (info.author && info.from !== 'comment') seen.set(info.author, info.colour);
      const fs = host.env?.fontSize || 16;
      const key = ++chipSeq;
      const Chip = () => html`<${NoteChip} info=${info} label=${chipLabel(info)} fontSize=${fs} open=${openKey.value === key}
        onToggle=${(el) => toggle(instance, el)} onEscape=${() => close()} />`;
      const box = document.createElement('span');
      box.className = 'rtx-note-chip-host';
      box.style.display = 'contents';
      host.el.append(box);
      render(html`<${Chip} />`, box);
      const b = box.firstElementChild;
      chipKeys.set(b, key);
      const list = chips.get(instance.id) ?? [];
      list.push(b);
      chips.set(instance.id, list);
      return () => {
        render(null, box);
        box.remove();
        const l = chips.get(instance.id)?.filter((x) => x !== b) ?? [];
        if (l.length) chips.set(instance.id, l); else chips.delete(instance.id);    // (its env stays: a hidden note has no piece, and must come back)
        if (open?.chip === b) close({ focus: false });
      };
    },
  };
  function chipLabel(info) {
    const what = info.from === 'comment' ? 'Comment' : info.from === 'figure' ? 'Missing figure' : `Note${info.author ? ` by ${info.author}` : ''}`;
    const text = info.note ? texToText(info.note.text).replace(/\$/g, '').slice(0, 80) : '';
    return text ? `${what}: ${text}` : what;
  }

  // ── The popover (in the page, never in the text: viewer README, Widgets) ──
  function toggle(instance, chip) {
    if (open?.chip === chip) { close(); return; }
    openAt(instance, chip);
  }
  function openAt(instance, chip) {
    close({ focus: false });
    const info = noteOf(instance);
    const off = !info.note || !info.blockId;
    const part = instance.part?.('text');
    open = { instance, chip };
    openKey.value = chipKeys.get(chip) ?? null;
    layer.show({
      chip, info, title: chipLabel(info),
      mountText: (el) => (part?.type === 'typeset' ? part.mount(el, { width: 'container' }) : null),
      fallback: info.note ? texToText(info.note.text) : '',
      actions: [
        { id: 'edit', label: 'Edit', disabled: off, run: () => editNote(instance) },
        { id: 'resolve', label: 'Resolve', disabled: off, run: () => resolveIt(instance) },
      ],
      // the popover went (Esc, a press outside, another chip, an action): the chip's state follows
      onClosed: (focus) => { if (open?.chip !== chip) return; open = null; openKey.value = null; if (focus && chip.isConnected) chip.focus({ preventScroll: true }); },
    });
  }
  function close({ focus = true } = {}) {
    if (!open) return;
    layer.hide({ focus });
  }
  // (Escape closes the popover: the kit's one overlay layer, design/ui/layers.js)

  // ── Actions ───────────────────────────────────────────────────────────────
  function editNote(instance) {
    const info = noteOf(instance);
    close({ focus: false });
    if (!info.note || !info.host) return;
    const b = info.host.block(info.blockId);
    const brace = info.from === 'comment' ? b.source.indexOf('%', info.note.offset) + 1 : b.source.indexOf('{', info.note.offset) + 1;
    const caret = brace > 0 && brace <= info.note.offset + info.note.length ? brace : info.note.offset;
    info.host.edit(info.blockId, caret);
  }
  function resolveIt(instance) {
    const info = noteOf(instance);
    close({ focus: false });
    if (!info.note || !info.host) return;
    const host = info.host, b = host.block(info.blockId);
    const before = b.source, after = resolveNote(before, info.note);
    host.setSource(info.blockId, after);
    // Undo: the old source back, unless the block changed since (then the toast is stale: ⌘Z still works)
    toast(info.from === 'comment' ? 'Comment removed' : 'Note resolved', () => {
      if (host.block(info.blockId)?.source === after) host.setSource(info.blockId, before);
    });
  }
  // the page's one toast, shared with the app (chrome/toast.js): no second timer hiding it early
  function toast(text, undo) { showToast(text, undo); }

  // ── Settings ──────────────────────────────────────────────────────────────
  function applyHidden() {
    document.documentElement.toggleAttribute('data-notes-hidden', !!settings.hidden);   // a page-wide option: on <html>, as the theme
    if (settings.hidden) close({ focus: false });
    for (const [id, set] of envs) {
      if (!window.reflowtex?.host?.find(id)) { envs.delete(id); continue; }          // its block went
      for (const r of set) {
        const env = r.deref();
        if (!env) { set.delete(r); continue; }
        try { env.invalidate(); } catch { /* piece gone */ }
      }
    }
  }
  function setHidden(v) { settings.hidden = !!v; safeSet(KEY_HIDDEN, settings.hidden ? '1' : ''); applyHidden(); }
  function setComments(v) {
    settings.comments = !!v;
    safeSet(KEY_COMMENTS, settings.comments ? '1' : '0');
    close({ focus: false });
    for (const host of hosts?.all() ?? []) host.recompileAll();   // every open document's blocks
  }

  // ── The TODO panel: open a note's chip (false: no chip, the panel falls back) ─
  function openNote(t, editor) {
    if (settings.hidden || !t?.blockId || !editor) return false;
    // the block in the focused pane when it shows it (one document in two panes), else wherever it is shown, in
    // the editor whose TODO list asks (its container, app/editor-root.ts)
    const roots = editor.$$(`.blk[data-id="${CSS.escape(t.blockId)}"]`);
    const ws = [...workspaces].find((h) => roots.some((r) => h.at(r))) ?? null;
    const here = ws?.current()?.pane ?? null;
    const root = roots.find((r) => hosts?.at(r)?.pane === here) ?? roots[0] ?? null;
    const el = shownBlock(root);
    const blk = el && window.reflowtex?.host?.block(el);
    const host = hosts?.at(root), b = host?.block(t.blockId);
    if (!blk || !b) return false;
    const list = notesIn(b.source, todoMacros(host.preamble()), { comments: settings.comments && wants(backendOf(host)) });
    const k = list.findIndex((n) => n.offset === t.offset);
    const inst = k >= 0 && blk.instances({ kind: KIND }).find((i, j) => (i.attrs?.n ? Number(i.attrs.n) - 1 : j) === k);
    const chip = inst && chips.get(inst.id)?.[0];
    if (!chip) return false;
    chip.scrollIntoView({ block: 'center', behavior: 'auto' });
    openAt(inst, chip);
    return true;
  }

  // ── Registering the kind with the viewer ──────────────────────────────────
  const define = () => { try { window.reflowtex.host.define(KIND, def); } catch (e) { console.warn('notes:', e.message); } };
  if (window.reflowtex?.host) define(); else document.addEventListener('reflowtex:host', define, { once: true });
  document.documentElement.toggleAttribute('data-notes-hidden', !!settings.hidden);   // a page-wide option: on <html>, as the theme

  return {
    /** the workspace's document hosts, once made: at(node), current(), all() */
    attach(h) { workspaces.add(h); return () => workspaces.delete(h); },
    colour: (author) => seen.get(author) ?? authorColour(author),
    openNote,
    /** the cache key's part that is ours (comments on/off change what a block compiles to) */
    keySalt: (backend) => (wants(backend) ? `+notes${settings.comments ? '' : '-nc'}` : ''),
    settings: () => ({ ...settings }),
    setHidden, setComments,
    /** tests: chips in the page, with what they stand for */
    chips: () => [...chips.entries()].flatMap(([id, list]) => list.map((el) => ({ id, el }))),
    isOpen: () => (open ? { instance: open.instance.id, blockId: blockRootOf(open.instance)?.dataset.id ?? null } : null),
    close: () => close({ focus: false }),
  };
}

