// The build's virtual modules (scripts/lib/app-bundle.ts resolves `rtx:<name>` to the module's entry, or to
// app/stubs.js while it is missing): typed as the entries they resolve to in this checkout, for the TypeScript
// modules that import them (app/services.ts).
declare module 'rtx:store' { const m: typeof import('./store/index.js'); export = m; }
declare module 'rtx:io' { const m: typeof import('./io/index.js'); export = m; }
declare module 'rtx:home' { const m: typeof import('./home/index.js'); export = m; }
declare module 'rtx:refs' { const m: typeof import('./refs/index.ts'); export = m; }
declare module 'rtx:backend' { const m: typeof import('../../engine/web/backend.js'); export = m; }
declare module 'rtx:modules' { const which: Record<string, 'real' | 'stub'>; export default which; }
declare module '*.sty' { const text: string; export default text; }
declare module 'reflowtex/companion' { const m: Record<string, unknown>; export = m; }

/** an SVG file inlined as its text (the app bundle's loader) */
declare module '*.svg' { const text: string; export default text; }
