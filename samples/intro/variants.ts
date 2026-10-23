// SPDX-License-Identifier: AGPL-3.0-or-later
// The intro's two versions from one source (source/main.tex): the editor's (seed-intro.ts: the default document) and
// the website's (website/tools/prepare-intro.ts: the home page). A line that starts with %% is for this selection
// only and is left out of both versions:
//
//   %% editor:      opens a passage kept only in the editor's version
//   %% site:        opens a passage kept only in the website's version
//   %% end          closes the passage
//   %% <anything>   a comment about the two versions (left out of both)
//
// Passages hold whole lines (whole sentences or paragraphs), do not nest, and every one is closed. A line
// that is almost a marker (%% editor without the colon, %% End) is an error, so a typo never shows on either side.
//
//   versionOf(tex, 'editor' | 'site'): the source for that version, every %% line gone
//   passagesOf(tex): the lines of each kind of passage (for the tests: what must not show on the other side)

export type Version = 'editor' | 'site';

interface Line { text: string; only?: Version; marker: boolean }

const MARKER = /^\s*%%(.*)$/;
const OPENS: Record<string, Version> = { 'editor:': 'editor', 'site:': 'site' };

function linesOf(tex: string): Line[] {
  const out: Line[] = [];
  let open: { version: Version; at: number } | null = null;
  const lines = tex.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    const m = MARKER.exec(text);
    if (!m) { out.push({ text, ...(open ? { only: open.version } : {}), marker: false }); continue; }
    const word = (m[1] ?? '').trim();
    const opens = OPENS[word];
    if (opens) {
      if (open) throw new Error(`intro versions: line ${i + 1}: "%% ${word}" inside the passage opened at line ${open.at}`);
      open = { version: opens, at: i + 1 };
    } else if (word === 'end') {
      if (!open) throw new Error(`intro versions: line ${i + 1}: "%% end" with no passage open`);
      open = null;
    } else if (/^(editor|site|end):?$/i.test(word)) {
      throw new Error(`intro versions: line ${i + 1}: "%% ${word}" is not a marker (%% editor:, %% site:, %% end)`);
    }
    out.push({ text, marker: true });
  }
  if (open) throw new Error(`intro versions: the passage opened at line ${open.at} is never closed (%% end)`);
  return out;
}

/** The source for one version: the other version's passages and every %% line left out. */
export function versionOf(tex: string, version: Version): string {
  return linesOf(tex).filter((l) => !l.marker && (!l.only || l.only === version)).map((l) => l.text).join('\n');
}

/** The non-blank lines of the editor's passages and of the site's. */
export function passagesOf(tex: string): Record<Version, string[]> {
  const out: Record<Version, string[]> = { editor: [], site: [] };
  for (const l of linesOf(tex)) if (l.only && l.text.trim()) out[l.only].push(l.text.trim());
  return out;
}
