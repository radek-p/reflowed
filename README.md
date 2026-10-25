# ReflowEd

ReflowEd is a LaTeX editor that runs in the browser. A document is a list of
blocks: paragraphs, theorems, displays, figures. Each block is typeset by a real
TeX engine (Tectonic, compiled to WebAssembly and run in a worker), and the
result is shown reflowed to the width of the window, so the same document reads
well on a wide screen and on a phone. The source of a block opens in place for
editing; the block is typeset again as you type.

A release is a single HTML file (or a directory of static files) that works
offline, with no server.

Website: https://radek-p.github.io/reflowed/ (the editor is at
https://radek-p.github.io/reflowed/app/).

## How it uses reflowtex

ReflowEd builds on [reflowtex](https://github.com/radek-p/reflowtex). From it
come the viewer (it draws the captured TeX boxes and breaks the lines again at
any width), the encoder, the companion LaTeX package and the inspector. The
engine is Tectonic with the capture reflowtex needs, built to WebAssembly in
[reflow-tectonic](https://github.com/radek-p/reflow-tectonic); ReflowEd takes it
from that repository's releases, with its LaTeX format and its TeX Live tree.

The builds find the reflowtex checkout through `REFLOWTEX=<path>`; without it,
a `reflowtex/` directory beside this one (or beside any directory above it) is
used.

reflowtex is pinned as the engine is: `reflowtex.lock.json` names the
reflowtex commit this commit of ReflowEd is built and tested with. A release
build refuses a checkout that is not at that commit or has changes, and the
website workflow checks that commit out. To move to another reflowtex commit
(it must be on GitHub, where the workflow fetches it from), check it out in
the reflowtex checkout and lock it:

```
git -C ../reflowtex checkout <commit>
node scripts/lock-reflowtex.ts               # writes reflowtex.lock.json; commit it
node scripts/lock-reflowtex.ts --check       # is the checkout the locked commit?
```

## Layout

| Directory | What |
|---|---|
| `app/` | the editor's page: `index.html`, `app.css`, `src/` (Preact, Signals, htm) |
| `workbench/` | tabs, splits and side panels the page is built on, with its own demo and tests |
| `loading/` | how the page loads its files from the static trees beside it |
| `engine/` | the engine's side here: the worker, the capture's converter, and `reflow-tectonic.json`, the engine release it uses |
| `tex/` | the LaTeX packages the editor ships |
| `samples/intro/` | the introduction to ReflowEd, the document a new user sees first |
| `scripts/` | the builds: `w3-build.ts` (the page for development), `build.ts` (a release), `seed.ts`, `typecheck.ts` |
| `tests/` | the test runner (`test-all.ts`, `suites.ts`), the harness (`qa/lib`) and the suites |

Each source file starts with a comment that says what it does and how to use it.

## Building and running

You need Node 24 and a clone of reflowtex.
Every command below runs from the top of this repository.

1. reflowtex, next to this checkout, at the commit `reflowtex.lock.json` names:

   ```
   git clone https://github.com/radek-p/reflowtex ../reflowtex
   git -C ../reflowtex checkout "$(node -p "require('./reflowtex.lock.json').commit")"
   (cd ../reflowtex && npm ci)
   ```

2. The dependencies:

   ```
   (cd app && npm ci) && (cd engine && npm ci) && (cd engine/encode && npm ci)
   npx --prefix app playwright install chromium     # for the tests and the release build
   ```

3. The engine. It lives in
   [reflow-tectonic](https://github.com/radek-p/reflow-tectonic), and
   `engine/reflow-tectonic.json` names the release ReflowEd uses, with the
   sha256 of each of its files. This downloads them, checks them and puts them
   where the builds read them: the engine in `engine/dist/async/`, the LaTeX
   format in `engine/api/formats/latex.fmt`, and the TeX Live tree from the same
   release in `build/resources/www/texlive/2022/`:

   ```
   node scripts/fetch-engine.ts
   ```

   To use an engine you built yourself from reflow-tectonic, give the directory
   of its release files (their sha256s must be the ones in
   `engine/reflow-tectonic.json`):

   ```
   node scripts/fetch-engine.ts --from ../reflow-tectonic/reflow/dist/release
   ```

   Then the worker: `(cd engine && node scripts/build-worker.ts)`.

4. The page for development, and a local server:

   ```
   node scripts/seed.ts                       # build/seed/intro.json
   node scripts/w3-build.ts --assets          # app/lib/
   node tests/integration/serve.ts 8161       # then open http://127.0.0.1:8161/
   ```

   TeX files the document asks for come from Tectonic's online bundle, through
   the server, and are kept in a disk cache (`TECTONIC_CACHE`, see
   `engine/server/bundle.ts`).

5. A release:

   ```
   node scripts/build.ts
   ```

   It writes the single file and the multi-file release under `dist/`, with the
   introduction typeset in advance, and checks them in Chromium.

## Tests

`node scripts/typecheck.ts` checks the TypeScript (strict). Unit tests sit next
to their code (`*.test.ts`) and run with Node. `node tests/test-all.ts --list`
lists the suites; `node tests/test-all.ts --only unit` runs the unit suites, and
a browser suite runs on its own as `node tests/test-<name>.ts <dev server URL>`.

## Licence

ReflowEd is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version (AGPL-3.0-or-later). The full text is in [LICENSE](LICENSE). This covers
the introduction document in `samples/intro/` too. The source code is at
https://github.com/radek-p/reflowed.

Copyright © 2026 Radosław Piórkowski.

Third-party components keep their own licences; see
[THIRD-PARTY.md](THIRD-PARTY.md). A release lists every component it bundles,
with its licence, in its About box.
