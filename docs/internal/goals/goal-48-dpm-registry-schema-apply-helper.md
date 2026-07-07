# Goal 48 - DPM Registry Schema Apply Helper

**Status: complete 2026-07-08**

> Predecessor: [Goal 46 - DPM Postgres Registry Storage Adapter](./goal-46-dpm-postgres-registry-storage-adapter.md), [Goal 47 - DPM Postgres Registry Consumer Demo](./goal-47-dpm-postgres-registry-consumer-demo.md)

## Purpose

Goal 46 and Goal 47 made the Postgres registry adapter usable and demonstrable, but product consumers still had to manually decide how to apply the canonical registry schema before binding the adapter. The SDK already exposed the full SQL string, but not a small dependency-free bootstrap helper that applies the ordered schema blocks through the same kind of explicit query client boundary used by the other Postgres-facing DPM APIs.

Goal 48 adds a schema apply helper for `dpm.relationship_registry` and `dpm.relationship_registry_audit_events` without introducing a database driver dependency or a live migration runner.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| ordered registry storage schema SQL blocks | adding `pg` as a package dependency |
| dependency-free schema apply query client contract | versioned migration framework |
| public storage subpath exports and type smoke | live database integration tests |
| schema apply result with schema version and applied block count | destructive schema reset/drop helpers |
| docs, feature matrix, and progress index updates | environment-specific database provisioning |

## Implementation Units

### DPM-68 - Registry Schema Apply Helper

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/storage/registry-schema-sql.ts`
- `packages/dpm/src/storage/registry-schema-apply.ts`
- `packages/dpm/src/storage/registry-schema.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-schema.test.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `DPM_REGISTRY_STORAGE_SCHEMA_SQL_BLOCKS` exposes the ordered schema SQL blocks used to assemble `DPM_REGISTRY_STORAGE_SCHEMA_SQL`.
- `applyDpmRegistryStorageSchema()` applies each schema SQL block through an explicit query client with empty parameters.
- The apply result reports `DPM_REGISTRY_STORAGE_SCHEMA_VERSION` and the applied block count.
- The public storage subpath exports the helper, SQL blocks, query client type, and apply result type.
- Existing schema fixture parity remains intact.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-schema.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm check:dpm-surface`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Product consumers can bootstrap the canonical registry schema through an SDK helper before binding the Postgres registry storage adapter.
- The helper remains driver-neutral and does not require live DB credentials in CI.
- Schema SQL fixture parity still proves the public SQL matches the checked-in canonical fixture.
