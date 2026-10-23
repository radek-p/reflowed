// Reduced motion (one check for every animation the workbench starts itself, its CSS has its own @media rules).
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
