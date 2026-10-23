// The few Node APIs the workbench's tests and scripts use, typed by hand: the repository has no @types/node (app/'s
// dependencies are the browser's), and the workbench adds no package. Only what is imported here; extend as needed.

interface Buffer extends Uint8Array {
  toString(encoding?: 'utf8' | 'ascii' | 'base64' | 'hex' | 'latin1', start?: number, end?: number): string;
  readUInt32BE(offset: number): number;
  writeUInt32BE(value: number, offset: number): number;
  write(text: string, offset: number, encoding?: 'ascii' | 'utf8'): number;
  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
  subarray(start?: number, end?: number): Buffer;
}
interface BufferConstructor {
  from(data: string, encoding?: 'utf8' | 'base64' | 'hex' | 'latin1'): Buffer;
  from(data: ArrayLike<number> | ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
  alloc(size: number): Buffer;
  byteLength(text: string, encoding?: 'utf8' | 'latin1'): number;
  concat(list: readonly Uint8Array[]): Buffer;
}
declare var Buffer: BufferConstructor;

declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  exit(code?: number): never;
  cwd(): string;
};

declare module 'node:fs' {
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: 'utf8' | 'latin1' | 'ascii'): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export interface Dirent { name: string; isDirectory(): boolean; isFile(): boolean }
  export function readdirSync(path: string): string[];
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
declare module 'node:module' {
  /** require from a place: the tests load playwright and esbuild from app/node_modules (untyped there: unknown). */
  export function createRequire(path: string): (id: string) => any;
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Buffer;
  export function deflateSync(data: Uint8Array): Buffer;
  export function crc32(data: Uint8Array | string, value?: number): number;
}
declare module 'node:http' {
  export interface IncomingMessage { url?: string; method?: string }
  export interface ServerResponse { writeHead(status: number, headers?: Record<string, string>): this; end(body?: string | Uint8Array): void }
  export interface Server { listen(port: number, host: string, cb?: () => void): Server; close(): void }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Server;
}
declare module 'node:child_process' {
  export function spawnSync(cmd: string, args: string[], options?: { cwd?: string; encoding?: 'utf8' }): { stdout: string; stderr: string; status: number | null };
}
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): Promise<void>;
  export function test(name: string, options: { skip?: boolean | string; timeout?: number }, fn: () => void | Promise<void>): Promise<void>;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((e: unknown) => boolean) | object, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
    match(value: string, re: RegExp, message?: string): void;
    fail(message?: string): never;
  }
  const assert: Assert;
  export default assert;
}
