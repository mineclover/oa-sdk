# Goal 61 - DPM Registry Conflict Blocking Stabilization

**Status: complete 2026-07-08**

> Predecessor: [Goal 60 - DPM Package Consumer Workflow Smoke](./goal-60-dpm-package-consumer-workflow-smoke.md)

## Purpose

Review found that approved relationship conflicts were deterministic for the PostgreSQL adapter, but the SDK split repository guard still raised a plain `Error`. Product workflows need the same blocking contract regardless of whether the conflict is detected by a database constraint or by the repository guard before adapter mutation.

Goal 61 normalizes repository-detected approved relationship conflicts to `DpmRegistryApprovedRelationshipConflictError` and proves that public package consumers receive the same `PROF204` blocking behavior through built subpaths.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| split repository approved relationship conflict error normalization | new registry lifecycle semantics |
| gateway `PROF204` blocking coverage for repository guard conflicts | live database concurrency tests |
| built public subpath consumer workflow blocking smoke | new CLI command |
| docs/feature matrix/progress index updates | publishing package release |

## Implementation Units

### DPM-81 - Repository Conflict Blocking Contract

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/package-consumer-workflow-smoke.mjs`
- `packages/dpm/README.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The split repository single-approved-name guard throws `DpmRegistryApprovedRelationshipConflictError`.
- Gateway profile hint approval maps repository guard conflicts to schema-valid `PROF204` blocking responses.
- The built package consumer workflow smoke imports only public subpaths and proves both approval success and approved-conflict blocking.
- Registry rows and audit events are not duplicated after the blocking conflict path.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `pnpm --filter @oa-sdk/dpm run smoke:consumer-workflow`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm check:dpm-surface`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/runtime code no longer depends on adapter-specific conflict behavior to produce deterministic blocking diagnostics.
- Public package consumers have automated proof that focused subpaths can execute the success path and the approved-conflict blocking path.
