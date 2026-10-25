// The TeX resource server's field in the Settings panel's Advanced section (behind "Show advanced features"): a
// preference of this browser (settings/resources.ts), applied when the field is left or on Enter; the blocks that
// failed for want of a file typeset again. The field keeps id #ss-resource-server (tests).
import { useState } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { Input } from '../design/ui/index.js';
import { registerSetting } from './registry.ts';
import { Row } from './rows.ts';
import { storedServer, resourceChoice, setResourceServer, checkServerAddress, DEFAULT_RESOURCE_SERVER, NONE } from './resources.ts';

function ResourceServerField() {
  const [text, setText] = useState(storedServer.value ?? '');
  const [problem, setProblem] = useState('');
  const commit = () => {
    const why = checkServerAddress(text);
    setProblem(why);
    if (!why) setResourceServer(text);
  };
  const hint = `Packages, classes and fonts the editor does not carry come from this address (a TeX Live tree on a web server) `
    + `the first time a document needs them, then stay in this browser. ${DEFAULT_RESOURCE_SERVER ? 'Empty: the tree beside this page (texlive/2022/), when it is there.' : 'Empty: none.'} `
    + `Type ${NONE} for no server.${resourceChoice.value.url ? '' : ' Now: none.'}`;
  return html`<${Row} id="resource-server" label="TeX resource server" for="ss-resource-server" hint=${hint}>
    <${Input} id="ss-resource-server" class="rtx-set-url" mono=${true} type="url" spellcheck=${false} placeholder=${DEFAULT_RESOURCE_SERVER ? 'beside this page (texlive/2022/)' : NONE} value=${text}
      aria-invalid=${problem ? 'true' : 'false'}
      onInput=${(e: Event) => { setText((e.currentTarget as HTMLInputElement).value); if (problem) setProblem(''); }} onChange=${commit}
      onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); } }} />
    ${problem ? html`<p class="rtx-set-hint rtx-set-problem" role="alert">${problem}</p>` : null}
  <//>`;
}

registerSetting({ id: 'resource-server', where: 'advanced', order: 20, advanced: true, Control: () => html`<${ResourceServerField} />` });
