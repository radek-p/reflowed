// THE GALLERY (app/gallery.html, /gallery on the dev server; bundled by scripts/w3-build.ts into lib/gallery.js; dev
// only, never in a release): every UI component, rendered from the real components with fixture data, in every
// state, in the four themes. One theme at a time, switched in the header: the View options' theme (view/index.js: the JSON themes' tokens on
// <html>, design/theme.ts), which the View options keep; ?theme=light|dark|sepia|contrast (or hc) picks it at load.
// The View options save their choice in this browser: the gallery puts the saved choice back when the page goes.
//
//   kit        the editor's design kit (app/src/design/ui)                        gallery/kit.ts
//   wb-kit     the workbench's kit (workbench/src/kit)                             gallery/wb-kit.ts
//   widgets    the editor's own widgets apart from a document (fixture data)        gallery/widgets.ts
//   sheets     Document settings, the title form, View options (their content in a pane container)   gallery/widgets.ts
//   editor     the editor mounted on the fixture document (mountEditor, backend none), its panels, the code popover
//   tabs       the workbench's tabs with each document status                      gallery/live.ts
//
// Every section says when it is drawn: [data-section=<id>][data-ready]; the page when all are: html[data-gallery-ready].
// tests/test-gallery.ts checks them in every theme and shoots each into test-results/gallery/.
import { signal, type Signal } from '@preact/signals';
import { html, render, Segmented } from '../design/ui/index.js';
import { applyTheme } from '../design/theme.ts';
import { KEY as VIEW_KEY } from '../view/settings.js';
import { onTheme, currentTheme } from '../../../workbench/src/themes.ts';
import { pageParams } from '../app/release-mode.js';
import { createPageServices, pageReady } from '../app/services.ts';
import { KitSection } from './kit.ts';
import { WbKitSection } from './wb-kit.ts';
import { WidgetsSection, SheetsSection } from './widgets.ts';
import { EditorSection, TabsSection } from './live.ts';
import type { EditorServices } from '../app/mount.ts';
import { GALLERY_CSS } from './css.ts';

export type GalleryTheme = 'light' | 'dark' | 'sepia' | 'contrast';
export const THEMES: readonly { value: GalleryTheme; label: string; wb: string }[] = [
  { value: 'light', label: 'Light', wb: 'light' }, { value: 'dark', label: 'Dark', wb: 'dark' },
  { value: 'sepia', label: 'Sepia', wb: 'sepia' }, { value: 'contrast', label: 'High contrast', wb: 'hc' }];
/** a theme name from the URL or the workbench's ids (hc) */
export function themeOf(name: string | null | undefined): GalleryTheme {
  const t = THEMES.find((x) => x.value === name || x.wb === name);
  return t ? t.value : 'light';
}

export interface Gallery {
  theme: Signal<GalleryTheme>;
  setTheme(t: string): void;
  services: EditorServices;
  /** a section drawn: its [data-ready] set; the page's once every section is */
  ready(id: string): void;
}

const SECTIONS = [['kit', 'Editor kit'], ['wb-kit', 'Workbench kit'], ['widgets', 'Editor widgets'], ['sheets', 'Sheets and View options'],
  ['editor', 'The editor, live'], ['tabs', 'Tab status']] as const;

function Header({ g }: { g: Gallery }) {
  return html`<header class="gal-head" data-ui-chrome>
    <div class="gal-head-in">
      <h1 class="gal-title">ReflowEd gallery</h1>
      <nav class="gal-nav" aria-label="Sections">${SECTIONS.map(([id, label]) => html`<a href=${`#gal-${id}`}>${label}</a>`)}</nav>
      <${Segmented} class="gal-theme" label="Theme" value=${g.theme.value} onChange=${(v: string) => g.setTheme(v)}
        options=${THEMES.map((t) => ({ value: t.value, label: t.label, attrs: { 'data-theme-pick': t.value } }))} />
    </div>
  </header>`;
}

function Page({ g }: { g: Gallery }) {
  return html`<${Header} g=${g} />
    <main class="gal">
      <${KitSection} g=${g} />
      <${WbKitSection} g=${g} />
      <${WidgetsSection} g=${g} />
      <${SheetsSection} g=${g} />
      <${EditorSection} g=${g} />
      <${TabsSection} g=${g} />
    </main>`;
}

function read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string | null) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* no storage */ } }

async function start() {
  const style = document.createElement('style');
  style.id = 'gallery-css';
  style.textContent = GALLERY_CSS;
  document.head.append(style);
  const params = new URLSearchParams(location.search);
  const theme = signal<GalleryTheme>(themeOf(params.get('theme')));
  applyTheme(theme.peek());                                    // the first paint
  // the View options' and the companion's saved choices, put back when the page goes (the gallery's switch is theirs)
  const SAVED = [VIEW_KEY, 'reflowtex-theme'].map((k) => [k, read(k)] as const);
  addEventListener('pagehide', () => { for (const [k, v] of SAVED) write(k, v); });
  await pageReady();
  const { services } = await createPageServices({ params: pageParams(), store: 'memory' });
  const view = services.view as { set(p: { theme: string }): void } | null;
  const pick = (t: GalleryTheme) => { if (view) view.set({ theme: t }); else applyTheme(t); };
  pick(theme.peek());
  // a theme picked elsewhere on the page (the View options' panel, the workbench's theme switch) shows in the header
  onTheme((e) => { if (e.kind === 'apply') theme.value = themeOf(currentTheme()); });
  const done = new Set<string>();
  const g: Gallery = {
    theme, services,
    setTheme(t) {
      theme.value = themeOf(t);
      pick(theme.value);
      document.documentElement.dataset.galleryTheme = theme.value;
      const u = new URL(location.href);
      u.searchParams.set('theme', theme.value);
      history.replaceState(null, '', u);
    },
    ready(id) {
      document.querySelector(`[data-section="${id}"]`)?.setAttribute('data-ready', '');
      done.add(id);
      if (SECTIONS.every(([s]) => done.has(s))) document.documentElement.dataset.galleryReady = '';
    },
  };
  document.documentElement.dataset.galleryTheme = theme.value;
  const root = document.getElementById('gallery');
  if (!root) throw new Error('gallery: no #gallery');
  render(html`<${Page} g=${g} />`, root);
}

start().catch((e: unknown) => {
  console.error('gallery:', e);
  document.body.append(Object.assign(document.createElement('pre'), { className: 'gal-failed', textContent: `The gallery could not start: ${String(e)}` }));
});
