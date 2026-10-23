// The text contrast of an element against what is painted under it (WCAG 2 ratio), in the page: install once with
// page.addInitScript(CONTRAST) (or page.evaluate(CONTRAST)), then window.__contrast(el) -> number (one decimal).
// The same measure as test-settings / test-w15: the element's colour composited over its painted ground.
export const CONTRAST = `(() => {
  const cv = document.createElement('canvas').getContext('2d');
  const rgba = (c) => { const sr = c.match(/^color\\(srgb ([\\d.e-]+) ([\\d.e-]+) ([\\d.e-]+)(?: \\/ ([\\d.e-]+))?\\)$/); if (sr) return [+sr[1] * 255, +sr[2] * 255, +sr[3] * 255, sr[4] == null ? 1 : +sr[4]];
    cv.fillStyle = '#000'; cv.fillStyle = c; const v = cv.fillStyle; if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
    const m = v.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const over = (t, u) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
  const painted = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) st.push(c); if (c[3] >= 1) break; } let a = [255, 255, 255, 1]; for (const c of st.reverse()) a = over(c, a); return a; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  window.__contrast = (el) => el ? Math.round(ratio(over(rgba(getComputedStyle(el).color), painted(el)), painted(el)) * 10) / 10 : null;
  window.__ground = (el) => Math.round(lum(painted(el)) * 1000) / 1000;
})();`;
