// PANES: a block's decor — the classes, data attributes and inline styles that are the BLOCK's, the
// same in every pane (nesting's roles, has-problem, selected, the kind and state, TeX's spacing). Written
// once, recorded, applied to every view of the block; a view made later (a pane opened) gets the record.
// What is a view's own (editing, the edit layout, section focus, hover, the held height) is not decor.
//
//   const d = createDecor(() => views)   views(): the block's elements in every pane
//   d.cls(name, on) · d.data(key, value | null) · d.style(prop, value | null) · d.has(name) · d.get(key)
//   d.applyTo(el)   a new view: every recorded class, data attribute and style
export function createDecor(views) {
  const cls = new Set(), data = new Map(), style = new Map();
  return {
    cls(name, on = true) {
      on = !!on;
      if (cls.has(name) === on) { for (const el of views()) if (el.classList.contains(name) !== on) el.classList.toggle(name, on); return; }
      if (on) cls.add(name); else cls.delete(name);
      for (const el of views()) el.classList.toggle(name, on);
    },
    has: (name) => cls.has(name),
    data(key, value) {
      const v = value == null ? null : String(value);
      if (v == null) data.delete(key); else data.set(key, v);
      for (const el of views()) { if (v == null) delete el.dataset[key]; else if (el.dataset[key] !== v) el.dataset[key] = v; }
    },
    get: (key) => data.get(key) ?? null,
    style(prop, value) {
      const v = value == null || value === '' ? null : String(value);
      if (v == null) style.delete(prop); else style.set(prop, v);
      for (const el of views()) { if (v == null) el.style.removeProperty(prop); else if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v); }
    },
    styleOf: (prop) => style.get(prop) ?? null,
    applyTo(el) {
      for (const c of cls) el.classList.add(c);
      for (const [k, v] of data) el.dataset[k] = v;
      for (const [p, v] of style) el.style.setProperty(p, v);
    },
  };
}
