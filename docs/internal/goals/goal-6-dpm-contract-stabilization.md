# Goal 6 - DPM Contract Stabilization

**Status: active 2026-07-04**

> Predecessor: [Goal 5 - DPM Runtime/Storage Integration](./goal-5-dpm-runtime-storage-integration.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
> Product PRD: [Relationship-First Data Pseudonymization Manifest](../../../tasks/prd-data-pseudonymization-manifest.md)

## Purpose

Goal 4 and Goal 5 introduced the relationship-first DPM package, runtime adapter, storage-backed
demo, and gateway OpenAPI artifact. Goal 6 hardens the implementation/spec boundary so that the
published contract rejects incomplete payloads, matches actual runtime/storage outputs, and remains
safe for downstream tooling such as editors, visualizers, API clients, and automated analyzers.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| OpenAPI component schemas for gateway requests/responses | production HTTP server |
| runtime/CLI payload parity and schema validation | tokenization engine execution |
| storage-backed report output validation against gateway schemas | production vault storage |
| regression tests for incomplete or information-empty payloads | automatic relationship approval |
| progress index alignment for the active contract-stabilization goal | broad DPM feature expansion |

## Execution Principles

1. Code and tests are the source of truth for implemented contracts.
2. `DpmManifestPolicy` remains intentionally opaque; every other gateway component must reject `{}`.
3. Runtime payloads must validate against the OpenAPI components they claim to implement.
4. Storage projections that are described as gateway-compatible must be validated by the gateway schema.
5. Tightening a schema must preserve actual runtime/storage output compatibility.

## Implementation Units

### DPM-16 - Gateway Component Requiredness

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway.test.ts`

Tasks:
- Reject empty objects for every non-opaque gateway component schema.
- Keep `DpmManifestPolicy` opaque and explicitly documented by test.
- Add minimal valid request/response examples for gateway workflow schemas.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-17 - Runtime Nested Object Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-runtime.test.ts`

Tasks:
- Require all dry-run impact counters when `DpmDryRunResult.impact` is present.
- Reject empty diagnostic coordinate objects while preserving partial informative coordinates.
- Keep runtime compile and dry-run outputs schema-valid.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-18 - Storage Report Gateway Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway.test.ts`
- `packages/dpm/test/storage-report.test.ts`

Tasks:
- Align `DpmJobReport.status` with persisted validation report lifecycle statuses.
- Reject pre-report job statuses such as `accepted` from `DpmJobReport`.
- Validate storage-backed gateway job report outputs against the OpenAPI `DpmJobReport` schema.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-report.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

## Verification Ladder

| Stage | Gate |
|---|---|
| focused contract | targeted vitest file for changed gateway/storage behavior |
| package confidence | `pnpm --filter @oa-sdk/dpm test`, `typecheck`, `build` |
| repo integration | `build:scripts`, `check:api-index`, `check:cli-spec`, `check:feature-tests`, `check:release-policy`, `git diff --check` |

## Done Criteria

- All implemented gateway request/response components either reject `{}` or are explicitly marked opaque.
- Runtime compile/dry-run outputs validate against gateway OpenAPI schemas.
- Storage-backed job report outputs validate against gateway OpenAPI schemas.
- The progress index points to the next unchecked stabilization unit or marks this goal complete only after all listed gates pass.
