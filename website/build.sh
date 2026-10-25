#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build (or serve) the ReflowEd site.
#
#   ./build.sh            # compile the LaTeX blocks + `hugo` -> public/
#   ./build.sh server     # …then `hugo server` for live preview
#
# The site is set by the public reflowtex pipeline, as the reflowtex site is: its
# Hugo integration (the shortcode, the viewer partial, the prebuild) and its
# companion package (the reading options) come from a checkout of the public
# reflowtex repository, named by REFLOWTEX (else /reflowtex, else a
# reflowtex/ checkout in a directory above this one). Nothing it copies or
# generates is kept in git (see .gitignore).
set -euo pipefail

SITE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SITE/.." && pwd)"                   # this repository
INTRO="$REPO/samples/intro/source"               # the intro document, shown on the home page

# "Open ReflowEd" goes to the editor published with the site, at app/
# (hugo.toml's appURL): a release and its TeX Live tree in static/app/,
# put there by tools/stage-app.ts. Without it the link would be dead.
if [ ! -f "$SITE/static/app/index.html" ]; then
  echo "build.sh: static/app/index.html is missing: the editor is not in the site." >&2
  echo "          Put a release and its TeX tree there: node tools/stage-app.ts <release dir> <tree dir>" >&2
  exit 1
fi

is_checkout() { [ -d "$1/integrations/hugo" ] && [ -d "$1/src/viewer" ]; }
if [ -z "${REFLOWTEX:-}" ]; then
  if is_checkout /reflowtex; then REFLOWTEX=/reflowtex
  else
    d="$REPO"
    while [ "$d" != "/" ]; do
      if is_checkout "$d/reflowtex"; then REFLOWTEX="$d/reflowtex"; break; fi
      d="$(dirname "$d")"
    done
  fi
fi
if [ -z "${REFLOWTEX:-}" ] || ! is_checkout "$REFLOWTEX"; then
  echo "build.sh: set REFLOWTEX to a checkout of https://github.com/radek-p/reflowtex" >&2
  exit 1
fi
REFLOWTEX="$(cd "$REFLOWTEX" && pwd)"
HUGO_INT="$REFLOWTEX/integrations/hugo"
echo "build.sh: reflowtex from $REFLOWTEX ($(git -C "$REFLOWTEX" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout'))"
# the commit the editor is built with (reflowtex.lock.json): another one is said, not refused (a preview of the site)
LOCKED="$(sed -n 's/^ *"commit": *"\([0-9a-f]\{40\}\)".*/\1/p' "$REPO/reflowtex.lock.json")"
AT="$(git -c safe.directory="$REFLOWTEX" -C "$REFLOWTEX" rev-parse HEAD 2>/dev/null || true)"
if [ "$AT" != "$LOCKED" ]; then
  echo "build.sh: note: reflowtex is at ${AT:-an unknown commit}, not at ${LOCKED:-?}, the commit reflowtex.lock.json names" >&2
fi

# The pipeline runs on Node, straight from reflowtex's TypeScript sources; its
# dependencies are installed into that checkout's node_modules on first use.
if [ ! -d "$REFLOWTEX/node_modules" ] || [ "$REFLOWTEX/package-lock.json" -nt "$REFLOWTEX/node_modules/.package-lock.json" ]; then
  (cd "$REFLOWTEX" && npm ci --no-audit --no-fund)
fi

# 1. The shortcode and the viewer partial, from the Hugo integration.
mkdir -p "$SITE/layouts/shortcodes" "$SITE/layouts/partials" "$SITE/data"
cp "$HUGO_INT/layouts/shortcodes/latex.html"          "$SITE/layouts/shortcodes/latex.html"
cp "$HUGO_INT/layouts/partials/reflowtex-viewer.html" "$SITE/layouts/partials/reflowtex-viewer.html"
#    The browser's scripts (the viewer, the companion), built from their
#    TypeScript when missing or stale.
node "$REFLOWTEX/scripts/build-bundles.ts"
#    The companion package's browser side, with the Preact it is written in,
#    in a folder named by a hash of its files (a new version is new URLs).
#    Pages import it by name, from an import map (layouts/partials/companion.html).
COMPANION_V="$(cat "$REFLOWTEX/src/companion/companion.js" "$REFLOWTEX/src/companion/companion.css" \
                   "$REFLOWTEX/src/inspector/vendor/preact.js" | shasum -a 256 | cut -c1-10)"
rm -rf "$SITE/static/companion"
mkdir -p "$SITE/static/companion/$COMPANION_V"
cp "$REFLOWTEX/src/companion/companion.js" "$REFLOWTEX/src/companion/companion.css" \
   "$REFLOWTEX/src/inspector/vendor/preact.js" "$SITE/static/companion/$COMPANION_V/"
printf '{"dir": "companion/%s"}\n' "$COMPANION_V" > "$SITE/data/companion.json"

# 2. The intro document, as it is in samples/intro/ now: a copy with the
#    editor's notes package and its bibliography's .bbl (tools/prepare-intro.ts),
#    and its figures for the feature pages.
node "$SITE/tools/prepare-intro.ts" "$INTRO" "$SITE/.reflowtex-build/intro-src" "$SITE/static/images/intro"

# 3. Compile every LaTeX block, embed the schema, provision the fonts.
#    PREBUILD_ARGS passes extra flags (e.g. --force, --prune, -j 8).
# shellcheck disable=SC2086
node "$HUGO_INT/prebuild.ts" "$SITE" --demos-dir "$SITE/.reflowtex-build/intro-src" ${PREBUILD_ARGS:-}

# 4. The site's own scripts (browser/): the note on what it keeps in the
#    browser, the intro's \todo notes, the reference card and the screenshots'
#    corners and shadow.
for s in privacy-notice notes refcard shots; do
  "$REFLOWTEX/node_modules/.bin/esbuild" "$SITE/browser/$s.ts" --charset=utf8 --legal-comments=none \
      --log-level=warning --outfile="$SITE/static/$s.js"
done

# 5. Build (or serve) the static site.
if [ "${1:-}" = "server" ]; then
  shift
  exec hugo server --source "$SITE" "$@"
fi
exec hugo --source "$SITE" --minify "$@"
