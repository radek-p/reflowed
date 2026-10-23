// Text measured on a canvas (one context for the page): the tabs' 3-character minimum, the UI font's x-height.
let measureCtx: CanvasRenderingContext2D | null = null;
export const measurer = (): CanvasRenderingContext2D => (measureCtx ??= document.createElement('canvas').getContext('2d')!);
export function textWidth(text: string, font: string): number { const m = measurer(); m.font = font; return m.measureText(text).width; }
