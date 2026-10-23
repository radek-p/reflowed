// The introduction document in a running page (the dev app, the single file, the multi-file release): it is there
// (tagged intro), it opens, every block typesets with no error, and every picture it includes (its placeholder
// screenshots, samples/intro/source/figures/shot-*.png) is drawn from its own bytes (an <image> with a data:image/png
// URL in the block's SVG, not the missing-file frame), and the References panel has its two entries. Waits on editorAPI.whenIdle() and frames, never on fixed times.
// Used by scripts/build.ts's acceptance, tests/test-multifile.ts and tests/test-intro.ts.
//
//   const r = await introCheck(page)      → IntroReport; introProblems(r) → string[] (empty: all good)
/** Playwright's Page, as far as this needs it */
interface PageLike { evaluate<R, A>(fn: (a: A) => Promise<R> | R, arg: A): Promise<R> }
export interface IntroReport {
  found: boolean; n: number; compiled: number; errors: string[];
  /** the keys of its bibliography as the References panel has them (bibpane's library) */
  refs: string[];
  pictures: { block: string; file: string; drawn: boolean; frame: boolean }[];
}

export async function introCheck(page: PageLike): Promise<IntroReport> {
  return page.evaluate(async (_: null) => {
    const api = (window as any).editorAPI;
    const list = await api.store().listDocs();
    const doc = list.find((d: any) => d.tags?.includes('intro') || d.meta?.tags?.includes('intro'));
    if (!doc) return { found: false, n: 0, compiled: 0, errors: [], pictures: [], refs: [] };
    const bes = (globalThis as any).__rtxEditor?.backends ?? [];
    const before = bes.map((b: any) => b.stats().compiled);
    if (api.route()?.id !== doc.id) await api.open(doc.id);
    await api.whenIdle();
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    const pictures: { block: string; file: string; drawn: boolean; frame: boolean }[] = [];
    // the viewer draws a block when it comes into view: scroll each picture block into view, then look
    for (const b of api.blocks().filter((x: any) => /\\(?:includegraphics|shot)\b/.test(x.source))) {
      const el = document.querySelector(`main.rtx-pane[data-part="page"] .blk[data-id="${b.id}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center' });
      await frame(); await api.whenIdle(); await frame();
      const svg = el?.querySelector('.latex-block svg');
      const imgs = [...(svg?.querySelectorAll('image') ?? [])].map((i) => i.getAttribute('href') ?? i.getAttribute('xlink:href') ?? '');
      const file = /\\(?:includegraphics(?:\[[^\]]*\])?|shot)\{([^}]*)\}/.exec(b.source)?.[1] ?? '';
      const base = file.replace(/^.*\//, '');
      const text = [...(svg?.querySelectorAll('text, tspan') ?? [])].map((t) => t.textContent ?? '').join('');
      pictures.push({ block: b.id, file, drawn: imgs.some((h) => h.startsWith('data:image/png') || h.startsWith('data:image/jpeg')), frame: !!base && text.includes(base) });
    }
    const bs = api.blocks();
    const errors = bs.filter((b: any) => b.errors?.length || b.state === 'error').map((b: any) => `${b.id}: ${b.errors?.[0]?.message ?? b.state}`);
    const compiled = bes.map((b: any, i: number) => b.stats().compiled - before[i]).reduce((a: number, c: number) => a + c, 0);
    const lib = api.bibpane?.()?.library?.();
    const refs: string[] = (lib?.entries ?? []).map((e: { key: string }) => e.key).sort();
    return { found: true, n: bs.length, compiled, errors, pictures, refs };
  }, null);
}

export function introProblems(r: IntroReport, o: { baked?: boolean } = {}): string[] {
  const p: string[] = [];
  if (!r.found) return ['intro: the introduction is not among the documents'];
  if (r.n < 20) p.push(`intro: only ${r.n} blocks`);
  for (const e of r.errors) p.push(`intro: block error ${e.slice(0, 200)}`);
  if (!r.pictures.length) p.push('intro: no picture found');
  for (const x of r.pictures) if (!x.drawn || x.frame) p.push(`intro: ${x.file} is not drawn from its bytes (block ${x.block}${x.frame ? ', the missing-file frame' : ''})`);
  if (r.refs.join() !== 'knuth1984,lamport1994') p.push(`intro: the References panel's entries are ${JSON.stringify(r.refs)}, not its two`);
  if (o.baked && r.compiled) p.push(`intro: ${r.compiled} blocks compiled on open (not baked in)`);
  return p;
}
