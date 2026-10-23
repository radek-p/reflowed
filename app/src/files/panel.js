// The Files panel's content: every file the document uses, as the Export .zip writes them (io/files.ts: the
// export's own list), each row its name, kind, size and where it is used; a click goes to the first use (the nav API).
// Content only: it renders into whatever container holds it (the sidebar's tab today, a sheet through openView).
//
//   <${FilesContent} host=${{ list, goTo, locator }} />
//     list()      -> Promise<{ files: ProjectFile[], warnings } | null>   (null: no document, or no io/)
//     goTo(id)    -> reveal block id (the panel's click)
//     locator(id) -> "§2.1 · Figure" (where a block is, in words)
//     onCount(n)  -> the number of files (the tab's badge)
// Hooks for tests: .fl-list > li > .fl-row[data-path][data-kind][data-uses] (.fl-name, .fl-kind, .fl-size, .fl-where).
import { useEffect, useState } from 'preact/hooks';
import { html, Icon } from '../design/ui/index.js';
import { onChange } from '../app/page-state.ts';

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ext = (p) => (/\.([A-Za-z0-9]+)$/.exec(p)?.[1] ?? '').toLowerCase();
const OTHER = { sty: 'Package', cls: 'Class', bst: 'Bibliography style', clo: 'Class option', tex: 'TeX file', bib: 'BibTeX database', bbl: 'Bibliography' };

export function kindLabel(f) {
  switch (f.kind) {
    case 'main': return 'Main file';
    case 'input': return 'Input file';
    case 'bib': return 'BibTeX database';
    case 'bbl': return 'Bibliography (.bbl)';
    case 'package': return 'Title package';
    case 'figure': return `Figure · ${ext(f.path).toUpperCase()}`;
    case 'rendition': return ext(f.path) === 'ipe' ? 'Ipe document (edited figure)' : 'TikZ (edited figure)';
    default: return OTHER[ext(f.path)] ?? (ext(f.path) ? `${ext(f.path).toUpperCase()} file` : 'File');
  }
}
const ICON = { main: 'textSize', input: 'textSize', bib: 'note', bbl: 'note', package: 'settings', figure: 'figure', rendition: 'figure', asset: 'textSize' };

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function whereLabel(f, locator) {
  const n = f.uses.length;
  if (f.kind === 'main' || f.kind === 'input') return [f.preamble ? 'Preamble' : '', n ? plural(n, 'block') : ''].filter(Boolean).join(' and ') || 'No blocks';
  const first = n ? (locator?.(f.uses[0]) || 'a block') : '';
  const blocks = n ? `${first}${n > 1 ? ` and ${n - 1} more` : ''}` : '';
  return [f.preamble ? 'Preamble' : '', blocks].filter(Boolean).join(' · ') || 'Not named in the source';
}

/** display order: the export's, with an edited figure's renditions right after the figure */
function ordered(files) {
  const out = files.filter((f) => f.kind !== 'rendition');
  for (const r of files.filter((f) => f.kind === 'rendition')) {
    const i = out.findIndex((f) => f.path === r.of);
    if (i < 0) out.push(r);
    else { let j = i + 1; while (out[j]?.of === r.of) j++; out.splice(j, 0, r); }
  }
  return out;
}

function Row({ f, host }) {
  const slash = f.path.lastIndexOf('/');
  const dir = slash >= 0 ? f.path.slice(0, slash + 1) : '', base = f.path.slice(slash + 1);
  const I = Icon[ICON[f.kind]] ?? Icon.textSize;
  const go = f.uses.length ? () => host.goTo(f.uses[0]) : null;
  const where = whereLabel(f, host.locator);
  return html`<li>
    <button type="button" class=${`fl-row${f.kind === 'rendition' ? ' fl-sub' : ''}`} data-path=${f.path} data-kind=${f.kind} data-uses=${f.uses.length}
      aria-disabled=${go ? undefined : 'true'} title=${go ? `${f.path}: go to its first use` : f.path} onClick=${() => go?.()}>
      <span class="fl-ico" aria-hidden="true"><${I} /></span>
      <span class="fl-main">
        <span class="fl-name">${dir ? html`<span class="fl-dir">${dir}</span>` : null}${base}</span>
        <span class="fl-meta"><span class="fl-kind">${kindLabel(f)}</span><span class="fl-size">${fmtSize(f.size)}</span></span>
        <span class="fl-where">${where}</span>
      </span>
    </button>
  </li>`;
}

export function FilesContent({ host }) {
  const [state, setState] = useState({ files: null, warnings: [], error: null });
  useEffect(() => {
    let live = true, timer = 0, seq = 0;
    const load = async () => {
      const my = ++seq;
      try {
        const r = await host.list();
        if (!live || my !== seq) return;
        setState({ files: r?.files ?? [], warnings: r?.warnings ?? [], error: r ? null : 'Not available for this document.' });
        host.onCount?.(r?.files?.length ?? 0);
      } catch (e) { if (live && my === seq) setState((s) => ({ ...s, error: e.message })); }
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
    load();
    // the container's signals (app/page-state.ts); current: the focused pane shows another document
    const offs = [onChange(host.state.refreshed, soon), onChange(host.state.current, soon)];
    return () => { live = false; clearTimeout(timer); for (const off of offs) off(); };
  }, [host]);

  const { files, warnings, error } = state;
  if (error && !files?.length) return html`<p class="sb-empty fl-empty">${error}</p>`;
  if (!files) return html`<p class="sb-empty fl-empty">Listing the files…</p>`;
  const total = files.reduce((s, f) => s + f.size, 0);
  return html`<div class="fl">
    <ul class="fl-list" aria-label="Files">
      ${ordered(files).map((f) => html`<${Row} key=${f.path} f=${f} host=${host} />`)}
    </ul>
    <p class="fl-foot">${`${plural(files.length, 'file')} · ${fmtSize(total)}: what Export .zip writes`}</p>
    ${warnings.length ? html`<ul class="fl-warn">${warnings.map((w) => html`<li key=${w}>${w}</li>`)}</ul>` : null}
  </div>`;
}
