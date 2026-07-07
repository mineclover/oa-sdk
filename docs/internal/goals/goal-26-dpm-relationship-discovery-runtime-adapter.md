# Goal 26 - DPM Relationship Discovery Runtime Adapter

**Status: complete 2026-07-07**

> Predecessor: [Goal 25 - DPM Discovery Gateway Candidate Contract](./goal-25-dpm-discovery-gateway-candidate-contract.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 25 exposed the full relationship discovery candidate contract through OpenAPI.
Goal 26 closes the runtime gap: documented relationship discovery requests must resolve into a
source-DB-free runtime path that creates schema-valid, non-executable discovery reports from loaded
catalog evidence.

This gives product/editor flows a practical API-to-runtime route for catalog-derived relationship
candidates before any relationship can be imported, reviewed, or promoted into a registry.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| catalog FK to relationship discovery candidate derivation | live source DB or Kafka access |
| manifest scope filtering for catalog-derived candidates | discovering relationships outside declared manifest scope |
| relationship discovery request resolver for catalog snapshot refs | registry mutation or approval |
| runtime discovery/import handlers exposed through `createDpmGatewayRuntime()` | physical foreign key creation |
| schema-valid runtime tests for discovery report and import count responses | inferring candidates from query logs or ORM metadata |

## Implementation Units

### DPM-46 - Relationship Discovery Runtime Adapter

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/discovery/catalog-relationship-candidates.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-relationship-request.ts`
- `packages/dpm/src/gateway/runtime-relationship-discover.ts`
- `packages/dpm/src/gateway/runtime-relationship-candidate-import.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/public/relationship-discovery.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/test/gateway-runtime-relationship-discovery.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- OpenAPI `discoverDpmRelationships` request bodies can be resolved through a catalog snapshot resolver into loaded runtime input.
- Runtime relationship discovery derives review-only candidates from catalog foreign-key evidence.
- Runtime relationship discovery only emits catalog-derived candidates whose parent and child tables are inside manifest scope when scope is present.
- Discovery reports remain `autoApproveEnabled: false`, candidates remain `executable: false`, and no approved registry status is emitted.
- Candidate import returns review/reject counts without writing or exporting registry rows.
- Public API index and feature-test matrix include the new discovery/runtime exports and tests.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-relationship-discovery.test.ts test/discovery-report.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- DPM relationship discovery has a practical OpenAPI-to-runtime path over loaded catalog evidence.
- The runtime remains non-mutating and source-DB-free.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
