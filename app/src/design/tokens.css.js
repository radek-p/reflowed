// CSS as a string module: the builds need no CSS loader. Edit the CSS between the backticks.
export default `
/* The editor's design tokens. Every control size, font size, radius,
   border, tint, shadow and motion the chrome uses comes from here; the kit
   (ui.css, ui/*.js) is built only from these. GUIDE.md says how to use them.

   Colours: the theme tokens' (design/theme.ts): one source, the JSON
   themes; borders and tints mix currentColor, as the website's example
   frames do, so they follow whatever ink they sit on. */
:root {
  /* ── type: one scale, px (the chrome's body is 13; 16 for touch inputs) ── */
  --ui-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --ui-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ui-text-xs: 11px;    /* captions, counts, uppercase labels */
  --ui-text-sm: 12px;    /* hints, secondary lines, small buttons */
  --ui-text-md: 13px;    /* controls, menus, the sidebar: the default */
  --ui-text-lg: 14px;    /* dialog body, the document title */
  --ui-text-xl: 16px;    /* dialog titles; every input on touch (iOS zooms below 16) */
  --ui-text-2xl: 20px;
  --ui-text-3xl: 28px;   /* the home screen's heading */
  --ui-leading: 1.4;
  --ui-leading-tight: 1.2;
  --ui-medium: 500;
  --ui-semibold: 600;
  --ui-caps-track: 0.08em;   /* small uppercase labels (the website's tabs) */

  /* ── sizes: three control heights; 44 on touch (the media query below) ── */
  --ui-h-sm: 24px;
  --ui-h-md: 28px;
  --ui-h-lg: 32px;
  --ui-touch: 44px;
  --ui-icon-xs: 12px;
  --ui-icon-sm: 14px;
  --ui-icon-md: 16px;
  --ui-icon-lg: 20px;

  /* ── space: a 4 px grid ── */
  --ui-1: 4px;
  --ui-2: 8px;
  --ui-3: 12px;
  --ui-4: 16px;
  --ui-5: 20px;
  --ui-6: 24px;
  --ui-8: 32px;
  --ui-10: 40px;

  /* ── radii: controls 6, popovers and menus 8, cards and dialogs 12 ── */
  --ui-r-sm: 6px;
  --ui-r-md: 8px;
  --ui-r-lg: 12px;
  --ui-r-pill: 999px;

  /* ── colour: none here: the kit's --ui-* colours are aliases of the theme tokens (design/theme.ts, the
     JSON themes: workbench/src/themes.ts); the derived ones (--ui-ink-2, --ui-hover …) the tokens' mixes ── */

  /* ── elevation ── */
  --ui-shadow-sm: 0 1px 2px color-mix(in srgb, #000 8%, transparent);
  --ui-shadow-pop: 0 0 0 0.5px color-mix(in srgb, #000 10%, transparent), 0 4px 12px color-mix(in srgb, #000 10%, transparent), 0 12px 32px color-mix(in srgb, #000 10%, transparent);
  --ui-shadow-dialog: 0 0 0 0.5px color-mix(in srgb, #000 10%, transparent), 0 8px 24px color-mix(in srgb, #000 12%, transparent), 0 24px 64px color-mix(in srgb, #000 14%, transparent);

  /* ── surfaces: THE side sheet's width (the title form's) ── */
  /* responsive: 600 px at a 1280 px window (as before), growing with it to 820 px (from about 1830 px), not
     below 480 px; full width on phones (below) */
  --ui-sheet-w: clamp(480px, calc(40vw + 88px), 820px);

  /* ── stacking: the one overlay layer (ui/layers.js) adds a layer's place in its tier; the page's own chrome
     (top bar 20, sidebar 30, drop lines 40) stays below every tier; native modal dialogs are in the top layer ── */
  --ui-z-pill: 45;      /* the Back pill */
  --ui-z-drag: 48;      /* a dragged block's preview and its drop line (docview/drag.ts): above the workbench, below menus */
  --ui-z-float: 50;     /* menus, popovers, the reference card */
  --ui-z-toast: 80;     /* toasts */
  --ui-z-tip: 90;       /* tooltips */

  /* ── focus: one ring, keyboard only (:focus-visible) ── */
  /* the ring's colour: the focus token (--rfed-focus, solid: a mix fell to 2.3:1 on light grounds; 3:1 needed) */
  --ui-ring: 0 0 0 2px var(--ui-ring-color);
  --ui-ring-offset: 1px;

  /* ── motion ── */
  --ui-fast: 120ms;
  --ui-mid: 180ms;
  --ui-slow: 260ms;
  --ui-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --ui-ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* ── the control each size maps to (the kit reads these) ── */
  --ui-ctl-sm: var(--ui-h-sm);
  --ui-ctl-md: var(--ui-h-md);
  --ui-ctl-lg: var(--ui-h-lg);
  --ui-row: var(--ui-h-md);          /* menu items, list rows (minimum) */
  --ui-input-text: var(--ui-text-md);
}
html.dark {
  --ui-shadow-pop: 0 0 0 0.5px color-mix(in srgb, #fff 12%, transparent), 0 4px 12px color-mix(in srgb, #000 40%, transparent), 0 12px 32px color-mix(in srgb, #000 50%, transparent);
  --ui-shadow-dialog: 0 0 0 0.5px color-mix(in srgb, #fff 12%, transparent), 0 8px 24px color-mix(in srgb, #000 45%, transparent), 0 24px 64px color-mix(in srgb, #000 55%, transparent);
}
html.contrast {
  --ui-shadow-pop: 0 0 0 1.5px #000, 0 6px 18px rgba(0, 0, 0, 0.2);
  --ui-shadow-dialog: 0 0 0 1.5px #000, 0 6px 18px rgba(0, 0, 0, 0.2);
  --ui-ring: 0 0 0 2px #0040c0;
}
/* phones: the sheet is the whole width */
@media (max-width: 640px) { :root { --ui-sheet-w: 100vw; } }
/* touch: every hit target 44 px, inputs 16 px (no zoom on focus) */
@media (pointer: coarse) {
  :root {
    --ui-ctl-sm: var(--ui-touch);
    --ui-ctl-md: var(--ui-touch);
    --ui-ctl-lg: var(--ui-touch);
    --ui-row: var(--ui-touch);
    --ui-input-text: var(--ui-text-xl);
  }
}
@media (prefers-reduced-motion: reduce) {
  :root { --ui-fast: 0ms; --ui-mid: 0ms; --ui-slow: 0ms; }
}
`;
