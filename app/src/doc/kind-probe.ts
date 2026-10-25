// The editor's engine as offeredKinds' probe (doc/kinds.ts): is \begin{env} defined with the document's preamble?
// The engine typesets \begin{env}x\end{env} against the preamble (one compile request for the questions of one tick;
// results cached like any block's, so a preamble asked about before is answered from the cache); defined unless TeX
// says "Environment env undefined" (or the preamble itself fails). Answers are kept per preamble text, the last few.
//
//   const probe = engineProbe(backend, preamble)   null: a backend that is not the engine (no answers to trust)
//   await probe('lemma') -> boolean
//
// The engine loads mathtools and the companion's numbering package for every document (engine/src/compile.ts,
// adapter.ts), so it defines align and proof whatever the preamble says: those are answered false here (what the
// author's own LaTeX would not typeset is not offered).
import type { Probe } from './kinds.ts';

interface Problem { message: string }
interface Engine {
  id: string;
  compile(req: { preamble: string; blocks: { id: string; source: string; context?: string }[]; keep: string[] }): Promise<{ blocks: Record<string, { status: string; errors?: Problem[] } | undefined>; preamble?: { errors?: Problem[] } }>;
}
const ENGINE_OWN = new Set(['align', 'alignat', 'flalign', 'xalignat', 'gather', 'multline', 'proof']);
const KEEP = 8;
const answers = new Map<string, Map<string, Promise<boolean>>>();      // preamble text -> env -> answer

/** A probe through `backend` for `preamble`, or null when the backend is not the engine. */
export function engineProbe(backend: unknown, preamble: string): Probe | null {
  const be = backend as Partial<Engine> | null;
  if (!be || be.id !== 'tectonic' || typeof be.compile !== 'function') return null;
  const engine = be as Engine;
  let known = answers.get(preamble);
  if (!known) {
    known = new Map();
    answers.set(preamble, known);
    if (answers.size > KEEP) answers.delete(answers.keys().next().value!);
  }
  const mine = known;
  let batch: { env: string; resolve(v: boolean): void }[] = [];
  const flush = () => {
    const asked = batch;
    batch = [];
    const id = (env: string) => `kind-probe:${env}`;
    engine.compile({ preamble, blocks: asked.map(({ env }) => ({ id: id(env), source: `\\begin{${env}}x\\end{${env}}`, context: '' })), keep: [] })
      // a preamble TeX stops in answers nothing: not defined
      .then((r) => asked.forEach(({ env, resolve }) => resolve(!r.preamble?.errors?.length && defined(env, r.blocks[id(env)]))),
        () => asked.forEach(({ env, resolve }) => { mine.delete(env); resolve(false); }));      // the engine did not run: asked again next time
  };
  return (env: string) => {
    if (ENGINE_OWN.has(env)) return Promise.resolve(false);
    let p = mine.get(env);
    if (!p) {
      p = new Promise<boolean>((resolve) => { batch.push({ env, resolve }); if (batch.length === 1) queueMicrotask(flush); });
      mine.set(env, p);
    }
    return p;
  };
}

/** a probe's result: no result, or TeX's "Environment env undefined", is not defined */
export function defined(env: string, r: { status: string; errors?: Problem[] } | undefined): boolean {
  if (!r) return false;
  return !(r.errors ?? []).some((e) => e.message.includes(`Environment ${env} undefined`));
}
