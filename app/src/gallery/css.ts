// The gallery page's own CSS: on the theme tokens (--rfed-*) and the kit's metrics (--ui-*); no literal colour.
export const GALLERY_CSS = String.raw`
html, body { background: var(--rfed-page); color: var(--rfed-ink); }
body { font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); }
.gal-head { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--rfed-page) 88%, transparent);
  -webkit-backdrop-filter: saturate(1.6) blur(16px); backdrop-filter: saturate(1.6) blur(16px); box-shadow: inset 0 -1px 0 var(--rfed-border); }
html.contrast .gal-head { background: var(--rfed-page); -webkit-backdrop-filter: none; backdrop-filter: none; }
.gal-head-in { max-width: 1240px; margin: 0 auto; padding: var(--ui-2) var(--ui-4); display: flex; align-items: center; gap: var(--ui-4); flex-wrap: wrap; }
.gal-title { font-size: var(--ui-text-lg); font-weight: var(--ui-semibold); margin: 0; }
.gal-nav { display: flex; gap: var(--ui-3); flex-wrap: wrap; flex: 1 1 auto; font-size: var(--ui-text-sm); }
.gal-nav a { color: var(--rfed-ink-2); text-decoration: none; }
.gal-nav a:hover { color: var(--rfed-ink); text-decoration: underline; }
.gal { max-width: 1240px; margin: 0 auto; padding: var(--ui-5) var(--ui-4) 120px; }
.gal-sec { margin: 0 0 56px; scroll-margin-top: 64px; }
.gal-h2 { font-size: 22px; font-weight: var(--ui-semibold); margin: 0 0 var(--ui-1); letter-spacing: -0.01em; }
.gal-lead { color: var(--rfed-ink-2); margin: 0 0 var(--ui-5); max-width: 72ch; }
.gal-group { margin: 0 0 var(--ui-6); }
.gal-h3 { font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); letter-spacing: var(--ui-caps-track, 0.06em); text-transform: uppercase;
  color: var(--rfed-ink-3); margin: 0 0 var(--ui-2); }
.gal-note { color: var(--rfed-ink-3); font-size: var(--ui-text-sm); margin: 0 0 var(--ui-3); max-width: 80ch; }
.gal-row { display: flex; gap: var(--ui-4); align-items: flex-start; padding: var(--ui-2) 0; border-top: 1px solid var(--rfed-border-soft, var(--rfed-border)); }
.gal-label { flex: 0 0 96px; color: var(--rfed-ink-3); font-size: var(--ui-text-sm); line-height: 28px; }
.gal-items { display: flex; flex-wrap: wrap; gap: var(--ui-2); align-items: center; min-width: 0; flex: 1 1 auto; }
.gal-icon { display: inline-grid; place-items: center; width: 28px; height: 28px; color: var(--rfed-ink-2); }
/* the icon catalogue: number, the icon at 16, 20 and 32 px, its name */
.gal-icons { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--ui-2); width: 100%; }
.gal-ic { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: var(--ui-2); align-items: center; padding: var(--ui-2); border: 1px solid var(--rfed-border-soft, var(--rfed-border)); border-radius: var(--ui-r-md); color: var(--rfed-ink); }
.gal-ic-n { grid-row: 1 / 3; align-self: start; min-width: 2ch; color: var(--rfed-ink-3); font-size: var(--ui-text-sm); font-variant-numeric: tabular-nums; }
.gal-ic-row { display: flex; gap: var(--ui-3); align-items: center; }
.gal-ic .gal-ic-16 { width: 16px; height: 16px; } .gal-ic .gal-ic-20 { width: 20px; height: 20px; } .gal-ic .gal-ic-32 { width: 32px; height: 32px; }
.gal-ic-name { font-size: var(--ui-text-sm); color: var(--rfed-ink-2); overflow-wrap: anywhere; }
.gal-tex { font: 17px/1.5 "Latin Modern Roman", "Times New Roman", serif; margin: 0; }
.gal-gap { height: var(--ui-3); }
.gal-toasts { display: flex; gap: var(--ui-3); flex-wrap: wrap; }
.gal-toasts .ui-toast { position: static; }
.gal-menu-box { position: relative; }
.gal-cap { font-size: var(--ui-text-sm); color: var(--rfed-ink-3); margin-bottom: var(--ui-2); }
.gal-pop-space { height: 84px; width: 1px; }
.gal-static { position: static !important; animation: none !important; }
.gal-inplace dialog.ui-dialog { position: static; margin: 0; }
.gal-cells { display: flex; flex-wrap: wrap; gap: var(--ui-5); align-items: flex-end; }
.gal-cells--top { align-items: flex-start; }
.gal-stack { display: grid; gap: var(--ui-3); }
.gal-cell { margin: 0; display: flex; flex-direction: column; gap: var(--ui-2); min-width: 0; }
.gal-cell--wide { width: 100%; }
.gal-cell figcaption { font-size: var(--ui-text-xs); color: var(--rfed-ink-3); }
.gal-cell-body { display: flex; align-items: center; min-height: 24px; }
.gal-chip { display: inline-block; }
.gal-find .find-bar { max-width: 760px; margin: 0; box-shadow: 0 0 0 1px var(--rfed-border); border-radius: var(--ui-r-md); }
.gal-card { width: 400px; }
.gal-errors { width: 460px; }
.gal-sheet { position: static !important; inset: auto; width: min(var(--ui-sheet-w, 440px), 100%); height: 620px; max-height: none; box-shadow: 0 0 0 1px var(--rfed-border); border-radius: var(--ui-r-lg); }
.gal-editor { position: relative; overflow: hidden; border-radius: var(--ui-r-lg); box-shadow: 0 0 0 1px var(--rfed-border); background: var(--rfed-page); }
.gal-editor--main { height: 640px; }
.gal-editor--code { width: 720px; height: 560px; }
.gal-editor--narrow { width: 480px; height: 560px; }
.gal-panel { width: 260px; height: 380px; flex: none; box-shadow: 0 0 0 1px var(--rfed-border); border-radius: var(--ui-r-md); padding-top: var(--ui-2); }
.gal-vp { width: 340px; }
.gal-wb { display: grid; gap: var(--ui-4); }
.gal-wb .gal-group { margin: 0; }
.gal-wb-bar { display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 6px; --wb-btn-h: 32px; box-shadow: inset 0 -1px 0 var(--rfed-top-bar-border); }
.gal-wb-row { display: flex; gap: var(--ui-4); align-items: flex-start; flex-wrap: wrap; }
.gal-wb-row--far { gap: 160px; }
.gal-wb-pop { position: static; box-shadow: var(--ui-shadow-pop); border-radius: var(--ui-r-md); background: var(--rfed-surface); }
.gal-wb-pop-room { margin-bottom: 96px; }
.gal-wb-host { position: relative; height: 160px; border-radius: var(--ui-r-lg); overflow: hidden; box-shadow: 0 0 0 1px var(--rfed-border); }
.gal-wb-host > .wb-root { position: absolute; inset: 0; }
.gal-wb-doc { padding: var(--wb-inset-top, 0px) var(--ui-5) 0; color: var(--rfed-ink-2); }
.gal-failed { color: var(--rfed-danger); padding: var(--ui-4); white-space: pre-wrap; }
@media (max-width: 640px) { .gal-row { flex-direction: column; gap: var(--ui-1); } .gal-label { line-height: 1.4; } .gal-editor--code, .gal-editor--narrow { width: 100%; } }
`;
