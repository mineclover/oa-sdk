#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'USAGE'
Effect TSGO + OA SDK standalone Docker tests.
  bash scripts/run-docker.sh bootstrap   Create package-lock.json once from the declared package versions.
  bash scripts/run-docker.sh verify      npm ci, diagnostic contract tests, full OA/Effect integration review.
  bash scripts/run-docker.sh contracts   Run only the pure Node diagnostic-contract tests (no npm install).
  bash scripts/run-docker.sh image       Show image reference/id; use docker image inspect for full digests.
  bash scripts/run-docker.sh help        Print this guide.
The shell runner never modifies OA SDK root pnpm files or root CI.
USAGE
}

case "${1:-help}" in
  help|-h|--help) usage; exit 0 ;;
  bootstrap|verify|contracts|image) ;;
  *) usage >&2; echo "Unsupported mode: $1" >&2; exit 2 ;;
esac
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI missing; install Docker Engine/Desktop with Compose v2." >&2
  exit 2
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 unavailable." >&2
  exit 2
fi

mode="$1"
if [[ "$mode" == "image" ]]; then
  docker compose images
  exit
fi

# Resolve the moving tag once and use the exact same digest for the build.
# A tag name alone cannot prove which compiler runtime was used.
docker pull node:26-bookworm >/dev/null
image_digest="$(docker image inspect node:26-bookworm --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep -m1 '@sha256:' || true)"
if [[ ! "$image_digest" =~ ^[a-zA-Z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "REFUSED: no verified registry manifest digest for node:26-bookworm." >&2
  exit 2
fi
export OA_EFFECT_NODE_IMAGE_DIGEST="$image_digest"
mkdir -p .reports
printf '{"schema":"oa-effect-docker-image/v1","baseTag":"node:26-bookworm","baseDigest":"%s","recordedAtUtc":"%s"}\\n' \
  "$image_digest" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > .reports/docker-base-image.json
printf 'Node base image: %s\\n' "$image_digest" >&2
docker compose build --pull test
if [[ "$mode" == "bootstrap" ]]; then
  if [[ -e package-lock.json ]]; then
    echo "package-lock.json already exists: refusing implicit lock regeneration." >&2
    echo "Review changes explicitly and use 'verify' for frozen installs." >&2
    exit 2
  fi
  docker compose run --rm test npm install --package-lock-only --ignore-scripts --no-audit --no-fund
  if [[ ! -s package-lock.json ]]; then
    echo "Lockfile was not produced; bootstrap failed." >&2
    exit 1
  fi
  echo "Lockfile generated. Review and commit package-lock.json before promotion." >&2
elif [[ "$mode" == "contracts" ]]; then
  docker compose run --rm test node --test test/diagnostics-contract.test.mjs
else
  if [[ ! -s package-lock.json ]]; then
    echo "No package-lock.json: run 'bootstrap' first." >&2
    exit 2
  fi
  docker compose run --rm test
fi
