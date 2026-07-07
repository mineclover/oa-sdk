# Goal 50 - DPM Registry Split Append Audit Return

**Status: complete 2026-07-08**

> Predecessor: [Goal 45 - DPM Registry Write Receipt Audit Link](./goal-45-dpm-registry-write-receipt-audit-link.md), [Goal 46 - DPM Postgres Registry Storage Adapter](./goal-46-dpm-postgres-registry-storage-adapter.md)

## Purpose

Goal 45 linked profile hint approval write receipts to persisted approval audit events, and Goal 46 added the concrete Postgres registry adapter. The atomic commit path already returned the stored audit row, but the split append adapter contract could only return `void`, so repository save results could not prefer a storage-confirmed audit row when a non-atomic adapter had one.

Goal 50 lets split append adapters return the saved audit row while keeping existing `void` append adapters compatible.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| allow split `appendRelationshipAuditEvent()` to return a saved audit event row | requiring all adapters to return a row |
| prefer the adapter-returned audit row in `saveRelationshipWithAuditEvent()` | removing the atomic `commitRelationshipApproval()` path |
| return the Postgres adapter's inserted audit row through the wrapper | changing registry table schema |
| focused repository/Postgres/gateway tests and docs | live database integration test |

## Implementation Units

### DPM-70 - Split Append Audit Return

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/storage/registry-postgres-storage.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `docs/internal/spec.md`

Acceptance:
- Split append adapters may return `DpmRegistryRelationshipAuditEventRow`.
- Existing `void` append adapters remain compatible.
- Repository save results prefer the adapter-returned audit row when present.
- The Postgres registry storage wrapper returns the inserted audit event row from its append helper.
- Tests prove adapter-confirmed audit event ids override request-generated ids in the save result.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts test/storage-registry-postgres.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `git diff --check`

## Done Criteria

- Product/editor consumers can receive a storage-confirmed approval audit event from both atomic commit adapters and row-returning split append adapters.
- Existing split append adapters that return `void` keep their current behavior.
