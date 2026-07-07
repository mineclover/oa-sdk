# Goal 27 - DPM Relationship Approval Runtime Adapter

**Status: complete 2026-07-07**

> Predecessor: [Goal 26 - DPM Relationship Discovery Runtime Adapter](./goal-26-dpm-relationship-discovery-runtime-adapter.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 26 made relationship discovery reachable through the local gateway runtime.
Goal 27 closes the next review-loop gap: a reviewable discovery candidate can be converted into an
approved registry relationship payload without mutating storage or auto-approving candidates.

This gives product/editor flows a deterministic approval handoff artifact that can be reviewed,
stored, or exported by a separate registry repository step.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| approval request schema with candidate and registry policy fields | writing registry rows |
| non-mutating runtime approval response with approved registry relationship payload | automatic approval during discovery |
| registry snapshot compatibility proof for the approved payload | source DB/Kafka access |
| public gateway runtime exports and feature matrix/API index updates | physical FK creation |

## Implementation Units

### DPM-47 - Relationship Approval Runtime Adapter

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/openapi-relationship-approval-schemas.ts`
- `packages/dpm/src/gateway/runtime-relationship-approve.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/test/gateway-runtime-relationship-approval.test.ts`
- `packages/dpm/test/support/gateway-request-minimal-fixtures.ts`
- `packages/dpm/test/support/gateway-workflow-response-relationship-fixtures.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Gateway approval request schema requires the reviewable candidate plus registry policy fields needed for an approved relationship.
- Runtime approval returns a schema-valid approved registry relationship payload.
- The returned relationship can be passed to `createRegistrySnapshot()` and becomes executable only through the explicit approved status.
- Runtime approval does not write registry rows or change the discovery candidate.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-relationship-approval.test.ts test/gateway-runtime.test.ts test/gateway-schema-requests.test.ts test/gateway-schema-response-minimal.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- DPM relationship approval has a practical runtime handoff from reviewable candidate to approved registry relationship payload.
- The runtime remains non-mutating and source-DB-free.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
