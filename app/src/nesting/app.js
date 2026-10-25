// nested blocks in the editor (the app's side; the model is model.ts).
//
// A container block (a proof or theorem-like split into paragraphs) has no row
// of its own: it lives in an outer gutter column, a bracket along its
// paragraphs with its handle and a fold toggle; its children follow as ordinary blocks. The text
// column is not narrowed: a child's lines break as they do in the paper.
//
// createNesting(host) -> {
//   order(blocks), isContainer(b), compileSource(b), contextView(blocks), extraContext(b), treeSig(), pass(fn),
//   display(b, u), decorate(), refreshHeads(), split(id, offset, o), merge(id, o), remove(id), duplicate(id),
//   moveBy(id, dir), moveTo(id, index, parentId), dragTargets(id), drop(id, target), menuItems(id, menuItem),
//   visibleStep(i, dir), reveal(id), flatten(blocks), spacingPrev(k), nestBlock(id), join(id), collapse(id, on), state()
// }
// host: the app's internals it needs (app.js createDocEditor passes them):
//   doc(), ui (block states: decor through u.cls / u.data / u.style), views(id) (the block's views, one per pane),
//   panes() (the panes: { id, views }), blockById, indexOf, ids, applyBlocks(label, plan, o), enterEdit, toast,
//   refsState(), kindOf(src), splitOptions(), kindLabel(kind), texToText(s, refText), docId()
// every pane shows the containers the same way: the classes are the block's decor (panes/decor.js,
// in every view), the bracket and the fold are made in each view (display), and each pane's containers are laid
// over that pane's paragraphs (layoutHeads: each pane breaks its lines at its own width).
import {
  isContainer, frameOf, treeOrder, childrenOf, compileParts, flattenForExport, nestSource,
  joinContainer, fixBefores, isTypeset, headTitle, parseFrame, nestableEnv, repairTree,
} from './model.ts';
import { envsFromPreamble } from '../io/split.ts';
import { createTree } from './tree.ts';
import { installStyle } from './style.js';
import { clearPanel } from '../edit/panel.js';
import { svg } from '../design/ui/icons.ts';

export function createNesting(host) {
  installStyle();
  // the theorem-like and proof environments of the preamble (as the importer reads them)
  let optsFor = null, opts = null;
  host.splitOptions ??= () => {
    const p = host.doc()?.preamble?.source ?? '';
    if (optsFor !== p) { optsFor = p; opts = envsFromPreamble(p); }
    return opts;
  };
  const blocks = () => host.doc()?.blocks ?? [];
  /** children, roles and parents of the current block list (recomputed when the list or an order changes) */
  // the tree memoised (nesting/tree.ts): every block key asks for it, a call compares the whole list with the last one
  // (no build); in a pass it is read once, at its start (asked once per block, a pass was O(n²))
  const trees = createTree();
  let pinned = null;
  const tree = () => pinned ?? trees.of(blocks());
  /** fn reads the blocks (their keys, sources as compiled, contexts) and changes none: the tree read once for all of
   *  them. A pass inside a pass is the same pass; outside one, each ask reads the blocks as they are */
  function pass(fn) {
    if (pinned) return fn();
    pinned = trees.of(blocks());
    try { return fn(); } finally { pinned = null; }
  }
  /** the tree's signature: a child gets its role (its environment's head and end) once it typesets something */
  const treeSig = () => tree().rev;
  const parentOf = (id) => tree().parent.get(id) ?? null;
  const kidsOf = (id) => tree().kids.get(id) ?? [];
  const containerOf = (id) => { const p = parentOf(id); return p ? host.blockById(p) : null; };

  // ── collapsed containers (per document, this browser) ────────────────────
  const collapsed = new Set();
  let collapsedDoc = null;
  const ckey = () => `rtx-editor.nest-collapsed.${host.docId()}`;
  function loadCollapsed() {
    if (collapsedDoc === host.docId()) return;
    collapsedDoc = host.docId();
    collapsed.clear();
    try { for (const id of JSON.parse(localStorage.getItem(ckey()) ?? '[]')) collapsed.add(id); } catch { /* none */ }
  }
  function saveCollapsed() { try { localStorage.setItem(ckey(), JSON.stringify([...collapsed])); } catch { /* not kept */ } }
  const isCollapsed = (id) => { loadCollapsed(); return collapsed.has(id); };
  function collapse(id, on = !isCollapsed(id)) {
    loadCollapsed();
    if (on) collapsed.add(id); else collapsed.delete(id);
    saveCollapsed();
    decorate();
    host.display(id);
  }
  /** a hidden child (its container collapsed) is shown before it is edited or revealed */
  function reveal(id) { const p = parentOf(id); if (p && isCollapsed(p)) collapse(p, false); }

  // ── compiling ─────────────────────────────────────────────────────────────
  /** What the backend compiles for a block (a child: its source and its environment's end line). */
  function compileSource(b) {
    const role = tree().roles.get(b.id);
    const c = role && host.blockById(role.parent);
    return c ? b.source.trim() + compileParts(c, role).suffix : b.source.trim();
  }
  /** The blocks refs.contextFor sees: containers left out (a child follows the block before its container). */
  const contextView = (list) => list.filter((b) => !isContainer(b));
  /** A child's prefix after its refs context: the flags and its environment's head. */
  function extraContext(b) {
    const role = tree().roles.get(b.id);
    const c = role && host.blockById(role.parent);
    return c ? compileParts(c, role).prefix : '';
  }

  // ── the container in the gutter ─────────────────────────────
  // A container has no row of its own (no added height: the document keeps the whole environment's
  // vertical rhythm). Its element is taken out of the flow and laid over its paragraphs (layoutHeads:
  // top and height); its gutter is an outer column: a bracket along the paragraphs, the container's
  // handle at its top (drag, menu; labelled with the kind and number) and a fold toggle. Collapsed: the
  // first paragraph shows its first line only, the others are hidden, the toggle stays as the fold mark.
  // the kit's chevron (12 px, an inline mark); the toggle sits in the core's block element (plain DOM there)
  const CHEVRON = svg('chevronDown', 12);
  /** a block's look as a container (or not): in the views `list` (those no editor is on; default: all) */
  function display(b, u, list = host.views(b.id)) {
    if (!isContainer(b)) {
      for (const v of host.views(b.id)) if (v.bracket) { v.bracket.remove(); v.fold.remove(); v.bracket = v.fold = null; v.root.style.removeProperty('top'); v.root.style.removeProperty('height'); }
      u.cls('nest-head', false);
      return false;
    }
    u.cls('nest-head', true);
    u.state = 'container'; u.data('state', 'container');
    for (const v of list) {
      v.render.hidden = true;
      v.preview.hidden = true;
      clearPanel(v.errors);                                // the errors box is a Preact root (edit/panel.js)
      attachView(b, v);
    }
    fillHead(b, u);
    return true;
  }
  /** the container's head in one view: the bracket and the fold toggle (plain DOM, in the block's element) */
  function attachView(b, v) {
    if (v.bracket) return;
    const bracket = document.createElement('div');
    bracket.className = 'nest-bracket';
    bracket.setAttribute('aria-hidden', 'true');
    const fold = document.createElement('button');
    fold.className = 'nest-toggle';
    fold.type = 'button';
    fold.innerHTML = CHEVRON;
    fold.addEventListener('click', (e) => { e.stopPropagation(); collapse(b.id); });
    v.root.append(bracket, fold);
    v.bracket = bracket; v.fold = fold;
  }
  function headText(b) {
    const st = host.refsState?.() ?? {};
    const first = kidsOf(b.id).find(isTypeset);
    const item = first && st.numbers?.[first.id]?.items?.find((it) => it.counter !== 'equation');
    const label = host.kindLabel(b.kind);
    const number = b.kind !== 'proof' && item?.number ? ` ${item.number}` : '';
    const t = headTitle(b.source);
    const refText = (k) => { const l = st.labels?.[k]; return l?.text || l?.number || '??'; };
    return { kind: `${label}${number}`, title: t ? host.texToText(t, refText) : '' };
  }
  function fillHead(b, u) {
    const { kind, title } = headText(b);
    const coll = isCollapsed(b.id);
    const n = kidsOf(b.id).filter(isTypeset).length;
    const name = `${kind}${title ? ` (${title})` : ''}`;
    for (const v of host.views(b.id)) {
      const handle = v.root.querySelector(':scope > .gutter .g-handle');
      if (handle) {
        handle.setAttribute('aria-label', `${name}: move or edit the whole environment`);
        handle.title = `${name} · drag to move · click for options`;
        handle.setAttribute('aria-expanded', String(!coll));
      }
      if (!v.fold) continue;
      v.fold.classList.toggle('nest-fold', coll);
      v.fold.setAttribute('aria-expanded', String(!coll));
      v.fold.setAttribute('aria-label', coll ? `Show the ${n} paragraph${n === 1 ? '' : 's'} of ${name}` : `Fold ${name} to its first line`);
      v.fold.title = coll ? `Show all ${n} paragraph${n === 1 ? '' : 's'}` : 'Fold to the first line';
    }
    u.cls('nest-collapsed', coll);
  }
  function refreshHeads() {
    for (const b of blocks()) if (isContainer(b)) { const u = host.ui.get(b.id); if (u && host.views(b.id).some((v) => v.bracket)) fillHead(b, u); }
  }
  /** classes on every block's row: head, child (first/last), hidden or folded (in a collapsed container) */
  function decorate() {
    const t = tree();
    for (const b of blocks()) {
      const u = host.ui.get(b.id);
      if (!u) continue;
      const p = t.parent.get(b.id);
      const ks = p ? t.kids.get(p) : null;
      const first = !!p && ks[0] === b;
      u.cls('nest-child', !!p);
      u.cls('nest-first', first);
      u.cls('nest-last', !!p && ks[ks.length - 1] === b);
      u.cls('nest-hidden', !!p && !first && isCollapsed(p));
      u.cls('nest-folded', first && isCollapsed(p));
      u.data('parent', p ?? null);
      const r = t.roles.get(b.id);
      u.data('role', r ? (r.first && r.last ? 'only' : r.first ? 'first' : r.last ? 'last' : 'middle') : null);
      if (isContainer(b)) u.cls('nest-collapsed', isCollapsed(b.id));
      if (p || isContainer(b)) for (const v of host.views(b.id)) watch(v.root);
    }
    layoutHeads();
  }
  /** each container laid over its paragraphs, in every pane (in the same frame as the layout that moved them: no jump) */
  // (performance rule 2) in passes, each over every container of every pane: read the folded firsts' glyph
  // boxes, write their --nest-line (it sets a folded first's height), read the offsets, write the heads. Reads and
  // writes alternated per container: a forced layout each, twice.
  function layoutHeads() {
    const t = tree();
    const items = [];
    for (const pane of host.panes()) for (const [pid, ks] of t.kids) {
      const head = pane.views.get(pid)?.root;
      if (!head?.isConnected) continue;
      const shown = ks.map((k) => pane.views.get(k.id)?.root).filter((r) => r?.isConnected && !r.classList.contains('nest-hidden'));
      if (shown.length) items.push({ head, first: shown[0], last: shown[shown.length - 1], line: null });
    }
    for (const it of items) {
      if (!it.first.classList.contains('nest-folded')) continue;
      // the first line only: the bottom of the glyphs on the render's first line
      const r = it.first.querySelector('.blk-render');
      const ts = r ? [...r.querySelectorAll('svg tspan')].map((x) => x.getBoundingClientRect()).filter((x) => x.height > 2) : [];
      if (!ts.length) { it.line = undefined; continue; }
      const top = Math.min(...ts.map((x) => x.top)), rt = r.getBoundingClientRect().top;
      const h = Math.min(...ts.map((y) => y.height));
      const one = ts.filter((x) => x.top < top + h * 0.8), rest = ts.filter((x) => x.top >= top + h * 0.8);
      // cut where the second line's boxes start (above its ink), else just below the first line
      const cut = rest.length ? Math.min(...rest.map((x) => x.top)) : Math.max(...one.map((x) => x.bottom)) + 4;
      it.line = `${Math.floor(cut - rt)}px`;
    }
    for (const it of items) {
      if (it.line) it.first.style.setProperty('--nest-line', it.line);
      else if (it.line === null) it.first.style.removeProperty('--nest-line');   // unfolded (undefined: folded, nothing typeset yet: as it was)
    }
    for (const it of items) { it.top = it.first.offsetTop; it.bottom = it.last.offsetTop + it.last.offsetHeight; }
    for (const it of items) {
      const s = it.head.style;
      if (s.top !== `${it.top}px`) s.top = `${it.top}px`;
      if (s.height !== `${it.bottom - it.top}px`) s.height = `${it.bottom - it.top}px`;
    }
  }
  // the paragraphs (and the column) are watched: a container follows them as they typeset, reflow or move
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => layoutHeads());
  const watched = new WeakSet();
  function watch(el) {
    if (!ro || watched.has(el)) return;
    watched.add(el); ro.observe(el);
    const col = el.parentElement;
    if (col && !watched.has(col)) { watched.add(col); ro.observe(col); hover(col); }
  }
  /** a view or a pane's list gone: no longer watched */
  function unwatch(el) { if (!ro || !el || !watched.has(el)) return; watched.delete(el); ro.unobserve(el); }
  // the handles: a child's on hover of its paragraph (app.css); all of a container's while its bracket or
  // handle is hovered, or the container is selected; the container's own while any of its paragraphs is hovered
  // hover is a pane's: the handles show in the pane the pointer is in (`col`: that pane's list)
  let shown = null;
  const marked = new Set();                // the views this document marked (no page-wide query)
  const mark = (el, cls) => { el.classList.add(cls); marked.add(el); };
  function show(pid, all, col = null) {
    const key = pid ? `${pid}:${all}:${col ? col.closest('[data-pane]')?.dataset.pane : '*'}` : null;
    if (key === shown) return;
    for (const el of marked) el.classList.remove('nest-active', 'nest-show');
    marked.clear();
    shown = key;
    if (!pid) return;
    const inCol = (v) => !col || v.root.parentElement === col;
    for (const v of host.views(pid)) if (inCol(v)) mark(v.root, 'nest-active');
    if (all) for (const k of kidsOf(pid)) for (const v of host.views(k.id)) if (inCol(v)) mark(v.root, 'nest-show');
  }
  let selectedHead = null;
  function hover(col) {
    col.addEventListener('pointerover', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      const head = el?.closest('.blk.nest-head');
      if (head) { show(head.dataset.id, true, col); return; }
      const blk = el?.closest('.blk.nest-child');
      if (blk?.dataset.parent) show(blk.dataset.parent, selectedHead === blk.dataset.parent, col);
      else show(selectedHead, true);
    });
    col.addEventListener('pointerleave', () => show(selectedHead, true));
  }
  /** the app selected a block (or none): a selected container shows all its paragraphs' handles and their selection */
  function selected(id) {
    const b = id ? host.blockById(id) : null;
    const next = b && isContainer(b) ? id : null;
    if (selectedHead && selectedHead !== next) for (const k of kidsOf(selectedHead)) host.ui.get(k.id)?.cls('nest-selected', false);
    selectedHead = next;
    if (next) for (const k of kidsOf(next)) host.ui.get(k.id)?.cls('nest-selected', true);
    show(next, true);
  }

  // ── restructuring (each one undoable step through host.applyBlocks) ──────
  const copy = (b) => ({ ...b, attrs: { ...(b.attrs ?? {}) } });
  /** containers with fewer than two children become one plain block again; children of no container go top level */
  function normalize(list, touched) {
    let out = list.map(copy);
    const kids = childrenOf(out);
    const drop = new Set();
    const joined = new Map();
    for (const [pid, ks] of kids) {
      if (ks.length >= 2) continue;
      const c = out.find((x) => x.id === pid);
      joined.set(pid, joinContainer(c, ks));
      for (const k of ks) drop.add(k.id);
    }
    out = out.filter((b) => !drop.has(b.id)).map((b) => joined.get(b.id) ?? b);
    const ids = new Set(out.filter(isContainer).map((b) => b.id));
    for (const b of out) if (b.parentId && !ids.has(b.parentId)) { b.parentId = null; touched?.add(b.id); }
    return fixBefores(treeOrder(out, { sorted: true }).order, touched);
  }
  /** the ids that move together: a container with its children, else the block */
  const unitOf = (id) => { const b = host.blockById(id); return isContainer(b) ? [id, ...kidsOf(id).map((k) => k.id)] : [id]; };
  /** move `id`'s unit to `index` (in the list without the unit), into container `parentId` (null: top level) */
  function planMove(list, id, index, parentId) {
    const unit = new Set(unitOf(id));
    const moving = list.filter((b) => unit.has(b.id)).map(copy);
    const rest = list.filter((b) => !unit.has(b.id)).map(copy);
    const head = moving.find((b) => b.id === id);
    const touched = new Set([id]);
    const was = head.parentId ?? null;
    if (!isContainer(head)) {
      head.parentId = parentId ?? null;
      if (parentId) { const c = rest.find((b) => b.id === parentId); if (c) head.file = c.file; }
    }
    if (was === (head.parentId ?? null)) touched.delete(id);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, ...moving);
    return normalize(rest, touched);
  }
  /** the app's move(id, to): `to` the index it ends at; the parent is the one of the place (parentAt) */
  function moveIndex(id, to) {
    const b = host.blockById(id);
    const i = blocks().findIndex((x) => x.id === id);
    if (!b || (!isContainer(b) && !parentOf(id) && !parentAt(to + (to > i ? 1 : 0)))) return false;
    const rest = blocks().filter((x) => !unitOf(id).includes(x.id));
    const index = Math.max(0, Math.min(to, rest.length));
    const prev = rest[index - 1];
    const p = isContainer(b) || !prev ? null : isContainer(prev) ? (isCollapsed(prev.id) ? null : prev.id) : parentOf(prev.id);
    return moveTo(id, index, p);
  }
  function moveTo(id, index, parentId = null, label = 'move block') {
    host.applyBlocks(label, (list) => planMove(list, id, index, parentId));
    return true;
  }

  /** a plain environment block → a container and its paragraphs; `split`: also cut at that source offset */
  function nestPlan(b, split) {
    const next = nestSource(b, host.splitOptions(), () => host.ids.ulid(), { min: split != null ? 1 : 2, split });
    return next;
  }
  function nestBlock(id, { split = null, focusAfter = false } = {}) {
    const b = host.blockById(id);
    if (!b || isContainer(b) || b.parentId) return null;
    const parts = nestPlan(b, split);
    if (!parts || parts.length < 3) return null;
    const focus = parts.splitChild ?? null;          // the paragraph after the caret
    host.applyBlocks('split into paragraphs', (list) => {
      const i = list.findIndex((x) => x.id === id);
      const out = list.map(copy);
      out.splice(i, 1, ...parts.map(copy));
      return normalize(out);
    });
    if (focus && focusAfter) host.enterEdit(focus, null, 0);
    return focus ?? parts[0].id;
  }
  /** a container (or a child's container) → one plain block */
  function join(id) {
    const b = host.blockById(id);
    const c = isContainer(b) ? b : containerOf(id);
    if (!c) return false;
    host.applyBlocks('join into one block', (list) => {
      const ks = childrenOf(list).get(c.id) ?? [];
      const drop = new Set(ks.map((k) => k.id));
      return list.filter((x) => !drop.has(x.id)).map((x) => (x.id === c.id ? joinContainer(x, ks) : copy(x)));
    });
    return true;
  }

  /** ⌘-Enter: in a plain proof/theorem → a container; in a container's head: nothing. false: the app splits. */
  function split(id, offset, { edit = false } = {}) {
    const b = host.blockById(id);
    if (!b) return false;
    if (isContainer(b)) return true;
    if (b.parentId) return false;                       // a paragraph: the app's split, the new block its sibling
    const f = parseFrame(b.source);
    if (!f || !nestableEnv(f.env, host.splitOptions())) return false;
    if (offset <= f.head.length || offset >= b.source.length - f.end.length - f.after.length) return false;
    return !!nestBlock(id, { split: offset, focusAfter: edit });
  }
  /** Backspace at the start / "merge with the block above". null: the app merges as usual; true/false: done / refused. */
  function merge(id, { edit = false } = {}) {
    const list = blocks();
    const i = list.findIndex((x) => x.id === id);
    const b = list[i], prev = list[i - 1];
    if (!b || !prev) return null;
    if (isContainer(b)) return false;                                   // a container is not merged
    const p = parentOf(id);
    if (!p) return prev.parentId || isContainer(prev) ? false : null;  // a top-level block does not merge into a proof
    if (prev.id === p) return false;                                   // the first paragraph: nothing above it inside
    const joinAt = prev.source.replace(/\s+$/, '').length + 2;
    host.applyBlocks('merge blocks', (l) => {
      const out = l.map(copy);
      const a = out.find((x) => x.id === prev.id);
      a.source = `${a.source.replace(/\s+$/, '')}\n\n${b.source.replace(/^\s+/, '')}`;
      a.kind = host.kindOf(a.source);
      return normalize(out.filter((x) => x.id !== id));
    });
    if (edit) host.enterEdit(host.blockById(prev.id) ? prev.id : p, null, host.blockById(prev.id) ? joinAt : null);
    return true;
  }
  /** delete: a container with its children; a child (a container left with one child is joined). false: the app's. */
  function remove(id) {
    const b = host.blockById(id);
    if (!b) return false;
    if (!isContainer(b) && !parentOf(id)) return false;
    const unit = new Set(unitOf(id));
    host.applyBlocks(isContainer(b) ? 'delete block' : 'delete block', (l) => normalize(l.filter((x) => !unit.has(x.id))), { safety: 'deleting a block' });
    return true;
  }
  /** duplicate a container with its children (new ids) right after it; false: the app's */
  function duplicate(id) {
    const b = host.blockById(id);
    if (!isContainer(b)) return false;
    const unit = unitOf(id);
    host.applyBlocks('duplicate block', (l) => {
      const out = l.map(copy);
      const src = out.filter((x) => unit.includes(x.id));
      const cid = host.ids.ulid();
      const dup = src.map((x) => ({ ...copy(x), id: x.id === id ? cid : host.ids.ulid(), parentId: x.id === id ? null : cid, pos: '' }));
      const at = out.findIndex((x) => x.id === unit[unit.length - 1]) + 1;
      out.splice(at, 0, ...dup);
      return normalize(out);
    });
    return true;
  }
  /** the parent a block inserted at `index` of the list gets: a sibling of the block before it (a child), the
   *  first child of an open container before it; top level otherwise */
  function parentAt(index) {
    const prev = blocks()[index - 1];
    if (!prev) return null;
    if (isContainer(prev)) return isCollapsed(prev.id) ? null : prev.id;
    return parentOf(prev.id);
  }

  /** ⌥↑/⌥↓, "Move up/down": a child moves among its siblings and out at either end; a top-level block moves
   *  into an open container's end or start; a container moves past whole blocks. false: the app's move. */
  function moveBy(id, dir) {
    const list = blocks();
    const b = host.blockById(id);
    if (!b) return false;
    const without = (ids) => list.filter((x) => !ids.includes(x.id));
    const unit = unitOf(id);
    const rest = without(unit);
    const idx = (xid) => rest.findIndex((x) => x.id === xid);
    const p = parentOf(id);
    if (p) {
      const sib = kidsOf(p);
      const k = sib.findIndex((x) => x.id === id);
      if (dir < 0) return k === 0 ? moveTo(id, idx(p), null) : moveTo(id, idx(sib[k - 1].id), p);
      const lastOfUnit = sib[sib.length - 1].id === id ? (sib[sib.length - 2]?.id ?? p) : null;
      return k === sib.length - 1 ? moveTo(id, idx(lastOfUnit) + 1, null) : moveTo(id, idx(sib[k + 1].id) + 1, p);
    }
    const i = list.findIndex((x) => x.id === id);
    if (isContainer(b)) {
      if (dir < 0) {
        const prev = list[i - 1];
        if (!prev) return true;
        const start = parentOf(prev.id) ?? prev.id;
        return moveTo(id, idx(start), null);
      }
      const next = list[i + unit.length];
      if (!next) return true;
      const nu = unitOf(next.id);
      return moveTo(id, idx(nu[nu.length - 1]) + 1, null);
    }
    if (dir < 0) {
      const prev = list[i - 1];
      const pp = prev && parentOf(prev.id);
      if (pp) return isCollapsed(pp) ? moveTo(id, idx(pp), null) : moveTo(id, idx(prev.id) + 1, pp);
      return false;
    }
    const next = list[i + 1];
    if (next && isContainer(next)) {
      if (isCollapsed(next.id)) { const nu = unitOf(next.id); return moveTo(id, idx(nu[nu.length - 1]) + 1, null); }
      return moveTo(id, idx(next.id) + 1, next.id);
    }
    return false;
  }

  /** a child to right after its container (top level) */
  function moveOut(id) {
    const p = parentOf(id);
    if (!p) return false;
    const rest = blocks().filter((x) => x.id !== id);
    const unit = unitOf(p).filter((x) => x !== id);
    return moveTo(id, rest.findIndex((x) => x.id === unit[unit.length - 1]) + 1, null, 'move out of the environment');
  }

  // ── drag and drop ─────────────────────────────────────────────────────────
  /** Where a dragged block can land: [{ y, index, parentId, indent }] (index in the list without it).
   *  elOf(id): the element that shows a block in the pane the pointer is in (split view: a mirror or the
   *  real one); the places are that pane's. Blocks it does not draw (collapsed, out of a section focus) are skipped. */
  function dragTargets(id, elOf) {
    const list = blocks();
    const unit = new Set(unitOf(id));
    const isC = isContainer(host.blockById(id));
    const drawn = (b) => { const el = elOf(b.id); return !!el && !el.classList.contains('nest-hidden') && (isContainer(b) || el.getClientRects().length > 0); };
    const shown = list.filter((b) => !unit.has(b.id) && drawn(b));
    const rest = list.filter((b) => !unit.has(b.id));
    // a container has no row: it is a line at its first shown paragraph's top
    const rect = (b) => {
      if (isContainer(b)) { const f = kidsOf(b.id).map((k) => elOf(k.id)).find((r) => r && !r.classList.contains('nest-hidden')); if (f) { const t = f.getBoundingClientRect().top; return { top: t, bottom: t }; } }
      return elOf(b.id).getBoundingClientRect();
    };
    const out = [];
    const add = (y, before, prevB) => {
      const index = before ? rest.indexOf(before) : rest.length;
      const inside = before && parentOf(before.id);                      // between a container's children
      if (inside) { if (!isC) out.push({ y, index, parentId: inside, indent: true }); return; }
      const pp = prevB && parentOf(prevB.id);                             // after a container's last child
      if (pp && !isC) out.push({ y, index, parentId: pp, indent: true });
      out.push({ y, index, parentId: null, indent: false });
    };
    shown.forEach((b, k) => {
      const r = rect(b);
      const y = k === 0 ? r.top - 4 : (rect(shown[k - 1]).bottom + r.top) / 2;
      add(y, b, shown[k - 1]);
    });
    if (shown.length) add(rect(shown[shown.length - 1]).bottom + 4, null, shown[shown.length - 1]);
    return out;
  }
  /** The target nearest the pointer (x picks inside / outside where both are possible). */
  function pickTarget(targets, x, y, colLeft) {
    let best = null;
    for (const t of targets) if (!best || Math.abs(t.y - y) < Math.abs(best.y - y) - 0.5) best = t;
    if (!best) return null;
    const same = targets.filter((t) => Math.abs(t.y - best.y) < 0.5);
    if (same.length > 1) return same.find((t) => t.indent === (x > colLeft + 18)) ?? best;
    return best;
  }
  function drop(id, t) {
    if (!t) return false;
    const list = blocks();
    const unit = unitOf(id);
    const rest = list.filter((b) => !unit.includes(b.id));
    const i = list.findIndex((x) => x.id === id);
    // dropped where it was: nothing to do
    if (rest[t.index - 1] === list[i - 1] && (t.parentId ?? null) === (parentOf(id) ?? null) && rest[t.index] === list[i + unit.length]) return false;
    return moveTo(id, t.index, t.parentId, 'move block');
  }

  // ── the block menu ────────────────────────────────────────────────────────
  function menuItems(id, menuItem) {
    const b = host.blockById(id);
    if (!b) return [];
    if (isContainer(b)) return [menuItem('Join into one block', 'nest-join', () => join(id)),
      menuItem(isCollapsed(id) ? 'Show the paragraphs' : 'Hide the paragraphs', 'nest-collapse', () => collapse(id))];
    if (parentOf(id)) return [menuItem('Join into one block', 'nest-join', () => join(id)),
      menuItem('Move out of the environment', 'nest-out', () => moveOut(id))];
    const parts = nestPlan(b, null);
    return parts ? [menuItem('Split into paragraphs', 'nest-split', () => nestBlock(id))] : [];
  }

  /** keyboard selection: the next block shown (collapsed children skipped) */
  function visibleStep(i, dir) {
    const list = blocks();
    let k = i + dir;
    while (k >= 0 && k < list.length && host.ui.get(list[k].id)?.decor.has('nest-hidden')) k += dir;
    return Math.max(0, Math.min(k, list.length - 1));
  }
  /** the block whose spacing data sets the gap above block k (containers have none), and where the gap goes */
  function spacingPrev(k) {
    const list = blocks();
    let j = k - 1;
    while (j >= 0 && isContainer(list[j])) j--;
    return j >= 0 ? list[j] : null;
  }
  /** the block that takes the gap above block k: itself (a container has no row to put it above) */
  function spacingTarget(k) { return blocks()[k]; }

  function state() {
    const t = tree();
    return [...t.kids].map(([id, ks]) => ({
      id, kind: host.blockById(id)?.kind, head: host.blockById(id)?.source, collapsed: isCollapsed(id),
      children: ks.map((k) => ({ id: k.id, role: (() => { const r = t.roles.get(k.id); return r ? (r.first && r.last ? 'only' : r.first ? 'first' : r.last ? 'last' : 'middle') : null; })() })),
    }));
  }

  return {
    order: (list) => treeOrder(list).order, repair: (list) => repairTree(list), isContainer, compileSource, contextView, extraContext, treeSig, pass,
    display, attachView, unwatch, decorate, refreshHeads, layoutHeads, selected, split, merge, remove, duplicate, moveBy, moveTo, dragTargets, pickTarget, drop,
    menuItems, visibleStep, reveal, flatten: (list) => flattenForExport(list), spacingPrev, spacingTarget, parentAt,
    nestBlock, join, collapse, isCollapsed, state, parentOf, moveOut, moveIndex, unit: unitOf,
  };
}
