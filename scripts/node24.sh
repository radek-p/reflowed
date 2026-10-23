#!/bin/sh
# Node 24 (it runs TypeScript by stripping the types) for the LuaLaTeX images, whose own Node
# cannot: the Playwright image's /usr/bin/node, copied to build/node24 (gitignored).
# Mount it into a container, e.g.
#   -v "$(scripts/node24.sh)":/usr/local/bin/node24:ro
#   scripts/node24.sh        prints the path; copies the binary first when it is missing
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$ROOT/build/node24
IMG=${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.58.0-noble}
if [ ! -x "$OUT" ]; then
  mkdir -p "$ROOT/build"
  id=$(docker create "$IMG")
  docker cp "$id:/usr/bin/node" "$OUT" >/dev/null
  docker rm "$id" >/dev/null
fi
echo "$OUT"
