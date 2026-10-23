// (first step) The op log is complete: after edits made through the app, the latest snapshot plus the
// ops logged since it equals the stored document (store/replay.ts). Each kind of edit is checked on its own
// (typing, setSource, insert, remove, move, split, merge, preamble, nesting) so a gap names the edit.
// Kept, adapted: the op log is disposable now (store/policy.ts drops it with the snapshots on any schema
// change), so the invariant is checked between drops only: each step takes its own base snapshot, and the Node
// policy suite checks that a log started after a drop is complete again. It stays because the log still feeds
// seeds.ts (an unedited copy from before seed versioning).
//
//   node tests/test-replay.ts dev [http://localhost:8150/] | file [dist/reflowtex-editor.html]
import { harness } from './qa/lib/harness.ts';
import { replay, stateOf, diffStates } from '../app/src/store/replay.ts';

const argv = process.argv.slice(2);
const target = argv[0] === 'file' ? 'file' : 'dev';
const at = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
const t = harness('replay');
const { ctx, page, errors } = await t.launch({ target, at });
const id = await t.newDoc(page, { title: 'Replay', preamble: '\\documentclass{article}', blocks: [
  { source: 'First paragraph.' }, { source: 'Second paragraph with some words.' }, { source: 'Third.' }, { source: 'Fourth.' },
  { source: '\\begin{proof}\nOne step.\n\nAnother step.\n\\end{proof}' }] });
const api = (f: string, ...a: unknown[]) => page.evaluate(([f, a]: [string, unknown[]]) => (window as any).editorAPI[f](...a), [f, a] as [string, unknown[]]);
const ids = async (): Promise<string[]> => (await api('blocks')).map((b: any) => b.id);
const settle = async () => { await api('leave'); await page.waitForTimeout(500); await t.idle(page); };   // (typing is written 400 ms after the last key)

/** a snapshot, then `act`, then: snapshot + ops since == stored */
async function step(name: string, act: () => Promise<unknown>) {
  await settle();
  const snapId: string = await page.evaluate((d: string) => (window as any).editorAPI.store().snapshots.put(d, 'replay base'), id);
  await page.waitForTimeout(5);
  await act();
  await settle();
  const r = await page.evaluate(async ([d, s]: [string, string]) => {
    const st = (window as any).editorAPI.store();
    return { snap: await st.snapshots.get(s), ops: await st.getOps(d, s), now: await st.getDoc(d) };
  }, [id, snapId] as [string, string]);
  const diff = diffStates(replay(r.snap, r.ops), stateOf(r.now));
  t.check(`${name}: snapshot + ${r.ops.length} op(s) = the stored document`, !diff.length, diff.slice(0, 6));
}

await step('typing in a block', async () => { const [a] = await ids(); await api('edit', a, 5); await page.keyboard.type(' typed'); });
await step('setSource', async () => { const [, b] = await ids(); await api('setSource', b, 'Second paragraph, rewritten.'); });
await step('insert', async () => { await api('insert', 2, 'paragraph', 'Inserted paragraph.'); });
await step('remove', async () => { const l = await ids(); await api('remove', l[3]); });
await step('move', async () => { const l = await ids(); await api('move', l[0], 2); });
await step('split', async () => { const l = await ids(); await api('split', l[1], 6); });
await step('merge', async () => { const l = await ids(); await api('merge', l[2]); });
await step('preamble', async () => { await api('setPreamble', '\\documentclass{article}\n\\usepackage{amsmath}'); });
await step('nest a proof (container + paragraphs)', async () => { const bs = await api('blocks'); const p = bs.find((b: any) => b.source.startsWith('\\begin{proof}')); if (p) await api('nestSplit', p.id); });
t.check('no page errors', !errors.length, errors);
await ctx.close();
t.done();
