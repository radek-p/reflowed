// app/doc-files.ts with a fake host (Node: the download's <a> and URL stubbed): what each action asks of the host, in
// order, and what it does when the host cannot (no PDF, a failed reset, no banner in this pane).
//   node app/src/app/doc-files.test.ts      (Node; exit 1 on a failure)
import { createDocFiles, type DocFilesHost, type FilesIo } from './doc-files.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d: unknown = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d && !ok ? ` — ${JSON.stringify(d)}` : ''}`); };

// the DOM a download touches
const downloads: { name: string; type: string }[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.document = { createElement: () => ({ click() {}, remove() {} }), body: { append: (a: { download: string; href: { type: string } }) => downloads.push({ name: a.download, type: a.href.type }) } };
g.URL = Object.assign(URL, { createObjectURL: (b: Blob) => ({ type: b.type }), revokeObjectURL: () => {} });
g.window = { open: () => {} };

function fake(over: Partial<DocFilesHost> = {}, io: Partial<FilesIo> = {}) {
  const log: string[] = [];
  const host: DocFilesHost = {
    doc: () => ({ id: 'd1', title: 'My Paper: Draft 2' }),
    store: { getDoc: async (id) => { log.push(`getDoc ${id}`); return { id, stored: true }; }, getAsset: async () => null },
    io: () => ({ resetToSeed: async () => { log.push('reset'); }, openImportTex: () => { log.push('import'); }, exportTex: (d) => { log.push(`exportTex ${JSON.stringify(d)}`); return '\\documentclass{article}'; },
      exportZip: async () => new Blob(['z'], { type: 'application/zip' }), mountSeedBanner: () => { log.push('banner'); return { destroy: () => log.push('banner gone') }; }, ...io }),
    leaveEditors: () => log.push('leave'), settled: async () => { log.push('settled'); },
    toast: (t) => log.push(`toast ${t}`), setStatus: (t, k) => log.push(`status ${k} ${t}`),
    forExport: (d) => ({ ...(d as object), trash: false }),
    pdf: () => null, reopen: (id) => log.push(`reopen ${id}`), openDoc: (id) => log.push(`open ${id}`),
    bannerHost: () => ({}) as HTMLElement,
    ...over,
  };
  return { files: createDocFiles(host), log };
}

{
  const { files, log } = fake();
  await files.exportTex();
  check('exportTex: the editors leave, every write lands, then the stored document (figures\' trash out) is exported', log.join('|') === 'leave|settled|getDoc d1|exportTex {"id":"d1","stored":true,"trash":false}', log);
  check('… downloaded as <title>.tex (io/download.ts fileName: case kept, the colon out)', downloads.at(-1)?.name === 'My-Paper-Draft-2.tex' && downloads.at(-1)?.type === 'text/x-tex', downloads.at(-1));
}
{
  const { files } = fake();
  await files.exportZip();
  check('exportZip: downloaded as <title>.zip', downloads.at(-1)?.name === 'My-Paper-Draft-2.zip');
}
{
  const { files, log } = fake();
  await files.exportPdf();
  check('exportPdf with a backend that has no PDF: "No PDF", nothing opened', log.includes('status error No PDF'), log);
  const ok = fake({ pdf: async () => ({ pdf: new Blob(['%PDF'], { type: 'application/pdf' }) }) });
  await ok.files.exportPdf();
  check('exportPdf: "Making the PDF…", then "PDF ready"', ok.log.join('|') === 'leave|status busy Making the PDF…|status ok PDF ready', ok.log);
}
{
  const { files, log } = fake({}, { resetToSeed: async () => { throw new Error('offline'); } });
  await files.resetSeed();
  check('resetSeed failing: a toast says why, the document is not reopened', log.includes('toast Reset failed: offline') && !log.some((x) => x.startsWith('reopen')), log);
  const ok = fake();
  await ok.files.resetSeed();
  check('resetSeed: reset, then reopened', ok.log.join('|') === 'leave|settled|reset|reopen d1', ok.log);
}
{
  const none = fake({ bannerHost: () => null });
  none.files.showSeedBanner('d1');
  check('no banner host (a guest pane): no banner', !none.log.includes('banner'));
  const { files, log } = fake();
  files.showSeedBanner('d1'); files.showSeedBanner('d1'); files.removeSeedBanner();
  check('a banner shown again replaces the old one; removed on close', log.join('|') === 'banner|banner gone|banner|banner gone', log);
}

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
