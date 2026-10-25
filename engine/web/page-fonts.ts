// The worker's font files, given to the viewer (engine/web/backend.js uses it). The worker answers a compile with
// the fonts it serves (original name → served file) and the files the page has not had yet; each goes to the viewer
// by its original name, with the served file's bytes (reflowtex host.fonts.provide). Before a block uses a font,
// its face is made from them; a font whose file changes later (one that needed no patch at first gains its
// private-use entries: the worker patches a font whole, once) has its face replaced by the viewer only once the new
// file has loaded, so nothing on screen goes blank or into a stand-in meanwhile.
//
//   applyFonts(map, files)   map: { original: served }, files: { served: bytes } (those new to the page)
//   fontSwaps()              { pending, given, swaps, failures, maxPerFont, settled }: for stats and tests

interface ViewerFonts { provide(file: string, source: Uint8Array): Promise<boolean | void> }

const current = new Map<string, string>();          // original → the served file given for it
const servedBytes = new Map<string, Uint8Array>();  // served file → its bytes (while some original is given it)
const pending = new Set<Promise<void>>();           // provides on their way (a replaced face loading)
const swapsOf = new Map<string, number>();          // original → how many times its face was replaced
let failures = 0, swaps = 0;
/** fonts given before the viewer's host exists: given once it does (reflowtex:host) */
const beforeHost: [string, Uint8Array, boolean][] = [];

const viewerFonts = (): ViewerFonts | null =>
  (globalThis as { reflowtex?: { host?: { fonts?: ViewerFonts } } }).reflowtex?.host?.fonts ?? null;

function give(orig: string, bytes: Uint8Array, swap: boolean): void {
  const f = viewerFonts();
  if (!f) {
    if (!beforeHost.length) document.addEventListener('reflowtex:host', () => { for (const g of beforeHost.splice(0)) give(...g); }, { once: true });
    beforeHost.push([orig, bytes, swap]);
    return;
  }
  const p: Promise<void> = f.provide(orig, bytes).then((ok) => {
    if (ok === false) failures++;
    else if (swap) { swaps++; swapsOf.set(orig, (swapsOf.get(orig) ?? 0) + 1); }
  }, () => { failures++; }).finally(() => { pending.delete(p); });
  pending.add(p);
}

export function applyFonts(map: Record<string, string> | null | undefined, files: Record<string, Uint8Array> | null | undefined): void {
  for (const [served, bytes] of Object.entries(files ?? {})) if (!servedBytes.has(served)) servedBytes.set(served, bytes);
  for (const [orig, served] of Object.entries(map ?? {})) {
    const bytes = servedBytes.get(served), prev = current.get(orig);
    if (!bytes || prev === served) continue;
    current.set(orig, served);
    give(orig, bytes, prev !== undefined);
    if (prev !== undefined && ![...current.values()].includes(prev)) servedBytes.delete(prev);
  }
}

export const fontSwaps = () => ({
  pending: pending.size, given: current.size, swaps, failures,
  maxPerFont: Math.max(0, ...swapsOf.values()), settled: Promise.allSettled([...pending]),
});
