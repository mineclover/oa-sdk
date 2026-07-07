# Goal 40 - DPM Registry Approval Audit Events

**Status: complete 2026-07-07**

> Predecessor: [Goal 32 - DPM Registry Approval Persistence Bridge](./goal-32-dpm-registry-approval-persistence-bridge.md), [Goal 39 - DPM Profile Hint Approval Workflow](./goal-39-dpm-profile-hint-approval-workflow.md)

## Purpose

Goal 39 made the product approval path practical, but durable registry storage still only modeled the current approved
relationship rows. Production operators need a separate append-only audit surface for approved relationship events so
approval history can be reviewed without treating the compiled registry snapshot as the only evidence of governance.

Goal 40 adds an optional audit event adapter path to registry storage while preserving existing reader and writer adapter
compatibility.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| relationship approval audit event row vocabulary | full immutable event-sourced registry replacement |
| Postgres audit table and indexes | cross-registry supersession workflow |
| optional adapter hook for appending audit events | transactional adapter implementation |
| optional repository audit event listing | UI timeline rendering |
| profile hint workflow audit hook coverage | live Postgres integration |

## Implementation Units

### DPM-60 - Registry Approval Audit Events

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/registry-audit-row-types.ts`
- `packages/dpm/src/storage/registry-audit-event.ts`
- `packages/dpm/src/storage/registry-schema-audit-table.ts`
- `packages/dpm/src/storage/registry-schema-indexes.ts`
- `packages/dpm/src/storage/registry-schema-sql.ts`
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-repository-request-types.ts`
- `packages/dpm/src/storage/registry-repository-types.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-schema.test.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/fixtures/storage/registry-schema.sql`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Registry storage schema includes a dedicated `dpm.relationship_registry_audit_events` table and audit lookup indexes.
- Public storage exports include audit event row types, event taxonomy, event row builder, and copy helper.
- `createDpmRegistryRepository()` preserves existing adapter compatibility and appends audit events only when the adapter supplies `appendRelationshipAuditEvent`.
- Audit events copy approval/source metadata across adapter boundaries.
- Save guards reject invalid writes before any audit event append.
- Profile hint approval workflow appends an approval audit event when backed by an auditable registry adapter.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-relationship-hint-approval.test.ts test/storage-registry-schema.test.ts test/storage-registry-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Production adapters can persist approval audit events without changing existing registry snapshot export semantics.
- Existing registry storage consumers keep working when they do not implement audit event hooks.
- Public docs, package subpath smoke, feature-test matrix, and focused storage/runtime tests describe the implemented surface.
