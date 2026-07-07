# Goal 23 - DPM Gateway Blocking Response Contract

**Status: complete 2026-07-07**

> Predecessor: [Goal 22 - DPM Pack Boundary Smoke](./goal-22-dpm-pack-boundary-smoke.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 22 closed the DPM package artifact boundary. Goal 23 closes the gateway failure-contract gap:
runtime handlers already return structured 400 responses for blocking manifest diagnostics and proposal
review mismatches, so the OpenAPI gateway must document those responses for generated clients and
product routers.

The same stabilization promotes the DPM package surface smokes to a root CI gate and fixes Turbo's
test cache inputs so DPM `test/**` changes participate in cached test invalidation.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| OpenAPI 400 response schemas for runtime blocking paths | introducing a new generic error envelope |
| contract test that compares documented 400 schemas with runtime results | changing runtime status-code semantics |
| root `check:dpm-surface` script and CI step | publishing the private package |
| Turbo `test/**` input coverage | changing every package's test layout |

## Implementation Units

### DPM-43 - Gateway Blocking Response Contract

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/openapi-operation.ts`
- `packages/dpm/src/gateway/openapi-manifest-paths.ts`
- `packages/dpm/src/gateway/openapi-profile-paths.ts`
- `packages/dpm/test/gateway-blocking-response-contract.test.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `turbo.json`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Manifest validate and compile document 400 responses with their existing result schemas.
- Manifest dry-run documents 400 responses as `DpmCompileResult`, matching runtime compile-blocking output.
- Profile proposal review documents 400 responses as `DpmProfileProposalReviewResponse`.
- Contract tests validate both the OpenAPI response refs and representative runtime 400 payloads.
- Root `pnpm check:dpm-surface` runs DPM subpath and pack smokes, and CI runs that root gate.
- Turbo test cache inputs include package-local `test/**` files.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-blocking-response-contract.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm check:dpm-surface`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- DPM gateway clients can discover structured 400 response schemas for blocking manifest and proposal-review outcomes.
- DPM package surface smokes are available as a root CI gate.
- API/spec docs, feature-test matrix, progress index, and Turbo cache inputs match the implemented behavior.
