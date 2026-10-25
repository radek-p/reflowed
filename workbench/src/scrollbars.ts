// The platform's scrollbars: classic ones take room from their box (Windows, Linux, macOS with "Show scroll bars:
// Always"); overlay ones float over the content and take none (macOS, iOS). The workbench's views run under a glass
// header, so a bar spanning a view runs under it too. Where the bars are classic, css.ts styles them (a thin thumb, the
// track inset below the header: ::-webkit-scrollbar). A styled bar is always a classic one: on macOS and iOS it turned
// the overlay bar into a 12 px one that took that much from every view (System apps never reserve room for an overlay
// bar), and Firefox has no track inset. So where the bars are overlay ones, and in Firefox, css.ts hides the native bar
// and the workbench draws its own overlay bar (overlay-scrollbar.ts), its track below the header.
//
//   watchScrollbars(doc)   sets <html data-wb-scrollbars="classic" | "overlay">, measured on a plain scroller (no style
//                          of ours) now and again whenever the window gets the focus back (the System Settings choice
//                          changed, a mouse plugged in); returns the off switch. html.ts calls it with the styles.
//   scrollbarMode(doc)     the measurement alone
//   ownScrollbars(doc)     the workbench draws its own bars: overlay ones measured, or no ::-webkit-scrollbar (Firefox)
export type ScrollbarMode = 'classic' | 'overlay';

/** The width a plain scroller's vertical bar takes from it: 0 for overlay bars (and for hidden ones: headless). */
export function scrollbarMode(doc: Document = document): ScrollbarMode {
  const d = doc.createElement('div');
  d.style.cssText = 'position:absolute;top:-200px;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none';
  doc.documentElement.append(d);
  const room = d.offsetWidth - d.clientWidth;
  d.remove();
  return room > 0 ? 'classic' : 'overlay';
}

let webkitBars: boolean | null = null;
/** The bars are the workbench's own (overlay-scrollbar.ts): where they are overlay ones, and where no
 *  ::-webkit-scrollbar can inset a classic one's track (Firefox). The CSS makes the same choice (css.ts). */
export function ownScrollbars(doc: Document = document): boolean {
  webkitBars ??= typeof CSS !== 'undefined' && CSS.supports('selector(::-webkit-scrollbar)');
  return doc.documentElement.dataset.wbScrollbars === 'overlay' || !webkitBars;
}

export function watchScrollbars(doc: Document = document): () => void {
  const root = doc.documentElement;
  const read = () => { const m = scrollbarMode(doc); if (root.dataset.wbScrollbars !== m) root.dataset.wbScrollbars = m; };
  read();
  const win = doc.defaultView;
  win?.addEventListener('focus', read);
  return () => win?.removeEventListener('focus', read);
}
