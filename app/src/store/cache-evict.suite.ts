// The result cache shrinks (engine/web/cache-evict.ts), on any CoreStore (memory and fake-indexeddb in
// Node; scripts/test-w2.ts prints them).
import type { Check } from './store.suite.ts';
import { evictCache, buildOfKey } from '../../../engine/web/cache-evict.ts';

export async function runCacheEvictSuite(label: string, make: () => Promise<any>): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, info = '') => { out.push({ name: `${label}: ${name}`, ok, info }); };
  const store = await make();
  const c = store.cache;
  const put = (k: string) => c.put(k, { status: 'ok', k });
  // pages of three engine builds opened in turn (aaa1, then bbb2, now ccc3), each leaving its results
  const fill = async (b: string) => { for (let i = 0; i < 5; i++) await put(`e${b}.p.${i}`); await put(`pre.e${b}.p`); };
  await put('rtx:seeds'); await put('notakey');
  await fill('aaa1'); await evictCache(c, 'aaa1');
  await fill('bbb2'); await evictCache(c, 'bbb2');
  check('the build before stays when a new one starts', (await c.keys()).filter((k: string) => buildOfKey(k) === 'aaa1').length === 6);
  await fill('ccc3');
  const r = await evictCache(c, 'ccc3');
  const keys: string[] = await c.keys();
  check('the oldest build\'s results and preamble go; the current and the previous build stay', !keys.some((k) => buildOfKey(k) === 'aaa1')
    && keys.filter((k) => buildOfKey(k) === 'bbb2').length === 6 && keys.filter((k) => buildOfKey(k) === 'ccc3').length === 6 && r.deleted === 6, JSON.stringify(keys));
  check('the editor\'s own records and keys that are not results stay', keys.includes('rtx:seeds') && keys.includes('notakey'));
  const r2 = await evictCache(c, 'ccc3', 7);
  const k2: string[] = await c.keys();
  check('over the cap: the previous build\'s results go first, then the current build\'s beyond it', r2.kept === 7 && k2.filter((k) => buildOfKey(k) === 'ccc3').length === 6 && k2.filter((k) => buildOfKey(k) === 'bbb2').length === 1, JSON.stringify(r2));
  check('buildOfKey reads result and preamble keys', buildOfKey('e3f2d47d055.abc.def') === '3f2d47d055' && buildOfKey('pre.e3f2.x') === '3f2' && buildOfKey('rtx:builds') === null);
  return out;
}
