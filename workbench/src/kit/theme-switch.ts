// The theme switch: a Button opening the Select of the registered themes (and System: the system's light or dark).
import { html } from '../html.ts';
import { Button } from './button.ts';
import { openSelect, type MenuAnchor, type Opened } from './menu.ts';
import { themes } from '../themes.ts';

/** value: a theme id or 'system'; onChange(id). */
export function openThemeSelect(anchor: MenuAnchor, { value, onChange, system = true }: { value: string; onChange: (id: string) => void; system?: boolean }): Opened | null {
  return openSelect(anchor, [...themes().map((t) => ({ id: `theme-${t.id}`, label: t.label, active: value === t.id, onSelect: () => onChange(t.id) })),
    ...(system ? [{ id: 'theme-system', label: 'System', active: value === 'system', onSelect: () => onChange('system') }] : [])], { label: 'Theme' });
}
export function ThemeSwitch({ value, onChange, label = 'Theme', system = true, ...rest }: { value: string; onChange: (id: string) => void; label?: string; system?: boolean; [data: `data-${string}`]: string | undefined }) {
  return html`<${Button} label=${label} aria-haspopup="grid" tip="Theme: Light, Dark, Sepia, High contrast or the system's" onClick=${(e: MouseEvent) => openThemeSelect(e.currentTarget as HTMLElement, { value, onChange, system })} ...${rest} />`;
}
