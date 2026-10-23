// How the editor compiles a document whose title data is in \ReflowedMeta:
// the data leaves the preamble the engine sees (\ReflowedMetaSetup{apply=none}
// stands in its place) and goes in front of each \maketitle block, which
// applies it (\ReflowedMetaApply) before \maketitle. A title edit then
// changes the title block alone: the preamble, its warm snapshot and every
// other block's compile key stay as they were. In print (export, PDF) the
// preamble is used as written; meta/proof/test-tex.ts checks that both ways
// give the same page.
//
// Only when it is safe: the package is loaded, applied automatically, and
// nothing else in the preamble reads the data (a getter, a loop, \ReflowedMetaApply,
// \ReflowedMetaSetup); otherwise the preamble is sent whole, as before.
//
//   splitMeta(preamble) → { preamble, titlePrefix }   (cached on the last preamble)
//   blockSource(kind, source, split)                   what a block compiles
//   titlePrefixFor(meta text)                          the prefix for an edited \ReflowedMeta (the form's preview)

import { metaCommands } from './model.ts';
import { parseKv } from './kv.ts';
import { packageOptions, usesAny } from '../tex/calls.ts';

export interface MetaSplit { preamble: string; titlePrefix: string }

const READS = ['ReflowedMetaGet', 'ReflowedMetaCount', 'ReflowedMetaIfSetTF', 'ReflowedMetaJoin', 'ReflowedMetaForEach', 'ReflowedMetaApply', 'ReflowedMetaSetup'];
const cache = { pre: '', out: null as MetaSplit | null };

/** The package is loaded and applies by itself (no apply=none in its options). */
function appliesItself(pre: string): boolean {
  const opts = packageOptions(pre, 'reflowed-meta');
  if (opts === null) return false;
  return !parseKv(opts).some((e) => e.key === 'apply' && e.value === 'none');
}

export const titlePrefixFor = (commands: string) => `${commands}\\ReflowedMetaApply%\n`;

export function splitMeta(pre: string): MetaSplit {
  if (cache.pre === pre && cache.out) return cache.out;
  let out: MetaSplit = { preamble: pre, titlePrefix: '' };
  const cmds = metaCommands(pre);
  if (cmds.length && appliesItself(pre)) {
    let rest = '', last = 0, prefix = '', others = '';
    cmds.forEach(([s, , c], i) => {
      rest += pre.slice(last, s) + (i === 0 ? '\\ReflowedMetaSetup{apply=none}' : '');
      others += pre.slice(last, s);
      prefix += pre.slice(s, c + 1) + '%\n';
      last = c + 1;
    });
    rest += pre.slice(last);
    others += pre.slice(last);
    if (!usesAny(others, READS)) out = { preamble: rest, titlePrefix: titlePrefixFor(prefix) };
  }
  cache.pre = pre; cache.out = out;
  return out;
}

/** What a block compiles: the title block gets the data in front. */
export const blockSource = (kind: string, source: string, split: MetaSplit) => (kind === 'title' && split.titlePrefix ? split.titlePrefix + source : source);
