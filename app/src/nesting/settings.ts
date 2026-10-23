// the one setting. "Split long proofs and theorems into paragraphs on
// import" (on unless turned off; kept per browser). Node (tests, the seed
// build) has no localStorage: on.
export const NEST_KEY = 'rtx-editor.nest-import';

export function nestOnImport(): boolean {
  try { return (globalThis as any).localStorage?.getItem(NEST_KEY) !== '0'; } catch { return true; }
}

export function setNestOnImport(on: boolean): void {
  try { (globalThis as any).localStorage?.setItem(NEST_KEY, on ? '1' : '0'); } catch { /* not kept */ }
}
