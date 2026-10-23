// esbuild for the public repo's bundle helper (scripts/lib/public-repo.ts), when the public checkout has no node_modules
// of its own: the app's esbuild, its builds resolving packages (preact, htm …) from the app's node_modules too.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as ESBuild from 'esbuild';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../../app');
const real: typeof ESBuild = createRequire(join(APP, 'package.json'))('esbuild');
const nodePaths = [join(APP, 'node_modules')];
export const version = real.version;
export const buildSync = (o: ESBuild.BuildOptions) => real.buildSync({ nodePaths, ...o });
export const build = (o: ESBuild.BuildOptions) => real.build({ nodePaths, ...o });
export const transformSync = real.transformSync;
export const transform = real.transform;
export default { version, buildSync, build, transformSync, transform };
