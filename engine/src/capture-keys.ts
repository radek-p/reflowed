// What the editor's capture records for its own use and the wire format does not carry (latex.proto has no field
// for it), by message, as the public encoder's PIPELINE_ONLY names the pipeline's own: taken off a block's data
// just before it is encoded (worker.ts). The public encoder refuses any other key it has no field for, so a key
// the capture adds and no one names here fails the block loudly ("latex.proto's Paragraph has no field …"),
// never silently.
//
//   Paragraph    tex_breaks (TeX's own breaks at the source width, convert.ts), source (its source lines)
//   ContentItem  display_id, display_row (a display's identity across the samples), display_place (TeX's
//                equation-number placement inputs: displays.ts), display_route1, display_sampled (how its
//                affine model was made)
//
//   dropCaptureKeys(data) -> number of keys taken off (mutates data)

type J = Record<string, unknown>;

export const CAPTURE_ONLY = {
  Paragraph: ['tex_breaks', 'source'],
  ContentItem: ['display_id', 'display_row', 'display_place', 'display_route1', 'display_sampled'],
} as const;

/** Every content item: the main flow's and each stream's, with their wide forms (each a ContentItem). */
function contentItems(data: { content?: unknown; streams?: unknown }): J[] {
  const out: J[] = [];
  const add = (items: unknown) => {
    for (const it of Array.isArray(items) ? items as J[] : []) {
      if (!it || typeof it !== 'object') continue;
      out.push(it);
      if (it.display_wide && typeof it.display_wide === 'object') out.push(it.display_wide as J);
    }
  };
  add(data.content);
  for (const s of Array.isArray(data.streams) ? data.streams as J[] : []) add(s?.content);
  return out;
}

export function dropCaptureKeys(data: { paragraphs?: unknown; content?: unknown; streams?: unknown }): number {
  let n = 0;
  const drop = (o: J, keys: readonly string[]) => { for (const k of keys) if (k in o) { delete o[k]; n++; } };
  for (const p of Array.isArray(data.paragraphs) ? data.paragraphs as J[] : []) if (p && typeof p === 'object') drop(p, CAPTURE_ONLY.Paragraph);
  for (const it of contentItems(data)) drop(it, CAPTURE_ONLY.ContentItem);
  return n;
}
