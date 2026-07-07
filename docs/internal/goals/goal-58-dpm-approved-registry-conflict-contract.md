# Goal 58 - DPM Approved Registry Conflict Contract

**Status: complete 2026-07-08**

> Predecessor: [Goal 57 - DPM Package Consumer Surface Guide](./goal-57-dpm-package-consumer-surface-guide.md)

## Purpose

Production profile approval flows can race: two reviewers or workers may try to approve different versions of the same relationship name for one dataset registry version. The Postgres schema already rejects that state through the approved partial unique index, but product callers need a deterministic SDK contract instead of parsing raw database errors.

Goal 58 turns approved registry uniqueness conflicts into a structured DPM storage error and maps that error to a schema-valid profile hint approval blocking response.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| structured approved relationship conflict error code/class/type guard | redesigning the registry repository API |
| Postgres approved partial unique index conflict mapping | changing the approved partial unique index |
| profile hint approval `PROF204` blocking diagnostic | adding new HTTP status families |
| public storage subpath consumer smoke | YAML/direct registry snapshot metadata guard |

## Implementation Units

### DPM-78 - Approved Registry Conflict Contract

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/storage/registry-storage-errors.ts`
- `packages/dpm/src/storage/registry-postgres-storage.ts`
- `packages/dpm/src/gateway/runtime-profile-relationship-hint-approval.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-postgres.test.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `packages/dpm/README.md`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Postgres duplicate errors for `dpm_relationship_registry_approved_idx` become `DpmRegistryApprovedRelationshipConflictError`.
- The error exposes a stable code, type guard, dataset id, registry version, relationship name, attempted relationship version, constraint, and original cause.
- Non-approved-index Postgres errors are rethrown unchanged.
- Profile relationship hint approval catches the conflict error and returns a schema-valid blocking response with `PROF204` before registry snapshot export.
- The storage subpath exposes the error code, class, type guard, and related types for product consumers.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-postgres.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product approval callers can branch on a stable SDK error instead of raw Postgres error text.
- Profile approval runtime returns deterministic blocking diagnostics for approved relationship version conflicts.
