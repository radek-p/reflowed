// The banner in a default document whose stored copy the user edited while a
// newer build brought a new version of it (seeds.ts): "A newer version of this
// example is available". As the Documents view offers it (home/sample-update.js): an edited copy
// "Open the new version" (the copy stays, renamed "… (edited)") · Keep mine; an unedited one Replace · Keep mine.
// The kit's Banner (Preact), placed first in the page; .rtx-seed-banner, [data-action=seed-*].
//
//   const b = mountSeedBanner(pageEl, { store, docId, reopen, open });  b.ready; b.settled(); b.destroy()

import type { DocStore } from '../store/types.ts';
import { resolveSeedUpdate, seedUpdate } from './seeds.ts';
import { html, render, ensureStyles, Banner, Button } from '../design/ui/index.js';
import { injectHomeStyle } from '../home/css.ts';

export interface SeedBannerOptions {
  store: DocStore;
  docId: string;
  /** after "Reset to new version": reload this document */
  reopen?(docId: string): void;
  /** after "Open the new version": go to the new document */
  open?(docId: string): void;
}

type Choice = 'reset' | 'alongside' | 'keep';
const TITLES: Record<Choice, string> = { reset: 'Your copy is saved in its Versions first', alongside: 'The new version as a new document; your copy stays, renamed “… (edited)”', keep: 'Do not ask again for this version' };

export function mountSeedBanner(page: HTMLElement, o: SeedBannerOptions) {
  ensureStyles();
  injectHomeStyle();
  let host: HTMLElement | null = null;
  let destroyed = false;
  let last: Promise<unknown> = Promise.resolve();
  const remove = () => { if (host) { render(null, host); host.remove(); host = null; } };
  const ready = (async () => {
    const up = await seedUpdate(o.store, o.docId);
    if (!up || destroyed) return false;
    host = document.createElement('div');
    host.style.display = 'contents';
    const draw = (busy: boolean) => {
      const act = (label: string, choice: Choice, variant: string) => html`<${Button} size="sm" variant=${variant} data-action=${`seed-${choice}`}
        title=${TITLES[choice]} disabled=${busy} onClick=${() => choose(choice)}>${label}<//>`;
      const acts = up.edited ? [act('Open the new version', 'alongside', 'primary'), act('Keep mine', 'keep', 'ghost')]
        : [act('Replace', 'reset', 'primary'), act('Keep mine', 'keep', 'ghost')];
      render(html`<${Banner} class="rtx-seed-banner" actions=${acts}>
        A newer version of this example is available${up.builtAt ? ` (build ${up.builtAt.slice(0, 10)})` : ''}. ${up.edited ? 'Your copy has your edits; it is kept.' : 'Your copy has no edits.'}
      <//>`, host!);
    };
    const choose = (choice: Choice) => {
      draw(true);
      last = (async () => {
        const r = await resolveSeedUpdate(o.store, o.docId, choice);
        remove();
        if (choice === 'reset') o.reopen?.(o.docId);
        if (choice === 'alongside') o.open?.(r.docId);
        return r;
      })();
    };
    draw(false);
    page.prepend(host);
    return true;
  })();
  return {
    /** resolves true when the banner is shown */
    ready,
    /** resolves with the last choice's result */
    settled: () => last,
    destroy() { destroyed = true; remove(); },
  };
}
