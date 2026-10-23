// The workbench's icons: the one registry (app/src/design/ui/icon-set.ts, a standalone file of the kit like core.js:
// Preact and Lucide only), so the workbench, the editor kit and the figure editor draw the same icons by the same
// names. It lives there because Node loads the editor's modules in its unit suites and resolves packages from app/;
// the workbench's own files cannot be loaded that way. Names, the renderer and how to add an icon: that file.
export { Icon, iconSvg, ICONS, ICON_SET, ICON_STROKE, ICON_VIEWBOX, isIconName } from '../../../app/src/design/ui/icon-set.ts';
export type { IconName, IconProps } from '../../../app/src/design/ui/icon-set.ts';
