# Goal 49 - DPM Storage Demo Schema Bootstrap

**Status: complete 2026-07-08**

> Predecessor: [Goal 47 - DPM Postgres Registry Consumer Demo](./goal-47-dpm-postgres-registry-consumer-demo.md), [Goal 48 - DPM Registry Schema Apply Helper](./goal-48-dpm-registry-schema-apply-helper.md)

## Purpose

Goal 48 added `applyDpmRegistryStorageSchema()`, but the storage-backed demo still began at the Postgres registry adapter read path. Product consumers need one runnable path that shows the intended sequence: apply the canonical registry schema blocks, bind the Postgres registry storage adapter, export the registry snapshot, and read back approval audit events.

Goal 49 wires schema bootstrap into the storage-backed customer-orders demo and smoke tests.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| storage demo call to `applyDpmRegistryStorageSchema()` | live database integration test |
| fixture query client support for schema DDL blocks | adding `pg` dependency |
| demo output proof of applied schema block count | migration framework |
| in-process test proof of schema apply before registry reads | destructive schema reset/drop helper |
| docs, feature matrix, and progress index updates | production database provisioning |

## Implementation Units

### DPM-69 - Storage Demo Schema Bootstrap

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/examples/customer-orders-storage/run-demo.mjs`
- `packages/dpm/examples/customer-orders-storage/README.md`
- `packages/dpm/test/support/storage-demo-postgres-registry-fixtures.ts`
- `packages/dpm/test/storage-demo-pipeline.test.ts`
- `packages/dpm/test/storage-demo-command.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The storage demo applies registry schema blocks before creating the adapter-backed repository.
- The fixture Postgres registry query client accepts schema DDL blocks and keeps query-call evidence.
- The demo output reports the applied schema block count.
- In-process tests prove schema apply calls happen before relationship and audit read queries.
- The storage demo documentation describes schema bootstrap as part of the runnable path.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-demo-pipeline.test.ts test/storage-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm run demo:storage`
- `pnpm --filter @oa-sdk/dpm test -- storage-demo`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- The demo shows a complete driver-neutral consumer sequence from schema bootstrap to registry export.
- The proof remains CI-reproducible without live database credentials.
