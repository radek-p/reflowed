// Tooling (Node): convert a build directory's capture stream to output.json.
//   node convert-cli.ts <dir> [out.json]
// Font files come from the directory, then Tectonic's bundle cache (the
// files the engine read), then `tectonic -X bundle cat`.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { convert } from './convert.ts';
import { buildSourceMap } from './sourcemap.ts';

const [dir, outName = 'output.json'] = process.argv.slice(2);
const job = process.env.RTX_JOB ?? 'input';
const cache = process.env.TECTONIC_CACHE_DIR ?? '/cache';
const dataDirs: string[] = [dir];
try {
  for (const e of readdirSync(join(cache, 'bundles/data'))) if (!e.endsWith('.index')) dataDirs.push(join(cache, 'bundles/data', e));
} catch { /* no cache */ }
dataDirs.push(join(cache, 'rtx/files'));
const readFile = (name: string): Uint8Array | null => {
  for (const d of dataDirs) { const p = join(d, name); if (existsSync(p)) return readFileSync(p); }
  try {
    const b = execFileSync('tectonic', ['-X', 'bundle', 'cat', name], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    return b.length ? b : null;
  } catch { return null; }
};
const t = Date.now();
const out = convert({
  stream: readFileSync(join(dir, `${job}.rtxc.jsonl`), 'utf8'),
  readFile,
  hyphenation: process.env.RTX_HYPHENATION === 'tex82' ? 'tex82' : 'luatex',
});
writeFileSync(join(dir, outName), JSON.stringify(out));
// the glyphs' source positions, for a page to load next to the viewer's data
if (out.source_files) writeFileSync(join(dir, 'sourcemap.json'), JSON.stringify(buildSourceMap(out)));
console.log(`convert: ${out.paragraphs.length} paragraph(s), ${out.content.length} item(s), ${out.streams.length} stream(s) in ${Date.now() - t} ms; ${JSON.stringify(out.capture.stats)}`);
