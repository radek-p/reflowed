// The pill's parts, shared by the tab shells (TabPill here, DocCrumb for a host that draws its
// own tabs, VS Code): the document chip, the section chip, the line that holds them, the status layer, the
// unsaved dot, the status words, and the rename field. Markup and behaviour only; the shell decides when they act.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { html } from '../html.ts';
import { Icon } from '../kit/icons.ts';
import { Input } from '../kit/index.ts';
import type { Workbench } from '../workbench.ts';
import type { Tab } from '../model.ts';
import type { FillEl } from '../ticker.ts';
import type { Progress, Subtitle } from '../types.ts';

/** A tab's document status in its pill, whenever the host sets one: what each part shows.
 *  Unsaved is a filled dot in the × slot (the × on hover or focus; saved: nothing, the hidden × takes no room); the layer is
 *  the pill's background: a progress bar while typesetting (progress.ts), a danger tint with errors, the bar full in the
 *  success colour and fading when a run ends without errors. The accessible name and the tooltip list every state. */
export type StatusLayerState = { doc: string; band: boolean; run: Progress | null; errors: boolean; flash: number | null };
export type TabStatus = { words?: string[]; tips?: string[]; unsaved?: boolean; layer?: StatusLayerState };
export function statusOf(wb: Workbench, t: Tab): TabStatus {
  const doc = wb.docOf(t);
  if (doc == null) return {};
  const flash = wb.docFlash.value.get(doc) ?? null;
  const s = wb.getDocStatus(doc), n = s.errors;
  const words = [s.typesetting && 'typesetting', n && `${n} error${n > 1 ? 's' : ''}`, s.unsaved && 'unsaved'].filter((x): x is string => !!x);
  const tips = [s.typesetting && 'Typesetting…', n && `${n} block${n > 1 ? 's' : ''} failed to typeset`, s.unsaved && 'Unsaved changes'].filter((x): x is string => !!x);
  return { words, tips, unsaved: s.unsaved,
    layer: { doc, band: wb.barOf(doc) === 'band', run: s.typesetting ? s.progress ?? null : null, errors: n > 0, flash: !s.typesetting && !n ? flash : null } };
}
/** The pill's background layer: the progress fill (its length set each frame by the store's ticker, ticker.ts, never
 *  backwards within a run), the error tint, and on success the fill run to 100 % in the success colour, fading out over
 *  FLASH_MS (resumed where it was when the tab is drawn anew). Decoration: aria-hidden; the name says the state. */
export function StatusLayer({ s }: { s: StatusLayerState }) {
  const fill = useRef<FillEl>(null), age = useRef<{ t0: number | null; ms: number; p0: number } | null>(null);
  if (age.current?.t0 !== s.flash) age.current = { t0: s.flash, ms: s.flash == null ? 0 : Math.max(0, performance.now() - s.flash), p0: fill.current?._p ?? 0 };
  const kind = s.flash != null ? 'done' : s.run ? 'run' : null;
  if (!kind && !s.errors) return null;
  return html`<span class=${`wb-status${s.band ? ' wb-status--band' : ''}${s.errors ? ' wb-status--error' : ''}${kind ? ` wb-status--${kind}` : ''}`} data-pdoc=${s.doc} aria-hidden="true">${kind
    ? html`<span class="wb-status-fill" ref=${fill} data-run=${kind === 'run' ? String(s.run!.run) : undefined}
      style=${kind === 'done' ? { '--wb-p0': age.current!.p0, animationDelay: `-${age.current!.ms}ms` } : undefined}></span>` : null}</span>`;
}
/** The field's vertical padding: an input centres its one line of text in its content box, a label puts it where its
 *  line-height says; so the content box is made the text's own box (a Range on the label's text), and the glyphs keep
 *  their baseline whatever the label's line-height. */
function vpad(lab: Element, lr: DOMRect): Partial<CSSStyleDeclaration> {
  const w = document.createTreeWalker(lab, NodeFilter.SHOW_TEXT); let text = w.nextNode();
  while (text && !text.textContent?.length) text = w.nextNode();     // (the name's text is in .wb-tab-name)
  if (!text) return {};
  const r = document.createRange(); r.setStart(text, 0); r.setEnd(text, Math.min(1, text.textContent?.length ?? 0));
  const g = r.getBoundingClientRect(), top = g.top - lr.top;
  return { paddingTop: `${top}px`, paddingBottom: `${Math.max(0, lr.height - top - g.height)}px`, lineHeight: "normal" };
}
/** The rename field: laid over the name it edits (the tab keeps its box); Enter or a click elsewhere keeps the new
 *  name, Escape restores it. */
export function RenameField({ wb, tabId, value }: { wb: Workbench; tabId: string; value: string }) {
  const ref = useRef<HTMLInputElement>(null), done = useRef(false);
  useLayoutEffect(() => {
    const input = ref.current!, host = input.parentElement!, lab = host.querySelector<HTMLElement>('.wb-tab-label, .wb-crumb-label');
    if (lab) {
      const hr = host.getBoundingClientRect(), lr = lab.getBoundingClientRect();
      // the field takes the label's own box (the name chip's, its padding included) and its text metrics, so the
      // glyphs stay where they were: the same left edge and baseline; the editing look is the field's ground and ring
      const cs = getComputedStyle(lab), px = (v: number) => `${v}px`;
      Object.assign(input.style, { left: px(lr.left - hr.left), top: px(lr.top - hr.top), width: px(lr.width), height: px(lr.height),
        paddingRight: cs.paddingRight, paddingLeft: cs.paddingLeft, borderRadius: cs.borderRadius, ...vpad(lab, lr),
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, textIndent: '0px', ...vpad(lab, lr) });
      lab.style.visibility = 'hidden';
    }
    input.focus({ preventScroll: true }); input.select();
    return () => { if (lab) lab.style.visibility = ''; };
  }, []);
  const end = (name: string | null) => { if (done.current) return; done.current = true; wb.finishRename(tabId, name); };
  return html`<${Input} inputRef=${ref} class="wb-rename" aria-label="Rename" value=${value} data-rename=${tabId}
    onPointerDown=${(e: Event) => e.stopPropagation()} onClick=${(e: Event) => e.stopPropagation()} onDblClick=${(e: Event) => e.stopPropagation()}
    onKeyDown=${(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end((e.currentTarget as HTMLInputElement).value.trim() || null); } else if (e.key === 'Escape') { e.preventDefault(); end(null); } }}
    onBlur=${(e: FocusEvent) => end((e.currentTarget as HTMLInputElement).value.trim() || null)} />`;
}

/** A chip's attributes from its shell: a control (role=button, its name, its keys) where it acts, else hidden. */
export type ChipAttrs = Record<string, unknown>;
/** The document chip: the document's name; the document switcher's anchor where there is one (data-name). */
export function DocChip({ label, switcher, attrs }: { label: string; switcher: boolean; attrs: ChipAttrs }) {
  return html`<span class="wb-tab-label" data-name=${switcher ? '' : undefined} ...${attrs}><span class="wb-tab-name">${label}</span></span>`;
}
/** The section chip: one line, the chevron then the number and the text; two lines, the chevron inside it and the
 *  section under the name. The section menu's anchor (data-sub). */
export function SectionChip({ sub, two, attrs }: { sub: Subtitle; two: boolean; attrs: ChipAttrs }) {
  return two ? html`<span class="wb-tab-sub" data-sub ...${attrs}><span class="wb-tab-chev" aria-hidden="true"><${Icon} name="chevronRight" /></span>
        <span class="wb-tab-sub-label">${sub.label}</span></span>`
    : html`<span class="wb-tab-chev" aria-hidden="true"><${Icon} name="chevronRight" /></span><span class="wb-tab-sec" data-sub ...${attrs}>
        ${sub.num ? html`<span class="wb-tab-num">${sub.num}</span>` : null}<span class="wb-tab-sec-text">${sub.text ?? sub.label}</span></span>`;
}
/** The line holding the chips: one line ("Document › Section") or two (the name, the section under it). `shared`: the
 *  name is the group's twice, so it steps back and the sections lead. */
export function ChipLine({ two, shared, label, sub, switcher, nameAttrs, secAttrs }: { two: boolean; shared: boolean; label: string; sub: Subtitle | null;
  switcher: boolean; nameAttrs: ChipAttrs; secAttrs: ChipAttrs }) {
  return html`<span class=${`${two ? 'wb-tab-text' : 'wb-tab-line'}${shared ? ' is-shared' : ''}`}><${DocChip} label=${label} switcher=${switcher} attrs=${nameAttrs} />${sub?.label
    ? html`<${SectionChip} sub=${sub} two=${two} attrs=${secAttrs} />` : null}</span>`;
}
/** The unsaved dot (in the × slot: the × on hover or focus, the rule for every look). */
export const DirtyDot = () => html`<span class="wb-st wb-st--unsaved wb-st--slot" aria-hidden="true"></span>`;
