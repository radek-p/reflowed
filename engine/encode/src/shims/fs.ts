// node:fs for the browser: the calls the public encoder makes, on vfs.ts.
import { Buffer } from 'buffer';
import * as vfs from './vfs.ts';

const enoent = (op: string, p: string) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT' });

export function readFileSync(p: string, opt?: string | { encoding?: string }): Buffer | string {
  const b = vfs.read(String(p));
  if (!b) throw enoent('open', String(p));
  const enc = typeof opt === 'string' ? opt : opt?.encoding;
  const buf = Buffer.from(b);                  // a copy, as every Node read is
  return enc ? buf.toString(enc as BufferEncoding) : buf;
}
export function writeFileSync(p: string, data: Uint8Array | string): void { vfs.write(String(p), data); }
export const existsSync = (p: string): boolean => vfs.isDir(String(p)) || vfs.isFile(String(p));
export function mkdirSync(p: string): void { vfs.mkdirp(String(p)); }
export function mkdtempSync(prefix: string): string {
  const p = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
  vfs.mkdirp(p);
  return p;
}
class Dirent {
  constructor(readonly name: string, private readonly dir: boolean) {}
  isDirectory() { return this.dir; }
  isFile() { return !this.dir; }
}
export function readdirSync(p: string, o?: { withFileTypes?: boolean }): (string | Dirent)[] {
  p = String(p);
  if (!vfs.isDir(p)) throw enoent('scandir', p);
  const names = vfs.list(p);
  return o?.withFileTypes ? names.map(n => new Dirent(n, vfs.isDir(`${p}/${n}`))) : names;
}
export function statSync(p: string) {
  p = String(p);
  const dir = vfs.isDir(p);
  const b = dir ? null : vfs.read(p);
  if (!dir && !b) throw enoent('stat', p);
  return { isDirectory: () => dir, isFile: () => !dir, size: b?.length ?? 0, mtimeMs: 0 };
}
export function copyFileSync(a: string, b: string): void {
  const d = vfs.read(String(a));
  if (!d) throw enoent('copyfile', String(a));
  vfs.write(String(b), d);
}
export function cpSync(a: string, b: string, o: { recursive?: boolean; filter?: (s: string) => boolean } = {}): void {
  a = String(a); b = String(b);
  if (o.filter && !o.filter(a)) return;
  if (!vfs.isDir(a)) return copyFileSync(a, b);
  vfs.mkdirp(b);
  for (const n of vfs.list(a)) cpSync(`${a}/${n}`, `${b}/${n}`, o);
}
export function renameSync(a: string, b: string): void { copyFileSync(a, b); vfs.remove(String(a)); }
export function rmSync(p: string, o: { recursive?: boolean; force?: boolean } = {}): void {
  p = String(p);
  if (!o.force && !existsSync(p)) throw enoent('rm', p);
  vfs.remove(p, !!o.recursive);
}
export function chmodSync(): void {}
export default { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, copyFileSync, cpSync, renameSync, rmSync, chmodSync };
