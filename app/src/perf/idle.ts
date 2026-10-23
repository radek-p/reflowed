// An idle callback, with a timer where the browser has none (Safari): one definition (there
// were four copies, each with its own fallback). Each caller keeps its numbers.
//   const h = idle(fn, { timeout, delay?, budget? })   fn(deadline) in idle time, by `timeout` ms at the latest;
//                                                      without requestIdleCallback: after `delay` ms, `budget` ms to use
//   cancelIdle(h)
export interface Deadline { timeRemaining(): number; didTimeout: boolean }
export type IdleHandle = number;

export function idle(fn: (d: Deadline) => void, { timeout, delay = 16, budget = 8 }: { timeout: number; delay?: number; budget?: number }): IdleHandle {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout });
  return setTimeout(() => fn({ timeRemaining: () => budget, didTimeout: false }), delay) as unknown as IdleHandle;
}

export function cancelIdle(h: IdleHandle): void {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(h); else clearTimeout(h);
}
