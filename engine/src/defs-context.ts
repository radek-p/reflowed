// A stand-in for contextFor, for the engine's own paper tests only:
// the body-level definitions of earlier blocks, and for each \name* use the
// thm-restate `restatable` block that defines \name, typeset into a
const DEF = /^\s*\\(?:newcommand|renewcommand|providecommand|def|gdef|let|DeclareMathOperator|newcolumntype|NiceMatrixOptions)\b/;
const RESTATABLE = /\\begin\{restatable\}(?:\[(?:[^[\]]|\[[^\]]*\])*\])?\{[^}]*\}\{([^}]+)\}/;
export const isDefinitions = (s: string) => DEF.test(s.replace(/^(\s*%.*\n)*/, ''));

export function defsContexts(sources: string[]): string[] {
  const restatables = new Map<string, number>();
  sources.forEach((s, i) => { const m = RESTATABLE.exec(s); if (m) restatables.set(m[1], i); });
  const defs: string[] = [];
  return sources.map((s, i) => {
    const parts = [...defs];
    for (const m of s.matchAll(/\\([A-Za-z]+)\*/g)) {
      const j = restatables.get(m[1]);
      if (j != null && j !== i) parts.push(`\\setbox0=\\vbox{${sources[j]}}`);
    }
    if (isDefinitions(s)) defs.push(s);
    return parts.join('\n');
  });
}
