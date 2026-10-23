// convert-slots.ts on its own: the notes' syntax, parameters, streams and
// gaps, asides and footnotes, hyperref's links. node --test tests/unit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes, parseAttrs, applySlots } from '../convert-slots.ts';

test('notes: \\luaescapestring between ^^A and ^^B, taken as written', () => {
  const n = parseNotes('Serializer.note_slot(3, "^^Artxn {"s":1,"L":[{"l":"a\\\\b"}]}^^B", 218235, 109117, 72745)\n');
  assert.deepEqual(n, [{ fn: 'note_slot', args: [3, 'rtxn {"s":1,"L":[{"l":"a\\\\b"}]}', 218235, 109117, 72745] }]);
});

test('notes: plain literals, nil, negatives, two calls on one line, a call over lines', () => {
  const n = parseNotes('Serializer.note_label(4, "reflowtex-outline-2") Serializer.note_outline(4, "^^Asection^^B", 0,\n"^^A^^B", "^^A\\numberline {1}Intro^^B")\n'
    + 'Serializer.note_stream(2, "batch-part", -1, "part=x")\nSerializer.note_slot(1, "^^Aw^^B", 0, 0, 0, nil)');
  assert.deepEqual(n.map((x) => x.fn), ['note_label', 'note_outline', 'note_stream', 'note_slot']);
  assert.deepEqual(n[1].args, [4, 'section', 0, '', '\\numberline {1}Intro']);
  assert.deepEqual(n[2].args, [2, 'batch-part', -1, 'part=x']);
  assert.equal(n[3].args[5], null);
});

test('notes: a string holding quotes, commas and parentheses', () => {
  const n = parseNotes('Serializer.note_link_url(1, "^^Ahttps://x.org/a_(b),"c"^^B")');
  assert.equal(n[0].args[1], 'https://x.org/a_(b),"c"');
});

test('attrs: split, trimmed, keys lower-cased, bad keys dropped, ## single', () => {
  assert.deepEqual(parseAttrs(' Initial = collapsed ,print=last,, bad key=1, flag,--rtx-accent=##c2410c'),
    [{ key: 'initial', value: 'collapsed' }, { key: 'print', value: 'last' }, { key: 'flag', value: '' }, { key: '--rtx-accent', value: '#c2410c' }]);
});

// a tiny output.json as convert.ts (attrs: true) leaves it
const T = (stream = 0, extra: Partial<Record<number, number>> = {}) => {
  const a = [0, 0, 0, 0, 0, 0, 0, 0];
  a[2] = stream;
  for (const [k, v] of Object.entries(extra)) a[Number(k)] = v!;
  return a;
};
const glyph = (c: string, a?: number[], more: object = {}) => ({ type: 'glyph', char: c.codePointAt(0), font: 1, width: 1, height: 1, depth: 0, ...(a ? { _a: a } : {}), ...more });
const par = (text: string, a?: number[]) => ({ nodes: [...text].map((c) => glyph(c, a)) });

test('streams: items into their streams, nested; the gap between a box and the text is the text\'s', () => {
  const out: any = {
    paragraphs: [par('a'), par('b', T(1)), par('c', T(2)), par('d')],
    content: [
      { kind: 'paragraph', para: 1 }, { kind: 'vspace', amount: 5 },
      { kind: 'paragraph', para: 2, _a: T(1) }, { kind: 'vspace', amount: 6 },
      { kind: 'paragraph', para: 3, _a: T(2) }, { kind: 'vspace', amount: 7 },
      { kind: 'paragraph', para: 4 },
    ],
    streams: [],
  };
  applySlots(out, { lua: 'Serializer.note_stream(1, "^^Abox^^B", 0, "^^Avariant=card^^B")\nSerializer.note_stream(2, "^^Ainner^^B", 1, "^^A^^B")' });
  assert.deepEqual(out.content, [{ kind: 'paragraph', para: 1 }, { kind: 'vspace', amount: 5 }, { kind: 'stream', stream: 1 },
    { kind: 'vspace', amount: 7 }, { kind: 'paragraph', para: 4 }]);
  assert.deepEqual(out.streams[0], { kind: 'box', content: [{ kind: 'paragraph', para: 2 }, { kind: 'vspace', amount: 6 }, { kind: 'stream', stream: 2 }],
    attrs: [{ key: 'variant', value: 'card' }] });
  assert.deepEqual(out.streams[1].content, [{ kind: 'paragraph', para: 3 }]);
});

test('asides fill their own stream; footnotes follow the noted streams; marks point at them', () => {
  const out: any = {
    paragraphs: [{ nodes: [glyph('x', T(0, { 6: 1 }).map((v, i) => (i === 6 ? 0 : v)), { stream: 2 }), { type: 'hlist', children: [], _a: T(0, { 6: 1 }) }] }, par('n'), par('f')],
    content: [{ kind: 'paragraph', para: 1 }],
    streams: [
      { kind: 'footnote', content: [{ kind: 'paragraph', para: 2, _a: T(1) }], attrs: [], _a: T(0, { 5: 1 }) },   // the aside's insertion
      { kind: 'footnote', content: [{ kind: 'paragraph', para: 3 }], attrs: [] },
    ],
  };
  applySlots(out, { lua: 'Serializer.note_stream(1, "^^Apopover^^B", 0, "^^Afor=1^^B")' });
  assert.equal(out.streams.length, 2);
  assert.deepEqual(out.streams[0], { kind: 'popover', content: [{ kind: 'paragraph', para: 2 }], attrs: [{ key: 'for', value: '1' }, { key: 'aside', value: 'true' }] });
  assert.equal(out.streams[1].kind, 'footnote');
  assert.equal(out.paragraphs[0].nodes[0].stream, 2, 'the footnote mark follows its stream to index 2');
  assert.equal(out.paragraphs[0].nodes[1].aside, 1);
});

test('glyph fields; hyperref links resolved through the .aux; a link to a page is dropped', () => {
  const out: any = {
    paragraphs: [{ nodes: [glyph('1', T(0, { 0: 1, 4: 2, 7: 1 })), glyph('2', undefined, { _hl: 1 }), glyph('3', undefined, { _hl: 2 }),
      { type: 'hlist', subtype: 2, width: 0, height: 0, depth: 0, children: [], _dest: 'section.1' },
      { type: 'hlist', subtype: 2, width: 0, height: 0, depth: 0, children: [], _dest: 'unused.9' },
      { type: 'glue', width: 3, _a: T(0, { 4: 2 }) }] }],
    content: [{ kind: 'paragraph', para: 1 }], streams: [],
    _hyperref: [{ k: 1, dest: 'section.1' }, { k: 2, dest: 'page.3' }],
  };
  applySlots(out, {
    lua: 'Serializer.note_link(1, "^^A{eq:a}^^B")\nSerializer.note_link(3, "^^Ac:x,c:y^^B")\nSerializer.note_slot(2, "^^Aclock^^B", 1, 2, 3)\nSerializer.note_mark(1, "^^Aid^^B", "^^Ahot^^B")',
    aux: '\\newlabel{sec:intro}{{1}{1}{Intro}{section.1}{}}\n',
  });
  const [g1, g2, g3, d1, glue] = out.paragraphs[0].nodes;
  assert.deepEqual([g1.link, g1.slot, g1.mark], [1, 2, 1]);
  assert.equal(g2.link, 4);
  assert.equal(g3.link, undefined);
  assert.equal(d1.anchor, 1);
  assert.equal(out.paragraphs[0].nodes.length, 5, 'the destination no link needs is gone');
  assert.equal(glue.slot, 2);
  assert.deepEqual(out.links, [{ label: "eq:a" }, {}, { label: "c:x" }, { label: "sec:intro" }]);
  assert.deepEqual(out.anchors, ['sec:intro']);
  assert.deepEqual(out.slots, [{ name: '' }, { name: 'clock', space: 1, stretch: 2, shrink: 3 }]);
  assert.deepEqual(out.marks, [{ id: 'id', classes: 'hot' }]);
  assert.ok(!JSON.stringify(out).includes('"_'), 'no private field left');
});
