// "Missing character" lines of every block of the default documents through the editor engine (Node):
// characters XeTeX could not find in the font, which vanish from the output. With
//   node scripts/missing-chars.ts [--seeds=intro.json] [--without-fix]
import { readFileSync } from 'node:fs';
import { engine, local, TC, EXTRA, ENGINE } from '../tests/node-host.ts';
import { buildHost, blockFile } from '../src/compile.ts';
const { contextFor } = await import('../../app/src/refs/context.ts');

type J = Record<string, any>;
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SEEDS = (arg('seeds') ?? 'intro.json').split(',');
const WITHOUT = process.argv.includes('--without-fix');
const extra = { ...EXTRA };
if (WITHOUT) extra['rtx-xetex.sty'] = extra['rtx-xetex.sty'].replace('\\RequirePackage{rtx-tfm-unicode}', '');

for (const name of SEEDS) {
  const init = JSON.parse(readFileSync(TC + 'build/seed/' + name, 'utf8')).init;
  local.clear();
  for (const a of init.assets ?? []) local.set(a.name, Buffer.from(a.base64, 'base64'));
  for (const f of (await import('node:fs')).readdirSync(ENGINE + 'tex')) if (!f.endsWith('.sty')) local.set(f, readFileSync(ENGINE + 'tex/' + f));
  const e = await engine('async');
  e.setExtraFiles({ ...extra, ...(init.bib?.kind === 'bbl' ? { 'input.bbl': init.bib.source } : {}) });
  e.reset(); e.addFile('input.tex', buildHost(init.preamble).main);
  if (!e.warm('input.tex').ok) { console.log(`${name}: the preamble does not warm`); continue; }
  const plain = init.blocks.filter((b: J) => !b.attrs?.container).map((b: J) => ({ id: b.id, kind: b.kind, source: b.source }));
  const ctxOf = new Map<string, string>(plain.map((b: J, k: number) => [b.id, contextFor(plain, k) ?? '']));
  const chars = new Map<string, number>();
  let lines = 0, blocks = 0, failed = 0;
  for (const b of init.blocks) {
    if (b.attrs?.container || !b.source.trim() || ['macros', 'comment'].includes(b.kind)) continue;
    const r = e.runBlock(blockFile(b.source, ctxOf.get(b.id) ?? '').text);
    if (r.status > 1) failed++;
    const log = e.text('input.log');
    const own = log.slice(log.lastIndexOf('(rtx-block.tex'));
    const miss = own.match(/Missing character: There is no (.+?) \("?[0-9A-F]+\) in font [^!]*!/g) ?? [];
    if (miss.length) blocks++;
    lines += miss.length;
    for (const m of miss) { const k = m.replace(/^Missing character: There is no /, '').replace(/!$/, ''); chars.set(k, (chars.get(k) ?? 0) + 1); }
  }
  console.log(`== ${name}${WITHOUT ? ' (without the fix)' : ''}: ${lines} missing characters in ${blocks} blocks (${failed} blocks failed)`);
  for (const [k, n] of [...chars].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`   ${n}× ${k}`);
}
