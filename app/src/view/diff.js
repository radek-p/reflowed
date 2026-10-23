// a small character diff between the last source that compiled and the
// current one (the error note's "Show changes"). Common prefix and suffix
// are trimmed; the middle is diffed by LCS when small (≤ 250 000 cells),
// else shown as one deletion and one insertion. The view shows the changed
// lines only, with the rest of those lines as context: edit/panel.js draws it (Preact); this module is the
// diff only (its DOM builder, diffView, went with the move to Preact).
export function charDiff(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s), B = b.slice(p, b.length - s);
  const mid = [];
  if (A.length * B.length <= 250000 && A.length && B.length) {
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    const push = (t, ch) => { const last = mid[mid.length - 1]; if (last?.t === t) last.s += ch; else mid.push({ t, s: ch }); };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { push('-', A[i]); i++; } else { push('+', B[j]); j++; }
    }
    while (i < n) push('-', A[i++]);
    while (j < m) push('+', B[j++]);
  } else {
    if (A) mid.push({ t: '-', s: A });
    if (B) mid.push({ t: '+', s: B });
  }
  return { prefix: a.slice(0, p), ops: mid, suffix: a.slice(a.length - s) };
}
