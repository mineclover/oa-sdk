# Goal 6 - DPM Contract Stabilization

**Status: complete 2026-07-04**

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
- `packages/dpm/test/gateway-schema-validation.test.ts`

Tasks:
- Reject empty objects for every non-opaque gateway component schema.
- Keep `DpmManifestPolicy` opaque and explicitly documented by test.
- Add minimal valid request/response examples for gateway workflow schemas.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts test/gateway-schema-validation.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-17 - Runtime Nested Object Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-runtime-manifest.test.ts`

Tasks:
- Require all dry-run impact counters when `DpmDryRunResult.impact` is present.
- Reject empty diagnostic coordinate objects while preserving partial informative coordinates.
- Keep runtime compile and dry-run outputs schema-valid.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-manifest.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-18 - Storage Report Gateway Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-schema-validation.test.ts`
- `packages/dpm/test/storage-report.test.ts`

Tasks:
- Align `DpmJobReport.status` with persisted validation report lifecycle statuses.
- Reject pre-report job statuses such as `accepted` from `DpmJobReport`.
- Validate storage-backed gateway job report outputs against the OpenAPI `DpmJobReport` schema.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-schema-validation.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-report.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-19 - Diagnostic Code Taxonomy Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/validator/diagnostics.ts`
- `packages/dpm/src/validator/diagnostic-types.ts`
- `packages/dpm/src/validator/diagnostic-taxonomy.ts`
- `packages/dpm/src/validator/diagnostic-coordinate-types.ts`
- `packages/dpm/src/validator/diagnostic-result-types.ts`
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-runtime-manifest.test.ts`

Tasks:
- Promote the SYN/REL/SAF diagnostic code taxonomy to a runtime constant.
- Derive `DpmDiagnosticCode` from the same runtime taxonomy used by OpenAPI.
- Reject unknown diagnostic codes from the gateway `DpmDiagnostic` schema.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-manifest.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-20 - Compiled Plan Taxonomy Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/compiler/plan.ts`
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-runtime-manifest.test.ts`

Tasks:
- Promote compiled plan versions and stale reasons to runtime constants.
- Derive `DpmCompiledPlanVersion` and `DpmPlanStaleReason` from the same runtime taxonomies used by OpenAPI.
- Reject unknown plan versions and stale reasons from the gateway `DpmCompiledPlan` schema.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-manifest.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-21 - Workflow Response Taxonomy Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/discovery/types.ts`
- `packages/dpm/src/discovery/discovery-taxonomy.ts`
- `packages/dpm/src/registry/types.ts`
- `packages/dpm/src/registry/registry-taxonomy.ts`
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-taxonomy.test.ts`
- `packages/dpm/test/gateway-schema-validation.test.ts`

Tasks:
- Promote discovery candidate recommendations and registry lifecycle statuses to runtime constants.
- Derive TypeScript taxonomy types from the same runtime constants used by OpenAPI.
- Reject unknown recommendation/status values from workflow response schemas.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-taxonomy.test.ts test/gateway-schema-validation.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-22 - Relationship Step Taxonomy Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/compiler/plan.ts`
- `packages/dpm/src/registry/types.ts`
- `packages/dpm/src/registry/registry-taxonomy.ts`
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway-runtime-manifest.test.ts`
- `packages/dpm/test/gateway-taxonomy.test.ts`

Tasks:
- Promote relationship step cardinalities and registry orphan policies to runtime constants.
- Derive compiled relationship step TypeScript fields from registry and plan taxonomies.
- Reject unknown relationship type, cardinality, transform strategy, and orphan policy values from the gateway `DpmRelationshipStep` schema.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-manifest.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-taxonomy.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

## Verification Ladder

| Stage | Gate |
|---|---|
| focused contract | targeted vitest file for changed gateway/storage behavior |
| package confidence | `pnpm --filter @oa-sdk/dpm test`, `typecheck`, `build` |
| repo integration | `build:scripts`, `check:api-index`, `check:cli-spec`, `check:feature-tests`, `check:release-policy`, `git diff --check` |

## Completion Evidence

Completed on 2026-07-04 after DPM-16 through DPM-22 passed their focused
contract tests, the DPM package test/typecheck/build gates, and the repo
integration checks listed in the verification ladder.

## Done Criteria

- All implemented gateway request/response components either reject `{}` or are explicitly marked opaque.
- Runtime compile/dry-run outputs validate against gateway OpenAPI schemas.
- Storage-backed job report outputs validate against gateway OpenAPI schemas.
- The progress index points to the next unchecked stabilization unit or marks this goal complete only after all listed gates pass.
