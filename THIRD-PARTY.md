# Third-party components

ReflowEd's own code and the introduction document (`samples/intro/`) are under the
GNU Affero General Public License, version 3 or later (see [LICENSE](LICENSE)).
The files below come from other projects and keep their own licences.

## In this repository

| Path | What | Licence |
|---|---|---|
| `engine/licences/` | the licence texts of the code compiled into the engine's WebAssembly: Tectonic and XeTeX, HarfBuzz, ICU, FreeType, libpng, zlib, Graphite2 | each its own (in the file) |
| `engine/tex/lipics-v2021.cls`, `engine/tex/lipics-logo-bw.pdf`, `engine/tex/cc-by.pdf`, `engine/tex/orcid.pdf` | the LIPIcs document class and the logos it loads, as distributed on CTAN (Tectonic's bundle does not have them) | LPPL 1.3 or later (Schloss Dagstuhl) |
| `website/static/app/` | the editor as the site publishes it: a release built by `node scripts/build.ts`, with the npm packages, engine parts and TeX files it bundles; the release lists each with its licence (`licences-*.txt`, also shown in its About box) | each its own, as the release lists them; ReflowEd's own code AGPL-3.0-or-later |
| `website/static/app/texlive/2022/` | a subset of TeX Live 2022's `texmf-dist` (its packages are named in `website/static/app/texlive/README`), unchanged, with each package's TeX Live record (`tlpkg/tlpobj/`) and licence files (`texmf-dist/doc/`); `LICENCES.txt` lists them | each package its own: mostly LPPL, also GPL, OFL, Knuth, MIT, public domain and others (`catalogue-license` in each package's `.tlpobj`) |

## In a build

A release (`node scripts/build.ts`) bundles npm packages, the engine's
WebAssembly (from [reflow-tectonic](https://github.com/radek-p/reflow-tectonic):
Tectonic, MIT, with changes under AGPL-3.0-or-later) and TeX files from
Tectonic's bundle. `scripts/licences.ts` lists each of them with its licence
when the release is built, and the release shows the list, with the full texts,
in its About box.

The public [reflowtex](https://github.com/radek-p/reflowtex) parts the build
bundles (the viewer, the encoder, the companion package) are under
AGPL-3.0-or-later, from that repository. The multi-file release also carries
reflowtex's inspector (its built files, in a folder of their own: the advanced
Inspector loads them when it is opened), AGPL-3.0-or-later as well, with the
bundle of Preact and Preact Signals (MIT) and htm (Apache-2.0) it uses; its
licence list names them.
