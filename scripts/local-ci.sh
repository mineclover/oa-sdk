#!/bin/bash
# Full local verification gate.
#
# `.github/workflows/ci.yml` keeps only the essential GitHub lanes. This script is the superset:
# it also runs the maintenance/internal workspaces, schema validation/rollback, public runtime on
# Node 22/24/26, TS7, and NestJS/FastAPI governance. A green run is the merge/release gate while
# GitHub Actions billing is unresolved. It does not publish anything.
#
# Usage: pnpm ci:local
#   LOCAL_CI_TMP=<dir>       scratch directory (default: mktemp -d)
#   LOCAL_CI_KEEP=1          keep the log directory
set -u
cd "$(dirname "$0")/.."

TMP="${LOCAL_CI_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/oa-sdk-local-ci.XXXXXX")}"
mkdir -p "$TMP"
LOG="$TMP/local-ci.log"
PUBLIC_CONSUMER="$TMP/public-runtime"
: > "$LOG"
FAILED=()

run() {
  local name="$1"; shift
  echo "" | tee -a "$LOG"
  echo "=== [$(date +%H:%M:%S)] $name ===" | tee -a "$LOG"
  echo "+ $*" | tee -a "$LOG"
  local start end status
  start=$(date +%s)
  "$@" >>"$LOG" 2>&1
  status=$?
  end=$(date +%s)
  if [ "$status" -eq 0 ]; then
    echo "PASS ($((end - start))s) $name" | tee -a "$LOG"
  else
    echo "FAIL ($((end - start))s) $name" | tee -a "$LOG"
    FAILED+=("$name")
  fi
  return 0
}

# Run a command under a specific Node version when mise has it installed.
run_node() {
  local node_version="$1"; shift
  if command -v mise >/dev/null 2>&1 && mise ls node 2>/dev/null | grep -q "node  ${node_version}"; then
    run "$1 (Node $node_version)" mise exec "node@$node_version" -- "${@:2}"
  else
    echo "SKIP Node $node_version: not installed in mise" | tee -a "$LOG"
  fi
}

run "install (frozen lockfile)" pnpm install --frozen-lockfile
run "build:core" pnpm build:core
run "build:downstream" pnpm build:downstream
run "build:maintenance" pnpm build:maintenance
run "build:internal" pnpm build:internal
run "build:scripts" pnpm build:scripts
run "typecheck:core" pnpm typecheck:core
run "typecheck:downstream" pnpm typecheck:downstream
run "typecheck:maintenance" pnpm typecheck:maintenance
run "typecheck:internal" pnpm typecheck:internal
run "test:core:ci" pnpm test:core:ci
run "test:downstream:ci" pnpm test:downstream:ci
run "test:maintenance:ci" pnpm test:maintenance:ci
run "test:internal:ci" pnpm test:internal:ci
run "test:integration" pnpm test:integration
run "test:e2e:typespec-plugin" pnpm test:e2e:typespec-plugin

run "schema validate:spectral" pnpm --filter @oa-sdk/schemas run validate:spectral
run "schema validate:redocly" pnpm --filter @oa-sdk/schemas run validate:redocly
run "schema validate --require-32" node packages/codegen/dist/cli/index.js validate --spec packages/schemas/src/.merged.yaml --require-32
run "schema package test" pnpm --filter @oa-sdk/schemas run test
run "schema downstream-check" pnpm schema:downstream-check -- --spec packages/schemas/src/.merged.yaml --skip-build
run "schema freshness check-artifact" node packages/codegen/dist/cli/index.js check-artifact --head packages/schemas/src/.merged.3.1.yaml --artifact packages/schemas/dist/openapi.yaml
run "schema generated diff" git diff --exit-code packages/schemas/src/.merged.3.1.yaml packages/schemas/src/.merged.3.1.meta.json packages/schemas/src/.merged.upgraded.3.2.yaml
run "schema rollback tests" pnpm test:schema-rollback-check
run "schema rollback check" pnpm schema:rollback-check -- --typespec-report packages/schemas/src/.builder/typespec-bundle-report.json

run "api-index tests" pnpm test:api-index
run "check:api-index" pnpm check:api-index
run "check:cli-spec" pnpm check:cli-spec
run "check:codegen-boundaries" pnpm check:codegen-boundaries
run "type-registry:check" pnpm type-registry:check
run "browser-runtime-smoke" node apps/preview/scripts/browser-runtime-smoke.mjs
run "test:docs-gates" pnpm test:docs-gates
run "check:docs" pnpm check:docs
run "check:feature-tests" pnpm check:feature-tests
run "check:dpm-surface" pnpm check:dpm-surface
run "codegen smoke:pack" pnpm --filter @oa-sdk/codegen run smoke:pack
run "check:package-versions" pnpm check:package-versions
run "check:workspace-scope" pnpm check:workspace-scope

run "bench:parser (scale 2)" env BENCH_PARSER_BUDGET_SCALE=2 pnpm bench:parser

rm -rf "$PUBLIC_CONSUMER"
run "public-runtime prepare" node scripts/public-runtime-smoke.mjs prepare "$PUBLIC_CONSUMER"
run_node 22.23.1 "public-runtime verify" node scripts/public-runtime-smoke.mjs verify "$PUBLIC_CONSUMER" 22
run "public-runtime verify (Node 24, current)" node scripts/public-runtime-smoke.mjs verify "$PUBLIC_CONSUMER" 24
run_node 26.10.0 "public-runtime verify" node scripts/public-runtime-smoke.mjs verify "$PUBLIC_CONSUMER" 26

if command -v mise >/dev/null 2>&1 && mise ls node 2>/dev/null | grep -q "node  26.10.0"; then
  run "check:ts7 (Node 26)" mise exec node@26.10.0 -- pnpm check:ts7
else
  echo "SKIP check:ts7: Node 26 is not installed in mise" | tee -a "$LOG"
fi

run "nestjs governance" env OA_GEN="node ../../packages/codegen/dist/cli/index.js" bash -c 'cd apps/nestjs-ref && bash scripts/openapi-governance.sh ci'
run "fastapi governance" bash -c 'cd apps/fastapi-ref && command -v uv >/dev/null && uv sync && bash scripts/openapi-governance.sh ci'

echo "" | tee -a "$LOG"
echo "================ SUMMARY ================" | tee -a "$LOG"
echo "log: $LOG" | tee -a "$LOG"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "LOCAL CI: ALL PASS" | tee -a "$LOG"
  [ "${LOCAL_CI_KEEP:-0}" = "1" ] || rm -rf "$TMP"
  exit 0
fi
echo "LOCAL CI: FAILURES (${#FAILED[@]})" | tee -a "$LOG"
printf ' - %s\n' "${FAILED[@]}" | tee -a "$LOG"
exit 1
