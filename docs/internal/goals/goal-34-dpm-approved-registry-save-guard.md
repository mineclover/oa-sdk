# Goal 34 - DPM Approved Registry Save Guard

**Status: complete 2026-07-07**

> Predecessor: [Goal 33 - DPM Profile Analysis Policy Contract](./goal-33-dpm-profile-analysis-policy-contract.md)\
> Related persistence bridge: [Goal 32 - DPM Registry Approval Persistence Bridge](./goal-32-dpm-registry-approval-persistence-bridge.md)

## Purpose

Goal 32 added the persistence bridge from an approved relationship payload to a registry storage row, but the
save input still accepted the broader `RegistryRelationshipInput`. That left a mismatch between the intended
approval persistence path and what the writable repository could receive.

Goal 34 closes that boundary: `saveRelationship()` is now an approved-only write contract. Registry row export
still supports non-executable history rows, but the consumer write bridge rejects non-approved payloads before
adapter mutation.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| approved relationship input type | deleting rejected/proposed registry history |
| approved-only `DpmRegistryRelationshipSaveInput` | automatic approval |
| runtime guard for JS/cast consumers | database adapter implementation |
| gateway approval result narrowing | registry authorization/concurrency |
| storage repository tests and public type smoke | physical FK creation |
| API index, feature matrix, spec, progress updates | manifest policy body changes |

## Implementation Units

### DPM-54 - Approved Registry Save Guard

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/registry/registry-relationship-record-types.ts`
- `packages/dpm/src/registry/registry-relationship-types.ts`
- `packages/dpm/src/registry/types.ts`
- `packages/dpm/src/public/relationship-registry.ts`
- `packages/dpm/src/storage/registry-repository-request-types.ts`
- `packages/dpm/src/storage/registry-row-relationship.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-relationship-approve.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `ApprovedRegistryRelationshipInput` narrows registry relationship input to `status: "approved"`.
- `DpmRegistryRelationshipSaveInput.relationship` accepts only approved relationship payloads at the TypeScript boundary.
- `createDpmRegistryRelationshipRow()` rejects non-approved payloads at runtime before storage adapter mutation.
- Gateway approval result exposes an approved relationship payload that can flow directly into `saveRelationship()`.
- Registry snapshot export continues to read and report non-executable history rows.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts test/gateway-runtime-relationship-approval.test.ts test/gateway-consumer-smoke.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers cannot accidentally use the approval persistence bridge for rejected, proposed, deprecated, or superseded relationship payloads.
- Non-executable registry history remains readable through storage row export.
- Public type exports, docs, and feature-test matrix match the implemented approved-only write boundary.
