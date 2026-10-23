// A document's preamble and bibliography (out of app.js): written, saved, the engine told, and
// every block's context and key recomputed. Document settings (settings/) and the References pane (bibpane/) call these;
// an undo of either comes back through setMeta (app.js).
//
//   const meta = createDocMeta(host)
//     meta.putPreamble(text)             the preamble set (unchanged text: nothing), saved, then onPreamble()
//     meta.onPreamble()                  what a new preamble asks: every block typesets again, the engine takes it
//     meta.applyBib(bib, after?)         doc.bib set and saved, the engine told, every block's context recomputed
//     meta.setBibliography(bib, label, after?)   the same, as one undo step
//     meta.bibAgain(bib)                 an undo or a redo of it (the pane's last follow-up again)
//     meta.bibInfo()                     the bibliography in a few words (Document settings)

/** What the preamble and bibliography need of the open document. */
export interface MetaDoc { preamble: { source: string; rev?: number }; bib?: Bib | null; blocks: unknown[] }
export interface Bib { kind?: string; source?: string; entries?: unknown[] }
interface PreambleResult { errors?: unknown[]; warnings?: unknown[] }

/** What createDocEditor (app.js) gives: the document, its writes, the engine, and what follows a change of every block. */
export interface DocMetaHost {
  doc(): MetaDoc | null;
  saveMeta(patch: { preamble?: MetaDoc['preamble']; bib?: Bib | null }): void;
  /** the backend (engine) of the document now: it holds a preamble and a bibliography of its own */
  backend(): { setPreamble?(source: string): Promise<PreambleResult | undefined> | PreambleResult | undefined; setBib?(bib: Bib | null): unknown };
  /** the preamble the engine compiles against (the title data left out: meta/compile.ts) */
  enginePreamble(): string;
  /** derived values that depend on the preamble (its key, its theorem kinds: doc/derived.js) */
  preambleChanged(): void;
  /** every block typesets again: the status's full bar */
  statusFull(): void;
  /** the preamble's problems, from the engine (cleared by a new preamble) */
  setPreambleResult(r: PreambleResult): void;
  /** the preamble's problems shown (Document settings' list, the outline entry's badge) */
  showPreambleState(): void;
  /** every block's context and key recomputed, every view displayed again, the page refreshed (a change of what all
   *  blocks compile against) */
  everyBlockChanged(): void;
  compileSoon(): void;
  /** the engine warmed again */
  warm(): void;
  /** doFn as one undo step */
  perform(label: string, doFn: () => void): void;
}

export function createDocMeta(host: DocMetaHost) {
  let bibAfter: ((bib: Bib | null) => void) | null = null;   // the References pane's follow-up of a bibliography change
  function onPreamble() {
    const d = host.doc();
    if (!d) return;
    host.statusFull();                                     // every block typesets again: the full bar
    host.preambleChanged();
    host.setPreambleResult({ errors: [], warnings: [] });
    host.showPreambleState();
    // the backend keys results by the preamble it holds, which it takes when its queue gets to this call:
    // the keys move then, so the queue looks again (a result cached under the new key is shown, the rest compile)
    Promise.resolve(host.backend().setPreamble?.(host.enginePreamble()))
      .then((r) => { if (r?.errors?.length) { host.setPreambleResult(r); host.showPreambleState(); } }).catch(() => {})
      .then(() => { if (host.doc() === d) host.compileSoon(); });
    host.everyBlockChanged();
    host.warm();                                           // warm again for the new preamble
  }
  function putPreamble(text: string) {
    const d = host.doc();
    if (!d || text === d.preamble.source) return;
    d.preamble = { source: text, rev: (d.preamble.rev ?? 0) + 1 };
    host.saveMeta({ preamble: d.preamble });
    onPreamble();
  }
  /** doc.bib = bib: saved (putMeta + a meta op), the engine told, contexts and keys recomputed, due blocks typeset */
  function applyBib(bib: Bib | null, after: ((bib: Bib | null) => void) | null = null) {
    const d = host.doc();
    if (!d) return;
    d.bib = bib;
    if (after) bibAfter = after;
    host.saveMeta({ bib });
    Promise.resolve(host.backend().setBib?.(bib)).catch((e: Error) => console.warn('setBib:', e.message));
    try { after?.(bib); } catch (e) { console.error('bib after:', e); }
    host.everyBlockChanged();
  }
  return {
    putPreamble, onPreamble, applyBib,
    /** an undo or a redo of the bibliography: with the References pane's last follow-up */
    bibAgain(bib: Bib | null) { applyBib(bib, bibAfter); },
    setBibliography(bib: Bib | null, label = 'bibliography', after: ((bib: Bib | null) => void) | null = null) { host.perform(label, () => applyBib(bib, after)); },
    bibInfo(): string {
      const b = host.doc()?.bib;
      const n = b?.entries?.length ?? (b?.source?.match(/\\entry\{|\\bibitem\b/g) || []).length;
      return b?.kind && b.kind !== 'none' ? `${b.kind} · ${n} entries` : 'none (a thebibliography block, or import a .bbl)';
    },
  };
}
