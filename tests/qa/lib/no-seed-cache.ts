// Tests whose premise is "every block compiles" (the single file on an empty store):
// a release carries a seed cache (scripts/build.ts: __rtxEditor.seedCache), so the paper
// opens with 0 compiles and the blocks only wait to be mounted (~10 s instead of ~40 s).
// This init script catches the boot script's globalThis.__rtxEditor as it is set and drops
// its seedCache; nothing else in the page changes.
//   await ctx.addInitScript(dropSeedCache);
export function dropSeedCache() {
  Object.defineProperty(globalThis, '__rtxEditor', {
    configurable: true,
    get() { return undefined; },
    set(v: any) { if (v) v.seedCache = null; Object.defineProperty(globalThis, '__rtxEditor', { value: v, writable: true, configurable: true }); },
  });
}
