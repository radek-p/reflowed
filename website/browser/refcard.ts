// SPDX-License-Identifier: AGPL-3.0-or-later
// The reference card, as the ReflowEd editor shows it: pointing at a cross-reference (\ref, \eqref, \cref, \Cref,
// \autoref) or a citation (\cite) for a moment, or moving the keyboard focus onto one, opens a card beside it with
// what it points to typeset again: the theorem, equation, figure or section with its number, or the bibliography's
// entry. Its title is the reference as printed ("Theorem 3.2", "Citation [1]"); "Go to" jumps there. The site is
// read-only, so the editor's editing actions are not here, and a click on a reference still follows it, as the
// viewer does. After any jump a "Back" pill returns to where you were (also Alt+Left, or Cmd+[ / Ctrl+[).
//
// It uses only the viewer's public host API and DOM contract (reflowtex's src/viewer/src/host/types.ts and the
// viewer's README): a reference is a group of glyphs sharing data-link, a \label an element of class latex-anchor
// whose id is the label; host.block(el) finds the block an anchor is in, host.mount(el, { of }) shows that block again
// as a view of its own at the card's width (its anchors' ids end in --<its key>), host.rangesOf and host.addMark
// mark the reference while its card is open (the mark's rects place the card) and light it up when Back returns
// to it; its text is read with SVG's text DOM. The one thing it reads that the README does not name is where a
// reference goes: the href the viewer gives its glyphs (data-link-href), "#label" for a label on this page.
//
// What the card shows: the target's block, laid out anew at the card's width, scrolled so that the label's anchor
// stands near the top, with a little of what comes before it (a figure's picture stands above its caption, where
// the label is), and the rest faded out. That is the document itself, numbers and all, whatever the target is. How
// far the target reaches is not known to the page, and the viewer puts an anchor at the top of the run of
// paragraphs its label is in, so the card is a window onto the text at the label rather than the target alone.
//
// Pointer: the card opens 300 ms after the pointer comes to rest on a reference, stays while the pointer is in it,
// and closes a moment after it leaves both. Touch: a tap on a reference opens its card, a second tap follows it,
// a tap elsewhere closes it. Keyboard: the focus on a reference opens its card; Tab moves into it and on through it,
// Escape closes it and puts the focus back on the reference. The card is in the page's colours, so it follows the
// light, dark, sepia and contrast themes (html.dark, .sepia, .contrast), with the site's accent (--lt-primary).
//
// Plain DOM, no imports: like the site's other scripts it is a classic script. Loaded by every page
// (layouts/_default/baseof.html) as static/refcard.js, which build.sh builds from this file.
(() => {
    // ── The viewer's contract (the part of types.ts used here) ──────────────────────────────────────────────────
    interface TextRange { readonly block: string; readonly from: number; readonly to: number; readonly text: string }
    interface LiveMark { readonly live: boolean; rects(): DOMRect[]; remove(): void }
    interface Block {
        readonly el: HTMLElement;
        readonly key: string;
        on(event: 'layout', fn: () => void): () => void;
        unmount(): void;
    }
    interface Host {
        block(el: Element): Block | undefined;
        mount(el: HTMLElement, options?: { of?: Block | Element | string }): Promise<Block>;
        rangesOf(range: Range): TextRange[];
        addMark(ranges: readonly TextRange[], options?: { classes?: string }): LiveMark | null;
    }
    type Page = Window & { reflowtex?: { host?: Host } };

    const OPEN_MS = 300, CLOSE_MS = 250;
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── The look ─────────────────────────────────────────────────────────────────────────────────────────────────
    // A panel a little lighter than the page, opaque; its body, the typeset copy, on the page's own colour. The
    // buttons and the Back pill in the site's accent; their text white, or the page's colour on the dark theme's
    // light accent.
    const STYLE = `
.rc-card {
  position: fixed; z-index: 2147482500; box-sizing: border-box; left: -10000px; top: 0;
  width: min(460px, calc(100vw - 32px));
  border-radius: 12px; overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  color: inherit;
  box-shadow: 0 12px 36px -8px rgb(0 0 0 / .28), 0 2px 6px rgb(0 0 0 / .08);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  outline: none;
}
.rc-card:not(.rc-open) { visibility: hidden; pointer-events: none; }
/* Opaque, a little lighter than the page (WebKit shows the page's text through a translucent card). */
.rc-card { background: color-mix(in srgb, var(--latex-page-bg, Canvas) 45%, #fff); }
html.dark .rc-card { background: color-mix(in srgb, var(--latex-page-bg, Canvas) 91%, #fff); }
html.dark .rc-card { box-shadow: 0 12px 36px -8px rgb(0 0 0 / .7), 0 0 0 1px rgb(255 255 255 / .04); }
html.contrast .rc-card { border: 2px solid #000; box-shadow: none; }
.rc-head { display: flex; align-items: baseline; gap: 8px; padding: 10px 14px 6px; }
.rc-title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-key { margin-left: auto; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 12px/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace; opacity: .66; }
.rc-body { position: relative; box-sizing: border-box; max-height: min(240px, 38vh); overflow: hidden;
  padding: 0 14px 0 18px; background: var(--latex-page-bg, Canvas);
  border-block: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
.rc-body[hidden] { display: none; }
.rc-body.rc-fade-bottom { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent); }
.rc-body.rc-fade-top { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32px);
  mask-image: linear-gradient(to bottom, transparent, #000 32px); }
.rc-body.rc-fade-top.rc-fade-bottom { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 40px), transparent); }
.rc-view { zoom: .85; }
.rc-empty { margin: 4px 14px 8px; opacity: .75; }
.rc-empty[hidden] { display: none; }
.rc-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 14px 10px; }
.rc-go, .rc-back {
  all: unset; box-sizing: border-box; cursor: pointer;
  background: var(--lt-primary, Highlight); color: #fff;
  font: 600 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
html.dark .rc-go, html.dark .rc-back { color: var(--latex-page-bg, #000); }
.rc-go { padding: 5px 12px; border-radius: 8px; }
.rc-go:hover, .rc-back:hover { background: var(--lt-primary-strong, var(--lt-primary, Highlight)); }
.rc-go:focus-visible, .rc-back:focus-visible { outline: 2px solid var(--lt-primary, Highlight); outline-offset: 2px; }
.rc-go[hidden] { display: none; }
.rc-hint { margin-left: auto; font-size: 12px; opacity: .7; }
.rc-back {
  position: fixed; z-index: 2147482400; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom));
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px 9px 12px; border-radius: 999px;
  font-size: 14px; line-height: 1;
  box-shadow: 0 10px 28px -8px rgb(0 0 0 / .35), 0 2px 6px rgb(0 0 0 / .1);
  opacity: 0; transform: translate(-50%, 8px); transition: opacity .2s ease, transform .2s ease;
}
.rc-back.rc-on { opacity: .96; transform: translate(-50%, 0); }
.rc-back[hidden] { display: none; }
.rc-back svg { width: 16px; height: 16px; }
html.contrast .rc-back { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000; }
.latex-block svg rect.latex-mark[data-mark~="rc-ref"] { fill: color-mix(in srgb, var(--lt-primary, Highlight) 10%, transparent); }
html.dark .latex-block svg rect.latex-mark[data-mark~="rc-ref"] { fill: color-mix(in srgb, var(--lt-primary, Highlight) 18%, transparent); }
.latex-block svg rect.latex-mark[data-mark~="rc-flash"] { fill: color-mix(in srgb, var(--lt-primary, Highlight) 22%, transparent); }
@media (prefers-reduced-motion: reduce) { .rc-back { transition: none; } }
@media print { .rc-card, .rc-back { display: none; } }
`;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    // ── References on the page ───────────────────────────────────────────────────────────────────────────────────
    // A reference is the group of glyphs sharing a data-link key; it goes to a label on this page when its href is
    // "#label" and that label's anchor is here.
    interface Ref {
        readonly key: string;                       // its data-link
        readonly label: string;                     // the label it goes to
        readonly cite: boolean;                     // a citation (hyperref's anchor of an entry is cite.<key>)
    }
    const linkOf = (t: EventTarget | null): SVGElement | null =>
        t instanceof Element ? t.closest<SVGElement>('[data-link]') : null;
    const refOf = (t: EventTarget | null): Ref | null => {
        const el = linkOf(t);
        const key = el?.dataset.link, href = el?.dataset.linkHref;
        if (!el || !key || !href || !href.startsWith('#') || href.length < 2 || card.contains(el)) return null;
        let label = href.slice(1);
        try { label = decodeURIComponent(label); } catch { /* as it is */ }
        return { key, label, cite: label.startsWith('cite.') };
    };
    const glyphs = (r: Ref) => [...document.querySelectorAll<SVGGraphicsElement>(`[data-link="${CSS.escape(r.key)}"]`)]
        .filter((g) => !card.contains(g));
    /** The glyph that takes the focus (the viewer gives one glyph of a reference the tab stop). */
    const stop = (r: Ref) => glyphs(r).find((g) => g.hasAttribute('tabindex')) ?? glyphs(r)[0] ?? null;

    /** What the reference prints, with a space wherever its glyphs stand apart (a space is glue, not a glyph):
     *  measured on the glyphs' own text (SVG's text DOM), in the coordinates of the text element they share. */
    function printed(r: Ref): string {
        let out = '', last: { text: Element | null; end: DOMPoint; em: number } | null = null;
        for (const g of glyphs(r)) {
            if (!(g instanceof SVGTextContentElement)) continue;
            const n = g.getNumberOfChars();
            if (!n) continue;
            const text = g.closest('text'), start = g.getStartPositionOfChar(0), em = g.getExtentOfChar(0).height || 1;
            if (last && (last.text !== text || Math.abs(start.y - last.end.y) > 0.5 * em || start.x - last.end.x > 0.18 * Math.max(em, last.em))) out += ' ';
            out += g.textContent ?? '';
            last = { text, end: g.getEndPositionOfChar(n - 1), em };
        }
        return out.replace(/\s+/g, ' ').trim();
    }
    /** "Theorem 3.2" as printed (hyperref's "section 1" as a title: "Section 1"); a bare number "Reference 2";
     *  TeX's ?? (the label was not known where the reference was typeset) "Reference". */
    const titleOf = (r: Ref, text: string) => {
        if (r.cite) return `Citation ${/^[[(]/.test(text) ? text : `[${text}]`}`;
        if (/\p{L}/u.test(text)) return text.charAt(0).toUpperCase() + text.slice(1);
        return /\p{N}/u.test(text) ? `Reference ${text}` : 'Reference';
    };
    /** The reference's first line, as one rect (the card goes below it, or above): from the live mark over it,
     *  which the viewer draws as a band on each of its lines (and which shows which reference the card is of). */
    function rectOf(): DOMRect | null {
        const rs = open?.mark?.live ? open.mark.rects() : [];
        return rs.find((b) => b.width > 0 || b.height > 0) ?? null;
    }
    /** A live mark over the reference's glyphs, one range per glyph (the glyphs of a reference broken across two
     *  lines need not be neighbours in the DOM). */
    function markOf(r: Ref, classes = 'rc-ref'): LiveMark | null {
        if (!host) return null;
        const ranges: TextRange[] = [];
        try {
            for (const g of glyphs(r)) {
                if (!(g instanceof SVGTextContentElement)) continue;
                const range = document.createRange();
                range.selectNodeContents(g);
                ranges.push(...host.rangesOf(range));
            }
            return ranges.length ? host.addMark(ranges, { classes }) : null;
        } catch (e) { console.warn('refcard:', e); return null; }
    }
    /** The label's anchor for a reference drawn in a view of a block: that view's own (its id ends in --<key>). */
    function anchorFor(label: string, from: Element | null): HTMLElement | null {
        const view = from?.closest<HTMLElement>('[data-latex-view]');
        const b = view && host?.block(view);
        return (b && document.getElementById(`${label}--${b.key}`)) || document.getElementById(label);
    }
    /** The block an element is drawn in. */
    function blockOf(el: Element): Block | null {
        for (let n: Element | null = el; n; n = n.parentElement) { const b = host?.block(n); if (b) return b; }
        return null;
    }

    // ── The card ─────────────────────────────────────────────────────────────────────────────────────────────────
    const card = document.createElement('div');
    card.className = 'rc-card';
    card.id = 'rc-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'rc-card-title');
    card.tabIndex = -1;
    card.inert = true;
    card.innerHTML = `<div class="rc-head"><span class="rc-title" id="rc-card-title"></span><code class="rc-key"></code></div>
<div class="rc-body"></div><p class="rc-empty" hidden></p>
<div class="rc-foot"><button type="button" class="rc-go">Go to</button><span class="rc-hint"></span></div>`;
    const $ = <T extends Element>(sel: string) => card.querySelector<T>(sel)!;
    const titleEl = $<HTMLElement>('.rc-title'), keyEl = $<HTMLElement>('.rc-key'), body = $<HTMLElement>('.rc-body');
    const empty = $<HTMLElement>('.rc-empty'), goBtn = $<HTMLButtonElement>('.rc-go');
    const hintEl = $<HTMLElement>('.rc-hint');
    // The copy is the document again: its outline is not the page's (the table of contents listens for it).
    card.addEventListener('reflowtex:outline', (e) => e.stopPropagation());

    // One view at a time, of the block the last target was in, kept for the next card.
    let view: { of: Block; block: Block | null; el: HTMLElement; ready: Promise<Block | null>; off: (() => void) | null } | null = null;
    function viewOf(of: Block) {
        if (view?.of === of) return view;
        dropView();
        const el = document.createElement('div');
        // The block's own options (its data-* attributes: colour map, alignment, the breaker's knobs), but not its
        // compiled data or width: the view takes the data from the block, and its width from the card.
        el.className = 'latex-block rc-view';
        for (const [k, v] of Object.entries(of.el.dataset))
            if (v !== undefined && !/^(nodelistB64|latexWidth|latexView|latexScope)$/.test(k)) el.dataset[k] = v;
        body.append(el);
        const v: NonNullable<typeof view> = { of, block: null, el, off: null, ready: Promise.resolve(null) };
        v.ready = (host ? host.mount(el, { of }) : Promise.reject(new Error('no host'))).then((b) => {
            v.block = b;
            v.off = b.on('layout', () => { if (open && view === v) requestAnimationFrame(scrollToAnchor); });
            return b;
        }, (e: unknown) => { console.warn('refcard:', e); return null; });
        view = v;
        return v;
    }
    function dropView() {
        if (!view) return;
        const v = view;
        view = null;
        v.off?.();
        v.ready.then((b) => { try { b?.unmount(); } catch { /* gone with its block */ } v.el.remove(); });
    }

    let open: { ref: Ref; how: 'pointer' | 'touch' | 'keyboard'; describer: SVGElement | null; mark: LiveMark | null } | null = null;
    let token = 0;

    async function show(ref: Ref, how: 'pointer' | 'touch' | 'keyboard') {
        clearTimeout(openTimer); clearTimeout(closeTimer);
        if (open?.ref.key === ref.key) return;
        hide(false);
        const t = ++token;
        const anchor = anchorFor(ref.label, stop(ref));
        const target = anchor && blockOf(anchor);
        const text = printed(ref);
        titleEl.textContent = titleOf(ref, text);
        keyEl.textContent = ref.cite ? ref.label.slice(5) : ref.label;
        goBtn.textContent = ref.cite ? 'Go to the reference list' : 'Go to';
        goBtn.hidden = !anchor;
        hintEl.textContent = !anchor ? '' : how === 'touch' ? 'Tap again to jump' : how === 'keyboard' ? 'Enter to jump' : 'Click to jump';
        empty.hidden = !!target;
        empty.textContent = anchor ? 'This target cannot be shown here.' : 'The label is not on this page.';
        body.hidden = !target;
        if (target && view && view.of !== target) dropView();
        const v = target ? viewOf(target) : null;
        if (v) for (const el of body.querySelectorAll<HTMLElement>(':scope > .rc-view')) el.hidden = el !== v.el;
        body.classList.remove('rc-fade-top', 'rc-fade-bottom');
        delete body.dataset.at;
        open = { ref, how, describer: stop(ref), mark: markOf(ref) };
        open.describer?.setAttribute('aria-describedby', card.id);
        open.describer?.setAttribute('aria-expanded', 'true');
        card.inert = false;
        card.classList.add('rc-open');
        place();
        if (v) {
            await v.ready;
            if (t !== token) return;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            if (t !== token) return;
            scrollToAnchor();
            place();
        }
    }

    /** The label's anchor a quarter of the way down the body (once there, the body's data-at names the label). */
    function scrollToAnchor() {
        if (!open || !view?.block) return;
        const a = document.getElementById(`${open.ref.label}--${view.block.key}`);
        if (!a) return;
        const top = body.getBoundingClientRect().top + body.clientTop;
        const y = a.getBoundingClientRect().top - top + body.scrollTop;
        const max = body.scrollHeight - body.clientHeight;
        body.scrollTop = Math.max(0, Math.min(max, y - body.clientHeight / 4));
        body.classList.toggle('rc-fade-top', body.scrollTop > 1);
        body.classList.toggle('rc-fade-bottom', body.scrollTop < max - 1);
        body.dataset.at = open.ref.label;
    }

    function hide(focus: boolean) {
        clearTimeout(openTimer); clearTimeout(closeTimer);
        const o = open;
        if (!o) return;
        open = null;
        token++;
        if (o.describer) { o.describer.removeAttribute('aria-describedby'); o.describer.removeAttribute('aria-expanded'); }
        try { o.mark?.remove(); } catch { /* gone with its block */ }
        if (focus && card.contains(document.activeElement)) (stop(o.ref) as SVGElement | null)?.focus({ preventScroll: true });
        card.classList.remove('rc-open');
        card.inert = true;
        card.style.left = '-10000px';
    }

    // Below the reference's first line, from a little before its start; above it when there is no room below and
    // more above. Kept in the window.
    function place() {
        if (!open) return;
        const r = rectOf();
        if (!r) return;
        const w = card.offsetWidth, h = card.offsetHeight, gap = 8, edge = 16;
        const below = innerHeight - r.bottom - gap - 8, above = r.top - gap - 8;
        const top = h <= below || below >= above ? r.bottom + gap : r.top - gap - h;
        card.style.left = `${Math.round(Math.max(edge, Math.min(r.left - 24, innerWidth - w - edge)))}px`;
        card.style.top = `${Math.round(Math.max(8, top))}px`;
    }
    let frame = 0;
    const follow = () => {
        if (!open || frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!open) return;
            const r = rectOf();
            // Scrolled out of the window, or no longer drawn: closed.
            if (!r || r.bottom < 0 || r.top > innerHeight) { hide(false); return; }
            place();
        });
    };
    addEventListener('scroll', (e) => { if (!(e.target instanceof Node && card.contains(e.target))) follow(); }, { passive: true, capture: true });
    addEventListener('resize', follow, { passive: true });

    goBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!open) return;
        const { ref, how } = open;
        hide(false);
        jump(ref.label, ref, how === 'keyboard' || e.detail === 0);
    });

    // ── Opening and closing ──────────────────────────────────────────────────────────────────────────────────────
    let openTimer = 0, closeTimer = 0, pending: string | null = null;
    const later = (ref: Ref, how: 'pointer' | 'keyboard') => {
        clearTimeout(openTimer); clearTimeout(closeTimer);
        pending = ref.key;
        warm(ref);
        openTimer = window.setTimeout(() => { pending = null; void show(ref, how); }, open ? OPEN_MS / 2 : OPEN_MS);
    };
    const closeSoon = () => {
        clearTimeout(openTimer); pending = null;
        if (open && !closeTimer) closeTimer = window.setTimeout(() => { closeTimer = 0; if (!card.contains(document.activeElement)) hide(false); }, CLOSE_MS);
    };
    /** The view is made as soon as a reference is pointed at, so that the card has it when it opens. */
    function warm(ref: Ref) {
        const a = anchorFor(ref.label, stop(ref)), b = a && blockOf(a);
        if (b && host) viewOf(b);
    }

    document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        if (e.target instanceof Node && card.contains(e.target)) { clearTimeout(closeTimer); closeTimer = 0; return; }
        const ref = refOf(e.target);
        if (ref) {
            clearTimeout(closeTimer); closeTimer = 0;
            if (open?.ref.key !== ref.key && pending !== ref.key) later(ref, 'pointer');
            return;
        }
        if (pending) { clearTimeout(openTimer); pending = null; }
        if (open && open.how === 'pointer') closeSoon();
    }, { passive: true });

    document.addEventListener('focusin', (e) => {
        if (e.target instanceof Node && card.contains(e.target)) { clearTimeout(closeTimer); closeTimer = 0; return; }
        const ref = refOf(e.target);
        if (ref) {
            if (open?.ref.key === ref.key) { clearTimeout(closeTimer); closeTimer = 0; return; }
            if (suppressed === ref.key) return;
            later(ref, 'keyboard');
            return;
        }
        if (open) hide(false);
    });
    document.addEventListener('focusout', (e) => {
        if (refOf(e.target) && suppressed === refOf(e.target)?.key) suppressed = null;
        if (pending && refOf(e.target)?.key === pending) { clearTimeout(openTimer); pending = null; }
    });

    // A press outside the card and the reference closes it; a tap on a reference opens its card (a second tap
    // follows the reference).
    let tapped: string | null = null;
    document.addEventListener('pointerdown', (e) => {
        tapped = e.pointerType === 'touch' || e.pointerType === 'pen' ? refOf(e.target)?.key ?? null : null;
        if (!open || !(e.target instanceof Node) || card.contains(e.target)) return;
        if (refOf(e.target)?.key !== open.ref.key) hide(false);
    }, true);

    // Clicks: before the viewer's own handler (on document), so that a tap can open the card instead, and so that
    // a jump is known for Back.
    addEventListener('click', (e) => {
        const inCard = e.target instanceof Node && card.contains(e.target);
        const link = linkOf(e.target);
        if (inCard) {
            // A link in the copy: a reference goes to its target in the page (not in the copy); an address opens
            // in a new tab, so that the page stays.
            const href = link?.dataset.linkHref;
            if (!link || !href || link.dataset.linkAction) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const from = open?.ref ?? null;
            hide(false);
            if (href.startsWith('#')) {
                let label = href.slice(1);
                try { label = decodeURIComponent(label); } catch { /* as it is */ }
                jump(label, from, e.detail === 0);
            } else window.open(href, '_blank', 'noopener');
            return;
        }
        const ref = refOf(e.target);
        const tap = tapped;
        tapped = null;
        if (!ref) return;
        if (tap === ref.key && open?.ref.key !== ref.key) {
            e.preventDefault(); e.stopImmediatePropagation();
            void show(ref, 'touch');
            return;
        }
        // The viewer follows it: remember where from.
        hide(false);
        if (anchorFor(ref.label, stop(ref))) remember(ref, e.detail === 0);
    }, true);

    // Keys: Escape closes; Tab goes from the reference into its card and on through it; Back.
    let suppressed: string | null = null;            // a reference the focus came back to from its card: no card again
    const tabbable = (root: ParentNode) => [...root.querySelectorAll<HTMLElement | SVGElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]')]
        .filter((el) => el.tabIndex >= 0 && !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open) {
            e.preventDefault();
            const ref = open.ref, inside = card.contains(document.activeElement);
            hide(false);
            if (inside) { suppressed = ref.key; (stop(ref) as SVGElement | null)?.focus({ preventScroll: true }); }
            return;
        }
        if (e.key === 'Tab' && open && !e.altKey && !e.ctrlKey && !e.metaKey) {
            const a = document.activeElement, items = tabbable(card), ref = open.ref;
            const onRef = !!a && refOf(a)?.key === ref.key;
            const i = a instanceof HTMLElement || a instanceof SVGElement ? items.indexOf(a) : -1;
            if (onRef && !e.shiftKey && items.length) { e.preventDefault(); items[0].focus(); return; }
            if (i === 0 && e.shiftKey) { e.preventDefault(); suppressed = ref.key; (stop(ref) as SVGElement | null)?.focus(); return; }
            if (i >= 0 && i === items.length - 1 && !e.shiftKey) {
                // Out of the card: on to what follows the reference in the page.
                e.preventDefault();
                const from = stop(ref);
                hide(false);
                const next = from && tabbable(document).find((el) => !card.contains(el) && !!(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && refOf(el)?.key !== ref.key);
                if (next) next.focus(); else { suppressed = ref.key; (from as SVGElement | null)?.focus(); }
                return;
            }
        }
        const field = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        if (!field && history_.length && ((e.altKey && e.key === 'ArrowLeft') || ((e.metaKey || e.ctrlKey) && e.key === '['))) {
            e.preventDefault();
            back(true);
        }
    }, true);
    card.addEventListener('pointerleave', () => { if (open?.how === 'pointer' && !card.contains(document.activeElement)) closeSoon(); });
    card.addEventListener('pointerenter', () => { clearTimeout(closeTimer); closeTimer = 0; });
    card.addEventListener('focusout', (e) => {
        if (!open || (e.relatedTarget instanceof Node && card.contains(e.relatedTarget))) return;
        if (refOf(e.relatedTarget)?.key === open.ref.key) return;
        if (e.relatedTarget === null && open.how === 'pointer') return;   // a press on the page around: pointerdown decides
        hide(false);
    });

    // ── Jumping and coming back ──────────────────────────────────────────────────────────────────────────────────
    // Each jump made from a reference remembers where the window was, and the reference; Back returns there and
    // lights the reference up. The pill shows while there is somewhere to go back to, and goes once you have
    // scrolled two screens from where the jump landed.
    interface Stop { y: number; url: string; to: string; ref: Ref | null; keyboard: boolean }
    const history_: Stop[] = [];
    let landed: number | null = null, settle = 0;

    function remember(ref: Ref | null, keyboard: boolean) {
        history_.push({ y: scrollY, url: location.href, to: '', ref, keyboard });
        if (history_.length > 20) history_.shift();
        landed = null;
        // The address the jump leaves in the bar, once the viewer (or this) has set it.
        setTimeout(() => { const s = history_[history_.length - 1]; if (s && !s.to) s.to = location.href; }, 0);
        pill.show();
    }
    function jump(label: string, from: Ref | null, keyboard: boolean) {
        const a = from ? anchorFor(label, stop(from)) : document.getElementById(label);
        if (!a) return;
        remember(from, keyboard);
        a.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        history.pushState(null, '', `#${label}`);
        if (keyboard) {
            // The focus goes with the reader: to the place jumped to, the next tab stop after the anchor.
            const next = tabbable(document).find((el) => !card.contains(el) && !!(a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
            next?.focus({ preventScroll: true });
        }
    }
    function back(keyboard: boolean) {
        const s = history_.pop();
        if (!s) return;
        hide(false);
        landed = null;
        if (!history_.length) pill.hide();
        if (location.href !== s.url) history.replaceState(null, '', s.url);
        scrollTo({ top: s.y, behavior: reduced() ? 'auto' : 'smooth' });
        const ref = s.ref;
        if (!ref) return;
        if (keyboard || s.keyboard) { suppressed = ref.key; (stop(ref) as SVGElement | null)?.focus({ preventScroll: true }); }
        // A moment's highlight on the reference: a live mark over its glyphs.
        const mark = markOf(ref, 'rc-flash');
        if (mark) setTimeout(() => mark.remove(), 1200);
    }
    // The browser's own Back to where a jump came from: that stop is used up.
    addEventListener('popstate', () => {
        const s = history_[history_.length - 1];
        if (s && location.href === s.url) { history_.pop(); if (!history_.length) pill.hide(); }
    });
    addEventListener('scroll', () => {
        if (!history_.length) return;
        clearTimeout(settle);
        settle = window.setTimeout(() => {
            if (!history_.length) return;
            if (landed === null) { landed = scrollY; return; }
            if (Math.abs(scrollY - landed) > 2 * innerHeight) { history_.length = 0; pill.hide(); }
        }, 160);
    }, { passive: true });

    const pill = (() => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rc-back';
        b.hidden = true;
        b.title = `Back to where you were (${MAC ? '⌘[' : 'Alt+←'})`;
        b.setAttribute('aria-label', 'Back to where you were');
        // Lucide's arrow-left (ISC licence).
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg><span>Back</span>';
        b.addEventListener('click', (e) => { e.preventDefault(); back(e.detail === 0); });
        let t = 0;
        return {
            el: b,
            show() { clearTimeout(t); b.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('rc-on'))); },
            hide() {
                b.classList.remove('rc-on');
                clearTimeout(t);
                t = window.setTimeout(() => { if (!b.classList.contains('rc-on')) b.hidden = true; }, 220);
            },
        };
    })();

    // ── Start ────────────────────────────────────────────────────────────────────────────────────────────────────
    let host: Host | null = null;
    const start = (h: Host) => { host = h; };
    const attach = () => document.body.append(card, pill.el);
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
    const page = window as Page;
    if (page.reflowtex?.host) start(page.reflowtex.host);
    else document.addEventListener('reflowtex:host', (e) => start((e as CustomEvent<{ host: Host }>).detail.host), { once: true });
})();
