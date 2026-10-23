// @ts-check
// The command registry (a light one — id, label, keys, run — JSON
// editor's keys, the shortcuts dialog and editorAPI (the tests) all call it. A command is
//
//   { id: 'block.delete', label: 'Delete', key?: 'delete' (its menu entry's data-action), shortcut?: '⌫' (shown in
//     menus), keys?: '⌫ / Del' and help?: 'Delete the selected block' (a row of the shortcuts dialog, in `order`),
//     when?(c, input) -> bool (disabled when false), run(c, input) -> result, edits?: bool, destructive?: bool }
//
//   const commands = createCommands({ context: (via) => c })   c: what a command acts on (the editor's: its
//                                                              DocSession, the focused pane, the page's actions)
//   commands.define(cmd | cmd[]) · commands.has(id) · commands.get(id) · commands.list()
//   commands.call(id, input, { via }) -> run's result; undefined when `when` says no (via: 'ui' | 'key' | 'test' | …)
//   commands.enabled(id, input) -> bool
//   commands.menuItem(id, input, { label, disabled }) -> a menu entry (chrome/menu.js item) that calls the command
//   commands.shortcuts() -> [keys, help] rows, in the order commands were defined (the shortcuts dialog)
// Probes (counters, whenIdle, views) are not commands: they stay editorAPI's.

export const ID_RE = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z-]*$/;

/** @param {{ context: (via: string) => any, keep?: number }} o */
export function createCommands({ context, keep = 100 }) {
  /** @type {Map<string, any>} */ const cmds = new Map();
  /** @type {{ id: string, via: string, at: number }[]} */ const ring = [];

  function define(cmd) {
    for (const c of Array.isArray(cmd) ? cmd : [cmd]) {
      if (!ID_RE.test(c.id)) throw new Error(`command id ${c.id}: want group.verb`);
      if (cmds.has(c.id)) throw new Error(`command ${c.id} defined twice`);
      if (typeof c.run !== 'function') throw new Error(`command ${c.id}: no run`);
      cmds.set(c.id, { edits: false, destructive: false, ...c });
    }
    return api;
  }
  const describe = (c) => ({ id: c.id, label: c.label, key: c.key ?? null, shortcut: c.shortcut ?? '', keys: c.keys ?? null, help: c.help ?? null, edits: !!c.edits, destructive: !!c.destructive });
  function find(id) { const c = cmds.get(id); if (!c) throw new Error(`no command ${id}`); return c; }
  function enabled(id, input = {}, via = 'ui') { const c = find(id); return !c.when || !!c.when(context(via), input); }
  function call(id, input = {}, { via = 'ui' } = {}) {
    const c = find(id);
    const cx = context(via);
    if (c.when && !c.when(cx, input)) return undefined;
    ring.push({ id, via, at: Date.now() });
    if (ring.length > keep) ring.shift();
    return c.run(cx, input ?? {});
  }
  const api = {
    define, call, enabled,
    has: (id) => cmds.has(id),
    get: (id) => (cmds.has(id) ? describe(cmds.get(id)) : null),
    list: () => [...cmds.values()].map(describe),
    menuItem(id, input = {}, { label = null, disabled = null } = {}) {
      const c = find(id);
      // chrome/menu.js item()'s shape (no import: the registry has no DOM)
      return { label: label ?? c.label, key: c.key ?? id, fn: () => call(id, input, { via: 'ui' }), disabled: disabled ?? !enabled(id, input), shortcut: c.shortcut ?? '' };
    },
    shortcuts: () => [...cmds.values()].filter((c) => c.keys && c.help).map((c) => [typeof c.keys === 'function' ? c.keys() : c.keys, c.help]),
    recent: (n = 20) => ring.slice(-n),
  };
  return api;
}
