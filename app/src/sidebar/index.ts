// the sidebar's Problems and TODOs panels as Preact components (were app/panels.js drawProblems / drawTodos: the
// panel rebuilt on every refresh, which also lost a group's collapsed state and the keyboard focus). Keyed rows.
//
// Registered views' content: <ProblemsPanel ctx> and <TodosPanel ctx> draw the CURRENT
// document's lists (ctx.current: app/panel-host.ts, the data from doc/panels.ts) in whichever container hosts them,
// and act through the document's commands: a problem opens its place (nav.reveal { id, range }; a preamble problem:
// doc.settings { line }); a TODO opens its note chip (note.open { todo }: its place when it has none).
// Classes and attributes are the ones app.css and the tests know:
//   Problems  .pb-copyall, section.pb-group.pb-<kind>, button.pb-head[aria-expanded]
//             (.pb-title, .count), ul.pb-list, div.pb-row[data-kind][data-block]
//             [role=button][tabindex=0] (.pb-msg, .pb-where), .pb-copy, sb-empty ok
//   TODOs     .td-chips > button.td-chip(.on)[aria-pressed] (.dot, .count),
//             ul.td-list > li > button.td-row[data-block] (.dot, .td-text > .td-author, .td-msg, .pb-where)
import { signal, type Signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { html } from '../design/ui/core.js';
import { selecting } from '../view/copy-errors.js';
import { CopyButton } from '../design/ui/copy.js';   // the kit's one Copy button
import type { ViewContext } from '../design/ui/views.ts';
import type { PanelHost } from '../app/panel-host.ts';
import type { Diagnostic, ProblemKind, Todo } from '../doc/panels.ts';

/** A DOM element made by plain-DOM code ("Add entry…"), put in place of a placeholder once. It must stay
 *  its parent's last child (CSS reaches it with li > …; nothing is ever inserted after it). */
function Foreign({ make }: { make: () => HTMLElement | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = make();
    const ph = ref.current;
    if (el && ph) ph.replaceWith(el);
    return () => { if (el?.isConnected && ph) el.replaceWith(ph); };
  }, []);
  return html`<span ref=${ref} class="ui-foreign" hidden></span>`;
}

// ── Problems ───────────────────────────────────────────────────────────────
const pkey = (p: Diagnostic) => `${p.kind}|${p.blockId ?? ''}|${p.offset ?? ''}|${p.line ?? ''}|${p.message}`;

function ProblemRow({ p, where, open, copyOne, action }: { p: Diagnostic; where: string; open: (p: Diagnostic) => void; copyOne: ((p: Diagnostic) => string) | null; action: ((p: Diagnostic) => HTMLElement | null) | null }) {
  const onKey = (e: KeyboardEvent) => { const t = e.currentTarget as HTMLElement; if (e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } };
  const onClick = (e: MouseEvent) => { if (!selecting(e.currentTarget)) open(p); };
  return html`<li>
    <div class="pb-row" data-kind=${p.kind} data-block=${p.blockId ?? ''} role="button" tabindex="0" onKeyDown=${onKey} onClick=${onClick}>
      <span class="pb-msg">${p.message}</span>${p.blockId ? html`<span class="pb-where">${where}</span>` : null}
    </div>
    ${copyOne ? html`<${CopyButton} class="err-copy pb-copy" title="Copy a report of this error (message, line, source, TeX log)" text=${() => copyOne(p)} />` : null}
    ${action ? html`<${Foreign} make=${() => action(p)} />` : null}
  </li>`;
}

/** a problem's place: its key (or offset) in the block, else its line, else the block; a preamble problem: the settings */
function openProblem(host: PanelHost, p: Diagnostic) {
  if (!p.blockId) { host.commands.call('doc.settings', { line: p.line ?? null }); return; }
  const src = host.blocks().find((b) => b.id === p.blockId)?.source ?? '';
  let range: { from: number; to: number } | null = null;
  if (p.offset != null) {
    const k = p.key ? src.indexOf(p.key, p.offset) : -1;
    range = k >= 0 && p.key ? { from: k, to: k + p.key.length } : { from: p.offset, to: p.offset };
  } else if (p.line) {
    const lines = src.split('\n');
    let from = 0;
    for (let k = 0; k < p.line - 1 && k < lines.length; k++) from += lines[k].length + 1;
    range = { from, to: from + (lines[p.line - 1]?.length ?? 0) };
  }
  host.commands.call('nav.reveal', { id: p.blockId, range });
}

function Problems({ host, collapsed }: { host: PanelHost; collapsed: Signal<Set<ProblemKind>> }) {
  const list = host.lists.problems.value, shut = collapsed.value;
  const serious = list.filter((x) => x.kind !== 'unused-label');
  const where = host.locators();                       // the outline as it is now, once for the list
  const toggle = (kind: ProblemKind) => { const s = new Set(shut); if (s.has(kind)) s.delete(kind); else s.add(kind); collapsed.value = s; };
  const report = host.report;
  const copyAll = report ? (ps: Diagnostic[]) => ps.map((p) => report(p)).join('\n\n' + '-'.repeat(40) + '\n\n') : null;
  return html`
    ${!serious.length ? html`<p class="sb-empty ok">No problems found.</p>`
      : copyAll ? html`<div class="pb-copyall"><${CopyButton} class="err-copy pb-copy" label="Copy all" title="Copy a report of every problem"
          text=${() => copyAll(host.lists.problems.peek().filter((x) => x.kind !== 'unused-label'))} /></div>` : null}
    ${host.groups.map(([kind, title]) => {
      const rows = list.filter((x) => x.kind === kind);
      if (!rows.length) return null;
      const open = !shut.has(kind);
      return html`<section key=${kind} class=${`pb-group pb-${kind}`}>
        <button class="pb-head" aria-expanded=${String(open)} onClick=${() => toggle(kind)}><span class="pb-title">${title}</span><span class="count">${String(rows.length)}</span></button>
        <ul class="pb-list" hidden=${!open}>
          ${rows.slice(0, 300).map((p) => html`<${ProblemRow} key=${pkey(p)} p=${p} where=${p.blockId ? `${where(p.blockId)}${p.line ? ` · line ${p.line}` : ''}` : ''}
            open=${(x: Diagnostic) => openProblem(host, x)} copyOne=${report} action=${host.problemAction} />`)}
        </ul>
      </section>`;
    })}`;
}

/** the Problems view's content: the current document's problems; a group's collapsed state is the document's (unused
 *  labels start collapsed) and survives refreshes */
export function ProblemsPanel({ ctx }: { ctx: ViewContext<PanelHost> }) {
  const host = ctx.current.value;
  const collapsed = useMemo(() => signal<Set<ProblemKind>>(new Set(['unused-label'])), [host]);
  return host ? html`<${Problems} host=${host} collapsed=${collapsed} />` : null;
}

// ── TODOs ──────────────────────────────────────────────────────────────────
function Todos({ host, filter }: { host: PanelHost; filter: Signal<string | null> }) {
  const list = host.lists.todos.value, f = filter.value;
  if (!list.length) return html`<p class="sb-empty">No \\todo notes. The preamble's own todo macros (like \\editor{…}) count too.</p>`;
  const authors = [...new Set(list.map((t) => t.author))].sort();
  const colour = (a: string) => host.colour(a, authors);
  const where = host.locators();
  const chip = (label: string, value: string | null, n: number) => html`<button key=${`c:${value ?? ''}`} class=${`td-chip${f === value ? ' on' : ''}`} aria-pressed=${String(f === value)}
      onClick=${() => { filter.value = f === value ? null : value; }}>
    ${value ? html`<span class="dot" style=${`background:${colour(value)}`}></span>` : null}${label}<span class="count">${String(n)}</span></button>`;
  const seen = new Map<string, number>();
  const key = (t: Todo) => { const k = `${t.blockId}|${t.offset}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}|${n}`; };
  return html`<div class="td-chips">${chip('All', null, list.length)}${authors.map((a) => chip(a, a, list.filter((t) => t.author === a).length))}</div>
    <ul class="td-list">
      ${list.filter((x) => !f || x.author === f).map((t) => html`<li key=${key(t)}>
        <button class="td-row" data-block=${t.blockId} onClick=${() => host.commands.call('note.open', { todo: t })}>
          <span class="dot" style=${`background:${colour(t.author)}`}></span>
          <span class="td-text"><span class="td-author">${t.author}</span><span class="td-msg">${t.text || '(empty)'}</span><span class="pb-where">${where(t.blockId)}</span></span>
        </button></li>`)}
    </ul>`;
}

/** the TODOs view's content: the current document's notes; the author filter is the document's, kept across refreshes */
export function TodosPanel({ ctx }: { ctx: ViewContext<PanelHost> }) {
  const host = ctx.current.value;
  const filter = useMemo(() => signal<string | null>(null), [host]);
  return host ? html`<${Todos} host=${host} filter=${filter} />` : null;
}
