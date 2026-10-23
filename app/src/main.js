// The standalone page's entry: the editor on the workbench (app/wb/host.ts): its documents as
// tabs, splits and groups, its panels as side panels, its Documents view in each group's home panel, the URL
// (#/doc/<id> opens or shows that document's tab, #/ the home panel), the seeds and the test surface window.editorAPI
// (app/wb/test-surface.ts). The embeddable editor (app/mount.ts mountEditor: the document part, and its sidebar part)
// is another host's (the VS Code webview, the two-editors harness).
//
// Stays JavaScript (the bundle's entry, two calls). `rtx:<name>` imports are resolved by the build (esbuild plugin in
// scripts/lib/app-bundle.ts) to the real module, or to app/stubs.js while it is missing. URL options:
//   ?stubs=store,refs   use the stub even where the real module exists
//   ?backend=none|…    pick the compile backend (else the saved choice)
//   ?seed=example|paper|sample  what to put in an empty store (default: the example and
//                       the paper; sample = the tests' fixture, app/test-fixture.js)
//   ?engine             offer engine backend on a dev page (it needs /bundle/)
//   ?fresh              start from the default layout (the saved one is a disposable preference)
import { h } from './app/app.js';
import { pageParams } from './app/release-mode.js';     // no dev switches in a release
import { installQuotaNotice } from './app/quota.js';         // out of space: one toast
import { installAbout } from './app/about.js';           // About / Licence: the preview pill, the home footer
import { startWorkbench } from './wb/host.ts';             // the standalone page on the workbench
import { bootFailed } from './boot/load-status.ts';       // (multi-file release) the loader's overlay names the failure
installAbout();
installQuotaNotice();

startWorkbench({ el: document.querySelector('.rtx-editor'), params: pageParams() }).catch((e) => {
  console.error(e);
  bootFailed(`the editor could not start (${e.message})`);
  document.body.append(h('pre', 'fatal', { text: `The editor could not start: ${e.message}` }));
});
