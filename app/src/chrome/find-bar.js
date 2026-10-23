// the find-and-replace bar as a Preact component (was built by hand in
// app/find.js, which keeps the searching, going and replacing). The bar
// renders from a small model of signals; find.js calls back through `on`.
// Classes, labels and data attributes are the ones app.css and the tests know:
// .find-bar[role=search][hidden], .find-row, .find-input, .find-opt[data-opt]
// [aria-pressed], .find-count[data-kind], .find-btn(.wide)[data-act].
//   const bar = mountFindBar(host, on)   on: { input(q), next(dir), replace(text), replaceAll(text), close(), toggle(key) }
//   bar.model: { visible, opts, count: { text, kind } } (signals)
//   bar.find / bar.repl: the inputs
import { signal } from '@preact/signals';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { html, render } from '../design/ui/core.js';
import { Icon } from '../design/ui/icons.ts';

const OPTS = [['Aa', 'caseSensitive', 'Match case'], ['W', 'word', 'Whole words'], ['.*', 'regex', 'Regular expression']];

function FindBar({ m, on, refs }) {
  const find = useRef(null), repl = useRef(null);
  useLayoutEffect(() => { refs.find = find.current; refs.repl = repl.current; }, []);
  const opts = m.opts.value, count = m.count.value;
  const keyFind = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); on.next(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); on.close(); }
  };
  const keyRepl = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) on.replaceAll(e.currentTarget.value); else on.replace(e.currentTarget.value); }
    else if (e.key === 'Escape') { e.preventDefault(); on.close(); }
  };
  return html`<div class="find-bar" role="search" hidden=${!m.visible.value}>
    <div class="find-row">
      <input ref=${find} class="ui-input ui-input--mono find-input" placeholder="Find in sources" aria-label="Find" spellcheck="false" onInput=${(e) => on.input(e.currentTarget.value)} onKeyDown=${keyFind} />
      ${OPTS.map(([label, key, title]) => html`<button type="button" key=${key} class="ui-icon-btn find-opt" title=${title} aria-label=${title} aria-pressed=${String(!!opts[key])} data-opt=${key}
          onClick=${() => { on.toggle(key); find.current.focus(); }}><span class="ui-glyph" aria-hidden="true">${label}</span></button>`)}
      <span class="find-count" aria-live="polite" data-kind=${count.kind}>${count.text}</span>
      <button type="button" class="ui-icon-btn find-btn" title="Previous (⇧↵)" aria-label="Previous match" onClick=${() => on.next(-1)}><${Icon.chevronUp} /></button>
      <button type="button" class="ui-icon-btn find-btn" title="Next (↵)" aria-label="Next match" onClick=${() => on.next(1)}><${Icon.chevronDown} /></button>
      <button type="button" class="ui-icon-btn find-btn" title="Close (Esc)" aria-label="Close find" onClick=${() => on.close()}><${Icon.close} /></button>
    </div>
    <div class="find-row">
      <input ref=${repl} class="ui-input ui-input--mono find-input" placeholder="Replace with" aria-label="Replace with" spellcheck="false" onKeyDown=${keyRepl} />
      <button type="button" class="ui-btn ui-btn--ghost find-btn wide" data-act="replace" onClick=${() => on.replace(repl.current.value)}>Replace</button>
      <button type="button" class="ui-btn ui-btn--ghost find-btn wide" data-act="replace-all" onClick=${() => on.replaceAll(repl.current.value)}>Replace all</button>
    </div>
  </div>`;
}

export function mountFindBar(host, on, opts) {
  const model = { visible: signal(false), opts: signal({ ...opts }), count: signal({ text: '', kind: '' }) };
  const refs = { find: null, repl: null };
  render(html`<${FindBar} m=${model} on=${on} refs=${refs} />`, host);
  return { model, get find() { return refs.find; }, get repl() { return refs.repl; }, get el() { return host.querySelector('.find-bar'); } };
}
