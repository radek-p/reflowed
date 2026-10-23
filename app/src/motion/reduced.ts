// Whether the reader asked for reduced motion (the OS setting): one definition. There were 11
// copies, some without the guard (a page without matchMedia: a test's DOM, an old WebView).
//   reduced() -> boolean
export const reduced = (): boolean => { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
