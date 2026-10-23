// Links, anchors, slots, marks, streams and the outline on the XeTeX path
//what reflowtex's LuaTeX serializer
// (src/extract/serializer.lua, "Pictures" … "Resolving hyperref's links")
// makes of the companion package's attributes and Serializer.note_*(…)
// calls, made here from
//   - the attribute tuples the engine stamped on every node (capture flag 32,
//     patch 0005), which engine-api's convert.ts keeps as `_a` when called
//     with `attrs: true` (patches/convert-attrs.patch), together with
//     hyperref's links (`_hl` on glyphs, `_hyperref`) and destinations
//     (`_dest`) from its xdvipdfmx specials;
//   - the notes rtx-xetex.sty writes to <job>.rtxlua in place of \directlua;
//   - the .aux, for hyperref destinations named by the author's labels.
//
//   const out = convert({ stream, readFile, hyphenation: 'luatex', attrs: true });
//   applySlots(out, { lua: files['input.rtxlua'], aux: files['input.aux'] });
//
// applySlots fills output.json's links/anchors/slots/marks/outline, moves
// content items into the streams they were typeset in (webstream, boxes,
// accordions, asides; footnotes keep theirs, renumbered after), sets
// glyph.link/slot/mark, glue.slot, hlist.anchor/aside, and removes every `_`
// field. No Node APIs.

type J = Record<string, any>;

// Attribute numbers → index in the tuple (\attribute909 … \attribute916)
const LINK = 0, ANCHOR = 1, STREAM = 2, SLOT = 4, ASIDE = 5, ASIDE_MARK = 6, MARK = 7;
const attr = (a: number[] | undefined, k: number): number | undefined => (a && a[k] > 0 ? a[k] : undefined);

export interface SlotsInputs {
  /** <job>.rtxlua: the \directlua calls rtx-xetex.sty wrote out */
  lua?: string | null;
  /** <job>.aux: \newlabel's fourth field is hyperref's destination */
  aux?: string | null;
}

// ── The notes ─────────────────────────────────────────────────────────────────
// A call as rtx-xetex.sty's \write left it: Serializer.note_x(arg, …), where
// an argument is a number, nil, a Lua string literal as written in the
// package ("reflowtex-toc-3"), or \luaescapestring's text between the markers
// ^^A and ^^B, as TeX expanded it (nothing escaped: the delimiters say where
// it ends).
export interface Note { fn: string; args: (string | number | null)[] }

export function parseNotes(text: string): Note[] {
  const notes: Note[] = [];
  const re = /Serializer\.(note_[A-Za-z_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = re.lastIndex;
    const args: (string | number | null)[] = [];
    const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    let ok = true;
    for (;;) {
      ws();
      if (text[i] === ')') { i++; break; }
      if (text.startsWith('"^^A', i)) {
        const end = text.indexOf('^^B"', i + 4);
        if (end < 0) { ok = false; break; }
        args.push(text.slice(i + 4, end));
        i = end + 4;
      } else if (text[i] === '"') {
        let s = '';
        i++;
        while (i < text.length && text[i] !== '"') { if (text[i] === '\\' && i + 1 < text.length) i++; s += text[i++]; }
        i++;
        args.push(s);
      } else {
        const t = /^(-?\d+(?:\.\d+)?|nil)/.exec(text.slice(i, i + 40));
        if (!t) { ok = false; break; }
        args.push(t[1] === 'nil' ? null : Number(t[1]));
        i += t[1].length;
      }
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ')') { i++; break; }
      ok = false; break;
    }
    if (ok) notes.push({ fn: m[1], args });
    re.lastIndex = Math.max(i, m.index + 1);
  }
  return notes;
}

// serializer.lua's parse_stream_attrs: key=value, … split on commas, trimmed;
// keys letters, digits and "-" (lower-cased); a doubled # (\detokenize) single.
export function parseAttrs(text: string | null | undefined): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const item of String(text ?? '').split(',')) {
    if (item === '') continue;
    let k: string, v: string;
    const eq = item.indexOf('=');
    if (eq >= 0) { k = item.slice(0, eq).trim(); v = item.slice(eq + 1).trim(); }
    else { k = item.trim(); v = ''; }
    if (k !== '' && /^[A-Za-z0-9-]+$/.test(k)) out.push({ key: k.toLowerCase(), value: v.replace(/##/g, '#') });
  }
  return out;
}

// amsmath replays a display's label with its braces
const cleanLabel = (l: unknown) => { const s = String(l ?? ''); const m = /^\{(.*)\}$/s.exec(s); return m ? m[1] : s; };
const OUTLINE_LEVELS: Record<string, number> = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3 };

interface Stream { kind: string; content: J[]; attrs: { key: string; value: string }[]; parent?: number; text?: string; opened?: boolean }

// hyperref's destination → the author's label, from the .aux's \newlabel lines
function auxDestLabels(aux: string): Map<string, string> {
  const map = new Map<string, string>();
  const groups = (s: string, at: number): [string, number] | null => {
    if (s[at] !== '{') return null;
    let d = 0;
    for (let i = at; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '{') d++;
      else if (s[i] === '}' && --d === 0) return [s.slice(at + 1, i), i + 1];
    }
    return null;
  };
  let at = 0;
  while ((at = aux.indexOf('\\newlabel{', at)) >= 0) {
    const a = groups(aux, at + 9);
    if (!a) { at += 9; continue; }
    const b = groups(aux, a[1]);
    at = b ? b[1] : a[1];
    if (!b) continue;
    const parts: string[] = [];
    let j = 0;
    while (j < b[0].length) { const g = groups(b[0], j); if (!g) { j++; continue; } parts.push(g[0]); j = g[1]; }
    const dest = parts[3];
    if (dest && !map.has(dest)) map.set(dest, a[0]);
  }
  return map;
}

// ── applySlots ────────────────────────────────────────────────────────────────
export function applySlots(out: J, inp: SlotsInputs = {}): J {
  // the notes, as serializer.lua's tables
  const links = new Map<number, J>(), anchors = new Map<number, string>(), slots = new Map<number, J>(), marks = new Map<number, J>();
  const streams = new Map<number, Stream>();
  const outline: J[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  for (const { fn, args: a } of parseNotes(inp.lua ?? '')) {
    switch (fn) {
      case 'note_link': links.set(num(a[0]), { label: cleanLabel(a[1]).split(',')[0] }); break;
      case 'note_link_url': links.set(num(a[0]), { url: String(a[1] ?? '') }); break;
      case 'note_link_file': { const f = String(a[1] ?? ''), n = String(a[2] ?? ''); links.set(num(a[0]), { url: n ? `${f}#${n}` : f }); break; }
      case 'note_link_action': links.set(num(a[0]), { action: String(a[1] ?? '') }); break;
      case 'note_slot': {
        const s: J = { name: String(a[1] ?? ''), space: a[2], stretch: a[3], shrink: a[4] };
        if (a[5] != null) s.kind = String(a[5]);
        if (a[6] != null) s.attrs = parseAttrs(a[6] as string);
        slots.set(num(a[0]), s);
        break;
      }
      case 'note_mark': marks.set(num(a[0]), { id: String(a[1] ?? ''), classes: String(a[2] ?? '') }); break;
      case 'note_label': anchors.set(num(a[0]), cleanLabel(a[1])); break;
      case 'note_stream': {
        const parent = a[2] == null ? undefined : num(a[2]);
        streams.set(num(a[0]), { kind: String(a[1] ?? ''), content: [], attrs: parseAttrs(a[3] as string),
                                 parent: parent !== undefined && parent > 0 ? parent : undefined });
        break;
      }
      case 'note_stream_text': {
        const s = streams.get(num(a[0]));
        if (s) s.text = String(a[1] ?? '').replace(/^\s*\n/, '').replace(/\s+$/, '');
        break;
      }
      case 'note_outline': {
        const [anchor, kind0, level, number0, title0] = a;
        const kind = String(kind0 ?? ''); let number = String(number0 ?? ''), title = String(title0 ?? '');
        if (num(level) === 9) { outline.push({ kind: 'theorem', env: kind, level: 9, number, title, anchor }); break; }
        const lv = OUTLINE_LEVELS[kind];
        if (lv === undefined) break;
        const nl = /\\numberline\s*\{([^{}]*)\}\s*(.*)$/s.exec(title);
        if (nl) { number = nl[1]; title = nl[2]; }
        title = title.replace(/^\\protect\s*/, '');
        const last = outline[outline.length - 1];
        if (last && last.kind === kind && last.number === '' && last.title === title) break;
        outline.push({ kind, level: lv, number, title, anchor });
        break;
      }
      default: break;          // note_display, note_graphic, …: the engine records those itself
    }
  }

  // ── Nodes: attributes onto the fields serializer.lua sets ──────────────────
  const hyLinks = new Map<number, J>();
  for (const l of out._hyperref ?? []) hyLinks.set(l.k, { dest: l.dest, url: l.url });
  const node = (n: J) => {
    const a: number[] | undefined = n._a;
    if (n.type === 'glyph') {
      const link = attr(a, LINK), slot = attr(a, SLOT), mark = attr(a, MARK);
      if (link) n.link = link;
      if (slot) n.slot = slot;
      if (mark) n.mark = mark;
      if (!n.link && n.stream === undefined && n._hl) {     // hyperref's, provisional (footnote marks keep theirs)
        const l = hyLinks.get(n._hl);
        if (l) { l.used = true; n.link = -n._hl; }
      }
    } else if (n.type === 'glue') {
      const slot = attr(a, SLOT);
      if (slot) n.slot = slot;
    } else if (n.type === 'hlist' || n.type === 'vlist') {
      const anchor = attr(a, ANCHOR), aside = attr(a, ASIDE_MARK);
      if (anchor) n.anchor = anchor;
      if (aside) n.aside = aside;
    }
  };
  const eachNode = (v: any, fn: (n: J) => void) => {
    if (Array.isArray(v)) { for (const x of v) eachNode(x, fn); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.type === 'string') fn(v);
    for (const k of Object.keys(v)) if (k !== '_a' && typeof v[k] === 'object') eachNode(v[k], fn);
  };
  // hyperref destinations, in serializer.lua's order: paragraphs as captured,
  // then the flow as walked (footnotes after it, here)
  const dests: { name: string; item: J }[] = [];
  const noteDest = (n: J) => { if (n._dest !== undefined) dests.push({ name: n._dest, item: n }); };
  for (const p of out.paragraphs ?? []) eachNode(p.nodes, (n) => { node(n); noteDest(n); });
  const item = (it: J) => {
    if (it.kind === 'anchorpoint') { if (it._dest !== undefined) noteDest(it); else { const an = attr(it._a, ANCHOR); if (an) it.anchor = an; } }
    eachNode(it, (n) => { node(n); noteDest(n); });
  };
  for (const it of out.content ?? []) item(it);
  for (const s of out.streams ?? []) for (const it of s.content) item(it);

  // ── Streams: every item into the list it was typeset in ─────────────────────
  // (serializer.lua's stream_out, common_stream and place_gap)
  interface Ctx { out: J[]; base?: number; lastSid?: number }
  const norm = (ctx: Ctx, sid?: number) => (sid === undefined || sid === ctx.base || !streams.has(sid) ? undefined : sid);
  const streamOut = (ctx: Ctx, sid?: number): J[] => {
    if (sid === undefined || sid === ctx.base) return ctx.out;
    const s = streams.get(sid);
    if (!s) return ctx.out;
    if (!s.opened) { s.opened = true; streamOut(ctx, s.parent).push({ kind: 'stream', stream: sid }); }
    return s.content;
  };
  const chain = (ctx: Ctx, sid?: number): number[] => {
    const c: number[] = [], seen = new Set<number>();
    let s = norm(ctx, sid);
    while (s !== undefined && !seen.has(s)) { c.push(s); seen.add(s); s = norm(ctx, streams.get(s)!.parent); }
    return c;
  };
  const common = (ctx: Ctx, a?: number, b?: number) => { const inA = new Set(chain(ctx, a)); return chain(ctx, b).find((s) => inA.has(s)); };
  const onlyAnchors = (l: J[]) => l.every((it) => it.kind === 'anchorpoint');
  const placeGap = (ctx: Ctx, next: number | undefined, gap: J) => {
    const list = streamOut(ctx, common(ctx, ctx.lastSid, next));
    let pos = list.length;
    while (pos > 0) {
      const it = list[pos - 1];
      if (it.kind === 'anchorpoint' || (it.kind === 'stream' && streams.get(it.stream) && onlyAnchors(streams.get(it.stream)!.content))) pos--;
      else break;
    }
    if (pos > 0) list.splice(pos, 0, gap);
  };
  const place = (items: J[], ctx: Ctx) => {
    let pending: J[] = [];
    for (const it of items) {
      if (it.kind === 'vspace') { pending.push(it); continue; }
      const sid = attr(it._a, STREAM);
      if (it.kind === 'anchorpoint') { streamOut(ctx, sid).push(it); continue; }
      for (const g of pending) placeGap(ctx, sid, g);
      pending = [];
      streamOut(ctx, sid).push(it);
      ctx.lastSid = sid;
    }
    return ctx.out;
  };
  const content = place(out.content ?? [], { out: [] });
  // footnotes (convert.ts's streams): an aside's insertion fills its own
  // stream; the others stay footnotes, numbered after the noted streams
  const noted = streams.size ? Math.max(...streams.keys()) : 0;
  const footnotes: J[] = [];
  const renumber = new Map<number, number>();
  (out.streams ?? []).forEach((fn: J, i: number) => {
    const aside = attr(fn._a, ASIDE);
    const s = aside !== undefined ? streams.get(aside) : undefined;
    if (s) {
      place(fn.content, { out: s.content, base: aside });
      s.attrs.push({ key: 'aside', value: 'true' });
      return;
    }
    footnotes.push({ kind: 'footnote', content: place(fn.content, { out: [], base: attr(fn._a, STREAM) }), attrs: [] });
    renumber.set(i + 1, noted + footnotes.length);
  });

  // ── hyperref's links and destinations (serializer.lua's resolve_hyperref) ───
  const destLabel = hyLinks.size ? auxDestLabels(inp.aux ?? '') : new Map<string, string>();
  const labelOf = (name: string) => cleanLabel(destLabel.get(name) ?? name);
  const have = new Set(anchors.values()), here = new Set(dests.map((d) => d.name));
  const wanted = new Set<string>();
  const maxId = (m: Map<number, unknown>) => (m.size ? Math.max(0, ...m.keys()) : 0);
  const finalId = new Map<number, number>();
  let nextLink = maxId(links);
  for (const k of [...hyLinks.keys()].sort((x, y) => x - y)) {
    const l = hyLinks.get(k)!;
    if (!l.used) continue;
    if (l.dest !== undefined && (/^page\.\d+$/.test(l.dest) || !(destLabel.has(l.dest) || here.has(l.dest)))) continue;
    finalId.set(-k, ++nextLink);
    if (l.dest !== undefined) {
      const label = labelOf(l.dest);
      links.set(nextLink, { label });
      if (!have.has(label)) wanted.add(label);
    } else links.set(nextLink, { url: l.url });
  }
  let nextAnchor = maxId(anchors);
  for (const d of dests) {
    const label = labelOf(d.name);
    if (wanted.has(label)) { wanted.delete(label); anchors.set(++nextAnchor, label); d.item.anchor = nextAnchor; }
    else d.item._drop = true;
  }

  // ── Out ─────────────────────────────────────────────────────────────────────
  const streamList: J[] = [];
  for (let i = 1; i <= noted; i++) {
    const s = streams.get(i);
    const e: J = s ? { kind: s.kind, content: s.content, attrs: s.attrs } : { kind: '', content: [], attrs: [] };
    if (s?.text !== undefined) e.text = s.text;
    streamList.push(e);
  }
  streamList.push(...footnotes);
  out.content = content;
  out.streams = streamList;
  // the last pass: final ids, and nothing of ours left
  const strip = (v: any): any => {
    if (Array.isArray(v)) return v.filter((x) => !(x && typeof x === 'object' && x._drop)).map(strip);
    if (!v || typeof v !== 'object') return v;
    if (v.type === 'glyph') {
      if (v.link < 0) { const f = finalId.get(v.link); if (f) v.link = f; else delete v.link; }
      if (v.stream !== undefined) { const s = renumber.get(v.stream); if (s) v.stream = s; else delete v.stream; }   // a footnote mark
    }
    for (const k of Object.keys(v)) {
      if (k.startsWith('_')) { delete v[k]; continue; }
      if (typeof v[k] === 'object') v[k] = strip(v[k]);
    }
    return v;
  };
  for (const k of ['paragraphs', 'content', 'streams']) out[k] = strip(out[k]);
  delete out._hyperref;
  const dense = <T>(m: Map<number, T>, blank: () => T): T[] => {
    const n = maxId(m as Map<number, unknown>), l: T[] = [];
    for (let i = 1; i <= n; i++) l.push(m.has(i) ? m.get(i)! : blank());
    return l;
  };
  out.links = dense(links, () => ({}));
  out.anchors = dense(anchors, () => '');
  out.slots = dense(slots, () => ({ name: '' }));
  out.marks = dense(marks, () => ({}));
  out.outline = outline;
  return out;
}
