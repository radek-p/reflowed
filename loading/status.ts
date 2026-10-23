// THE ONE LOADING STATUS of the page: every fetch from either tree (tree.ts FetchEvent: the release's files fetched by
// the boot loader, the TeX Live tree's fetched synchronously by the engine worker, whose events the backend passes on
// through the worker channel) lands here. The boot overlay (page-loader.ts) and the app's status line
// (app/src/boot/load-status.ts) read it, nothing else keeps a loading state of its own.
//
//   filesStatus()            the page's store (one per page: kept on globalThis, so the inlined loader and the app's
//                            bundle share it; made on first use, also where no loader runs: the single file, a dev page)
//   createFilesStatus()      a store of one's own (tests)
//   s.expect(tree, [{ name, group, total }])   files about to be fetched (their bytes count in their group at once)
//   s.report(e)              an event
//   s.fraction(group)        0 … 1: bytes in over the group's known bytes; never goes back (1 for an empty group)
//   s.busy(group?)           a file of the group (any) is still on its way
//   s.loading(group?)        the names on their way
//   s.failures()             the files that failed and why (an assumed tree's failures, quiet, are not listed)
//   s.subscribe(fn)          fn after every change; returns its unsubscribe
// No DOM.

import type { FetchEvent } from './tree.ts';

export interface FileState { tree: string; name: string; group: string; total: number | null; got: number; state: 'expected' | 'loading' | 'done' | 'failed'; reason?: string; quiet?: boolean }
export interface FilesStatus {
  expect(tree: string, files: { name: string; group: string; total: number | null }[]): void;
  report(e: FetchEvent): void;
  fraction(group: string): number;
  busy(group?: string): boolean;
  loading(group?: string): string[];
  failures(): { tree: string; name: string; reason: string }[];
  files(): FileState[];
  subscribe(fn: () => void): () => void;
}

export function createFilesStatus(): FilesStatus {
  const files = new Map<string, FileState>();
  const shown = new Map<string, number>();
  const listeners = new Set<() => void>();
  const key = (tree: string, name: string) => `${tree}\u0000${name}`;
  const tell = () => { for (const fn of [...listeners]) fn(); };
  const of = (g?: string) => [...files.values()].filter((f) => g == null || f.group === g);
  const s: FilesStatus = {
    expect(tree, list) {
      for (const f of list) if (!files.has(key(tree, f.name))) files.set(key(tree, f.name), { tree, name: f.name, group: f.group, total: f.total, got: 0, state: 'expected' });
      tell();
    },
    report(e) {
      const k = key(e.tree, e.name);
      let f = files.get(k);
      if (e.kind === 'start') {
        if (!f || f.state === 'failed' || f.state === 'done') files.set(k, f = { tree: e.tree, name: e.name, group: e.group, total: e.total, got: f?.state === 'done' ? f.got : 0, state: 'loading', quiet: e.quiet });
        else { f.state = 'loading'; f.total ??= e.total; f.quiet = e.quiet; }
      } else if (!f) return;
      else if (e.kind === 'bytes') f.got = f.total != null ? Math.min(f.total, f.got + e.n) : f.got + e.n;
      else if (e.kind === 'done') { f.state = 'done'; f.got = f.total ?? e.bytes; delete f.reason; }
      else { f.state = 'failed'; f.reason = e.reason; f.quiet = e.quiet; }
      tell();
    },
    fraction(g) {
      let total = 0, got = 0;
      for (const f of of(g)) if (f.total != null) { total += f.total; got += f.got; }
      const v = Math.max(shown.get(g) ?? 0, total ? Math.min(1, got / total) : 1);
      shown.set(g, v);
      return v;
    },
    busy: (g) => of(g).some((f) => f.state === 'loading' || f.state === 'expected'),
    loading: (g) => of(g).filter((f) => f.state === 'loading').map((f) => f.name),
    failures: () => [...files.values()].filter((f) => f.state === 'failed' && !f.quiet).map((f) => ({ tree: f.tree, name: f.name, reason: f.reason ?? '' })),
    files: () => [...files.values()].map((f) => ({ ...f })),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  return s;
}

export function filesStatus(): FilesStatus {
  const g = globalThis as { __rtxFiles?: FilesStatus };
  return (g.__rtxFiles ??= createFilesStatus());
}

/** a whole percentage, rounded down (100 only when everything is there) */
export const percent = (f: number) => Math.floor(Math.max(0, Math.min(1, f)) * 100);

/** The boot loader's hand-off (page-loader.ts sets it; the app calls it): shown(): the UI is on screen, the overlay
 *  goes; failed(message): the app could not start, the overlay says so. None where no loader runs. */
export interface BootHandoff { shown(): void; failed(message: string): void }
export const bootHandoff = (): BootHandoff | null => (globalThis as { __rtxBoot?: BootHandoff }).__rtxBoot ?? null;
