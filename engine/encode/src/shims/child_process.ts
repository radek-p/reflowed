// node:child_process for the browser. `kpsewhich NAME` is answered from
// Tectonic's bundle (setKpsewhich), as a path under the /texmf mount; any
// other program (lualatex, dvisvgm, gs) is not there, as on a machine without it.
import { Buffer } from "buffer";
let kpse: (name: string) => string | null = () => null;
export function setKpsewhich(f: (name: string) => string | null): void { kpse = f; }

const notFound = (cmd: string) => Object.assign(new Error(`spawnSync ${cmd} ENOENT`), { code: 'ENOENT' });

export function execFileSync(cmd: string, args: string[] = []): Buffer {
  if (cmd === 'kpsewhich' && args.length === 1) {
    const p = kpse(args[0]);
    if (!p) throw Object.assign(new Error(`kpsewhich ${args[0]}: not found`), { status: 1 });
    return Buffer.from(`${p}\n`);
  }
  throw notFound(cmd);
}
export function execFile(cmd: string, ...rest: unknown[]): void {
  const cb = rest.find(x => typeof x === 'function') as ((e: Error) => void) | undefined;
  queueMicrotask(() => cb?.(notFound(cmd)));
}
export function spawn(cmd: string): never { throw notFound(cmd); }
