// A small LaTeX document splitter for the engine's own tests and the paper
// report (importer is the editor's real one): \input/\include followed,
// the body cut into blocks at blank lines outside environments.

import { commentStart } from './tex-comment.ts';

export interface SplitDoc { preamble: string; blocks: { source: string; file: string }[]; bbl?: string }

/** `read(path)` → text or null; paths as written (".tex" added when missing). */
export function splitDocument(main: string, read: (path: string) => string | null, mainName = 'main.tex'): SplitDoc {
  const b = main.indexOf('\\begin{document}'), e = main.lastIndexOf('\\end{document}');
  if (b < 0) throw new Error('no \\begin{document}');
  const preamble = main.slice(0, b).replace(/\s+$/, '');
  const body = main.slice(b + '\\begin{document}'.length, e < 0 ? undefined : e);
  const blocks: { source: string; file: string }[] = [];
  const addFrom = (text: string, file: string) => {
    let cur: string[] = [], depth = 0, braces = 0;
    const flush = () => {
      const s = cur.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
      if (s && s.split('\n').some((l) => l.trim() && !/^\s*%/.test(l))) blocks.push({ source: s, file });
      cur = [];
    };
    for (const line of text.split('\n')) {
      const code = line.slice(0, commentStart(line));
      const inp = /^\s*\\(?:input|include)\{([^}]+)\}\s*$/.exec(code);
      if (inp && depth === 0 && braces === 0) {
        flush();
        const p = /\.tex$/.test(inp[1]) ? inp[1] : `${inp[1]}.tex`;
        const t = read(p);
        if (t != null) addFrom(t, p); else { cur.push(line); flush(); }
        continue;
      }
      if (!code.trim() && depth === 0 && braces === 0) { flush(); continue; }
      cur.push(line);
      for (const m of code.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
        if (m[2] === 'document') continue;
        depth += m[1] === 'begin' ? 1 : -1;
      }
      if (depth < 0) depth = 0;
      for (const ch of code.replace(/\\\\/g, "").replace(/\\[{}]/g, "")) braces += ch === "{" ? 1 : ch === "}" ? -1 : 0;
      if (braces < 0) braces = 0;
    }
    flush();
  };
  addFrom(body, mainName);
  return { preamble, blocks };
}
