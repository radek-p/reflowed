// Errors that can be copied. Every error row is selectable
// text, and has a Copy button that puts a plain-text report on the clipboard:
// the document, the block (kind, id, place, section), TeX's message with its
// line (the block's and the compiled file's), the source around that line,
// TeX's own context lines (`l.<n> …`, the `!` detail) and the engine build.
//
//   errorReport(info) -> string        info: see below
//   copyText(text) -> Promise<boolean>
//   selecting(row) -> bool             a click that ends a text selection
// The Copy button is the kit's (design/ui/copy.js CopyButton), used by edit/panel.js and sidebar/index.ts.
export function errorReport({ title = '', backend = '', build = '', where = null, problem = {}, source = '', firstLine = null, file = '', extra = '' }) {
  const out = ['Reflow TeX error report'];
  if (title) out.push(`Document: ${title}`);
  if (where) {
    const pos = where.index != null ? ` (block ${where.index + 1} of ${where.count}${where.section ? `, in ${where.section}` : ''})` : '';
    out.push(where.preamble ? 'Where: the preamble (Document settings)' : `Block: ${where.kind || 'block'} ${where.id}${pos}`);
  }
  out.push(`${problem.severity === 'warning' ? 'Warning' : 'Error'}: ${problem.message ?? ''}`);
  if (problem.line != null) {
    const fileLine = firstLine != null ? problem.line + firstLine - 1 : null;
    out.push(`Line: ${problem.line} of the ${where?.preamble ? 'preamble' : 'block'}${fileLine != null ? ` (${file || 'the compiled file'}, line ${fileLine})` : ''}`);
  }
  if (problem.context) out.push(`TeX: ${String(problem.context).trim()}`);
  if (problem.detail) out.push('TeX log:', ...String(problem.detail).trimEnd().split('\n').map((l) => `  ${l}`));
  if (source) {
    const lines = source.split('\n');
    const at = problem.line != null ? Math.min(Math.max(problem.line, 1), lines.length) : null;
    const from = at != null ? Math.max(1, at - 3) : 1, to = at != null ? Math.min(lines.length, at + 3) : Math.min(lines.length, 7);
    const w = String(to).length;
    out.push(`Source (lines ${from}-${to} of ${lines.length}):`);
    for (let n = from; n <= to; n++) out.push(`${n === at ? '>' : ' '} ${String(n).padStart(w)} | ${lines[n - 1]}`);
  }
  if (extra) out.push(extra);
  out.push(`Engine: ${backend || '?'}${build ? `, build ${build}` : ''}`);
  return out.join('\n');
}

export { copyText } from '../design/ui/copy.js';   // the kit's one clipboard write

/** A row's click that ends a text selection is a selection, not a click. */
export const selecting = (row) => {
  const s = getSelection?.();
  return !!s && !s.isCollapsed && row.contains(s.anchorNode);
};
