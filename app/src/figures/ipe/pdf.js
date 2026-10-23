// The Ipe document inside a PDF that Ipe wrote. Ipe stores its own XML as
// a stream object `<< /Type /Ipe /Length n /Filter /FlateDecode >>` next to
// the drawing, so the figure can be opened and edited again. This finds that
// object, inflates it (DecompressionStream, in the page and in Node) and
// reads the page box the PDF is shown with: \includegraphics uses the
// CropBox when there is one (Ipe sets it to the drawing's bounding box plus a
// margin), else the MediaBox.

const latin1 = (bytes, from = 0, to = bytes.length) => {
  let s = '';
  for (let i = from; i < to; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 0x8000)));
  return s;
};

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

function box(text, key) {
  const m = new RegExp(`/${key}\\s*\\[\\s*([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s*\\]`).exec(text);
  return m ? m.slice(1, 5).map(Number) : null;
}

/** { xml, cropBox, mediaBox } or null when the PDF holds no Ipe stream. */
export async function extractIpeFromPdf(pdf) {
  const bytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  const text = latin1(bytes);
  if (!text.startsWith('%PDF')) return null;
  const at = text.search(/\/Type\s*\/Ipe\b/);
  if (at < 0) return null;
  const objStart = text.lastIndexOf(' obj', at);
  const dictStart = text.indexOf('<<', objStart);
  const streamKw = /stream\r?\n/g;
  streamKw.lastIndex = at;
  const sm = streamKw.exec(text);
  if (!sm) return null;
  const dict = text.slice(dictStart, sm.index);
  let length;
  const ind = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (ind) {
    const lm = new RegExp(`(?:^|[\\r\\n\\s])${ind[1]}\\s+${ind[2]}\\s+obj\\s*(\\d+)`).exec(text);
    if (!lm) throw new Error('Ipe PDF: indirect /Length not found');
    length = Number(lm[1]);
  } else {
    const dm = /\/Length\s+(\d+)/.exec(dict);
    if (!dm) throw new Error('Ipe PDF: no /Length on the Ipe stream');
    length = Number(dm[1]);
  }
  const start = sm.index + sm[0].length;
  let data = bytes.subarray(start, start + length);
  if (/\/FlateDecode/.test(dict)) data = await inflate(data);
  else if (/\/Filter/.test(dict)) throw new Error('Ipe PDF: unsupported filter on the Ipe stream');
  const xml = new TextDecoder('utf-8').decode(data);
  if (!/<ipe\b/.test(xml)) throw new Error('Ipe PDF: the Ipe stream holds no <ipe> document');
  return { xml, cropBox: box(text, 'CropBox'), mediaBox: box(text, 'MediaBox') };
}
