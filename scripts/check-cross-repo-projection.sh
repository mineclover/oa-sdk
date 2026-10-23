#!/usr/bin/env bash
# Cross-repo projection gate for the read-only references/bun-graph-db submodule.
#
# The parent CI checkout uses `submodules: false`, so this is a separate manual gate. It fails when
# the pinned submodule commit is not on the submodule's origin/main, which keeps the parent pin
# reproducible from a fresh clone.
set -euo pipefail
cd "$(dirname "$0")/.."

submodule="references/bun-graph-db"

if [ ! -e "$submodule/.git" ]; then
  echo "missing submodule checkout: $submodule (run git submodule update --init $submodule)" >&2
  exit 1
fi

if ! git -C "$submodule" merge-base --is-ancestor HEAD origin/main; then
  head_sha=$(git -C "$submodule" rev-parse --short HEAD)
  echo "submodule HEAD $head_sha is not on origin/main; repin to a pushed commit before verifying" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for the cross-repo projection gate" >&2
  exit 1
fi

echo "==> bun-graph-db typecheck"
(
  cd "$submodule"
  bun run typecheck
)

echo "==> bun-graph-db focused projection tests"
(
  cd "$submodule"
  bun test \
    tests/unit/mcp-openapi-projection-tool-handler.test.ts \
    tests/integration/mcp-table-projection-tools-list.test.ts \
    tests/integration/projection-graphql-mcp-smoke.test.ts
)
