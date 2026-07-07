# Goal 44 - DPM Registry Approval Commit Hook

**Status: complete 2026-07-07**

> Predecessor: [Goal 40 - DPM Registry Approval Audit Events](./goal-40-dpm-registry-approval-audit-events.md), [Goal 43 - DPM Registry Write Receipt Gateway Boundary](./goal-43-dpm-registry-write-receipt-gateway-boundary.md)

## Purpose

Goal 40 added optional approval audit event append support, but the repository still wrote the approved row and audit event through separate adapter calls. Production adapters need one repository-level hook that can commit the approved relationship row and its approval audit event inside a single database transaction or transactional outbox boundary.

Goal 44 adds that atomic approval commit adapter path while preserving existing split writer compatibility.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `commitRelationshipApproval` storage adapter hook | live database transaction implementation |
| atomic commit input/result public types | new approval workflow semantics |
| repository preference for atomic hook over split write | UI approval timeline rendering |
| defensive copy boundary for commit payload and returned row | cross-registry supersession workflow |
| focused repository and consumer surface tests | vault/reverse token lookup |

## Implementation Units

### DPM-64 - Registry Approval Commit Hook

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-repository-types.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Public storage types expose `DpmRegistryRelationshipApprovalCommitInput` and `DpmRegistryRelationshipApprovalCommitResult`.
- `DpmRegistryStorage` can optionally provide `commitRelationshipApproval(input)`.
- `createDpmRegistryRepository().saveRelationship()` builds the canonical relationship row and approval audit event once, prefers `commitRelationshipApproval`, and skips split `upsertRelationshipRow`/`appendRelationshipAuditEvent` calls when the hook exists.
- Existing adapters without the hook keep the previous `upsertRelationshipRow` and optional `appendRelationshipAuditEvent` behavior.
- Commit hook payloads and repository return values preserve defensive copy boundaries.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-consumer-smoke.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Production storage adapters can implement one transactional approval commit hook for the registry row plus audit event.
- Existing split writer adapters remain source-compatible.
- Docs, API index, feature matrix, public storage subpath smoke, and focused repository/runtime tests describe the implemented surface.
