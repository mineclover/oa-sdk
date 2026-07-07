# Goal 29 - DPM Candidate Import Review Report Runtime

**Status: complete 2026-07-07**

> Predecessor: [Goal 28 - DPM Registry Snapshot Export Runtime Adapter](./goal-28-dpm-registry-snapshot-export-runtime-adapter.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 28 made registry snapshot readback available through the local gateway runtime.
Goal 29 closes the candidate review handoff gap: importing candidates now returns the normalized
non-executable review report, not only review/reject counts.

This gives editor, visualization, and automated analysis flows concrete candidates, exclusions,
warnings, thresholds, and summary counts to continue into approval without registry mutation.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| richer `DpmCandidateImportResponse` with normalized report | writing registry rows |
| optional import `generatedAt`, `thresholds`, and `exclusions` preservation | automatic candidate approval |
| runtime result type and schema alignment | source DB/Kafka access |
| focused gateway runtime/schema tests | physical FK creation |
| feature matrix/API index/spec/progress updates | vault/reverse token lookup |

## Implementation Units

### DPM-49 - Candidate Import Review Report Runtime

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/openapi-relationship-candidate-import-schemas.ts`
- `packages/dpm/src/gateway/runtime-relationship-candidate-import.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/test/gateway-runtime-relationship-discovery.test.ts`
- `packages/dpm/test/support/gateway-workflow-response-relationship-fixtures.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Candidate import request accepts full candidate input plus optional generated time, thresholds, and exclusions.
- Candidate import response preserves review/reject counts and returns the normalized `RelationshipDiscoveryReport`.
- Imported candidates remain non-executable and never gain approved registry status.
- Candidate import remains non-mutating and source-DB-free.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-relationship-discovery.test.ts test/gateway-schema-response-minimal.test.ts test/gateway-schema-requests.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- DPM candidate import has a practical runtime handoff from imported candidate inputs to normalized review report.
- The runtime remains non-mutating and source-DB-free.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
