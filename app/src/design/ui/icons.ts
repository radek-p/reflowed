// The editor kit's icons: the one registry's (icon-set.ts: our names → Lucide; the workbench takes it too), in the kit's two forms:
//   Icon.<name>          a Preact component ({ size = 16, class }), class `ui-icon` plus the caller's
//   svg(name, size)      an SVG string, for innerHTML in plain-DOM code
//   ICON_NAMES           every name (the gallery and the showcase)
// A new icon is one line in the registry, not here.
import type { FunctionComponent } from 'preact';
import { Icon as Glyph, iconSvg, ICONS, type IconName } from './icon-set.ts';

export type { IconName };
type KitIconProps = { size?: number; class?: string };

/** An icon as an SVG string (for innerHTML in plain-DOM code). */
export function svg(name: IconName, size = 16): string {
  return iconSvg(name, size);
}

export const Icon = Object.fromEntries(ICONS.map((name) => [name, ({ size = 16, class: c = '' }: KitIconProps) =>
  Glyph({ name, size, class: c ? `ui-icon ${c}` : 'ui-icon' })])) as Record<IconName, FunctionComponent<KitIconProps>>;
export const ICON_NAMES: readonly IconName[] = ICONS;
