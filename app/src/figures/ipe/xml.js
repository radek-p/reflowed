// A small XML reader/writer for Ipe files (runs in the page and in Node).
// Ipe writes plain XML: elements, attributes in double quotes, text with the
// five entities (and numeric ones), an optional <?xml?> and <!DOCTYPE ipe>.
// Elements keep their attributes in file order, so a file read and written
// again unchanged comes out the same apart from those two header lines.
//
//   node = { name, attrs: { k: v }, children: [node | string] }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

export const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

export function parseXml(src) {
  let i = 0;
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const err = (msg) => { throw new Error(`XML: ${msg} at offset ${i}`); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { const t = src.slice(i); if (t.trim()) top.children.push(decodeEntities(t)); break; }
    if (lt > i) top.children.push(decodeEntities(src.slice(i, lt)));
    i = lt;
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i); if (e < 0) err('unterminated <?'); i = e + 2; continue; }
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); if (e < 0) err('unterminated comment'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i); if (e < 0) err('unterminated CDATA');
      top.children.push(src.slice(i + 9, e)); i = e + 3; continue;
    }
    if (src.startsWith('<!', i)) { const e = src.indexOf('>', i); if (e < 0) err('unterminated <!'); i = e + 1; continue; }
    if (src[i + 1] === '/') {
      const e = src.indexOf('>', i);
      const name = src.slice(i + 2, e).trim();
      const open = stack.pop();
      if (!open || open.name !== name) err(`</${name}> closes <${open?.name}>`);
      i = e + 1;
      continue;
    }
    const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(i, i + 200));
    if (!m) err('bad tag');
    const node = { name: m[1], attrs: {}, children: [] };
    i += m[0].length;
    const attrRe = /\s*([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
    for (;;) {
      attrRe.lastIndex = i;
      const a = attrRe.exec(src);
      if (!a) break;
      node.attrs[a[1]] = decodeEntities(a[3] ?? a[4]);
      i = attrRe.lastIndex;
    }
    while (/\s/.test(src[i])) i++;
    top.children.push(node);
    if (src.startsWith('/>', i)) { i += 2; continue; }
    if (src[i] !== '>') err(`bad attribute in <${node.name}>`);
    i++;
    stack.push(node);
  }
  if (stack.length !== 1) err(`<${stack[stack.length - 1].name}> not closed`);
  return root;
}

export function writeXml(node) {
  if (typeof node === 'string') return escText(node);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (!node.children.length) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(writeXml).join('')}</${node.name}>`;
}

export const elements = (node, name) => node.children.filter((c) => typeof c !== 'string' && (!name || c.name === name));
export const textOf = (node) => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
