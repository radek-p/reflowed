# ReflowEd – the site

The project's site (Hugo), published on GitHub Pages (`baseURL` in
`hugo.toml`). It is built like the ReflowTeX site (`params.reflowtexSite`),
with the same templates, and its prose is set through the reflowtex pipeline. Its home page is the intro document,
`samples/intro/source/main.tex`, with its figures, as it is at build time.

## Build

```sh
REFLOWTEX=<a checkout of reflowtex> ./build.sh          # -> public/
REFLOWTEX=… ./build.sh server --port 8152               # live preview
```

`build.sh` needs what the reflowtex pipeline needs (`lualatex`, `dvisvgm`,
`gs`, Node) and Hugo. It copies the Hugo integration's shortcode and viewer
partial and the companion package (the reading options) from the reflowtex
checkout, prepares the intro (`tools/prepare-intro.ts`: the notes package and the
.bbl), compiles every LaTeX block
with reflowtex's `integrations/hugo/prebuild.ts`, builds the site's scripts
from `browser/`, and runs Hugo. Everything it generates is git-ignored,
`public/` included.

Without `REFLOWTEX` it looks for `/reflowtex`, then for a `reflowtex/`
checkout in a directory above this repository.

## What's here

| Path | |
|---|---|
| `content/_index.md` | the home page: a short header, then the intro document |
| `content/docs/features/` | the feature pages (the sidebar's Features group) |
| `content/docs/reflowed/` | the first group of the sidebar: the home page and About |
| `content/about/` | licence, privacy, source and contact |
| `layouts/` | the ReflowTeX site's templates; `partials/head.html` holds the palette |
| `layouts/shortcodes/` | `open-editor` (the calls to action), `shot` (a screenshot), `siteurl` |
| `browser/` | the site's scripts, in TypeScript: the privacy note, the intro's `\todo` notes drawn as the editor draws them (`notes.ts`, on the viewer's public API; `prepare-intro.ts` adds `tex/rtx-notes.sty` to the intro's copy), the screenshots' rounded corners and shadow in typeset pictures (`shots.ts`), and the reference card: pointing at a cross-reference or a citation, or focusing it, shows its target typeset again, with a Back pill after a jump (`refcard.ts`, on the same API) |
| `latex-preambles/site.tex` | the preamble of every page's prose |
| `static/app/` | the editor, staged at build time (not in git): a release (`node scripts/build.ts`'s `dist/reflowtex-editor/`) and, beside it at `texlive/2022/`, the TeX Live tree it reads packages from (`texlive/README` says which packages and where their licences are) |
| `tools/stage-app.ts` | puts a release and its TeX Live tree into `static/app/`: `node tools/stage-app.ts <release dir> <tree dir>` |
| `static/icon.svg` | the ReIcon (from `app/src/chrome/wordmark/icon.svg`) |

The one deliberate difference from the ReflowTeX site is the accent colour:
the ReIcon's purple, `#a232c1`, with a lighter or deeper value per theme
(`layouts/partials/head.html`).

"Open ReflowEd" goes to `app/`, the editor published with the site. A release
and the TeX Live tree it reads packages from are staged into `static/app/`
before the site is built (`tools/stage-app.ts`; not in git); the release finds
the tree beside its page, at `texlive/2022/`. `build.sh` stops when
`static/app/index.html` is missing. Locally:

```sh
node scripts/fetch-engine.ts && node scripts/build.ts          # in the repository's root
node website/tools/stage-app.ts dist/reflowtex-editor build/resources/www/texlive/2022
```

## Deploy

`.github/workflows/website.yml` runs on every push to `main` (or by hand): it
builds the editor's release from the engine release `engine/reflow-tectonic.json`
names, stages it with its TeX Live tree, builds the site inside ReflowTeX's CI
image with a checkout of the reflowtex repository, and publishes `website/public`
to GitHub Pages. The repository's Pages source must be set to "GitHub Actions"
(Settings › Pages).
