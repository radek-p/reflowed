// SURFACES: the one diff view, Preact: the changed lines between two texts (view/diff.js charDiff), the
// rest of those lines as context; insertions <ins>, deletions <del>, a line break shown as ↵. Used by the editing
// popover's "Show changes" (edit/panel.js); any surface that shows what changed takes this one.
//   html`<${DiffView} a=${before} b=${after} />`     class .live-diff (the tests' and view/style.js's hook)
import { html } from '../design/ui/core.js';
import { charDiff } from './diff.js';

export function DiffView({ a, b, class: c = 'live-diff' }) {
  const { prefix, ops, suffix } = charDiff(a, b);
  if (!ops.length) return html`<pre class=${c}>(no change)</pre>`;
  const lineStart = prefix.lastIndexOf('\n') + 1, eol = suffix.indexOf('\n');
  const tail = eol < 0 ? suffix : suffix.slice(0, eol);
  return html`<pre class=${c}>${lineStart < prefix.length ? html`<span class="ctx">${prefix.slice(lineStart)}</span>` : null}${ops.map((o) => (o.t === '='
    ? o.s : o.t === '+' ? html`<ins>${o.s.replace(/\n/g, '↵\n')}</ins>` : html`<del>${o.s.replace(/\n/g, '↵\n')}</del>`))}${tail ? html`<span class="ctx">${tail}</span>` : null}</pre>`;
}
