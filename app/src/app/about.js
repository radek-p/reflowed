// About / Licence: the licence notice, the build, the example documents'
// attributions and every third-party component with its licence. Opened by the
// version pill (top bar) and the home footer
// (any element with [data-about]). The single file carries the data
// (#rtx-licences: an index, #third-party-licenses: the full texts; scripts/build.ts); the multi-file release's
// loader adds the same two elements once their files are in (loading/page-loader.ts: __rtxEditor.licences, a Promise):
// About opened before then fills in when they come. The dev server has only the notice.
// on the kit's Dialog (wide): title row with close, Esc, a press on the
// backdrop and Close close it; focus goes back to what opened it. The dialog
// keeps id="rtx-about" and the lists their data-list / data-name (the build's
// acceptance reads them).
//   import { installAbout } from './app/about.js'; installAbout();
import { html } from '../design/ui/core.js';
import { Dialog, openLayer } from '../design/ui/overlays.js';
import { buildVersion } from './build-version.js';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../design/ui/controls.js';

const NOTICE_FALLBACK = 'ReflowEd. Copyright © 2026 Radosław Piórkowski. Free software under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later).';
const TITLE = 'ReflowEd — Reflow TeX Editor, built on reflowtex';

function readData() {
  const idx = document.getElementById('rtx-licences');
  const txt = document.getElementById('third-party-licenses');
  let data = null;
  try { data = idx ? JSON.parse(idx.textContent) : null; } catch { data = null; }
  return { data, text: txt?.textContent ?? '' };
}

/** the data, again once the multi-file release's licence files are in */
function AboutData({ notice }) {
  const [d, setD] = useState(readData);
  useEffect(() => {
    const later = globalThis.__rtxEditor?.licences;
    if (!d.data && later?.then) later.then(() => setD(readData()), () => {});
  }, []);
  return html`<${AboutBody} data=${d.data} text=${d.text} notice=${notice} />`;
}

function AboutBody({ data, text, notice }) {
  const sec = (title, ...kids) => html`<section><h3>${title}</h3>${kids}</section>`;
  return html`
    <p class="rtx-about-notice">${notice}</p>
    <p class="muted rtx-about-build">${buildVersion().about}</p>
    ${data?.build ? html`<p class="muted">Build ${data.build.date?.slice(0, 16).replace('T', ' ')} UTC · engine ${data.build.engine} · ${data.build.version}</p>` : null}
    ${data?.documents?.length ? sec('Example documents',
      html`<p class="muted">Each is under the licence named.</p>`,
      html`<ul>${data.documents.map((doc) => html`<li><strong>${doc.title}</strong> — ${doc.source}. Licence: ${doc.url ? html`<a href=${doc.url} target="_blank" rel="noopener">${doc.licence}</a>` : doc.licence}.${doc.changes?.length ? html` Modified for this demo (notes):<ul>${doc.changes.map((c) => html`<li>${c}</li>`)}</ul>` : null}</li>`)}</ul>`) : null}
    ${data ? [
      sec(`Engine (${data.engine.length})`, html`<ul class="rtx-about-list">${data.engine.map((e) => html`<li>${e.name} — ${e.licence}</li>`)}</ul>`),
      sec(`npm packages (${data.npm.length})`, html`<ul class="rtx-about-list" data-list="npm">${data.npm.map((p) => html`<li data-name=${p.name}>${p.name} ${p.version} — ${p.licence} (${p.where.join(', ')})</li>`)}</ul>`),
      sec('TeX', html`<details><summary>TeX files in the pack (${data.tex.length}), each under its own licence</summary>
        <ul class="rtx-about-list" data-list="tex">${data.tex.map((t) => html`<li data-name=${t.file}>${t.file} — ${t.licence}</li>`)}</ul></details>`),
    ] : null}
    ${text ? sec('Full licence texts', html`<details><summary>Show</summary><pre class="rtx-about-texts">${text}</pre></details>`)
      : html`<p class="muted">The full list of third-party components and their licences is in the single-file build.</p>`}`;
}

let layer = null;
// "Reset local data…" in the footer once the app has a store (main.js: setAboutReset)
let resetLocal = null;
export function setAboutReset(fn) { resetLocal = fn; }
export function openAbout() {
  if (layer) return document.getElementById('rtx-about');
  const notice = document.querySelector('meta[name="license"]')?.content ?? readData().data?.notice ?? NOTICE_FALLBACK;
  const back = document.activeElement;
  layer = openLayer((close) => {
    const done = () => { close(); layer = null; if (back?.isConnected) back.focus?.({ preventScroll: true }); };
    return html`<${Dialog} id="rtx-about" class="rtx-about" wide title=${TITLE} onClose=${done}
        onClick=${(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
        footer=${html`${resetLocal ? html`<${Button} variant="ghost" id="about-reset-local" aria-haspopup="dialog" onClick=${(e) => { e.currentTarget.closest('dialog').close(); resetLocal(); }}>Reset local data…<//>` : null}<${Button} variant="ghost" onClick=${(e) => e.currentTarget.closest('dialog').close()}>Close<//>`}>
      <${AboutData} notice=${notice} />
    <//>`;
  });
  return document.getElementById('rtx-about');
}

export function installAbout() {
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-about]') : null;
    if (!t) return;
    e.preventDefault();
    openAbout();
  });
  return { open: openAbout };
}
