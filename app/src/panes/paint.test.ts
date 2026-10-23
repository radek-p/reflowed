// A block view's preview (panes/paint.ts): every kind gets its class, text and tooltip, and showing one
// writes all three, so a marker's tooltip does not stay on the block once it holds text.
//   node app/src/panes/paint.test.ts      (Node; exit 1 on a failure)
import { previewOf, showPreview } from './paint.ts';

let bad = 0, n = 0;
const check = (name: string, ok: boolean, d = '') => { n++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${d ? ` — ${d}` : ''}`); };
const el = () => ({ hidden: false, className: '', textContent: '', title: '' }) as unknown as HTMLElement;
const v = { render: el(), preview: el() };

showPreview(v, previewOf('comments', '% a note', { marker: true }));
check('a comments-only marker: its class, its source, the tooltip', v.preview.className === 'blk-preview marker comments' && v.preview.textContent === '% a note' && v.preview.title === 'Comments only' && v.render.hidden && !v.preview.hidden);
showPreview(v, previewOf('pending', 'Text now.'));
check('the same view, now text waiting for its result: the tooltip goes (it stayed)', v.preview.className === 'blk-preview pending' && v.preview.textContent === 'Text now.' && v.preview.title === '', JSON.stringify({ t: v.preview.title }));
check('the appendix marker', previewOf('appendix', '\\appendix', { marker: true }).text === 'Appendix' && previewOf('appendix', '', { marker: true }).title.startsWith('\\appendix'));
check('an empty block: the placeholder, no tooltip', previewOf('empty', '').cls === 'blk-preview placeholder' && previewOf('empty', '').title === '');
console.log(`${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
