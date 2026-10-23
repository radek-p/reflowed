// Where a suite writes its results: test-results/ at the repository root, or the directory test-all gives each suite
// of a run (RTX_RESULTS), so that two suites, or two lanes, never write the same files (w15 and w15-file both wrote
// test-results/w15/results.json).
//   const OUT = join(resultsDir(HERE), 'w15');
import { join, resolve } from 'node:path';

export const resultsDir = (root: string) => (process.env.RTX_RESULTS ? resolve(process.env.RTX_RESULTS) : join(root, 'test-results'));
