# Goal 35 - DPM Approved Registry Uniqueness Guard

**Status: complete 2026-07-07**

> Predecessor: [Goal 34 - DPM Approved Registry Save Guard](./goal-34-dpm-approved-registry-save-guard.md)

## Purpose

Goal 34 made `saveRelationship()` approved-only, but storage could still accept a second approved version for the
same relationship name in one dataset registry version. That creates an ambiguous executable registry and defers
failure until manifest validation.

Goal 35 moves that invariant to the persistence boundary: one dataset registry version can have only one approved
relationship for a relationship name.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| approved partial unique index | migration runner |
| repository pre-write duplicate approved version guard | relationship supersession workflow |
| focused storage schema and repository tests | authorization/concurrency locking |
| feature matrix, spec, and progress updates | physical FK creation |

## Implementation Units

### DPM-55 - Approved Registry Uniqueness Guard

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/registry-schema-indexes.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/test/fixtures/storage/registry-schema.sql`
- `packages/dpm/test/storage-registry-schema.test.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Postgres registry schema defines a unique approved partial index by dataset, registry version, and relationship name.
- `saveRelationship()` rejects another approved relationship version for an already-approved relationship name before adapter mutation.
- Existing same-version upsert behavior remains delegated to the storage adapter identity upsert contract.
- Non-executable history rows remain readable through storage row export.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-schema.test.ts test/storage-registry-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers cannot create an ambiguous executable registry by saving a second approved version for one relationship name.
- The database schema and SDK repository enforce the same single-approved-name invariant.
- Public docs and feature-test matrix describe the implemented storage boundary.
