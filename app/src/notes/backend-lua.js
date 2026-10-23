// A dev backend: the public LuaLaTeX pipeline behind notes/dev/serve.ts
// (POST api/compile), where the companion's web
// features already work. Offered only with ?backend=lua on that server; the
// editor's own backends are engine and the v1 worker.
export const luaBackend = {
  id: 'lua',
  label: 'Server · LuaLaTeX (dev)',
  /** notes/index.js: this backend draws \webwidget, so notes become chips */
  webFeatures: true,
  async available() {
    try {
      const r = await fetch(new URL('api/info', document.baseURI));
      return r.ok && (await r.json()).backend === 'lua';
    } catch { return false; }
  },
  async compile({ preamble, blocks: all, keep, limit }) {
    // (limit) the server keeps no results of its own here: the first `limit` blocks, the rest asked again
    const blocks = limit != null ? all.slice(0, limit) : all;
    const r = await fetch(new URL('api/compile', document.baseURI), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preamble, blocks: blocks.map((b) => ({ id: b.id, source: b.context ? `${b.context}\n${b.source}` : b.source })), keep }),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json()).error ?? msg; } catch { /* not JSON */ }
      throw new Error(`compile server: ${msg}`);
    }
    const res = await r.json();
    // a context prefix's lines are not the block's: take them off the problems' line numbers
    for (const b of blocks) {
      const n = b.context ? b.context.split('\n').length : 0;
      const out = res.blocks?.[b.id];
      if (!out || !n) continue;
      for (const p of [...(out.errors ?? []), ...(out.warnings ?? [])]) if (typeof p.line === 'number') p.line = p.line > n ? p.line - n : null;
    }
    return res;
  },
};
