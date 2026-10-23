// The workbench: tabs and splits holding registered views. DESIGN.md has the model and the API.
export { createWorkbench, WorkbenchContext, TabContext, moveInto } from './workbench.ts';
export * as keys from './keys.ts';
export { Workbench, openTabMenu, openMenu, openRowMenu, openSelect, tabHint, separators } from './ui.ts';
export * as kit from './kit/index.ts';
export { TOKENS as THEME_TOKENS, BUILTIN as BUILTIN_THEMES, registerTheme, setTheme, themes, resolveTheme, currentTheme, onTheme } from './themes.ts';
export { panelHint, sideOverlay, OVERLAY_MAX_W } from './sides.ts';
export { Crumbs } from './crumbs.ts';
export { Icon, ICONS, iconSvg, isIconName, ICON_STROKE } from './kit/icons.ts';
export { pointerSession, createGhost } from './drag.ts';
export { html, render } from './html.ts';
export * as model from './model.ts';
export { ownViewport, VIEWPORT_CSS, visibleBox, onVisible, type VisibleBox } from './viewport.ts';
// the types a host writes against
export type { Workbench as WorkbenchStore, WorkbenchOptions, BarSpec, ViewHost } from './workbench.ts';
export type { ViewType, ViewContext, ChipEvent, Subtitle, Switcher, OpenSpec, OpenOpts, DocStatus, DocStatusInput, WorkbenchEvents, TabHint, PanelHint } from './types.ts';
export type { Layout, Tab, Group, ViewState, Side, SideName } from './model.ts';
export type { Crumb } from './crumbs.ts';
export type { IconName } from './kit/icons.ts';
export type { DragSpec, DropHandlers, DragInfo, DragResult } from './drag.ts';
export type { ThemeJson, Theme, Token } from './themes.ts';
export type { KeymapEntry, Binding, Action, Platform } from './keys.ts';
export type { MenuEntry as MenuEntryLike, SelectRow, SelectAction } from './kit/menu.ts';
