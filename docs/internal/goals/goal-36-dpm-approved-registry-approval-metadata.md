# Goal 36 - DPM Approved Registry Approval Metadata

**Status: complete 2026-07-07**

> Predecessor: [Goal 35 - DPM Approved Registry Uniqueness Guard](./goal-35-dpm-approved-registry-uniqueness-guard.md)

## Purpose

Approved registry relationship writes should carry the same approval metadata required by the relationship approval
gateway response. Before this goal, `ApprovedRegistryRelationshipInput` narrowed only `status: "approved"` while
`approval.approvedBy` and `approval.reason` remained optional through the storage write API.

Goal 36 aligns the public type, gateway result type, and storage runtime guard around the approved relationship
metadata contract.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| approved approval metadata type | changing rejected/proposed review metadata |
| approved relationship input type narrowing | making `approvedAt` mandatory |
| runtime guard for JS/cast consumers | authorization identity provider |
| public subpath type smoke | approval workflow UI |
| API index, feature matrix, spec, and progress updates | database migration runner |

## Implementation Units

### DPM-56 - Approved Registry Approval Metadata

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/registry/registry-approval-types.ts`
- `packages/dpm/src/registry/registry-relationship-record-types.ts`
- `packages/dpm/src/registry/registry-relationship-types.ts`
- `packages/dpm/src/registry/types.ts`
- `packages/dpm/src/public/relationship-registry.ts`
- `packages/dpm/src/storage/registry-row-relationship.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `ApprovedRegistryApprovalMetadata` requires `approvedBy` and `reason` while keeping `approvedAt` optional.
- `ApprovedRegistryRelationshipInput.approval` uses the approved metadata type.
- `createDpmRegistryRelationshipRow()` rejects approved payloads missing approved metadata before adapter mutation.
- The public relationship subpath exposes the approved metadata type.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers cannot persist an approved relationship without reviewer identity and reason metadata.
- Gateway approval results and storage save inputs share the same approved relationship metadata type.
- Public API docs and package subpath smoke include the approved metadata contract.
