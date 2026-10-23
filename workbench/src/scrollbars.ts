// The platform's scrollbars: classic ones take room from their box (Windows, Linux, macOS with "Show scroll bars:
// Always"); overlay ones float over the content and take none (macOS, iOS). The workbench's own bar style (css.ts: a
// thin thumb, its track below the glass header) is a styled ::-webkit-scrollbar, and a styled bar is always a classic
// one: on macOS and iOS it turned the overlay bar into a 12 px one that took that much from every view (
// System apps never reserve room for an overlay bar). So the style applies only where the bars are classic
// anyway, and overlay bars stay the platform's own.
//
//   watchScrollbars(doc)   sets <html data-wb-scrollbars="classic" | "overlay">, measured on a plain scroller (no style
//                          of ours) now and again whenever the window gets the focus back (the System Settings choice
//                          changed, a mouse plugged in); returns the off switch. html.ts calls it with the styles.
//   scrollbarMode(doc)     the measurement alone
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

export function watchScrollbars(doc: Document = document): () => void {
  const root = doc.documentElement;
  const read = () => { const m = scrollbarMode(doc); if (root.dataset.wbScrollbars !== m) root.dataset.wbScrollbars = m; };
  read();
  const win = doc.defaultView;
  win?.addEventListener('focus', read);
  return () => win?.removeEventListener('focus', read);
}
