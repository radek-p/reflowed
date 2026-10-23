// What a block view's preview shows: one decision, one write. The preview's class, text and
// tooltip were set by hand in each of displayBlock's branches (marker, empty, pending, error, source), and the tooltip
// only for markers: a "Comments only" block edited into text kept it. Now every branch writes all three.
//   previewOf(kind, source) -> { cls, text, title }
//     kind: a marker ('appendix' | 'macros' | 'comments' …), 'empty', or a state ('pending' | 'error' | 'source' | …)
//   showPreview(v, p)  the view shows its preview (the render hidden), exactly p
export interface Preview { cls: string; text: string; title: string }
export interface PreviewView { render: HTMLElement; preview: HTMLElement }

const MARKER_TITLE: Record<string, string> = {
  appendix: '\\appendix: the sections after it are lettered A, B, …',
  macros: 'Definitions: typeset nothing; blocks after this one see them',
};

export function previewOf(kind: string, source: string, { marker = false } = {}): Preview {
  if (marker) return { cls: `blk-preview marker ${kind}`, text: kind === 'appendix' ? 'Appendix' : source, title: MARKER_TITLE[kind] ?? 'Comments only' };
  if (kind === 'empty') return { cls: 'blk-preview placeholder', text: 'Empty block · click to write LaTeX, / for a block type', title: '' };
  return { cls: `blk-preview ${kind}`, text: source, title: '' };
}

export function showPreview(v: PreviewView, p: Preview): void {
  // (writes only what differs: a display runs on every result and every live update)
  if (!v.render.hidden) v.render.hidden = true;
  if (v.preview.hidden) v.preview.hidden = false;
  if (v.preview.className !== p.cls) v.preview.className = p.cls;
  if (v.preview.textContent !== p.text) v.preview.textContent = p.text;
  if (v.preview.title !== p.title) v.preview.title = p.title;
}
