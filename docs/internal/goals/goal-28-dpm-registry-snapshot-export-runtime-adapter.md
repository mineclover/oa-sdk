# Goal 28 - DPM Registry Snapshot Export Runtime Adapter

**Status: complete 2026-07-07**

> Predecessor: [Goal 27 - DPM Relationship Approval Runtime Adapter](./goal-27-dpm-relationship-approval-runtime-adapter.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 27 made relationship approval available as a non-mutating runtime handoff.
Goal 28 closes the next readback gap: a product/editor flow can export the current
relationship registry snapshot through the local gateway runtime without source DB/Kafka access
or registry mutation.

This gives UI, visualization, and automated analysis surfaces a schema-valid snapshot that includes
the full registry summary, approved relationships, and non-executable relationships.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| repository-backed `exportDpmRegistrySnapshot` runtime handler | writing or updating registry rows |
| full `DpmRegistrySnapshotResponse` gateway schema | live source DB/Kafka access |
| runtime operation taxonomy/factory/public exports | vault/reverse token lookup |
| defensive response-boundary registry snapshot normalization | execute-job/report retrieval APIs |
| feature matrix/API index/spec/progress updates | physical FK creation |

## Implementation Units

### DPM-48 - Registry Snapshot Export Runtime Adapter

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-relationship-registry-export.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/openapi-relationship-registry-schemas.ts`
- `packages/dpm/src/gateway/runtime-operation-ids.ts`
- `packages/dpm/src/gateway/runtime-response-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/src/registry/registry-normalize.ts`
- `packages/dpm/src/registry/registry-relationship-copy.ts`
- `packages/dpm/src/storage/registry-row-relationship.ts`
- `packages/dpm/test/gateway-runtime-relationship-registry-export.test.ts`
- `packages/dpm/test/support/gateway-runtime-fixtures.ts`
- `packages/dpm/test/support/gateway-workflow-response-relationship-fixtures.ts`
- `packages/dpm/test/support/gateway-taxonomy-workflow-fixtures.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Gateway runtime exposes `exportDpmRegistrySnapshot`.
- Runtime export calls a consumer-supplied `DpmRegistryRepository` by dataset id and registry version.
- Runtime export returns a schema-valid full registry snapshot response with summary, approved relationships, and non-executable relationships.
- Runtime export re-normalizes repository snapshots at the response boundary and does not mutate registry storage.
- OpenAPI registry snapshot schema matches the actual `RegistrySnapshot` runtime shape.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-relationship-registry-export.test.ts test/gateway-runtime.test.ts test/gateway-schema-response-minimal.test.ts test/gateway-taxonomy-workflow.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- DPM registry snapshot export has a practical runtime readback path from repository storage to schema-valid gateway response.
- The runtime remains non-mutating and source-DB-free.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
