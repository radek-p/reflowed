// The page's loading, on the app's side: the UI of the one loading status (loading/status.ts filesStatus(): every
// fetch from the release's tree and the TeX tree lands there) and the boot loader's hand-off (loading/page-loader.ts,
// the multi-file release only; elsewhere bootHandoff() is null and those calls do nothing).
//   bootShown()        the UI is on screen (wb/host.ts): the loader's overlay fades out on the next frame
//   bootFailed(msg)    the app could not start (main.js): the overlay says so instead of covering the message
//   <LoadStatus />     the status line's part (wb/host.ts SideStatus): a thin accent line along the status line's top edge
//                      while something loads: the release's files still coming after the UI (the overlay's bar, moved
//                      there: determinate, by bytes), or files the engine is fetching from the TeX tree (a package a
//                      document needs: indeterminate, the ls-R index gives no sizes; their names in the tooltip); red,
//                      with the reasons in its tooltip, when a file of either could not be loaded. It comes in after
//                      150 ms (a quick fetch shows nothing: no flash) and fades out when all is in. It takes no room in
//                      the line (the column is narrow: the version pill and the word count fill it), so nothing moves.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { filesStatus, bootHandoff, percent } from '../../../loading/status.ts';

export function bootShown() {
  const b = bootHandoff();
  if (b) requestAnimationFrame(() => b.shown());
}
export function bootFailed(message: string) { bootHandoff()?.failed(message); }

const CSS = `
.wb-side-status { position: relative; }
.rtx-load-status { position: absolute; left: 0; right: 0; top: 0; height: 2px; }
.rtx-load-status-in { display: block; height: 100%; overflow: hidden; background: color-mix(in srgb, var(--rfed-accent) 18%, transparent);
  animation: rtx-load-in var(--ui-mid) var(--ui-ease-out) 150ms both; }
.rtx-load-status-fill { display: block; height: 100%; transform-origin: left; background: var(--rfed-accent);
  transition: transform var(--ui-fast) linear; }
.rtx-load-status[data-load-kind="tex"] .rtx-load-status-fill { width: 30%; animation: rtx-load-slide 1.2s var(--ui-ease) infinite; }
.rtx-load-status[data-failed] .rtx-load-status-in { background: var(--rfed-danger); }
@keyframes rtx-load-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes rtx-load-slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .rtx-load-status[data-load-kind="tex"] .rtx-load-status-fill { animation: none; width: 100%; opacity: .5; } }
`;
let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'rtx-load-status-css';
  s.textContent = CSS;
  document.head.append(s);
}

type View = { restBusy: boolean; rest: number; tex: string[]; fails: { name: string; reason: string }[]; active: boolean };
function read(): View {
  const s = filesStatus();
  const restBusy = s.busy('rest'), tex = s.loading('tex'), fails = s.failures();
  return { restBusy, rest: s.fraction('rest'), tex, fails, active: restBusy || tex.length > 0 || fails.length > 0 };
}

export function LoadStatus() {
  const [v, setV] = useState(read);
  const [present, setPresent] = useState(v.active);
  const el = useRef<HTMLElement>(null);
  useEffect(() => filesStatus().subscribe(() => setV(read())), []);
  useEffect(() => { if (v.active) setPresent(true); }, [v.active]);
  const leaving = present && !v.active;
  // it fades out (the kit's slow duration: 0 with reduced motion), then is gone; an animation, not a transition: one
  // ends even when it starts in the frame the element came (WebKit ran no transition then, and the line stayed)
  useEffect(() => {
    const e = el.current;
    if (!leaving || !e) return;
    const ms = parseFloat(getComputedStyle(e).getPropertyValue('--ui-slow')) || 0;
    if (!ms || !e.animate) { setPresent(false); return; }
    const a = e.animate([{ opacity: getComputedStyle(e).opacity }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
    a.finished.then(() => setPresent(false), () => {});
    return () => a.cancel();
  }, [leaving]);
  if (!present) return null;
  style();
  const failed = v.fails.length > 0;
  const kind = v.restBusy || !v.tex.length ? 'release' : 'tex';
  const p = percent(v.rest);
  const title = failed ? `Could not be loaded: ${v.fails.map((f) => `${f.name} (${f.reason})`).join('; ')}`
    : kind === 'tex' ? `Fetching from the TeX tree: ${v.tex.join(', ')}` : `Loading the TeX engine · ${p} %`;
  return html`<span class="rtx-load-status" role="progressbar" aria-label=${kind === 'tex' ? 'Fetching TeX files' : 'Loading the TeX engine'}
      aria-valuemin="0" aria-valuemax="100" aria-valuenow=${kind === 'release' ? p : undefined} data-load-where="status" data-load-kind=${kind}
      data-load-percent=${kind === 'release' ? p : undefined} data-load-files=${kind === 'tex' ? v.tex.join(' ') : undefined}
      data-leaving=${leaving ? '' : undefined} data-failed=${failed ? '' : undefined} data-load-failures=${failed ? v.fails.map((f) => f.name).join(' ') : undefined}
      title=${title} ref=${el}><span class="rtx-load-status-in">${failed ? null : html`<span class="rtx-load-status-fill" style=${kind === 'release' ? { transform: `scaleX(${v.rest})` } : undefined}></span>`}</span></span>`;
}
