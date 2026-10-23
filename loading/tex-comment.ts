// Where a TeX line's comment starts: the one rule every reader of TeX source uses (here, so loading/, the engine and
// the app share it; loading/ imports nothing from outside itself). \% is a percent sign, \\% a line break then a
// comment: escapes are read as pairs.
//
//   commentStart(line)   where the comment starts (the line's length when there is none)
//   stripComments(tex)   every line without its comment (the lines kept, so line numbers hold)

export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '%') return i;
  }
  return line.length;
}

export function stripComments(tex: string): string {
  return tex.split('\n').map((l) => l.slice(0, commentStart(l))).join('\n');
}
