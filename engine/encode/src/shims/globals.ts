// Globals Node code expects: Buffer, process (env, pid, cwd for path.resolve).
import { Buffer } from 'buffer';
export { Buffer };
export const process = { env: {} as Record<string, string | undefined>, pid: 1, cwd: () => '/', platform: 'browser', features: {}, argv: [] as string[] };
