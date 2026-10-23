// TeX strings as plain text, for what TeX hands the overlay as strings:
// cleveref's format samples ("Lemma\protect \nobreakspace  \rtx@N "), a
// label's \@currentlabel ("{$\star $}"), bbl fields ("Mäh24",
// "Gro{\etalchar{+}}15", "5562\bibrangedash 5568"). Not a TeX interpreter:
// the common macros only, the rest dropped with their braces kept as text.

const NBSP = ' ';

/** Symbols seen in labels and tags. */
const SYMBOLS: Record<string, string> = {
  star: '⋆', ast: '∗', dagger: '†', ddagger: '‡', S: '§', P: '¶', bullet: '•', circ: '∘',
  dag: '†', ddag: '‡', natural: '♮', sharp: '♯', flat: '♭', prime: '′', infty: '∞',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', lambda: 'λ', mu: 'μ',
  pi: 'π', sigma: 'σ', tau: 'τ', phi: 'ϕ', varphi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Sigma: 'Σ',
  Omega: 'Ω', ldots: '…', dots: '…', textendash: '–', textemdash: '—', bibrangedash: '–',
  bibinitperiod: '.', bibinitdelim: NBSP, bibnamedelima: ' ', bibnamedelimb: ' ', bibnamedelimc: ' ',
  bibnamedelimd: ' ', bibnamedelimi: ' ', bibinithyphendelim: '.-', nobreakspace: NBSP, space: ' ',
  textbackslash: '\\', '&': '&', '%': '%', '$': '$', '#': '#', _: '_', '{': '{', '}': '}', ' ': ' ',
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı',
};
/** Accents: \"{a}, \'e, \v{c} … as combining marks. */
const ACCENTS: Record<string, string> = {
  '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
};
/** Macros whose argument is kept (a font or case change, a wrapper). */
const KEEP_ARG = new Set(['textup', 'textbf', 'textit', 'emph', 'textrm', 'textsf', 'texttt', 'textsc', 'mbox',
  'hbox', 'text', 'textnormal', 'mathrm', 'mathbf', 'mathit', 'ensuremath', 'etalchar', 'NoCaseChange',
  'bibstring', 'mkbibemph', 'mkbibquote', 'textsuperscript', 'hyperlink', 'url', 'href']);
const UPPER = new Set(['MakeUppercase', 'uppercase', 'MakeTextUppercase']);
const LOWER = new Set(['MakeLowercase', 'lowercase', 'MakeTextLowercase']);
/** Dropped with nothing: spacing and bookkeeping that print nothing. */
const DROP = new Set(['protect', 'relax', 'ignorespaces', 'unskip', 'leavevmode', 'nobreak', 'hspace', 'kern',
  'normalfont', 'itshape', 'bfseries', 'upshape', 'rmfamily', 'sffamily', 'ttfamily', 'scshape', 'mdseries',
  'rtx@N', 'bibinfo', 'begingroup', 'endgroup', 'makeatletter', 'makeatother', 'noexpand', 'unexpanded']);

/** A TeX string as text. `N`: what \rtx@N (the overlay's number placeholder) becomes. */
export function texToText(src: string, N = ''): string {
  let out = '';
  let i = 0;
  const n = src.length;
  // one argument: a {group} or a single token, as text
  const arg = (): string => {
    while (i < n && src[i] === ' ') i++;
    if (src[i] === '[') {                         // an optional argument: skipped
      let d = 0;
      for (; i < n; i++) { if (src[i] === '[') d++; else if (src[i] === ']' && --d === 0) { i++; break; } }
      while (i < n && src[i] === ' ') i++;
    }
    if (src[i] === '{') {
      let d = 0; const s = i;
      for (; i < n; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '{') d++;
        else if (src[i] === '}' && --d === 0) { i++; break; }
      }
      return texToText(src.slice(s + 1, i - 1), N);
    }
    if (src[i] === '\\') { const m = /^\\([a-zA-Z@]+|.)\s*/.exec(src.slice(i)); if (m) { i += m[0].length; return texToText(m[0], N); } }
    return src[i++] ?? '';
  };
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z@]+)\s*|^\\(.)/.exec(src.slice(i));
      if (!m) { i++; continue; }
      i += m[0].length;
      const name = m[1] ?? m[2];
      if (name === 'rtx@N') { out += N; continue; }
      if (name in ACCENTS && (m[2] !== undefined || /^[a-zA-Z]$/.test(name))) {
        const a = arg();
        out += a ? (a.charAt(0) + ACCENTS[name] + a.slice(1)).normalize('NFC') : '';
        continue;
      }
      if (name in SYMBOLS) { out += SYMBOLS[name]; if (name === 'nobreakspace' && src.startsWith('{}', i)) i += 2; continue; }
      if (UPPER.has(name)) { out += arg().toUpperCase(); continue; }
      if (LOWER.has(name)) { out += arg().toLowerCase(); continue; }
      if (KEEP_ARG.has(name)) { out += arg(); continue; }
      if (DROP.has(name)) continue;
      if (name === 'def') {                        // \def\x{...}: drop the definition
        const m2 = /^\s*\\[a-zA-Z@]+/.exec(src.slice(i)); if (m2) i += m2[0].length;
        arg(); continue;
      }
      if (name === 'setcounter') { arg(); arg(); continue; }
      continue;                                    // an unknown macro prints nothing
    }
    if (c === '{' || c === '}' || c === '$') { i++; continue; }
    if (c === '~') { out += NBSP; i++; continue; }
    if (c === '-' && src.startsWith('---', i)) { out += '—'; i += 3; continue; }
    if (c === '-' && src.startsWith('--', i)) { out += '–'; i += 2; continue; }
    if (c === '^' || c === '_') { i++; out += arg(); continue; }
    out += c; i++;
  }
  return out.replace(/[ \t\n]+/g, ' ');
}

