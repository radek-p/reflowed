// The reader's line, for the anchor keeper: a width change re-breaks every block, the one the reader
// is in too, so holding a block's top lets the line being read move by up to the block's change (the top of the view
// inside a long paragraph: 24 px, the caret's line in an editor below: 72 px, measured). The line is held instead: the
// caret's line of a block being edited when it is in view, else the first line of the document below the reading top.
// A typeset line is known by one of its glyph nodes (the viewer re-breaks the same nodes: inspect.replay finds the line
// holding it at any width); an editor's by its caret.
//
//   lineAnchor.pick(list, top, bottom) -> { el, mark } | null   el: list's child holding the line; null: none (a block
//                                                               not laid out yet, a widget): the keeper holds a block
//   lineAnchor.y(mark) -> number | null                         the line's client y now; null: gone (re-typeset)
import { EditorView } from '@codemirror/view';
import { screenCTM } from './screen-ctm.ts';
import { shownBlock } from './shown.ts';
import { laidCount, segmentSvg, replay } from './viewer-bridge.js';   // the viewer's state read there only

interface Node { type: string }
interface Line { nodes: Node[] }
export type LineMark = { kind: 'text'; blk: HTMLElement; node: Node } | { kind: 'caret'; view: EditorView };

/** each line of blk's shown typeset block: its nodes and its baseline's client y */
function linesOf(blk: HTMLElement): { nodes: Node[]; y: number }[] {
  const lb = shownBlock(blk.querySelector('.blk-render') ?? blk);
  const out: { nodes: Node[]; y: number }[] = [];
  if (!lb) return out;
  const n: number = laidCount(lb);
  for (let i = 0; i < n; i++) {
    const M = screenCTM(segmentSvg(lb, i));
    if (M) replay(lb, i, { line: (_j: number, line: Line, _x: number, by: number) => { out.push({ nodes: line.nodes, y: M.d * by + M.f }); } });
  }
  return out;
}

function caretY(view: EditorView): number | null {
  if (!view.dom.isConnected) return null;
  const c = view.coordsAtPos(view.state.selection.main.head);
  return c ? c.top : null;
}

function pick(list: HTMLElement, top: number, bottom: number): { el: HTMLElement; mark: LineMark } | null {
  const child = (e: Element) => { let c: Element | null = e; while (c && c.parentElement !== list) c = c.parentElement; return c as HTMLElement | null; };
  // the caret's line, in view
  for (const dom of list.querySelectorAll<HTMLElement>('.cm-editor')) {
    const view = EditorView.findFromDOM(dom), y = view && caretY(view), el = child(dom);
    if (view && el && y != null && y >= top && y < bottom) return { el, mark: { kind: 'caret', view } };
  }
  // the first line below the top: in the block across the top, else the next one laid out
  for (const el of list.children as HTMLCollectionOf<HTMLElement>) {
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= top) continue;
    if (r.top > bottom) break;
    const line = linesOf(el).find((l) => l.y > top);
    const node = line?.nodes.find((n) => n.type === 'glyph');
    if (node) return { el, mark: { kind: 'text', blk: el, node } };
    if (r.top >= top) return null;           // a block below the top with no line of its own: its top is the anchor
  }
  return null;
}

function y(mark: LineMark): number | null {
  if (mark.kind === 'caret') return caretY(mark.view);
  if (!mark.blk.isConnected) return null;
  return linesOf(mark.blk).find((l) => l.nodes.includes(mark.node))?.y ?? null;
}

export const lineAnchor = { pick, y };
