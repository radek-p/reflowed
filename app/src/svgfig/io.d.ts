// Types for svgfig/io.js (io/import.ts is type-checked strictly).
export interface ImportEntry { path: string; data: Uint8Array }
/** An exported project's SVG figures back as SVG figures: \includegraphics for \input{….tikz}, the .tikz
 *  files and the export's added preamble lines dropped; renditions: SVG path → its kept TikZ rendition. */
export function restoreSvgFigures<E extends ImportEntry>(entries: E[]): { entries: E[]; renditions: Map<string, { tikz: string; hash: string }> };
