// svgfig editor: the figure editor over an SVG figure (model.js), drawn with
// SVG.js; selection handles, resizing, rotating and point editing are
// svg.select.js + svg.resize.js on a proxy shape over the selection (the
// objects themselves are drawn from the model, so every edit goes through it
// and undo is a copy of it). The panels are Preact (ui.js).
//   openSvgFigureEditor({ svg } | { fig, glyphs }, { compileLabel, renderTikz, from, name, scale, host })
//     → Promise<{ changed, fig, svg, tikz }>

import { SVG, Matrix } from '@svgdotjs/svg.js';
import '@svgdotjs/svg.select.js';
import '@svgdotjs/svg.resize.js';
import { signal, batch, effect } from '@preact/signals';
import { render as preactRender, h } from 'preact';
import {
  K, ANCHORS, make, clone, find, locate, parentOf, topOf, walk, frameOf, boundsOf, boundsOfAll, translate, mapBox,
  union, rotPts, newFigure, normalise, reId,
} from './model.js';
import { renderObject } from './render.js';
import { figureToSvg, svgToFigure, modelJson } from './asset.js';
import { toTikz } from './tikz.js';
import { createTypesetter, sigOf } from './text.js';
import { installFigureColours, currentTheme, shown } from './colours.js';
import { injectStyle } from './style.js';
import { App } from './ui.js';
import { reduced } from '../motion/reduced.ts';
import { isMacPlatform } from '../../../workbench/src/keys.ts';

const HANDLE = 7;          // handle size, CSS px
const SNAP = 5;            // snapping distance, CSS px
const isMac = isMacPlatform();

export async function openSvgFigureEditor(input = {}, opts = {}) {
  installFigureColours();
  injectStyle();
  const originalSvg = input.svg ?? null;
  const parsed = input.fig ? { fig: normalise(input.fig), glyphs: input.glyphs ?? new Map() }
    : (originalSvg && svgToFigure(originalSvg)) || { fig: newFigure(), glyphs: new Map() };
  let fig = parsed.fig;
  const ts = createTypesetter({ renderTikz: opts.renderTikz, compileLabel: opts.compileLabel });
  ts.adopt(parsed.glyphs);
  const startJson = modelJson(fig);

  // ── state ──────────────────────────────────────────────────────────────
  const S = {
    tool: signal('select'), sel: signal([]), version: signal(0), zoom: signal(1), editing: signal(null),
    pending: signal(0), canUndo: signal(false), canRedo: signal(false), theme: signal(currentTheme()),
    errors: signal(new Map()), popAt: signal(null), gesture: signal(null), closing: signal(false),
  };
  const undoStack = [modelJson(fig)], redoStack = [];
  let gesture = null;              // the pointer gesture under way
  let proxy = null;                // the proxy shape the handles sit on
  const live = new Map();          // text id -> { el, block } (a text box re-breaking live)
  let clipboard = null, pasteShift = 0;
  let panX = 0, panY = 0;
  let resolveDone;

  // ── DOM ────────────────────────────────────────────────────────────────
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const root = el('div', 'svf-root', { role: 'dialog', 'aria-label': `Figure editor${opts.name ? `: ${opts.name}` : ''}`, tabindex: '-1' });
  const viewport = el('div', 'svf-viewport');
  const back = el('div', 'svf-back');
  const stage = el('div', 'svf-stage');
  const shade = el('div', 'svf-shade');
  const sheet = el('div', 'svf-sheet');
  const liveLayer = el('div', 'svf-live');
  const chrome = el('div', 'svf-chrome');
  stage.append(shade, sheet);
  viewport.append(back, stage);
  root.append(viewport, chrome);
  (opts.host ?? document.body).append(root);
  if (!opts.host) root.classList.add('svf-overlay');

  const draw = SVG().addTo(sheet).addClass('svf-svg');
  /** Client coordinates from an element's user space, the stage's CSS transform included. WebKit's
   *  getScreenCTM leaves out CSS transforms on HTML ancestors (the stage's zoom), so pointer maths in
   *  figure units was off by the zoom there (svg.js point(), svg.resize.js). The root's mapping is
   *  taken from its box on screen; an element's own transforms relative to the root from the native
   *  CTMs, whose (possibly wrong) outer part cancels. */
  function clientCTM(node) {
    const r = draw.node.getBoundingClientRect();
    const vb = draw.viewbox();
    const root = new Matrix(r.width / vb.width, 0, 0, r.height / vb.height, r.left - (vb.x * r.width) / vb.width, r.top - (vb.y * r.height) / vb.height);
    if (node === draw.node) return root;
    return root.multiply(new Matrix(draw.node.getScreenCTM()).inverse().multiply(new Matrix(node.getScreenCTM())));
  }
  function fixCTM(elm) { elm.screenCTM = function () { return clientCTM(this.node); }; return elm; }
  fixCTM(draw);
  const content = draw.group().addClass('svf-content');
  const overlay = draw.group().addClass('svf-overlayg');
  sheet.append(liveLayer);
  function sizeSheet() {
    sheet.style.width = shade.style.width = `${fig.w * K}px`; sheet.style.height = shade.style.height = `${fig.h * K}px`;
    draw.size(fig.w * K, fig.h * K).viewbox(0, 0, fig.w, fig.h);
  }

  // ── model access ─────────────────────────────────────────────────────────
  const selObjs = () => S.sel.value.map((id) => find(fig, id)).filter(Boolean);
  const px = (v) => v / (K * S.zoom.value);          // CSS px -> bp at the current zoom
  const texts = () => [...walk(fig.objects)].map(([o]) => o).filter((o) => o.type === 'text');

  // ── painting ─────────────────────────────────────────────────────────────
  function applyTheme() {
    S.theme.value = currentTheme();
    sheet.style.color = shade.style.color = shown('#000000');
    root.dataset.theme = S.theme.value;
  }
  // a text's glyphs give way to its live block only once that block shows (never an empty box)
  function paintOpts() { return { glyphs: ts.glyphs, mounted: new Set([...live].filter(([, e]) => e.ready).map(([id]) => id)), hitWidth: px(8) }; }
  function paint(ids = null) {
    const o = paintOpts();
    if (ids) {
      for (const id of ids) {
        const obj = topOf(fig, id);
        const g = obj && content.node.querySelector(`:scope > [data-id="${obj.id}"]`);
        if (g) g.outerHTML = renderObject(obj, 'canvas', o); else return paint();
      }
    } else content.node.innerHTML = fig.objects.map((x) => renderObject(x, 'canvas', o)).join('');
    for (const [id, msg] of S.errors.value) { const g = content.node.querySelector(`[data-id="${id}"]`); if (g) { g.classList.add('svf-error'); g.setAttribute('data-error', msg.slice(0, 300)); } }
    placeLive();
  }
  function changed() { S.version.value++; }

  // ── history ──────────────────────────────────────────────────────────────
  function commit() {
    const j = modelJson(fig);
    if (j === undoStack[undoStack.length - 1]) { changed(); return false; }
    undoStack.push(j); if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    S.canUndo.value = undoStack.length > 1; S.canRedo.value = false;
    changed();
    typesetAll();
    return true;
  }
  function restore(j) {
    fig = normalise(JSON.parse(j));
    batch(() => { S.sel.value = S.sel.value.filter((id) => find(fig, id)); S.editing.value = null; });
    sizeSheet(); paint(); syncProxy(); changed(); typesetAll();
  }
  function undo() { if (undoStack.length < 2) return; endTextEdit(); redoStack.push(undoStack.pop()); restore(undoStack[undoStack.length - 1]); S.canUndo.value = undoStack.length > 1; S.canRedo.value = true; }
  function redo() { if (!redoStack.length) return; const j = redoStack.pop(); undoStack.push(j); restore(j); S.canUndo.value = true; S.canRedo.value = redoStack.length > 0; }

  // ── LaTeX texts ──────────────────────────────────────────────────────────
  ts.onPending((n) => { S.pending.value = n; });
  function typesetOne(o, tsOpts) {
    return ts.typeset(o, tsOpts).then((r) => {
      if (!find(fig, o.id)) return r;
      const errs = new Map(S.errors.value);
      if (r.error && !r.stale) errs.set(o.id, r.error); else if (!r.stale) errs.delete(o.id);
      S.errors.value = errs;
      if (r.changed || r.error) { paint([o.id]); if (S.sel.value.includes(o.id) && !gesture) syncProxy(); changed(); }
      return r;
    });
  }
  function typesetAll() { return Promise.all(texts().filter((o) => !live.has(o.id)).map(typesetOne)); }

  // A text box re-breaking while its width is dragged. The live viewer block (below) re-breaks the
  // typeset text at every width with no compile; until it shows (or where the snippet compile is not
  // available) the glyphs stay drawn and are typeset again for the width the box has reached: one
  // compile at a time, always for the latest width, each result drawn as it comes (rebreak).
  const rebreaking = new Map();      // id -> Promise (a compile for the drag's width under way)
  function rebreak(o) {
    if (rebreaking.has(o.id) || live.get(o.id)?.ready) return;
    const p = typesetOne(o, { interim: true }).finally(() => {
      rebreaking.delete(o.id);
      const cur = find(fig, o.id);
      if (cur && gesture?.kind === 'handle' && gesture.ids.includes(o.id) && ts.glyphs.get(o.id)?.sig !== sigOf(cur)) rebreak(cur);
    });
    rebreaking.set(o.id, p);
  }
  // a text box re-breaking live (while its width is dragged): a viewer block over it
  async function startLive(o) {
    if (live.has(o.id) || o.box == null) return;
    const host = el('div', 'svf-live-text');
    const entry = { el: host, block: null, ready: false };
    live.set(o.id, entry);
    liveLayer.append(host);
    placeLive();
    try {
      const r = await ts.liveBlock(o, host);
      if (!live.has(o.id)) { r?.block?.destroy?.(); host.remove(); return; }
      entry.block = r?.block ?? null; entry.ready = !!r;
      if (r) { paint([o.id]); placeLive(); } else endLive(o.id);
    } catch { endLive(o.id); }
  }
  function endLive(id) {
    const e = live.get(id);
    if (!e) return;
    live.delete(id);
    const done = () => { try { e.block?.destroy?.(); } catch { /* gone */ } e.el.remove(); };
    // keep the live text until the glyphs for the new width are drawn (no gap)
    const o = find(fig, id);
    if (o) typesetOne(o).finally(() => { paint([id]); done(); }); else done();
  }
  function placeLive() {
    for (const [id, e] of live) {
      const o = find(fig, id);
      if (!o) continue;
      const f = frameOf(o);
      const st = e.el.style;
      st.left = `${f[0] * K}px`; st.width = `${o.box * K}px`;
      // anchored vertically as the glyphs are: the block's own height decides
      const hPx = e.el.offsetHeight || (f[3] - f[1]) * K;
      const [, ay] = ANCHORS[o.anchor] ?? ANCHORS.nw;
      st.top = `${o.y * K - ay * hPx}px`;
      st.color = o.color && o.color !== '#000000' ? shown(o.color) : '';
      st.opacity = o.opacity < 1 ? String(o.opacity) : '';
      st.visibility = e.ready ? 'visible' : 'hidden';
    }
  }

  // ── selection proxy and handles (svg.select.js, svg.resize.js) ───────────
  const handleOpts = {
    createHandle(group) { group.rect(1, 1); },
    updateHandle(shape, p) { const s = px(HANDLE); shape.size(s, s).center(p[0], p[1]); },
    createRot(group) { group.line(0, 0, 0, 0).addClass('svf-rot-stem'); group.circle(1).addClass('svf-rot-knob'); },
    updateRot(group, _rp, hp) {
      const t = hp[1], b = hp[5];
      const d = Math.hypot(t[0] - b[0], t[1] - b[1]) || 1, ux = (t[0] - b[0]) / d, uy = (t[1] - b[1]) / d;
      const k = [t[0] + ux * px(22), t[1] + uy * px(22)];
      group.get(0).plot(t[0], t[1], k[0], k[1]);
      group.get(1).radius(px(4.5)).center(k[0], k[1]);
    },
  };
  const pointOpts = { createHandle(group) { group.circle(1); }, updateHandle(shape, p) { shape.radius(px(4.5)).center(p[0], p[1]); } };
  function handlesFor(objs) {
    if (objs.length !== 1) return ['lt', 't', 'rt', 'r', 'rb', 'b', 'lb', 'l'];
    const o = objs[0];
    if (o.locked) return [];
    if (o.type === 'text') return o.box != null ? ['l', 'r', 'rot'] : ['rot'];
    if (o.type === 'group') return ['lt', 't', 'rt', 'r', 'rb', 'b', 'lb', 'l'];
    return ['lt', 't', 'rt', 'r', 'rb', 'b', 'lb', 'l', 'rot'];
  }
  function dropProxy() {
    if (!proxy) return;
    try { proxy.resize(false); } catch { /* */ }
    try { proxy.select(false); } catch { /* */ }
    try { proxy.pointSelect?.(false); } catch { /* */ }
    proxy.remove(); proxy = null;
  }
  function syncProxy() {
    dropProxy();
    const objs = selObjs().filter((o) => !o.hidden);
    if (!objs.length) { S.popAt.value = null; return; }
    const one = objs.length === 1 ? objs[0] : null;
    if (one && (one.type === 'line' || one.type === 'path') && !one.locked) {
      proxy = overlay.polyline(one.pts.map((p) => p.slice())).addClass('svf-proxy svf-proxy-pts').fill('none').stroke({ color: 'transparent', width: px(10) });
      fixCTM(proxy);
      proxy.pointSelect(pointOpts).resize({});
      // the box around it too: moving and scaling the whole line
      proxy.select({ ...handleOpts, handles: [] });
    } else {
      const f = one && one.rot ? frameOf(one) : boundsOfAll(objs);
      if (!f) return;
      proxy = overlay.rect(Math.max(f[2] - f[0], 1e-3), Math.max(f[3] - f[1], 1e-3)).move(f[0], f[1]).addClass('svf-proxy').fill('transparent');
      fixCTM(proxy);
      if (one?.rot) proxy.attr('transform', `rotate(${one.rot} ${(f[0] + f[2]) / 2} ${(f[1] + f[3]) / 2})`);
      proxy.select({ ...handleOpts, handles: handlesFor(objs) }).resize({});
    }
    proxy.on('beforeresize', onBeforeResize);
    proxy.on('resize', onResize);
    placePop();
  }
  function selBounds() { return boundsOfAll(selObjs()); }
  /** Where the popover goes: the selection's box on screen. */
  function placePop() {
    const b = selBounds();
    if (!b) { S.popAt.value = null; return; }
    const a = toClient([b[0], b[1]]), c = toClient([b[2], b[3]]);
    S.popAt.value = { left: a[0], top: a[1], right: c[0], bottom: c[1] };
  }

  // ── coordinates, zoom, pan ───────────────────────────────────────────────
  const toFig = (e) => { const p = draw.point(e.clientX, e.clientY); return [p.x, p.y]; };
  function toClient([x, y]) { const r = sheet.getBoundingClientRect(); return [r.left + x * K * S.zoom.value, r.top + y * K * S.zoom.value]; }
  function applyView() { stage.style.transform = `translate(${panX}px, ${panY}px) scale(${S.zoom.value})`; }
  function setZoom(z, cx = null, cy = null) {
    const v = viewport.getBoundingClientRect();
    const z0 = S.zoom.value, z1 = Math.max(0.1, Math.min(8, z));
    const ox = (cx ?? v.left + v.width / 2) - v.left, oy = (cy ?? v.top + v.height / 2) - v.top;
    panX = ox - ((ox - panX) * z1) / z0; panY = oy - ((oy - panY) * z1) / z0;
    S.zoom.value = z1;
    applyView(); paint(); if (!gesture) syncProxy(); else placePop();
  }
  function fit() {
    const v = viewport.getBoundingClientRect();
    const padX = 80, padTop = 90, padBottom = 110;
    const z = Math.min((v.width - 2 * padX - 260) / (fig.w * K), (v.height - padTop - padBottom) / (fig.h * K), 2.5);
    S.zoom.value = Math.max(0.1, z);
    panX = (v.width - 260 - fig.w * K * S.zoom.value) / 2 + 260; panY = padTop + (v.height - padTop - padBottom - fig.h * K * S.zoom.value) / 2;
    applyView(); paint(); syncProxy();
  }

  // ── snapping ─────────────────────────────────────────────────────────────
  function snapTargets(exclude) {
    const xs = [0, fig.w / 2, fig.w], ys = [0, fig.h / 2, fig.h];
    const ex = new Set(exclude);
    for (const o of fig.objects) {
      if (o.hidden || ex.has(o.id) || [...walk([o])].some(([c]) => ex.has(c.id))) continue;
      const b = boundsOf(o);
      if (!b) continue;
      xs.push(b[0], (b[0] + b[2]) / 2, b[2]); ys.push(b[1], (b[1] + b[3]) / 2, b[3]);
    }
    return { xs, ys };
  }
  /** The smallest shift that puts one of `vals` on a target, and the guide. */
  function snap1(vals, targets) {
    let best = null;
    for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) <= px(SNAP) && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }
    return best;
  }
  function showGuides(gx, gy) {
    overlay.find('.svf-guide').forEach((g) => g.remove());
    const w = px(1);
    for (const x of gx) overlay.line(x, -1e4, x, 1e4).addClass('svf-guide').stroke({ width: w });
    for (const y of gy) overlay.line(-1e4, y, 1e4, y).addClass('svf-guide').stroke({ width: w });
  }
  const gridSnap = (v) => Math.round(v * 2) / 2;

  // ── handle gestures (resize, rotate, points) ─────────────────────────────
  function onBeforeResize() {
    const objs = selObjs();
    const one = objs.length === 1 ? objs[0] : null;
    gesture = {
      kind: 'handle', snapshot: objs.map(clone), ids: objs.map((o) => o.id),
      box0: one && one.rot ? frameOf(one) : boundsOfAll(objs), rot0: one?.rot ?? 0, targets: snapTargets(objs.map((o) => o.id)),
    };
    S.gesture.value = 'handle';
    for (const o of objs) if (o.type === 'text' && o.box != null) startLive(o);
    window.addEventListener('mouseup', () => setTimeout(endHandleGesture, 0), { once: true });
  }
  function onResize(e) {
    e.preventDefault();
    if (!gesture || gesture.kind !== 'handle') return;
    const { box, eventType, event, handler } = e.detail;
    const shift = event.shiftKey, alt = event.altKey;
    const objs = gesture.ids.map((id) => find(fig, id));
    if (eventType === 'point') {
      const o = objs[0], i = handler.index;
      let p = toFig(event);
      if (shift && o.pts.length > 1) {
        const q = o.pts[i === 0 ? 1 : i - 1];
        const a = Math.round(Math.atan2(p[1] - q[1], p[0] - q[0]) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        p = [q[0] + d * Math.cos(a), q[1] + d * Math.sin(a)];
      } else if (!alt) {
        const sx = snap1([p[0]], gesture.targets.xs), sy = snap1([p[1]], gesture.targets.ys);
        p = [sx ? p[0] + sx.d : gridSnap(p[0]), sy ? p[1] + sy.d : gridSnap(p[1])];
        showGuides(sx ? [sx.at] : [], sy ? [sy.at] : []);
      }
      o.pts[i] = p;
      paint([o.id]);
      proxy.plot(o.pts.map((q) => q.slice()));
      placePop();
      return;
    }
    if (eventType === 'rot') {
      const o = objs[0];
      const f = frameOf(o), c = [(f[0] + f[2]) / 2, (f[1] + f[3]) / 2];
      const p = toFig(event);
      gesture.start ??= toFig(handler.lastEvent ?? event);
      const a0 = Math.atan2(gesture.start[1] - c[1], gesture.start[0] - c[0]), a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
      let r = gesture.rot0 + ((a1 - a0) * 180) / Math.PI;
      r = shift ? Math.round(r / 15) * 15 : Math.round(r * 10) / 10;
      r = ((r % 360) + 540) % 360 - 180;
      o.rot = Math.abs(r) < 1e-6 ? 0 : r;
      if (!o.rot) delete o.rot;
      paint([o.id]);
      proxy.attr('transform', o.rot ? `rotate(${o.rot} ${c[0]} ${c[1]})` : null);
      placePop();
      return;
    }
    let nb = [box.x, box.y, box.x2, box.y2];
    const b0 = gesture.box0;
    if (shift && eventType.length === 2) {
      // keep the proportions (corners)
      const s = Math.max((nb[2] - nb[0]) / ((b0[2] - b0[0]) || 1), (nb[3] - nb[1]) / ((b0[3] - b0[1]) || 1));
      const w = (b0[2] - b0[0]) * s, hh = (b0[3] - b0[1]) * s;
      nb = [eventType.includes('l') ? b0[2] - w : b0[0], eventType.includes('t') ? b0[3] - hh : b0[1], 0, 0];
      nb[2] = nb[0] + w; nb[3] = nb[1] + hh;
    } else if (!alt && !objs[0]?.rot) {
      const gx = [], gy = [];
      const sx = eventType.includes('l') ? snap1([nb[0]], gesture.targets.xs) : eventType.includes('r') ? snap1([nb[2]], gesture.targets.xs) : null;
      const sy = eventType.includes('t') ? snap1([nb[1]], gesture.targets.ys) : eventType.includes('b') ? snap1([nb[3]], gesture.targets.ys) : null;
      if (sx) { if (eventType.includes('l')) nb[0] += sx.d; else nb[2] += sx.d; gx.push(sx.at); }
      else { if (eventType.includes('l')) nb[0] = gridSnap(nb[0]); if (eventType.includes('r')) nb[2] = gridSnap(nb[2]); }
      if (sy) { if (eventType.includes('t')) nb[1] += sy.d; else nb[3] += sy.d; gy.push(sy.at); }
      else { if (eventType.includes('t')) nb[1] = gridSnap(nb[1]); if (eventType.includes('b')) nb[3] = gridSnap(nb[3]); }
      showGuides(gx, gy);
    }
    if (nb[2] - nb[0] < 0.5) nb[2] = nb[0] + 0.5;
    if (nb[3] - nb[1] < 0.5) nb[3] = nb[1] + 0.5;
    gesture.snapshot.forEach((snap, i) => {
      const o = objs[i];
      const c = clone(snap);
      if (c.rot && objs.length === 1) {
        // a rotated shape: the box is its own frame
        if (c.type === 'text') { mapBox(c, b0, nb); } else { c.x = nb[0]; c.y = nb[1]; c.w = nb[2] - nb[0]; c.h = nb[3] - nb[1]; }
      } else mapBox(c, b0, nb);
      Object.assign(o, c);
    });
    paint(gesture.ids);
    for (const o of objs) if (o.type === 'text' && o.box != null) rebreak(o);
    const one = objs.length === 1 ? objs[0] : null;
    const f = one?.rot ? frameOf(one) : one?.type === 'text' ? frameOf(one) : nb;
    proxy.size(Math.max(f[2] - f[0], 1e-3), Math.max(f[3] - f[1], 1e-3)).move(f[0], f[1]);
    if (one?.rot) proxy.attr('transform', `rotate(${one.rot} ${(f[0] + f[2]) / 2} ${(f[1] + f[3]) / 2})`);
    placePop();
  }
  function endHandleGesture() {
    if (!gesture || gesture.kind !== 'handle') return;
    const ids = gesture.ids;
    gesture = null; S.gesture.value = null;
    showGuides([], []);
    for (const id of ids) if (live.has(id)) endLive(id);
    commit();
    paint(); syncProxy();
  }

  // ── pointer gestures on the canvas ───────────────────────────────────────
  function objectAt(e, deep = false) {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    for (const t of stack) {
      if (!content.node.contains(t)) continue;
      const g = t.closest('[data-id]');
      if (!g) continue;
      const chain = [];
      for (let x = g; x && x !== content.node; x = x.parentElement) if (x.dataset?.id) chain.unshift(x.dataset.id);
      const pick = deep ? chain[chain.length - 1] : (S.sel.value.find((id) => chain.includes(id) && chain.indexOf(id) > 0) ?? chain[0]);
      const o = find(fig, pick);
      if (o && !o.locked && !o.hidden && !(topOf(fig, pick)?.locked)) return pick;
    }
    return null;
  }
  const onHandle = (t) => !!t.closest?.('.svg_select_handle, .svg_select_handle_rot, .svg_select_handle_point');

  viewport.addEventListener('pointerdown', (e) => {
    if (S.closing.value) return;
    if (e.button === 1 || (e.button === 0 && (spaceDown || S.tool.value === 'hand'))) { startPan(e); return; }
    if (e.button !== 0 || onHandle(e.target)) return;
    if (!sheet.contains(e.target) && e.target !== viewport && e.target !== stage) return;
    root.focus({ preventScroll: true });
    if (S.editing.value) endTextEdit();
    const p = toFig(e);
    const t = S.tool.value;
    if (t === 'select') selectDown(e, p);
    else if (t === 'rect' || t === 'ellipse') createBox(e, p, t);
    else if (t === 'line' || t === 'arrow') createLine(e, p, t);
    else if (t === 'path') polyClick(e, p);
    else if (t === 'label') createLabel(e, p);
    else if (t === 'box') createTextBox(e, p);
  });
  // no native drag out of the canvas: Chromium starts one on an Alt-drag (the Alt of "no snapping"
  // and of "duplicate"), and cancels the pointer gesture under way
  viewport.addEventListener('dragstart', (e) => e.preventDefault());
  viewport.addEventListener('dblclick', (e) => {
    if (S.tool.value === 'path') { finishPoly(); return; }
    if (S.tool.value !== 'select' || onHandle(e.target)) return;
    const id = objectAt(e, true);
    if (!id) return;
    const o = find(fig, id);
    if (o.type === 'text') { select([id]); beginTextEdit(id); return; }
    const top = topOf(fig, id);
    if (top && top.id !== id) select([id]);   // into a group
  });

  function capture(e, move, up) {
    const tgt = viewport;
    try { tgt.setPointerCapture(e.pointerId); } catch { /* */ }
    const mv = (ev) => { if (ev.pointerId === e.pointerId) move(ev); };
    const fin = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', fin); tgt.removeEventListener('pointercancel', fin);
      try { tgt.releasePointerCapture(e.pointerId); } catch { /* */ }
      up(ev);
    };
    tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', fin); tgt.addEventListener('pointercancel', fin);
  }

  function startPan(e) {
    const x0 = e.clientX - panX, y0 = e.clientY - panY;
    root.classList.add('svf-panning');
    capture(e, (ev) => { panX = ev.clientX - x0; panY = ev.clientY - y0; applyView(); placePop(); }, () => root.classList.remove('svf-panning'));
    e.preventDefault();
  }

  function selectDown(e, p) {
    const deep = e.metaKey || e.ctrlKey;
    const onProxy = proxy && e.target === proxy.node;
    let id = objectAt(e, deep);
    const inSel = id && S.sel.value.includes(id);
    if (onProxy && !e.shiftKey) id = null;       // inside the selection's box: move the selection
    if (id) {
      if (e.shiftKey) { select(inSel ? S.sel.value.filter((x) => x !== id) : [...S.sel.value, id]); if (inSel) return; }
      else if (!inSel) select([id]);
    } else if (!onProxy) {
      startMarquee(e, p);
      return;
    }
    startMove(e, p, !e.shiftKey && inSel && S.sel.value.length > 1 ? id : null);
  }

  function startMove(e, p0, clickSelects) {
    let objs = selObjs().filter((o) => !o.locked);
    if (!objs.length) return;
    const c0 = [e.clientX, e.clientY];
    let moved = false, dup = false;
    const b0 = boundsOfAll(objs);
    let targets = null;
    capture(e, (ev) => {
      if (!moved && Math.hypot(ev.clientX - c0[0], ev.clientY - c0[1]) < 3) return;
      if (!moved) {
        moved = true;
        if (ev.altKey && !dup) { dup = true; objs = duplicate(objs, 0); }
        targets = snapTargets(objs.map((o) => o.id));
        gesture = { kind: 'move' }; S.gesture.value = 'move';
      }
      const p = toFig(ev);
      let dx = p[0] - p0[0], dy = p[1] - p0[1];
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const gx = [], gy = [];
      if (!ev.altKey || dup) {
        const sx = snap1([b0[0] + dx, (b0[0] + b0[2]) / 2 + dx, b0[2] + dx], targets.xs);
        const sy = snap1([b0[1] + dy, (b0[1] + b0[3]) / 2 + dy, b0[3] + dy], targets.ys);
        if (sx) { dx += sx.d; gx.push(sx.at); } else dx = gridSnap(b0[0] + dx) - b0[0];
        if (sy) { dy += sy.d; gy.push(sy.at); } else dy = gridSnap(b0[1] + dy) - b0[1];
      }
      showGuides(gx, gy);
      gesture.d = [dx, dy];
      for (const o of objs) {
        const g = content.node.querySelector(`[data-id="${o.id}"]`);
        if (g) g.setAttribute('transform', `translate(${dx} ${dy})`);
      }
      if (proxy) {
        const base = proxy.attr('data-base') ?? proxy.attr('transform') ?? '';
        if (proxy.attr('data-base') == null) proxy.attr('data-base', base || ' ');
        proxy.attr('transform', `translate(${dx} ${dy}) ${String(base).trim()}`.trim());
      }
      for (const o of objs) if (live.has(o.id)) placeLive();
      placePop();
    }, () => {
      showGuides([], []);
      if (!moved) { if (clickSelects) select([clickSelects]); return; }
      const [dx, dy] = gesture?.d ?? [0, 0];
      gesture = null; S.gesture.value = null;
      for (const o of objs) translate(o, dx, dy);
      paint(); commit(); syncProxy();
    });
  }

  function startMarquee(e, p0) {
    const add = e.shiftKey ? S.sel.value.slice() : [];
    if (!e.shiftKey) select([]);
    const r = overlay.rect(0, 0).addClass('svf-marquee').move(p0[0], p0[1]).stroke({ width: px(1) });
    gesture = { kind: 'marquee' };
    capture(e, (ev) => {
      const p = toFig(ev);
      const b = [Math.min(p0[0], p[0]), Math.min(p0[1], p[1]), Math.max(p0[0], p[0]), Math.max(p0[1], p[1])];
      r.move(b[0], b[1]).size(b[2] - b[0], b[3] - b[1]);
      const hit = fig.objects.filter((o) => !o.hidden && !o.locked).filter((o) => { const q = boundsOf(o); return q && q[0] <= b[2] && q[2] >= b[0] && q[1] <= b[3] && q[3] >= b[1]; }).map((o) => o.id);
      S.sel.value = [...new Set([...add, ...hit])];
    }, () => { r.remove(); gesture = null; syncProxy(); });
  }

  // ── creating ─────────────────────────────────────────────────────────────
  function insert(o, list = fig.objects) { list.push(o); return o; }
  function createBox(e, p0, type) {
    const snapT = snapTargets([]);
    const sp = (p) => { const sx = snap1([p[0]], snapT.xs), sy = snap1([p[1]], snapT.ys); return [sx ? p[0] + sx.d : gridSnap(p[0]), sy ? p[1] + sy.d : gridSnap(p[1])]; };
    if (!e.altKey) p0 = sp(p0);
    const o = insert(make(type, { x: p0[0], y: p0[1], w: 0, h: 0, fill: null }));
    gesture = { kind: 'create' }; S.gesture.value = 'create';
    paint([o.id]);
    let moved = false;
    capture(e, (ev) => {
      moved = true;
      let p = ev.altKey ? toFig(ev) : sp(toFig(ev));
      let w = p[0] - p0[0], hh = p[1] - p0[1];
      if (ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; }
      o.x = Math.min(p0[0], p0[0] + w); o.y = Math.min(p0[1], p0[1] + hh); o.w = Math.abs(w); o.h = Math.abs(hh);
      paint([o.id]);
    }, () => {
      gesture = null; S.gesture.value = null;
      if (!moved || o.w < 2 || o.h < 2) { o.w = type === 'rect' ? 72 : 48; o.h = type === 'rect' ? 36 : 48; }
      paint(); S.tool.value = 'select'; select([o.id]); commit();
    });
  }
  function createLine(e, p0, type) {
    const snapPts = anchorPoints([]);
    const sp = (p, ev) => {
      if (ev?.altKey) return p;
      let best = null;
      for (const q of snapPts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= px(8) && (!best || d < best.d)) best = { d, q }; }
      return best ? best.q.slice() : [gridSnap(p[0]), gridSnap(p[1])];
    };
    p0 = sp(p0, e);
    const o = insert(make('line', { pts: [p0, p0.slice()], arrowEnd: type === 'arrow' ? 'latex' : 'none' }));
    gesture = { kind: 'create' }; S.gesture.value = 'create';
    let moved = false;
    capture(e, (ev) => {
      moved = true;
      let p = toFig(ev);
      if (ev.shiftKey) {
        const a = Math.round(Math.atan2(p[1] - p0[1], p[0] - p0[0]) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(p[0] - p0[0], p[1] - p0[1]);
        p = [p0[0] + d * Math.cos(a), p0[1] + d * Math.sin(a)];
      } else p = sp(p, ev);
      o.pts[1] = p;
      paint([o.id]);
    }, () => {
      gesture = null; S.gesture.value = null;
      if (!moved || Math.hypot(o.pts[1][0] - p0[0], o.pts[1][1] - p0[1]) < 2) o.pts[1] = [p0[0] + 60, p0[1]];
      paint(); S.tool.value = 'select'; select([o.id]); commit();
    });
  }
  /** Points lines snap to: the corners, edge middles and centres of the objects. */
  function anchorPoints(exclude) {
    const out = [];
    for (const o of fig.objects) {
      if (o.hidden || exclude.includes(o.id)) continue;
      if (o.pts) { out.push(...o.pts); continue; }
      const b = boundsOf(o); if (!b) continue;
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      out.push([b[0], b[1]], [cx, b[1]], [b[2], b[1]], [b[2], cy], [b[2], b[3]], [cx, b[3]], [b[0], b[3]], [b[0], cy], [cx, cy]);
    }
    return out;
  }
  let poly = null;
  function polyClick(e, p) {
    if (!e.altKey) p = [gridSnap(p[0]), gridSnap(p[1])];
    if (!poly) {
      const o = insert(make('path', { pts: [p, p.slice()] }));
      poly = { id: o.id };
      gesture = { kind: 'poly' }; S.gesture.value = 'create';
      paint([o.id]);
      return;
    }
    const o = find(fig, poly.id);
    const first = o.pts[0];
    if (o.pts.length > 2 && Math.hypot(first[0] - p[0], first[1] - p[1]) <= px(8)) { o.pts.pop(); o.closed = true; o.fill = null; finishPoly(); return; }
    o.pts[o.pts.length - 1] = p;
    o.pts.push(p.slice());
    paint([o.id]);
  }
  viewport.addEventListener('pointermove', (e) => {
    if (!poly) return;
    const o = find(fig, poly.id);
    if (!o) { poly = null; return; }
    let p = toFig(e);
    if (e.shiftKey) {
      const q = o.pts[o.pts.length - 2];
      const a = Math.round(Math.atan2(p[1] - q[1], p[0] - q[0]) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      p = [q[0] + d * Math.cos(a), q[1] + d * Math.sin(a)];
    }
    o.pts[o.pts.length - 1] = e.altKey ? p : [gridSnap(p[0]), gridSnap(p[1])];
    paint([o.id]);
  });
  function finishPoly() {
    if (!poly) return;
    const o = find(fig, poly.id);
    poly = null; gesture = null; S.gesture.value = null;
    if (o) {
      // the rubber band's point goes; a doubled last point (the double click) too
      if (!o.closed) o.pts.pop();
      while (o.pts.length > 2 && Math.hypot(o.pts[o.pts.length - 1][0] - o.pts[o.pts.length - 2][0], o.pts[o.pts.length - 1][1] - o.pts[o.pts.length - 2][1]) < 0.5) o.pts.pop();
      if (o.pts.length < 2) removeIds([o.id]);
    }
    paint(); S.tool.value = 'select';
    if (o && find(fig, o.id)) select([o.id]);
    commit();
  }
  function createLabel(e, p) {
    const g = e.altKey ? (v) => v : gridSnap;
    const o = insert(make('text', { x: g(p[0]), y: g(p[1]), anchor: 'w', src: '', align: 'left' }));
    paint([o.id]); S.tool.value = 'select'; select([o.id]); beginTextEdit(o.id, { fresh: true });
  }
  function createTextBox(e, p0) {
    const g = e.altKey ? (v) => v : gridSnap;
    const o = insert(make('text', { x: g(p0[0]), y: g(p0[1]), anchor: 'nw', box: 120, src: '', align: 'center' }));
    let moved = false;
    gesture = { kind: 'create' };
    capture(e, (ev) => { moved = true; const p = toFig(ev); o.box = Math.max(24, (ev.altKey ? (v) => v : gridSnap)(Math.abs(p[0] - p0[0]))); o.x = Math.min(p0[0], p0[0] + (p[0] - p0[0])); paint([o.id]); },
      () => { gesture = null; paint(); S.tool.value = 'select'; select([o.id]); beginTextEdit(o.id, { fresh: true }); if (!moved) o.box = 120; });
  }

  // ── text editing (the source in the popover) ─────────────────────────────
  let editStart = null, editTimer = null;
  function beginTextEdit(id, { fresh = false } = {}) {
    const o = find(fig, id);
    if (!o || o.type !== 'text') return;
    editStart = { id, src: o.src, fresh };
    S.editing.value = id;
    placePop();
  }
  function setTextSource(id, src) {
    const o = find(fig, id);
    if (!o) return;
    o.src = src;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => typesetOne(o), 220);
    changed();
  }
  function endTextEdit() {
    const id = S.editing.value;
    if (!id) return;
    S.editing.value = null;
    clearTimeout(editTimer);
    const o = find(fig, id);
    const st = editStart; editStart = null;
    if (!o) return;
    if (!o.src.trim()) { removeIds([id]); paint(); syncProxy(); if (!st?.fresh) commit(); return; }
    typesetOne(o);
    commit();
  }

  // ── editing operations ───────────────────────────────────────────────────
  function select(ids) { S.sel.value = [...new Set(ids)].filter((id) => find(fig, id)); if (!gesture) syncProxy(); }
  function removeIds(ids) {
    for (const id of ids) { const l = locate(fig, id); if (l) l[0].splice(l[1], 1); ts.forget(id); live.delete(id); }
    // an emptied group goes too
    const prune = (list) => { for (let i = list.length - 1; i >= 0; i--) if (list[i].type === 'group') { prune(list[i].children); if (!list[i].children.length) list.splice(i, 1); } };
    prune(fig.objects);
  }
  function del() { const ids = S.sel.value; if (!ids.length) return; removeIds(ids); S.sel.value = []; paint(); syncProxy(); commit(); }
  /** Fresh ids for o and all in it; [old, new] pairs. */
  function withIdMap(o) {
    const before = [...walk([o])].map(([x]) => x.id);
    reId(o);
    const after = [...walk([o])].map(([x]) => x.id);
    return before.map((b, i) => [b, after[i]]);
  }
  function duplicate(objs, shift = 8) {
    const out = [];
    for (const o of objs) {
      const l = locate(fig, o.id);
      const c = clone(o);
      for (const [a, b] of withIdMap(c)) ts.copy(a, b);
      if (shift) translate(c, shift, shift);
      l[0].splice(l[1] + 1, 0, c);
      out.push(c);
    }
    paint();
    S.sel.value = out.map((o) => o.id);
    return out;
  }
  function copy() { const objs = selObjs(); if (objs.length) { clipboard = { objs: objs.map(clone), glyphs: new Map(objs.flatMap((o) => [...walk([o])].map(([x]) => [x.id, ts.glyphs.get(x.id)]).filter(([, g]) => g))) }; pasteShift = 0; } }
  function cut() { copy(); del(); }
  function paste() {
    if (!clipboard) return;
    pasteShift += 8;
    const out = [];
    for (const src of clipboard.objs) {
      const c = clone(src);
      const pairs = withIdMap(c);
      for (const [a, b] of pairs) { const g = clipboard.glyphs.get(a); if (g) { ts.glyphs.set(a, g); ts.copy(a, b); } }
      translate(c, pasteShift, pasteShift);
      fig.objects.push(c); out.push(c);
    }
    paint(); select(out.map((o) => o.id)); commit();
  }
  function dup() { const objs = selObjs(); if (!objs.length) return; duplicate(objs); syncProxy(); commit(); }
  function nudge(dx, dy) { const objs = selObjs().filter((o) => !o.locked); if (!objs.length) return; for (const o of objs) translate(o, dx, dy); paint(); syncProxy(); commit(); }
  /** z-order in the object's own list: +1 forward, -1 backward, 'front', 'back'. */
  function arrange(how) {
    const ids = S.sel.value.slice();
    if (!ids.length) return;
    const idx = (id) => locate(fig, id)?.[1] ?? 0;
    // the order keeps selected neighbours from swapping with each other
    const up = how === 1 || how === 'front';
    const order = ids.slice().sort((a, b) => (up ? idx(b) - idx(a) : idx(a) - idx(b)));
    if (how === 'front' || how === 'back') order.reverse();
    for (const id of order) {
      const l = locate(fig, id); if (!l) continue;
      const [list, i] = l;
      const [o] = list.splice(i, 1);
      const j = how === 'front' ? list.length : how === 'back' ? 0 : Math.max(0, Math.min(list.length, i + how));
      list.splice(j, 0, o);
    }
    paint(); syncProxy(); commit();
  }
  /** Move object id into list of parent (null: the top) at index (layers panel). */
  function moveTo(id, parentId, index) {
    const l = locate(fig, id);
    if (!l) return;
    const target = parentId ? find(fig, parentId) : null;
    if (parentId && (!target || target.type !== 'group' || [...walk([l[0][l[1]]])].some(([x]) => x.id === parentId))) return;
    const list = target ? target.children : fig.objects;
    const [o] = l[0].splice(l[1], 1);
    if (l[0] === list && l[1] < index) index--;
    list.splice(Math.max(0, Math.min(list.length, index)), 0, o);
    const prune = (xs) => { for (let i = xs.length - 1; i >= 0; i--) if (xs[i].type === 'group') { prune(xs[i].children); if (!xs[i].children.length) xs.splice(i, 1); } };
    prune(fig.objects);
    paint(); syncProxy(); commit();
  }
  function group() {
    const ids = S.sel.value;
    if (ids.length < 2) return;
    const parent = parentOf(fig, ids[0]);
    if (!ids.every((id) => parentOf(fig, id) === parent)) return;
    const list = parent ? parent.children : fig.objects;
    const members = list.filter((o) => ids.includes(o.id));
    const at = Math.max(...members.map((o) => list.indexOf(o)));
    const g = make('group', { children: members });
    const pos = at - members.length + 1;
    for (const m of members) list.splice(list.indexOf(m), 1);
    list.splice(pos, 0, g);
    paint(); select([g.id]); commit();
  }
  function ungroup() {
    const gs = selObjs().filter((o) => o.type === 'group');
    if (!gs.length) return;
    const out = [];
    for (const g of gs) { const [list, i] = locate(fig, g.id); list.splice(i, 1, ...g.children); out.push(...g.children.map((c) => c.id)); }
    paint(); select(out); commit();
  }
  function align(how) {
    const objs = selObjs().filter((o) => !o.locked);
    if (objs.length < 2) return;
    const B = boundsOfAll(objs);
    for (const o of objs) {
      const b = boundsOf(o);
      const dx = how === 'left' ? B[0] - b[0] : how === 'right' ? B[2] - b[2] : how === 'hcenter' ? (B[0] + B[2]) / 2 - (b[0] + b[2]) / 2 : 0;
      const dy = how === 'top' ? B[1] - b[1] : how === 'bottom' ? B[3] - b[3] : how === 'vcenter' ? (B[1] + B[3]) / 2 - (b[1] + b[3]) / 2 : 0;
      translate(o, dx, dy);
    }
    paint(); syncProxy(); commit();
  }
  function distribute(axis) {
    const objs = selObjs().filter((o) => !o.locked);
    if (objs.length < 3) return;
    const k = axis === 'h' ? 0 : 1;
    const items = objs.map((o) => ({ o, b: boundsOf(o) })).sort((a, b) => a.b[k] - b.b[k]);
    const total = items.reduce((s, x) => s + (x.b[k + 2] - x.b[k]), 0);
    const span = items[items.length - 1].b[k + 2] - items[0].b[k];
    const gap = (span - total) / (items.length - 1);
    let at = items[0].b[k];
    for (const x of items) { const d = at - x.b[k]; translate(x.o, k === 0 ? d : 0, k === 1 ? d : 0); at += x.b[k + 2] - x.b[k] + gap; }
    paint(); syncProxy(); commit();
  }
  /** Replace colour `from` by `to` wherever the selection (a group's objects too) uses it: strokes,
   *  fills, texts' colour (the popover's selection colours). One undo step. */
  function recolour(from, to, ids = S.sel.value) {
    if (!from || !to || from === to) return;
    const leaves = ids.map((id) => find(fig, id)).filter(Boolean).flatMap((o) => [...walk([o])].map(([x]) => x)).filter((o) => o.type !== 'group');
    for (const o of leaves) {
      if (o.type === 'text') { if ((o.color ?? '#000000') === from) o.color = to; continue; }
      if (o.stroke === from) o.stroke = to;
      if (o.fill === from) o.fill = to;
    }
    paint(); if (!gesture) syncProxy();
    commit();
  }
  /** Set props on the selection (the popover); style keys apply to shapes, text keys to texts. */
  function setProps(props, { ids = S.sel.value, record = true } = {}) {
    const objs = ids.map((id) => find(fig, id)).filter(Boolean);
    const leaves = objs.flatMap((o) => [...walk([o])].map(([x]) => x)).filter((o) => o.type !== 'group');
    for (const o of leaves) {
      for (const [k, v] of Object.entries(props)) {
        if (o.type === 'text' && !['color', 'opacity', 'size', 'align', 'src', 'anchor', 'name', 'hidden', 'locked'].includes(k)) continue;
        if (o.type !== 'text' && ['color', 'size', 'align', 'src'].includes(k)) continue;
        if ((k === 'arrowStart' || k === 'arrowEnd') && o.type !== 'line' && !(o.type === 'path' && !o.closed)) continue;
        if (v === undefined) delete o[k]; else o[k] = v;
      }
    }
    for (const o of objs) for (const k of ['name', 'hidden', 'locked']) if (k in props) o[k] = props[k];
    paint(); if (!gesture) syncProxy();
    if (record) commit(); else changed();
  }
  function setFigureSize(w, hh) {
    fig.w = Math.max(8, Math.round(w)); fig.h = Math.max(8, Math.round(hh));
    sizeSheet(); paint(); syncProxy(); commit();
  }
  function fitToContent(margin = 4) {
    const b = boundsOfAll(fig.objects);
    if (!b) return;
    const dx = margin - b[0], dy = margin - b[1];
    for (const o of fig.objects) translate(o, dx, dy);
    fig.w = Math.ceil(b[2] - b[0] + 2 * margin); fig.h = Math.ceil(b[3] - b[1] + 2 * margin);
    sizeSheet(); paint(); syncProxy(); commit();
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  let spaceDown = false;
  const TOOLS = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', p: 'path', t: 'label', b: 'box' };
  function onKey(e) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const typing = e.target.closest?.('input, textarea, [contenteditable="true"]');
    if (typing) {
      if (e.key === 'Escape') { e.preventDefault(); endTextEdit(); root.focus(); }
      return;
    }
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { e.preventDefault(); copy(); return; }
    if (mod && k === 'x') { e.preventDefault(); cut(); return; }
    if (mod && k === 'v') { e.preventDefault(); paste(); return; }
    if (mod && k === 'd') { e.preventDefault(); dup(); return; }
    if (mod && k === 'a') { e.preventDefault(); select(fig.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id)); return; }
    if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return; }
    if (mod && (e.key === ']' || e.key === '}')) { e.preventDefault(); arrange(e.shiftKey ? 'front' : 1); return; }
    if (mod && (e.key === '[' || e.key === '{')) { e.preventDefault(); arrange(e.shiftKey ? 'back' : -1); return; }
    if (mod && k === 's') { e.preventDefault(); finish(true); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(S.zoom.value * 1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); setZoom(S.zoom.value / 1.25); return; }
    if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); finish(true); return; }
    if (mod || e.altKey) return;
    if (e.key === ' ' && !spaceDown) { spaceDown = true; root.classList.add('svf-pan-ready'); e.preventDefault(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (poly) { finishPoly(); return; }
      if (S.tool.value !== 'select') { S.tool.value = 'select'; return; }
      if (S.sel.value.length) { const p = S.sel.value.length === 1 ? parentOf(fig, S.sel.value[0]) : null; select(p ? [p.id] : []); return; }
      return;
    }
    if (e.key === 'Enter') {
      if (poly) { e.preventDefault(); finishPoly(); return; }
      const o = selObjs()[0];
      if (o?.type === 'text') { e.preventDefault(); beginTextEdit(o.id); }
      else if (o?.type === 'group') { e.preventDefault(); select(o.children.map((c) => c.id)); }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); const [x, y] = arrows[e.key], s = e.shiftKey ? 10 : 1; nudge(x * s, y * s); return; }
    if (TOOLS[k] && !e.shiftKey) { e.preventDefault(); setTool(TOOLS[k]); }
  }
  const onKeyUp = (e) => { if (e.key === ' ') { spaceDown = false; root.classList.remove('svf-pan-ready'); } };
  root.addEventListener('keydown', onKey);
  root.addEventListener('keyup', onKeyUp);
  // A toolbar button that turns disabled under the focus (Redo after the last redo) drops the
  // focus to <body>; the editor is modal, so keys that land on <body> are still its keys.
  const orphan = (e) => e.target === document.body || e.target === document.documentElement;
  const onKeyWin = (e) => { if (orphan(e)) onKey(e); };
  const onKeyUpWin = (e) => { if (orphan(e)) onKeyUp(e); };
  window.addEventListener('keydown', onKeyWin);
  window.addEventListener('keyup', onKeyUpWin);
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) setZoom(S.zoom.value * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { panX -= e.deltaX; panY -= e.deltaY; applyView(); placePop(); }
  }, { passive: false });
  function setTool(t) {
    if (poly && t !== 'path') finishPoly();
    S.tool.value = t;
    if (t !== 'select' && t !== 'hand') select([]);
  }

  // ── theme ────────────────────────────────────────────────────────────────
  // the root's data-tool (the cursor) follows the tool, also when a gesture sets it back to select
  const stopToolAttr = effect(() => { root.dataset.tool = S.tool.value; });
  const themeObs = new MutationObserver(() => { const t = currentTheme(); if (t !== S.theme.value) { applyTheme(); paint(); } });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const onResizeWin = () => placePop();
  window.addEventListener('resize', onResizeWin);

  // ── done / cancel, and the animation from and to the document ───────────
  async function result(save) {
    if (!save) return { saved: false, changed: false, fig: JSON.parse(startJson), svg: originalSvg, tikz: null };
    await Promise.all(texts().map((o) => ts.typeset(o)));
    const svg = figureToSvg(fig, ts.glyphs);
    return { saved: true, changed: svg !== originalSvg, fig: JSON.parse(modelJson(fig)), svg, tikz: toTikz(fig, { scale: opts.scale ?? 1, name: opts.name ?? '', include: opts.include ?? '' }) };
  }
  async function finish(save) {
    if (S.closing.value) return;
    if (S.editing.value) endTextEdit();
    if (poly) finishPoly();
    S.closing.value = true;
    const res = await result(save);
    select([]);
    await animateOut();
    themeObs.disconnect();
    stopToolAttr();
    window.removeEventListener('resize', onResizeWin);
    window.removeEventListener('keydown', onKeyWin);
    window.removeEventListener('keyup', onKeyUpWin);
    if (globalThis.__svgfig?.root === root) globalThis.__svgfig = null;
    for (const id of [...live.keys()]) { const e = live.get(id); try { e.block?.destroy?.(); } catch { /* */ } }
    preactRender(null, chrome);
    root.remove();
    opts.onClose?.(res);
    resolveDone(res);
  }
  function fromRect() { const r = opts.from?.getBoundingClientRect?.(); return r && r.width > 2 && r.height > 2 ? r : null; }
  async function animateIn() {
    const from = fromRect();
    if (!from || opts.host || reduced()) { root.classList.add('svf-shown'); return; }
    const v = viewport.getBoundingClientRect();
    const tw = fig.w * K * S.zoom.value, k = from.width / tw;
    const dx = from.left - (v.left + panX), dy = from.top - (v.top + panY);
    // The first frame of the editor (style, layout, the drawing's first paint) can take longer than
    // the whole animation (WebKit: 100-250 ms), and an animation started with it lost its first half
    // (a jump, 2 frames). So that frame is drawn first, still: the sheet exactly over the figure in
    // the document (no backdrop, no panels, no shadow), and the animation starts after it.
    stage.style.transform = `translate(${panX + dx}px, ${panY + dy}px) scale(${S.zoom.value * k})`;
    for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
    applyView();
    root.classList.add('svf-shown');
    const ease = 'cubic-bezier(.2,.8,.2,1)';
    stage.animate([{ transform: `translate(${panX + dx}px, ${panY + dy}px) scale(${S.zoom.value * k})` }, { transform: `translate(${panX}px, ${panY}px) scale(${S.zoom.value})` }], { duration: 300, easing: ease });
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: ease });
    back.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    chrome.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 80, easing: 'ease-out', fill: 'backwards' });
    await stage.getAnimations()[0]?.finished.catch(() => {});
  }
  function animateOut() {
    const from = fromRect();
    if (!from || opts.host || reduced()) return Promise.resolve();
    const v = viewport.getBoundingClientRect();
    const k = from.width / (fig.w * K * S.zoom.value);
    const dx = from.left - (v.left + panX), dy = from.top - (v.top + panY);
    const ease = 'cubic-bezier(.4,0,.2,1)';
    chrome.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
    back.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
    shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
    const a = stage.animate([{ transform: `translate(${panX}px, ${panY}px) scale(${S.zoom.value})` }, { transform: `translate(${panX + dx}px, ${panY + dy}px) scale(${S.zoom.value * k})` }], { duration: 260, easing: ease, fill: 'forwards' });
    return a.finished.catch(() => {});
  }

  // ── the controller the panels use ────────────────────────────────────────
  const ed = {
    S, opts, get fig() { return fig; }, ts,
    select, setTool, setProps, recolour, setTextSource, beginTextEdit, endTextEdit, del, dup, copy, paste, cut, group, ungroup, arrange, moveTo, align, distribute,
    undo, redo, fit, setZoom, setFigureSize, fitToContent, finish,
    find: (id) => find(fig, id), selObjs, parentOf: (id) => parentOf(fig, id),
  };

  // ── go ───────────────────────────────────────────────────────────────────
  applyTheme();
  sizeSheet();
  preactRender(h(App, { ed }), chrome);
  const done = new Promise((r) => { resolveDone = r; });
  fit();
  paint();
  root.focus({ preventScroll: true });
  typesetAll();
  await animateIn();
  root.classList.add('svf-ready');

  // the test surface
  const api = {
    ed, root, sheet, content: content.node,
    model: () => JSON.parse(modelJson(fig)), svg: () => figureToSvg(fig, ts.glyphs),
    /** Resolves once no text is typesetting, no gesture is under way and no live block is up
     *  (typesetting is awaited, not counted); rejects, saying what is still busy, when that has not
     *  happened within `frames` frames (a stuck gesture or live block), so a test never goes on
     *  with a busy editor. */
    idle: async (frames = 300) => {
      const busy = () => [(ts.pending() || rebreaking.size) && `${ts.pending() || rebreaking.size} typesetting`, gesture && `gesture ${gesture.kind}`, live.size && `${live.size} live block(s)`].filter(Boolean);
      for (let i = 0; i < frames; i++) {
        await Promise.all(texts().map((o) => ts.typeset(o)));
        await new Promise((r) => requestAnimationFrame(() => r()));
        if (!busy().length) return;
      }
      throw new Error(`svgfig: not idle after ${frames} frames (${busy().join(', ')})`);
    },
    toClient, toFig, zoom: () => S.zoom.value, live: () => [...live.keys()], liveBlocks: () => [...live.values()].map((e) => e.el),
    done, finish, glyphs: ts.glyphs, errors: () => Object.fromEntries(S.errors.value),
  };
  globalThis.__svgfig = api;
  opts.onOpen?.(api);
  return done;
}
