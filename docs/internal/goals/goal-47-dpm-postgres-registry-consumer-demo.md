# Goal 47 - DPM Postgres Registry Consumer Demo

**Status: complete 2026-07-08**

> Predecessor: [Goal 46 - DPM Postgres Registry Storage Adapter](./goal-46-dpm-postgres-registry-storage-adapter.md)

## Purpose

Goal 46 added the concrete Postgres registry storage adapter, but the storage-backed demo still exported registry rows through a fixture-only reader. Product consumers needed a restartable example that shows how a service binds its own query client to `createDpmPostgresRegistryStorage()` and then uses the existing repository, registry export, validation, compile, dry-run, and report retrieval flow.

Goal 47 updates the storage-backed customer-orders demo so registry snapshot export and approval audit timeline readback go through the dependency-free Postgres registry adapter boundary.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| fixture query client that returns Postgres-shaped registry rows | adding `pg` as a package dependency |
| storage demo registry export through `createDpmPostgresRegistryStorage()` | running live database integration tests |
| approval audit event fixture and adapter-backed readback | changing registry table schema |
| command smoke and in-process pipeline assertions | adding UI/editor timeline rendering |
| docs, feature matrix, and progress index updates | migration runner |

## Implementation Units

### DPM-67 - Postgres Registry Consumer Demo

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/examples/customer-orders-storage/run-demo.mjs`
- `packages/dpm/examples/customer-orders-storage/relationship-registry-audit-events.json`
- `packages/dpm/examples/customer-orders-storage/README.md`
- `packages/dpm/test/support/storage-demo-postgres-registry-fixtures.ts`
- `packages/dpm/test/support/storage-demo-io-fixtures.ts`
- `packages/dpm/test/support/storage-demo-fixtures.ts`
- `packages/dpm/test/storage-demo-command.test.ts`
- `packages/dpm/test/storage-demo-pipeline.test.ts`
- `packages/dpm/test/storage-demo-surface.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The documented storage demo binds a fixture query client to `createDpmPostgresRegistryStorage()`.
- Registry snapshot export reads relationship rows through the Postgres registry adapter boundary.
- Approval audit event readback uses the same adapter boundary.
- The demo output reports the Postgres registry adapter path and persisted approval audit event id.
- In-process tests assert both relationship and audit SQL paths are exercised without a live DB.
- The feature matrix and spec describe the demo as a Postgres registry adapter consumer smoke.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-demo-surface.test.ts test/storage-demo-pipeline.test.ts test/storage-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm run demo:storage`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- A product consumer can inspect the storage demo to see the adapter binding shape.
- The demo proves registry export and audit readback pass through the Postgres adapter without requiring live DB credentials.
- Existing storage demo safety guarantees remain intact: no source DB mutation and no raw sensitive value persistence.
