// Go to the definition of a reference or a citation (out of app.js, pure, Node-tested): where a
// \ref's \label is, or a \cite's \bibitem, or the bibliography block when the entry is only in the .bbl data. The caller
// reveals the place and says the message.
//
//   definitionOf({ type: 'ref' | 'cite', key }, { blocks, refs }) ->
//     { block, range: { from, to } | null, edit?: false, say?: string } | { say } (not found)
import { scanLabels } from '../tex/texscan.js';

export interface DefBlock { id: string; kind?: string; source: string }
export interface DefRefs { labels: Record<string, { blockId?: string; offset?: number } | undefined>; bib: Record<string, { label?: string } | undefined> }
export type Definition = { block: string; range: { from: number; to: number } | null; edit?: false; say?: string } | { block?: undefined; say: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function definitionOf(k: { type: string; key: string }, { blocks, refs }: { blocks: DefBlock[]; refs: DefRefs }): Definition {
  if (k.type === 'ref') {
    const l = refs.labels[k.key];
    const b = l?.blockId ? blocks.find((x) => x.id === l.blockId) : blocks.find((x) => (scanLabels(x.source) as { name: string }[]).some((y) => y.name === k.key));
    if (!b) return { say: `No \\label{${k.key}} in this document` };
    const off = l?.offset ?? b.source.indexOf(`\\label{${k.key}}`);
    return { block: b.id, range: off >= 0 ? { from: off, to: off + k.key.length + 8 } : null };
  }
  const item = new RegExp(`\\\\bibitem\\s*(\\[[^\\]]*\\])?\\s*\\{${escape(k.key)}\\}`);
  const withItem = blocks.find((b) => item.test(b.source));
  if (withItem) {
    const off = withItem.source.search(new RegExp(`\\{${escape(k.key)}\\}`));
    return { block: withItem.id, range: off >= 0 ? { from: off + 1, to: off + 1 + k.key.length } : null };
  }
  const bibBlock = blocks.find((b) => b.kind === 'bibliography');
  const entry = refs.bib[k.key];
  if (entry && bibBlock) return { block: bibBlock.id, range: null, edit: false, say: `${entry.label ?? k.key} is in the bibliography data (.bbl)` };
  return { say: `No entry ${k.key} in the bibliography` };
}
