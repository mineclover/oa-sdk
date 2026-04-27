#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
if [[ -n "${OA_GEN:-}" ]]; then
  # shellcheck disable=SC2206
  OA_GEN_CMD=(${OA_GEN})
else
  OA_GEN_CMD=(node "$REPO_ROOT/packages/codegen/dist/cli/index.js")
fi

RAW="$APP_DIR/contracts/openapi.raw.yaml"
NORMALIZED="$APP_DIR/contracts/openapi.normalized.yaml"
UPGRADED="$APP_DIR/contracts/openapi.upgraded.yaml"
BASELINE="$APP_DIR/contracts/v1.openapi.yaml"
COLLECT_REPORT="$APP_DIR/contracts/openapi.collect-report.json"
TYPEGEN="$APP_DIR/src/generated/api-types.ts"
RUNTIME_OPENAPI_URL="http://localhost:3000/openapi.json"

source_openapi() {
  (cd "$APP_DIR" && pnpm export:openapi)
}

collect_openapi() {
  source_openapi
  "${OA_GEN_CMD[@]}" collect \
    --spec "$RAW" \
    --normalized "$NORMALIZED" \
    --upgraded "$UPGRADED" \
    --report "$COLLECT_REPORT" \
    --profile nestjs-swagger
}

case "${1:-all}" in
  collect)
    collect_openapi
    ;;
  check)
    collect_openapi
    "${OA_GEN_CMD[@]}" check-artifact --head "$NORMALIZED" --artifact "$BASELINE" --format human
    ;;
  review)
    collect_openapi
    "${OA_GEN_CMD[@]}" review --base "$BASELINE" --head "$NORMALIZED" --artifact "$BASELINE" --format markdown
    ;;
  typegen)
    collect_openapi
    mkdir -p "$(dirname "$TYPEGEN")"
    "${OA_GEN_CMD[@]}" typegen --spec "$NORMALIZED" --output "$TYPEGEN"
    ;;
  inventory)
    collect_openapi
    "${OA_GEN_CMD[@]}" inventory --spec "$UPGRADED" --format markdown
    ;;
  validate-upgraded)
    collect_openapi
    "${OA_GEN_CMD[@]}" validate --spec "$UPGRADED"
    ;;
  drift)
    collect_openapi
    test -n "$RUNTIME_OPENAPI_URL" || { echo "runtimeOpenApiUrl is not configured"; exit 1; }
    "${OA_GEN_CMD[@]}" drift --runtime-openapi-url "$RUNTIME_OPENAPI_URL" --managed-openapi "$NORMALIZED" --format markdown
    ;;
  update-baseline)
    collect_openapi
    cp "$NORMALIZED" "$BASELINE"
    echo "baseline updated: $BASELINE"
    ;;
  all)
    collect_openapi
    "${OA_GEN_CMD[@]}" check-artifact --head "$NORMALIZED" --artifact "$BASELINE" --format human
    "${OA_GEN_CMD[@]}" review --base "$BASELINE" --head "$NORMALIZED" --artifact "$BASELINE" --format markdown
    mkdir -p "$(dirname "$TYPEGEN")"
    "${OA_GEN_CMD[@]}" typegen --spec "$NORMALIZED" --output "$TYPEGEN"
    "${OA_GEN_CMD[@]}" validate --spec "$UPGRADED"
    ;;
  *)
    echo "usage: $0 [collect|check|review|typegen|inventory|validate-upgraded|drift|update-baseline|all]"
    exit 1
    ;;
esac
