// the title form's fields. A value is LaTeX source; a field shows it as text when that is lossless
// (tex/text.ts valueText: Kr\'{o}l shows as Król) and writes typed text back as Unicode with
// LaTeX's specials escaped. Anything else (maths, \\, a minipage) shows as source in a mono field marked
// "LaTeX". An untouched field writes nothing; typing back the text it showed keeps the source it had.
import { html, cx, nextId } from '../../design/ui/core.js';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../design/ui/icons.ts';
import { valueText, textValue } from '../../tex/text.ts';
import { balanced } from '../kv.ts';

/** value: the source (undefined: not set); onChange(source | undefined) */
export function ValueField({ label, value, onChange, multiline = false, placeholder = '', check = null, hint = null, name, inputMode, autoFocus = false }) {
  const id = useRef(nextId('mf')).current;
  const src = value ?? '';
  const asText = valueText(src);
  const [latex, setLatex] = useState(asText === null);
  const showLatex = latex || asText === null;
  const shown = showLatex ? src : asText;
  const [problem, setProblem] = useState(null);
  const el = useRef(null);
  useLayoutEffect(() => { if (autoFocus) el.current?.focus({ preventScroll: false }); }, []);   // (autofocus only works on a dialog's first paint)
  const input = (e) => {
    const t = e.currentTarget.value;
    let next;
    if (showLatex) {
      if (!balanced(t)) { setProblem('Braces do not match (or a % comment): not applied'); return; }
      next = t;
    } else next = t === asText ? src : textValue(t);
    setProblem(null);
    onChange(next === '' && value === undefined ? undefined : next);
  };
  const msg = problem ?? (check && src ? check(src) : null);
  const Tag = multiline || showLatex && src.includes('\n') ? 'textarea' : 'input';
  return html`<div class=${cx('mf-field', msg && 'mf-bad')} data-field=${name}>
    <div class="mf-label-row"><label for=${id}>${label}</label>
      ${asText !== null ? html`<button type="button" class="mf-latex-toggle" aria-pressed=${String(showLatex)} title="Show and edit the LaTeX source"
        onClick=${() => setLatex(!latex)}>LaTeX</button>` : html`<span class="mf-latex-mark" title="Not plain text: edited as LaTeX">LaTeX</span>`}</div>
    <${Tag} ref=${el} id=${id} class=${cx('ui-input mf-input', showLatex && 'ui-input--mono', Tag === 'textarea' && 'mf-area')} value=${shown} placeholder=${placeholder}
      onInput=${input} spellcheck=${showLatex ? 'false' : 'true'} inputmode=${inputMode} aria-invalid=${msg ? 'true' : undefined}
      aria-describedby=${msg || hint ? `${id}-msg` : undefined} rows=${Tag === 'textarea' ? Math.min(8, Math.max(2, shown.split('\n').length)) : undefined}
      />
    ${msg || hint ? html`<div class=${cx('mf-msg', msg && 'is-bad')} id=${`${id}-msg`}>${msg ?? hint}</div>` : null}
  </div>`;
}

/** A plain field (no LaTeX: an email, an ORCID iD); `check(value)` → a problem or null; invalid values are kept, flagged. */
export function PlainField({ label, value, onChange, check, normalise = (v) => v, placeholder = '', name, type = 'text' }) {
  const id = useRef(nextId('mf')).current;
  const v = value ?? '';
  const msg = v && check ? check(v) : null;
  return html`<div class=${cx('mf-field', msg && 'mf-bad')} data-field=${name}>
    <div class="mf-label-row"><label for=${id}>${label}</label>${v && !msg ? html`<span class="mf-ok" role="img" aria-label="valid"><${Icon.check} /></span>` : null}</div>
    <input id=${id} type=${type} class="ui-input mf-input" value=${v} placeholder=${placeholder} spellcheck="false" autocomplete="off"
      aria-invalid=${msg ? 'true' : undefined} aria-describedby=${msg ? `${id}-msg` : undefined}
      onInput=${(e) => { const t = e.currentTarget.value.trim(); onChange(t ? t : undefined); }}
      onBlur=${(e) => { const t = e.currentTarget.value.trim(); if (t && !(check && check(t))) { const n = normalise(t); if (n !== t) onChange(n); } }} />
    ${msg ? html`<div class="mf-msg is-bad" id=${`${id}-msg`}>${msg}</div>` : null}
  </div>`;
}

/** A flag (a key with no value: corresponding, break-after …). */
export function FlagField({ label, on, onChange, hint, name }) {
  const id = useRef(nextId('mf')).current;
  return html`<label class="mf-flag" for=${id} data-field=${name} title=${hint}>
    <input id=${id} type="checkbox" checked=${on} onChange=${(e) => onChange(e.currentTarget.checked)} /><span>${label}</span></label>`;
}
