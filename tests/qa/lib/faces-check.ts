// Every font of the blocks' results has its face, as the public pipeline records it (latex.proto FontInfo: kind,
// filename, reason; src/shared/font-face.ts): a kind the schema knows, a file for a face drawn from one, and no
// font drawn as boxes (nothing of a default document may go undrawn). Node, on the encoded results (their
// nodelists), with the public schema. Used by scripts/build.ts on the seed cache it makes (the intro), and by
// engine/tests/faces.test.ts.
//
//   faceProblems(results, Document) -> { problems: string[], kinds: { kind: count } }

/** The public schema's Document (src/pipeline/schema.ts messageType('Document')), as far as this needs it. */
export interface DocumentType {
  decode(bytes: Uint8Array): unknown;
  toObject(m: unknown, o: { defaults: boolean; arrays: boolean; enums: StringConstructor; longs: NumberConstructor }): unknown;
}
interface WireFont { name?: string; kind?: string; filename?: string; reason?: string }

const FILE_KINDS = new Set(['opentype', 'type1', 'bitmap']);

export function faceProblems(results: Record<string, { nodelist?: string | null }>, Document: DocumentType): { problems: string[]; kinds: Record<string, number> } {
  const problems: string[] = [], kinds: Record<string, number> = {};
  for (const [key, r] of Object.entries(results)) {
    if (!r?.nodelist) continue;
    const doc = Document.toObject(Document.decode(Buffer.from(r.nodelist, 'base64')), { defaults: false, arrays: true, enums: String, longs: Number }) as { fonts?: WireFont[] };
    for (const f of doc.fonts ?? []) {
      const kind = f.kind ?? '(none)';
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      const where = `${key.slice(0, 24)}…: font ${f.name}`;
      if (FILE_KINDS.has(kind)) { if (!f.filename || f.filename === 'unknown') problems.push(`${where}: a ${kind} face that names no file (${f.filename ?? 'none'})`); }
      else if (kind === 'boxes') problems.push(`${where}: no face, drawn as boxes (${f.reason ?? ''})`);
      else if (kind !== 'virtual') problems.push(`${where}: no face kind on the wire (${kind})`);
    }
  }
  return { problems, kinds };
}
