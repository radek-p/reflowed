// An SVG element's screen matrix with CSS `zoom` in it, in every browser. The text size (View options) is CSS zoom on
// each block element (view/style.js). Chromium (128+) and Firefox put an ancestor's zoom into getScreenCTM(); WebKit
// (Safari; WebKitGTK 2.52 measured 2026-10-14) leaves it out: the matrix is the page's divided by the zoom (scale 1,
// offsets / zoom), while getBoundingClientRect() and pointer events are in page px. Every glyph box and click mapped
// through it was off by the zoom factor in Safari at any text size but 100 %.
//
//   screenCTM(el) -> DOMMatrix | null      el.getScreenCTM(), scaled by el's effective zoom where the browser leaves it out
//   effectiveZoom(el) -> number            the product of the zoom of el and its ancestors
//   zoomInScreenCTM() -> boolean           whether this browser's getScreenCTM() has CSS zoom in it (measured once)

let withZoom: boolean | null = null;

/** measured once: an SVG in a zoom: 2 box, its matrix's scale */
export function zoomInScreenCTM(): boolean {
  if (withZoom != null) return withZoom;
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-10000px;top:0;zoom:2;visibility:hidden;pointer-events:none';
  box.innerHTML = '<svg width="10" height="10"><rect width="1" height="1"/></svg>';
  (document.body ?? document.documentElement).append(box);
  const m = (box.firstElementChild as SVGSVGElement | null)?.getScreenCTM?.() ?? null;
  box.remove();
  withZoom = !m || Math.abs(m.a - 1) > 0.01;     // no matrix (not laid out): assume the standard
  return withZoom;
}

export function effectiveZoom(el: Element): number {
  let z = 1;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const v = parseFloat(getComputedStyle(e).zoom);
    if (v > 0 && v !== 1) z *= v;
  }
  return z;
}

export function screenCTM(el: SVGGraphicsElement | null | undefined): DOMMatrix | null {
  const m = el?.getScreenCTM?.() ?? null;
  if (!m || !el || zoomInScreenCTM()) return m;
  const z = effectiveZoom(el);
  return z === 1 ? m : new DOMMatrix([m.a * z, m.b * z, m.c * z, m.d * z, m.e * z, m.f * z]);
}
