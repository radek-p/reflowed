// Used by the engine (compile.ts) and the LuaLaTeX dev servers (app/src/lua-dev).
// TeX log -> problems (errors and warnings), for any backend: the server's
// LuaLaTeX run and, later, Tectonic's log in the browser. Plain JS, so both
// Node (server/serve.ts) and the page import it.
//
//   parseLog(log) -> [{ severity, message, line, context, detail }]
//     severity  'error' | 'warning' | 'info'
//     line      the line TeX named in the file it was reading (l.<n>, "on
//               input line <n>", "at lines <a>--<b>"), or null; the backend
//               maps it to the source's own lines
//     context   for an error, TeX's l.<n> line: the text up to where TeX
//               stopped (src/texlog.js errorColumns uses it)
//
//   unwrap(lines) -> lines   TeX's hard-wrapped lines joined back (missing-chars.ts too)
//
//   errorRange(problem, sourceLine) -> [startColumn, endColumn] (1-based,
//     end exclusive), the token TeX stopped after, or null.

const WRAP = 79;   // TeX's max_print_line: a log line this long continues on the next

/** Joins TeX's hard-wrapped lines back (a line exactly WRAP characters long
 *  continues on the next one). */
export function unwrap(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    while (l.length === WRAP && i + 1 < lines.length) l += lines[++i];
    out.push(l);
  }
  return out;
}

const WARNING_RE = /^(?:LaTeX|(?:Package|Class) ([\w.-]+)) Warning: (.*)$/;
const BOX_RE = /^((?:Over|Under)full \\[hv]box .*?)(?: (?:in paragraph|in alignment|detected) at lines? (\d+)(?:--(\d+))?| has occurred while \\output is active.*)?$/;

export function parseLog(log) {
  if (!log) return [];
  const lines = unwrap(log.split(/\r?\n/));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('! ')) {
      // An error: the message, then (within a few lines) TeX's l.<n> context.
      let message = l.slice(2).trim();
      let line = null, context = null;
      const detail = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        const m = /^l\.(\d+) ?(.*)$/.exec(lines[j]);
        if (m) {
          line = Number(m[1]); context = m[2];
          i = j;
          break;
        }
        if (lines[j].startsWith('! ')) break;
        detail.push(lines[j]);
      }
      // "! LaTeX Error: File `x.sty' not found." and the like carry on in
      // the next line until a blank one; most messages are one line.
      if (/[^.]$/.test(message) && detail.length && detail[0].trim() && !/^(See|Type|<|\s)/.test(detail[0]))
        message += ` ${detail[0].trim()}`;
      out.push({ severity: 'error', message, line, context, detail: detail.join('\n').trim() });
      continue;
    }
    let m = WARNING_RE.exec(l);
    if (m) {
      // continued lines are indented by "(pkg)" or spaces, up to a blank line
      let text = m[2];
      for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) {
        const cont = /^\(([\w.-]+)\)\s+(.*)$/.exec(lines[j]);
        if (cont && (!m[1] || cont[1] === m[1])) { text += ` ${cont[2]}`; i = j; continue; }
        if (/^\s{4,}\S/.test(lines[j])) { text += ` ${lines[j].trim()}`; i = j; continue; }
        break;
      }
      const at = /on input line (\d+)\.?/.exec(text);
      const message = (m[1] ? `${m[1]}: ` : '') + text.replace(/\s*on input line \d+\.?$/, '').replace(/\s+/g, ' ').trim();
      out.push({ severity: 'warning', message, line: at ? Number(at[1]) : null, context: null, detail: '' });
      continue;
    }
    m = BOX_RE.exec(l);
    if (m && /^(Over|Under)full/.test(l)) {
      const over = l.startsWith('Over');
      out.push({ severity: over ? 'warning' : 'info', message: m[1], line: m[2] ? Number(m[2]) : null,
        endLine: m[3] ? Number(m[3]) : null, context: null, detail: '' });
    }
  }
  // The same message at the same line once (TeX may report it in every pass).
  const seen = new Set();
  return out.filter((p) => { const k = `${p.severity}|${p.line}|${p.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The columns of the token TeX stopped after, on the source line: TeX's
 *  context is the line up to that point (with "..." for a long line's start). */
export function errorRange(p, sourceLine) {
  if (p.context == null || sourceLine == null) return null;
  let top = p.context.replace(/\s+$/, '');
  let start = 0;
  if (top.startsWith('...')) {
    top = top.slice(3);
    const k = sourceLine.indexOf(top);
    if (k < 0) return null;
    start = k;
  } else if (!sourceLine.startsWith(top)) {
    const k = sourceLine.indexOf(top);
    if (k < 0) return null;
    start = k;
  }
  const end = start + top.length;          // 0-based, exclusive
  // the control word TeX was expanding, when only a character or two it
  // peeked at follows it (\bar. -> \bar); else the last token
  const tok = /(\\[A-Za-z@]+\*?)[^\\A-Za-z\s]{0,2}\s*$/.exec(top) ?? /(\\[A-Za-z@]+\*?|\\.|\S)\s*$/.exec(top);
  if (!tok) return null;
  const tokStart = end - tok[0].length;
  return [tokStart + 1, tokStart + tok[1].length + 1];
}
