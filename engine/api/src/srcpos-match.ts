// Whether a glyph's character is what the source has at its position,
// allowing ligatures (ﬁ = fi), precomposition, and the input conventions of
// TeX Live's tex-text mapping (`` → “, -- → –, --- → —, ' → ’).
const MAPPED: Record<string, string[]> = {
  '“': ['``'], '”': ["''"], '‘': ['`'], '’': ["'"], '–': ['--'], '—': ['---'], '¡': ['!`'], '¿': ['?`'],
};
export function matches(glyph: string, source: string): boolean {
  if (glyph === source) return true;
  const k = glyph.normalize('NFKD'), s = source.normalize('NFKD');
  if (k === s || k === source || glyph.normalize('NFC') === source.normalize('NFC')) return true;
  return (MAPPED[glyph] ?? []).includes(source);
}
