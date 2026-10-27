// doc/viewer-log.ts and its rows in the Problems list (doc/panels.ts diagnosticsOf), on a stand-in for the viewer's
// host.log: the notice bar turned off; warnings and errors kept, debug and info not; a view's records the result's
// once bound (those logged before the binding too), once per result, code and message; a block's problems those of
// the result it shows now (gone when its result changes or it goes); the page's records once per code, the latest.
//   node app/src/doc/viewer-log.test.ts
import { createViewerLog, type ViewerRecord, type ViewerHostLog } from './viewer-log.ts';
import { diagnosticsOf, PROBLEM_GROUPS, type Block } from './panels.ts';

let fail = 0, pass = 0;
const check = (what: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (ok) pass++; else fail++;
};

/** the viewer's page log, as host.log gives it */
function standIn() {
  const list: ViewerRecord[] = [];
  const subs = new Set<(r: ViewerRecord) => void>();
  let shown: readonly string[] | null = ['font-load-failed'];
  const log: ViewerHostLog = {
    records: (after = 0) => list.filter((r) => r.seq > after),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    setShown: (s) => { shown = s; },
  };
  const add = (r: Omit<ViewerRecord, 'seq'>) => { const x = { ...r, seq: list.length + 1 }; list.push(x); for (const fn of subs) fn(x); };
  return { log, add, shown: () => shown };
}

const v = standIn();
v.add({ level: 'warning', code: 'font-without-face', message: 'font cmr10 has no face', block: 'k1' });   // before the log is made
const vl = createViewerLog(v.log);
let told = 0;
vl.subscribe(() => told++);
check('the viewer\'s notice bar is off (shown: nothing)', Array.isArray(v.shown()) && v.shown()!.length === 0, v.shown());
// a mount under way: the view's records come first, the binding after
v.add({ level: 'warning', code: 'missing-char', message: 'There is no ł (U+0142) in font cmr10', block: 'k1' });
v.add({ level: 'info', code: 'block-transformed', message: 'converted 3 pictures', block: 'k1' });
v.add({ level: 'debug', code: 'timing', message: 'layout 3 ms', block: 'k1' });
check('a view not yet bound: nothing is a result\'s yet, nothing told', vl.problemsOf('r1').length === 0 && told === 0);
vl.bind('k1', 'r1');
check('bound: its records are the result\'s, those from before the log was made too; info and debug left out',
  JSON.stringify(vl.problemsOf('r1').map((p) => p.code)) === JSON.stringify(['font-without-face', 'missing-char']), vl.problemsOf('r1'));
check('the binding told the listeners', told === 1, told);
// another mount of the same result (a pane opened, the block shown again): the same warnings again
v.add({ level: 'warning', code: 'missing-char', message: 'There is no ł (U+0142) in font cmr10', block: 'k2' });
vl.bind('k2', 'r1');
check('the same record from another view of the result: kept once', vl.problemsOf('r1').length === 2, vl.problemsOf('r1'));
// a bound view's later record
v.add({ level: 'error', code: 'kind-failed', message: 'kind "proof": render failed, drawn by default', block: 'k2' });
check('a later record of a bound view: the result\'s, told', vl.problemsOf('r1').some((p) => p.code === 'kind-failed' && p.level === 'error') && told === 2, { told });
// the page's
v.add({ level: 'error', code: 'font-load-failed', message: 'Some fonts could not be downloaded (cmr10).', block: null });
v.add({ level: 'error', code: 'font-load-failed', message: 'Some fonts could not be downloaded (cmr10, cmmi10).', block: null });
check('the page\'s records: once per code, the latest', JSON.stringify(vl.pageProblems()) === JSON.stringify([{ level: 'error', code: 'font-load-failed', message: 'Some fonts could not be downloaded (cmr10, cmmi10).' }]), vl.pageProblems());

// ── in the Problems list ─────────────────────────────────────────────────────
let key = 'r1';
const blocks: Block[] = [{ id: 'b1', kind: 'paragraph', source: 'Łódź' }, { id: 'b2', kind: 'paragraph', source: 'plain' }];
const src = (bs: Block[]) => ({ blocks: bs, preamble: '', refs: {}, previewOf: (b: Block) => vl.problemsOf(b.id === 'b1' ? key : 'r2'), pagePreview: vl.pageProblems() });
const rows = diagnosticsOf(src(blocks)).filter((d) => d.kind === 'preview');
check('Problems: the block\'s records, with its id and level, and the page\'s with none',
  rows.filter((d) => d.blockId === 'b1').length === 3 && rows.some((d) => d.blockId === null && d.level === 'error') && rows.every((d) => d.blockId !== 'b2'), rows);
check('Problems: the preview group is listed', PROBLEM_GROUPS.some(([k]) => k === 'preview'));
key = 'r3';                                                    // the block edited: another result
check('Problems: the block\'s records go when its result changes', !diagnosticsOf(src(blocks)).some((d) => d.kind === 'preview' && d.blockId === 'b1'));
key = 'r1';
check('Problems: and go when the block goes', !diagnosticsOf(src(blocks.slice(1))).some((d) => d.kind === 'preview' && d.blockId === 'b1'));

vl.dispose();
v.add({ level: 'warning', code: 'missing-char', message: 'after dispose', block: 'k1' });
check('disposed: no more records taken', !vl.problemsOf('r1').some((p) => p.message === 'after dispose'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
