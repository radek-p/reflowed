// the CSS of reference navigation, injected once (no stylesheet for the
// builds to carry). On the kit's tokens.
const CSS = String.raw`
.latex-block svg .rn-ref { cursor: pointer; }
.latex-block svg .rn-ref.rn-hot { fill: var(--latex-link-hover, var(--ui-accent)) !important; }
.latex-block svg .rn-ref:focus { outline: none; }
/* the hovered reference's live mark (units.js markUnit): the viewer's band on each of its lines */
.latex-block svg rect.latex-mark[data-mark~="rn-hot"] { fill: color-mix(in srgb, var(--ui-accent) 10%, transparent); }
html.dark .latex-block svg rect.latex-mark[data-mark~="rn-hot"] { fill: color-mix(in srgb, var(--ui-accent) 18%, transparent); }
.latex-block svg .rn-ref:focus-visible { fill: var(--ui-accent) !important; text-decoration: underline; }
.latex-block svg .rn-ref.rn-flash { fill: var(--ui-accent) !important; transition: fill 0.3s; }

.rn-card { position: fixed; box-sizing: border-box; max-width: calc(100vw - 32px);
  background: var(--ui-surface); color: var(--ui-ink); border-radius: var(--ui-r-lg); box-shadow: var(--ui-shadow-pop);
  font: var(--ui-text-md)/var(--ui-leading) var(--ui-font); overflow: hidden; }
.rn-card[hidden] { display: none; }
.rn-head { display: flex; align-items: baseline; gap: var(--ui-2); padding: var(--ui-3) var(--ui-3) var(--ui-1); }
.rn-title { font-weight: var(--ui-semibold); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rn-key { margin-left: auto; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: var(--ui-text-xs) var(--ui-mono); color: var(--ui-ink-3); }
.rn-body { position: relative; max-height: 240px; overflow: hidden; padding: 2px var(--ui-3) var(--ui-1); background: var(--latex-page-bg, var(--ui-page)); }
.rn-body > .latex-block { zoom: calc(var(--rtx-view-zoom, var(--rtx-zoom, 1)) * 0.82); }
.rn-body.rn-clipped { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 44px), transparent); }
.rn-body.rn-clipped.rn-clipped-top { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 36px, #000 calc(100% - 44px), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 36px, #000 calc(100% - 44px), transparent); }
.rn-body .rn-empty { margin: var(--ui-1) 0 var(--ui-2); color: var(--ui-ink-3); }
.rn-body .rn-source { margin: var(--ui-1) 0 var(--ui-2); font: var(--ui-text-sm)/1.45 var(--ui-mono); white-space: pre-wrap; color: var(--ui-ink); }
/* a citation's entries */
.rn-body.rn-cite { background: none; max-height: 280px; overflow: auto; padding: var(--ui-1) var(--ui-3) var(--ui-2); }
.rn-entries { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-2); }
.rn-entry { display: grid; gap: 2px; font-size: var(--ui-text-sm); line-height: 1.4; }
.rn-entry + .rn-entry { padding-top: var(--ui-2); border-top: 1px solid var(--ui-border-soft); }
.rn-eline { display: flex; align-items: baseline; gap: var(--ui-2); min-width: 0; }
.rn-label { font-size: var(--ui-text-xs); font-weight: var(--ui-semibold); color: color-mix(in srgb, var(--ui-ink) 74%, var(--ui-surface)); }
.rn-ekey { font: var(--ui-text-xs) var(--ui-mono); color: var(--ui-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rn-authors { color: color-mix(in srgb, var(--ui-ink) 80%, var(--ui-surface)); }
.rn-etitle { font-weight: var(--ui-semibold); color: var(--ui-ink); }
.rn-meta { color: color-mix(in srgb, var(--ui-ink) 74%, var(--ui-surface)); }
.rn-meta .rn-venue { font-style: italic; }
.rn-doi { color: color-mix(in srgb, var(--ui-accent) 78%, var(--ui-ink)); /* the accent, darkened (lightened in dark) to 4.5:1 */ text-decoration: none; overflow-wrap: anywhere; justify-self: start; }
.rn-doi:hover, .rn-doi:focus-visible { text-decoration: underline; }
.rn-foot { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ui-2); padding: var(--ui-2) var(--ui-3); border-top: 1px solid var(--ui-border-soft); }
.rn-hint { margin-left: auto; font-size: var(--ui-text-xs); color: var(--ui-ink-3); }

/* the Back pill: the kit's lg pill button, in the toast's colours */
.rn-back.ui-btn { position: fixed; left: 50%; bottom: var(--ui-5); transform: translate(-50%, 8px); opacity: 0;
  border-color: transparent; background: var(--toast-bg, color-mix(in srgb, var(--ui-ink) 94%, transparent)); color: var(--toast-text, var(--ui-page));
  box-shadow: var(--ui-shadow-pop); transition: opacity var(--ui-mid) var(--ui-ease), transform var(--ui-mid) var(--ui-ease); }
.rn-back.ui-btn.rn-on { opacity: 0.94; transform: translate(-50%, 0); }
.rn-back.ui-btn:hover { opacity: 1; background: var(--toast-bg, color-mix(in srgb, var(--ui-ink) 94%, transparent)); border-color: transparent; }
.rn-back[hidden] { display: none; }

@keyframes rn-pulse { 0% { box-shadow: 0 0 0 0 transparent; background-color: transparent; }
  15% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ui-accent) 18%, transparent); background-color: color-mix(in srgb, var(--ui-accent) 7%, transparent); }
  100% { box-shadow: 0 0 0 10px transparent; background-color: transparent; } }
.rn-pulse { animation: rn-pulse 1.2s ease-out; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  .rn-back { transition: none; }
  .rn-pulse { animation-duration: 1.2s; animation-name: rn-pulse-still; }
  @keyframes rn-pulse-still { 0%, 70% { background-color: color-mix(in srgb, var(--ui-accent) 8%, transparent); } 100% { background-color: transparent; } }
}
`;

let done = false;
export function installStyle() {
  if (done) return;
  done = true;
  const s = document.createElement('style');
  s.id = 'rtx-refnav-style';
  s.textContent = CSS;
  document.head.append(s);
}
