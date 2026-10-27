// The engine's own test page (not the editor): the reflowtex viewer and
// web/backend.js, for a server that serves it at /devpage/, this repository at /tc/, the format at
// /formats/latex.fmt and the TeX bundle (engine/server/bundle.ts).
//   node scripts/dev-page.ts      → build/devpage/{index.html, viewer/…}
// window.engineTest = { createBackend, mountBlock(el, result) } for the browser tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(HERE, 'build/devpage');
const PUB = process.env.REFLOWTEX ?? '/reflowtex';
mkdirSync(OUT, { recursive: true });
const site = await import(join(PUB, 'src/pipeline/site.ts'));
const { Log } = await import(join(PUB, 'src/shared/log.ts'));   // a log with no sinks: the bundles' build lines unprinted
site.installViewer(join(OUT, 'viewer'), { inspector: false, log: new Log('pipeline') });
writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>editor engine</title><link rel="icon" href="data:,">
<div id="latex-schema" data-schema-b64="${site.schemaBase64()}" hidden></div>
<script id="latex-font-map" type="application/json" data-fonts-base="/fonts/">{}</script>
<style>body{font:14px system-ui;margin:0 auto;max-width:720px;padding:16px} .latex-block{margin:0} .blk{border-bottom:1px dashed #ddd}</style>
</head><body><div id="blocks"></div>
<script src="viewer/protobuf.min.js"></script>
<script src="viewer/latex-viewer.js"></script>
<script type="module">
import { createBackend } from '/tc/engine/web/backend.js';
window.engineTest = {
  createBackend: (o = {}) => createBackend({ workerUrl: '/tc/engine/dist/editor-worker.js', ...o }),
  async mountBlock(id, result) {
    const wrap = document.createElement('div'); wrap.className = 'blk'; wrap.dataset.id = id;
    const el = document.createElement('div'); el.className = 'latex-block'; el.dataset.nodelistB64 = result.nodelist;
    wrap.append(el); document.getElementById('blocks').append(wrap);
    const block = await window.reflowtex.host.mount(el);
    return { height: el.getBoundingClientRect().height, glyphs: el.querySelectorAll('tspan, text').length };
  },
};
window.engineTestReady = true;
</script></body></html>
`);
console.log(`build/devpage/index.html (+ viewer)`);
