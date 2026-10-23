// SPDX-License-Identifier: AGPL-3.0-or-later
// The screenshots in a typeset picture (an SVG <image> the viewer draws for an \includegraphics of a bitmap), with
// rounded corners and a soft shadow, the same as the shot shortcode's <img> on the feature pages.
//
// A picture's <image> sits under the viewer's transforms, so its user units are not CSS pixels: a corner radius or a
// blur written in them would grow and shrink with the reading width. This script measures each image's scale on
// screen (getScreenCTM) and gives it, in its own units:
// - a clip-path, inset(0 round r), r the site's --lt-shot-radius (the header icon's corner, head.html);
// - on its picture group, a shadow filter made for that scale (feDropShadow, in partials/shot-shadow.html's <defs>),
//   applied outside the clip, so the shadow follows the rounded shape.
// The shadow's colours are CSS on the filter's primitives, per theme (head.html); the contrast theme has none.
// It runs as pictures are drawn (a MutationObserver), and again when the window or the text size changes.
// Loaded by every page (layouts/_default/baseof.html) as static/shots.js, which build.sh builds from this file.
(() => {
    const SVG = 'http://www.w3.org/2000/svg';
    // The shadow in CSS pixels: a large soft one, a close contact one, and a glow (the dark theme's).
    const SHADOWS = [
        { cls: 'lt-shot-far', dy: 8, blur: 13 },
        { cls: 'lt-shot-near', dy: 1, blur: 1.5 },
        { cls: 'lt-shot-glow', dy: 0, blur: 13 },
    ];
    const made = new Set<string>();

    /** The corner radius in CSS pixels, from --lt-shot-radius (a length head.html computes). */
    let probe: HTMLElement | null = null;
    const radius = (): number => {
        if (!probe) {
            probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--lt-shot-radius,6px);height:0';
            document.body.appendChild(probe);
        }
        return probe.getBoundingClientRect().width || 6;
    };

    /** A shadow filter for pictures drawn at `scale` screen pixels per user unit (one per 1% of scale). */
    const filterFor = (scale: number): string | null => {
        const defs = document.getElementById('lt-shot-defs');
        if (!defs) return null;
        const key = Math.max(1, Math.round(scale * 100));
        const id = `lt-shot-${key}`;
        if (!made.has(id)) {
            const k = key / 100;
            const f = document.createElementNS(SVG, 'filter');
            f.id = id;
            // the region reaches half the image past each edge: the blur and the glow (three standard deviations, up to
            // 47 px) fit even round a phone-sized screenshot, above it as well as below
            for (const [a, v] of [['x', '-50%'], ['y', '-50%'], ['width', '200%'], ['height', '200%'],
                ['color-interpolation-filters', 'sRGB']]) f.setAttribute(a, v);
            for (const s of SHADOWS) {
                const d = document.createElementNS(SVG, 'feDropShadow');
                d.setAttribute('class', s.cls);
                d.setAttribute('dx', '0');
                d.setAttribute('dy', String(s.dy / k));
                d.setAttribute('stdDeviation', String(s.blur / k));
                f.appendChild(d);
            }
            defs.appendChild(f);
            made.add(id);
        }
        return `url(#${id})`;
    };

    const fit = (image: SVGImageElement) => {
        const group = image.closest('.latex-picture');
        const m = image.getScreenCTM();
        if (!group || !m) return;
        const scale = Math.hypot(m.a, m.b);
        if (!(scale > 0)) return;
        // (written only when they change: the observer below sees style changes)
        const clip = `inset(0 round ${(radius() / scale).toFixed(2)}px)`;
        if (image.style.clipPath !== clip) image.style.clipPath = clip;
        const filter = filterFor(scale);
        if (filter && group instanceof SVGElement) {
            if (!group.classList.contains('lt-shot')) group.classList.add('lt-shot');
            if (group.style.filter !== filter) group.style.filter = filter;
        }
    };

    let queued = false;
    const all = () => {
        queued = false;
        for (const image of document.querySelectorAll<SVGImageElement>('.latex-picture image')) fit(image);
    };
    const later = () => { if (!queued) { queued = true; requestAnimationFrame(all); } };

    new MutationObserver((records) => {
        for (const r of records) {
            if (r.type === 'attributes' || [...r.addedNodes].some((n) => n instanceof Element)) { later(); return; }
        }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['transform', 'style', 'class'] });
    addEventListener('resize', later);
    later();
})();
