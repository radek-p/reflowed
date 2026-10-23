// SPDX-License-Identifier: AGPL-3.0-or-later
// The intro's \todo notes, drawn as the ReflowEd editor draws them: a small chip in the line, in the author's colour
// (initials, or a note icon for a note with no author), that opens a popover with who wrote it, what kind of note it
// is, and its text typeset by TeX (maths renders). The site is read-only, so the editor's Edit and Resolve are not
// here.
//
// The LaTeX side is the editor's own notes package (tex/rtx-notes.sty), which tools/prepare-intro.ts loads in the
// site's copy of the intro: on the web each \todo is \webwidget[n, author, color, todocolor, inline, from]{rtxnote}
// with its text as \webpart{text}{…}. This file uses only the viewer's public host API (window.reflowtex.host, the
// contract in reflowtex's src/viewer/src/host/types.ts): host.define with measure and render for the chip, and the
// part's mount for the text. The few types it needs are written out below, as that contract has them.
//
// The chip is a button (its label says whose note it is); pressing it, with the mouse or Enter or Space, opens the
// popover and moves the focus into it; Escape closes it and the focus goes back to the chip, as does pressing the
// chip again; a press outside, or the focus leaving both, closes it too. The popover stays by its chip as the page
// scrolls. Colours: the editor's palette per author, the ink on a chip a dark shade of its colour; the popover is on
// the page's colours, so it follows the light, dark, sepia and contrast themes (html.dark, .sepia, .contrast).
//
// Plain DOM, no imports: like the site's other scripts it is a classic script. Loaded by every page
// (layouts/_default/baseof.html) as static/notes.js, which build.sh builds from this file.
(() => {
    // ── The viewer's contract (the part of types.ts used here) ──────────────────────────────────────────────────
    interface Box { width: number; height: number; depth: number }
    interface InlineEnv {
        readonly fontSize: number;
        measure(content: string | Node | ((el: HTMLElement) => void)): Box;
        invalidate(): void;
    }
    interface Surface { dispose(): void }
    interface TypesetPart {
        readonly type: 'typeset';
        mount(el: HTMLElement, options?: { width?: number | 'natural' | 'container' }): Surface;
    }
    interface DataPart { readonly type: 'data'; readonly data: string }
    interface Instance {
        readonly id: string;
        readonly kind: string;
        readonly attrs: Readonly<Record<string, string>>;
        part(role: string): TypesetPart | DataPart | undefined;
    }
    interface PieceHost { readonly type: 'piece'; readonly el: HTMLElement; readonly instance: Instance; readonly env: InlineEnv }
    interface OtherHost { readonly type: 'block' | 'margin' | 'popover'; readonly el: HTMLElement }
    interface KindDef {
        render(instance: Instance, host: PieceHost | OtherHost): void | (() => void);
        measure?(instance: Instance, env: InlineEnv): Box;
    }
    interface Host { define(kind: string, def: KindDef): () => void }
    type Page = Window & { reflowtex?: { host?: Host } };

    const KIND = 'rtxnote';

    // ── Colours (the editor's notes/colours.js) ──────────────────────────────────────────────────────────────────
    const PALETTE = ['#f6c343', '#7fb3f5', '#8fd19e', '#f59e8b', '#c9a4f2', '#f5a3c7', '#7fd3d1', '#f0b27a'];
    const NEUTRAL = '#d9d8d4';                                    // a note of no author and no colour
    const HEX = /^#[0-9a-f]{6}$/i;
    const hashOf = (s: string) => {
        let h = 2166136261;
        for (const c of s) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
        return h >>> 0;
    };
    const channels = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    /** The note's own colour (todonotes' color=), else the author's. */
    const authorColour = (author: string, own = '') =>
        HEX.test(own) ? own : author ? PALETTE[hashOf(author.toLowerCase()) % PALETTE.length] : NEUTRAL;
    /** A colour mixed with white (todonotes' default colour is meant for a box, not a chip). */
    const tint = (hex: string | undefined, k: number) => (hex && HEX.test(hex)
        ? `#${channels(hex).map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('')}` : '');
    /** The ink on a chip of this colour: the colour, much darker. */
    const inkOf = (hex: string) => (HEX.test(hex) ? `rgb(${channels(hex).map((v) => Math.round(v * 0.32)).join(',')})` : '');
    /** Two words: their initials (AL); one: its first two letters (Sz). */
    const initials = (author: string) => {
        const w = author.trim().split(/\s+/).filter(Boolean);
        if (!w.length) return '';
        return w.length > 1 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : w[0].charAt(0).toUpperCase() + w[0].slice(1, 2).toLowerCase();
    };

    // ── What a note is ───────────────────────────────────────────────────────────────────────────────────────────
    interface Note { from: 'todo' | 'figure' | 'comment'; author: string; inline: boolean; colour: string }
    const noteOf = (instance: Instance): Note => {
        const a = instance.attrs;
        const from = a.from === 'figure' || a.from === 'comment' ? a.from : 'todo';
        const author = from === 'comment' || a.author === 'Unassigned' ? '' : (a.author ?? '').trim();
        const colour = from === 'comment' ? NEUTRAL : authorColour(author, a.color || (author ? '' : tint(a.todocolor, 0.55)));
        return { from, author, inline: a.inline === 'true', colour };
    };
    const chipText = (n: Note) => (n.from === 'todo' ? initials(n.author) : '');
    const label = (n: Note) => (n.from === 'comment' ? 'Comment' : n.from === 'figure' ? 'Missing figure'
        : `Note${n.author ? ` by ${n.author}` : ''}`);
    const who = (n: Note) => (n.from === 'comment' ? 'Comment in the source' : n.author || 'Note');
    const kindOf = (n: Note) => (n.from === 'comment' ? '%' : n.from === 'figure' ? 'missing figure'
        : n.inline ? 'inline note' : 'margin note');

    // The editor's icons (Lucide's sticky-note, image and message-square, ISC licence).
    const ICON = {
        todo: '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z"/><path d="M15 3v5a1 1 0 0 0 1 1h5"/>',
        figure: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        comment: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    };
    const icon = (n: Note) => `<svg class="rtx-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[n.from]}</svg>`;

    // ── The look ─────────────────────────────────────────────────────────────────────────────────────────────────
    // The chip fills the box the viewer gives the widget in the line (as tall as the text's capitals, a little below
    // the baseline), in the note's colour (--note-bg) with its ink (--note-ink). The popover is a panel in the colour
    // of the page's popovers, nearly opaque so that the text behind does not show through, with the note's colour as
    // its top edge. Its focus ring and the chip's are the site's accent.
    const CSS = `
.rtx-note-chip {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  border-radius: 999px;
  background: var(--note-bg); color: var(--note-ink);
  font: 600 1em/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .01em;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / .08);
  transition: filter .12s ease, box-shadow .12s ease;
}
.rtx-note-chip:hover { filter: brightness(.96) saturate(1.1); }
.rtx-note-chip[data-inline="true"] { border-radius: 4px; }
.rtx-note-chip:focus-visible, .rtx-note-chip[aria-expanded="true"] {
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12), 0 0 0 2px var(--latex-page-bg, Canvas), 0 0 0 3.5px var(--lt-primary, Highlight); }
html.contrast .rtx-note-chip { box-shadow: inset 0 0 0 1px #000; }
html.contrast .rtx-note-chip:focus-visible, html.contrast .rtx-note-chip[aria-expanded="true"] {
  box-shadow: inset 0 0 0 1px #000, 0 0 0 2px #fff, 0 0 0 4px var(--lt-primary, #000); }
.rtx-note-icon { display: block; width: 1.25em; height: 1.25em; }

.rtx-note-pop {
  position: fixed; z-index: 2147482000; box-sizing: border-box;
  width: min(360px, calc(100vw - 16px));
  padding: 12px 14px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-top: 3px solid var(--note-bg);
  background: var(--latex-page-bg, Canvas); color: inherit;
  background: rgb(from var(--latex-popover-background, var(--latex-page-bg, Canvas)) r g b / .97);
  -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
  box-shadow: 0 12px 36px -8px rgb(0 0 0 / .28), 0 2px 6px rgb(0 0 0 / .08);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  outline: none;
}
html.dark .rtx-note-pop { box-shadow: 0 12px 36px -8px rgb(0 0 0 / .7), 0 0 0 1px rgb(255 255 255 / .04); }
html.contrast .rtx-note-pop { border: 2px solid #000; border-top: 4px solid var(--note-bg); box-shadow: none; }
.rtx-note-pop:focus-visible { box-shadow: 0 0 0 2px var(--lt-primary, Highlight), 0 12px 36px -8px rgb(0 0 0 / .28); }
.rtx-note-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.rtx-note-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--note-bg);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / .1); }
.rtx-note-who { font-weight: 600; }
.rtx-note-tag { margin-left: auto; font-size: 12.5px; opacity: .7; }
.rtx-note-body { font-size: 15px; min-height: 1.2em; max-height: 50vh; overflow: auto; }
@media print { .rtx-note-pop { display: none; } }
`;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);

    // ── The chips ────────────────────────────────────────────────────────────────────────────────────────────────
    const chips = new Map<string, HTMLButtonElement[]>();        // instance id -> its chips (one per piece)
    const sizeOf = (n: Note, fs: number) => {
        const text = chipText(n), cf = 0.62 * fs;                  // the chip's own font size
        return { width: text ? Math.max(0.94 * fs, cf * (0.66 * text.length + 0.95)) : 1.1 * fs, height: 0.74 * fs, depth: 0.2 * fs };
    };

    const def: KindDef = {
        measure: (instance, env) => sizeOf(noteOf(instance), env.fontSize || 16),
        render(instance, host) {
            if (host.type !== 'piece') return;
            const n = noteOf(instance), fs = host.env.fontSize || 16;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'rtx-note-chip';
            chip.dataset.from = n.from;
            if (n.inline) chip.dataset.inline = 'true';
            chip.setAttribute('aria-haspopup', 'dialog');
            chip.setAttribute('aria-expanded', String(open?.instance.id === instance.id));
            chip.setAttribute('aria-label', label(n));
            chip.title = label(n);
            chip.style.setProperty('--note-bg', n.colour);
            chip.style.setProperty('--note-ink', inkOf(n.colour));
            chip.style.fontSize = `${(0.62 * fs).toFixed(2)}px`;
            const text = chipText(n);
            if (text) chip.textContent = text; else chip.innerHTML = icon(n);
            // The press is the chip's: not a selection or a click on the text around it.
            chip.addEventListener('pointerdown', (e) => e.stopPropagation());
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (open?.instance.id === instance.id) close(true); else show(instance, chip);
            });
            chip.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') e.stopPropagation();
                if (e.key === 'Escape' && open) close(true);
            });
            host.el.append(chip);
            const list = chips.get(instance.id) ?? [];
            list.push(chip);
            chips.set(instance.id, list);
            // Drawn again (the paragraph broken anew): an open popover moves to the new chip.
            if (open?.instance.id === instance.id && !open.chip.isConnected) { open.chip = chip; place(); }
            return () => {
                const rest = (chips.get(instance.id) ?? []).filter((c) => c !== chip);
                if (rest.length) chips.set(instance.id, rest); else chips.delete(instance.id);
                chip.remove();
                if (open?.chip === chip) {
                    // Its piece went: follow the widget to its new piece once the line is drawn, or close.
                    requestAnimationFrame(() => {
                        if (open?.chip !== chip) return;
                        const next = chips.get(instance.id)?.find((c) => c.isConnected);
                        if (next) { open.chip = next; next.setAttribute('aria-expanded', 'true'); place(); } else close(false);
                    });
                }
            };
        },
    };

    // ── The popover ──────────────────────────────────────────────────────────────────────────────────────────────
    let open: { instance: Instance; chip: HTMLButtonElement; pop: HTMLElement; surface: Surface | null } | null = null;
    let seq = 0;

    function show(instance: Instance, chip: HTMLButtonElement) {
        close(false);
        const n = noteOf(instance);
        const pop = document.createElement('div');
        pop.className = 'rtx-note-pop';
        pop.id = `rtx-note-pop-${++seq}`;
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', label(n));
        pop.tabIndex = -1;
        pop.style.setProperty('--note-bg', n.colour);
        const head = document.createElement('div');
        head.className = 'rtx-note-head';
        head.innerHTML = '<span class="rtx-note-dot" aria-hidden="true"></span><span class="rtx-note-who"></span><span class="rtx-note-tag"></span>';
        head.querySelector('.rtx-note-who')!.textContent = who(n);
        head.querySelector('.rtx-note-tag')!.textContent = kindOf(n);
        const body = document.createElement('div');
        body.className = 'rtx-note-body';
        pop.append(head, body);
        document.body.append(pop);
        // The text, as TeX typeset it, at the popover's width.
        const part = instance.part('text');
        let surface: Surface | null = null;
        try { if (part?.type === 'typeset') surface = part.mount(body, { width: 'container' }); } catch (e) { console.warn('notes:', e); }
        if (!surface && part?.type === 'data') body.textContent = part.data;
        open = { instance, chip, pop, surface };
        chip.setAttribute('aria-expanded', 'true');
        chip.setAttribute('aria-controls', pop.id);
        place();
        pop.focus({ preventScroll: true });
    }

    function close(focus: boolean) {
        const o = open;
        if (!o) return;
        open = null;
        try { o.surface?.dispose(); } catch { /* gone with its block */ }
        o.pop.remove();
        for (const c of chips.get(o.instance.id) ?? []) { c.setAttribute('aria-expanded', 'false'); c.removeAttribute('aria-controls'); }
        if (focus && o.chip.isConnected) o.chip.focus({ preventScroll: true });
    }

    // Below the chip, from its start; above it when there is no room below and more above. Kept in the window.
    function place() {
        if (!open) return;
        const { chip, pop } = open;
        if (!chip.isConnected) return;
        const r = chip.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 6, edge = 8;
        const below = innerHeight - r.bottom - gap - edge, above = r.top - gap - edge;
        const top = h <= below || below >= above ? r.bottom + gap : r.top - gap - h;
        pop.style.left = `${Math.round(Math.max(edge, Math.min(r.left, innerWidth - w - edge)))}px`;
        pop.style.top = `${Math.round(top)}px`;
    }
    let frame = 0;
    const follow = () => { if (open && !frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
    addEventListener('scroll', follow, { passive: true, capture: true });
    addEventListener('resize', follow, { passive: true });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open) { e.preventDefault(); close(true); }
    });
    document.addEventListener('pointerdown', (e) => {
        if (!open || !(e.target instanceof Node)) return;
        if (!open.pop.contains(e.target) && !open.chip.contains(e.target)) close(false);
    }, true);
    document.addEventListener('focusin', (e) => {
        if (!open || !(e.target instanceof Node)) return;
        if (!open.pop.contains(e.target) && !open.chip.contains(e.target)) close(false);
    });

    // ── Registering the kind ─────────────────────────────────────────────────────────────────────────────────────
    const define = (host: Host) => {
        try { host.define(KIND, def); } catch (e) { console.warn('notes:', e); }
    };
    const page = window as Page;
    if (page.reflowtex?.host) define(page.reflowtex.host);
    else document.addEventListener('reflowtex:host', (e) => define((e as CustomEvent<{ host: Host }>).detail.host), { once: true });
})();
