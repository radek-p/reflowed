// The one icon registry (the workbench's, the editor kit's and the figure editor's): our semantic names → Lucide
// A standalone file of the kit (it imports only Preact and Lucide, as core.js imports only Preact and htm): the
// workbench takes it through workbench/src/kit/icons.ts, the editor kit through icons.ts. It is here, under app/,
// because Node loads the editor's modules in its unit suites and resolves their packages from app/node_modules.
// icons (lucide 1.59.0, ISC; its LICENSE ships in the release's third-party licences). Adding an icon is one line in
// ICON_SET; its name is then an IconName, so a typo in TypeScript fails typecheck, and the source scan in
// workbench/tests/icons.test.ts checks the htm and JavaScript call sites (icon="…", Icon.…, svg('…')).
//   Icon({ name, size, class })   the Preact component (the workbench's Icon; the kit's Icon.<name> wraps it)
//   iconSvg(name, size, class)    the same SVG as a string, for plain-DOM code (the kit's svg())
//   ICONS                         every name, in the registry's order (the gallery's catalogue)
// Icons are read by name from Lucide's ESM build (L.<Name>, static accesses): esbuild bundles only those, inlined (no
// sprite, no fetch). A new icon: `ourName: L.LucideName,` in ICON_SET (lucide.dev names it; PascalCase here).
// Drawing: Lucide's 24-unit grid, currentColor, round caps and joins, one stroke for all (ICON_STROKE), aria-hidden;
// data-icon="<name>" on the svg (tests read which icon it is, not its geometry).
// The size is the width and height attributes; CSS that sizes `.ui-icon` (the kits' tokens) scales the stroke with it.
import { h } from 'preact';
import * as L from 'lucide';
import type { IconNode } from 'lucide';

export const ICON_SET = {
  // actions
  plus: L.Plus, minus: L.Minus, close: L.X, more: L.Ellipsis, check: L.Check, search: L.Search, pencil: L.Pencil, trash: L.Trash2,
  copy: L.Copy, undo: L.Undo2, redo: L.Redo2, back: L.ArrowLeft, settings: L.Settings,
  // grips and chevrons
  handle: L.GripVertical, chevronLeft: L.ChevronLeft, chevronRight: L.ChevronRight, chevronUp: L.ChevronUp, chevronDown: L.ChevronDown,
  // the workbench: panels, groups, tabs
  sidebarLeft: L.PanelLeft, sidebarRight: L.PanelRight, split: L.Columns2, pin: L.Pin, focus: L.Pin, unfocus: L.PinOff, newTab: L.SquareArrowRightEnter, home: L.House,
  // documents and views
  file: L.File, files: L.Files, text: L.Text, textSize: L.ALargeSmall, list: L.List, outline: L.List, todos: L.ListTodo, book: L.BookOpen,
  preamble: L.Braces, note: L.StickyNote, comment: L.MessageSquare, figure: L.Image, problems: L.TriangleAlert, missing: L.CircleAlert, keyboard: L.Keyboard,
  // the figure editor: tools
  pointer: L.MousePointer2, hand: L.Hand, rect: L.Square, ellipse: L.Circle, line: L.Slash, arrow: L.MoveUpRight, path: L.Spline,
  label: L.Type, textBox: L.TextCursorInput,
  // the figure editor: layers and arrange
  eye: L.Eye, eyeOff: L.EyeOff, lock: L.Lock, unlock: L.LockOpen, group: L.Group, toFront: L.BringToFront, toBack: L.SendToBack,
  forward: L.ArrowUp, backward: L.ArrowDown,
  alignLeft: L.AlignStartVertical, alignCentre: L.AlignCenterVertical, alignRight: L.AlignEndVertical,
  alignTop: L.AlignStartHorizontal, alignMiddle: L.AlignCenterHorizontal, alignBottom: L.AlignEndHorizontal,
  textLeft: L.AlignLeft, textCentre: L.AlignCenter, textRight: L.AlignRight, textJustify: L.AlignJustify,
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICON_SET;
export const ICONS = Object.keys(ICON_SET) as IconName[];
export const isIconName = (s: unknown): s is IconName => typeof s === 'string' && Object.hasOwn(ICON_SET, s);

/** The stroke on Lucide's 24-unit grid: 1.75 (1.17 px at 16 px, 1.46 px at 20 px). Lucide's default 2 looked heavier
 *  than the hand-drawn set (1.5 px at 16 px on a 16-unit grid, but smaller shapes); 1.75 keeps the weight at our sizes. */
export const ICON_STROKE = 1.75;
export const ICON_VIEWBOX = '0 0 24 24';
const ATTRS = { viewBox: ICON_VIEWBOX, fill: 'none', stroke: 'currentColor', 'stroke-width': ICON_STROKE, 'stroke-linecap': 'round',
  'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' } as const;

export type IconProps = { name: IconName; size?: number; class?: string };

/** An icon as a Preact element; `class` replaces the default `ui-icon` (the figure editor's is `svf-ic`). */
export function Icon({ name, size = 16, class: cls = 'ui-icon' }: IconProps) {
  const node: IconNode = ICON_SET[name] ?? ICON_SET.missing;
  return h('svg', { ...ATTRS, class: cls, width: size, height: size, 'data-icon': name }, node.map(([tag, a], i) => h(tag, { key: i, ...a })));
}

const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (o: Record<string, string | number | undefined>) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}="${esc(v!)}"`).join(' ');

/** The same icon as an SVG string (for plain-DOM code). */
export function iconSvg(name: IconName, size = 16, cls = 'ui-icon'): string {
  const node: IconNode = ICON_SET[name] ?? ICON_SET.missing;
  return `<svg ${attrs({ class: cls, width: size, height: size, ...ATTRS, 'data-icon': name })}>${node.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')}</svg>`;
}
