# Goal 5 - DPM Runtime/Storage Integration

**Status: complete 2026-07-01**

> Predecessor: [Goal 4 - Relationship-First DPM Roadmap](./goal-4-dpm-relationship-first-roadmap.md)\
> Core implementation status: [Goal 4 - DPM Implementation Strategy](./goal-4-dpm-implementation-strategy.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
> Product PRD: [Relationship-First Data Pseudonymization Manifest](../../../tasks/prd-data-pseudonymization-manifest.md)

## Purpose

Goal 4 proved the deterministic DPM contract loop with checked-in manifest, catalog, and registry
snapshots. Goal 5 moves that loop toward runtime integration without changing the safety boundary:
approved relationships remain the source of truth, source DBs are read-only catalog inputs, and AI
consumers never receive source DB credentials, vault access, or token reverse lookup APIs.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| Postgres canonical schema for relationship registry lifecycle | production token vault implementation |
| PostgreSQL catalog profiler that emits DPM catalog snapshots | source DB mutation |
| Gateway runtime adapter for validate/compile/dry-run | physical FK creation |
| job and validation report persistence | automatic relationship approval |
| storage-backed demo/smoke gate | multi-engine discovery before Postgres is stable |

## Execution Principles

1. Storage makes approved relationships durable; it does not weaken manual approval.
2. Catalog profiling is read-only and emits snapshots that the existing validator can consume.
3. Gateway runtime delegates to the existing DPM validator/compiler/dry-run APIs.
4. Runtime reports may persist diagnostics and plan identities, but not raw sensitive values.
5. Vault and reversible token behavior stay behind explicit breakpoints.

## Implementation Units

### DPM-11 - Registry Storage Canonical Model

Status: implemented 2026-07-01.

Artifacts:
- `packages/dpm/src/storage/registry-schema.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/storage/registry-repository-types.ts`
- `packages/dpm/src/storage/registry-row-mapper.ts`
- `packages/dpm/test/storage-registry.test.ts`
- migration or SQL fixture under `packages/dpm/test/fixtures/storage/`

Tasks:
- Define the canonical Postgres tables for relationship registry lifecycle.
- Model dataset id, registry version, relationship name, lifecycle status, endpoints, namespace,
  orphan policy, approval metadata, supersession metadata, and freshness.
- Add repository functions that export the same snapshot shape already consumed by the compiler.
- Keep YAML snapshot fixtures as review artifacts and deterministic tests.

Exit criteria:
- Approved relationships exported from storage match the existing registry snapshot contract.
- Non-approved relationships remain loadable but non-executable.
- Repository tests run without source DB credentials or production data.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm typecheck`

Implementation notes:
- `DPM_REGISTRY_STORAGE_SCHEMA_SQL` defines the Postgres canonical schema using `text`,
  `timestamptz`, check constraints, a composite identity index, and an approved partial index.
- `packages/dpm/src/storage/registry-repository-types.ts` owns storage row/request/repository
  adapter vocabulary.
- `createDpmRegistryRepository()` accepts a row reader so tests can verify export behavior without a
  live source database.
- `registryRowsToSnapshot()` in `packages/dpm/src/storage/registry-row-mapper.ts` exports storage
  rows to the existing `RegistrySnapshot` contract and rejects rows that do not match the requested
  dataset/version scope.

### DPM-12 - PostgreSQL Catalog Profiler

Status: implemented 2026-07-01.

Artifacts:
- `packages/dpm/src/catalog/profiler-postgres.ts`
- `packages/dpm/src/catalog/profiler-postgres-query.ts`
- `packages/dpm/src/catalog/profiler-postgres-query-ctes.ts`
- `packages/dpm/src/catalog/profiler-postgres-query-integrity-records.ts`
- `packages/dpm/src/catalog/profiler-postgres-query-records.ts`
- `packages/dpm/src/catalog/profiler-postgres-query-structure-records.ts`
- `packages/dpm/src/catalog/profiler-postgres-row-filters.ts`
- `packages/dpm/src/catalog/profiler-postgres-row-mappers.ts`
- `packages/dpm/src/catalog/profiler-postgres-row-types.ts`
- `packages/dpm/src/catalog/profiler-postgres-row-utils.ts`
- `packages/dpm/src/catalog/profiler-postgres-rows.ts`
- `packages/dpm/src/catalog/profiler-postgres-sources.ts`
- `packages/dpm/src/catalog/profiler-postgres-unique-candidates.ts`
- `packages/dpm/test/catalog-profiler.test.ts`
- read-only catalog SQL fixtures

Tasks:
- Read PostgreSQL catalog metadata for schemas, tables, columns, primary keys, unique indexes,
  foreign keys, indexes, and source coordinates.
- Emit the existing DPM catalog snapshot model.
- Compute catalog freshness with the existing deterministic hash.
- Require explicit connection input and keep the default test path fixture-backed.

Exit criteria:
- Profiler output normalizes into the existing catalog snapshot type.
- Freshness hash changes when structural catalog evidence changes.
- Tests do not require a live production database.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- catalog-profiler`
- `pnpm --filter @oa-sdk/dpm typecheck`

Implementation notes:
- `POSTGRES_CATALOG_PROFILE_SQL` reads `pg_catalog` metadata for selected schemas only and avoids
  mutation statements. Its SQL composer lives in `packages/dpm/src/catalog/profiler-postgres-query.ts`,
  with CTE fragments in `packages/dpm/src/catalog/profiler-postgres-query-ctes.ts`, record select
  ordering in `packages/dpm/src/catalog/profiler-postgres-query-records.ts`, structure selects in
  `packages/dpm/src/catalog/profiler-postgres-query-structure-records.ts`, and integrity selects in
  `packages/dpm/src/catalog/profiler-postgres-query-integrity-records.ts`.
- `profilePostgresCatalog()` requires an explicit query client and schema filter.
- `profiler-postgres-row-types.ts` owns the raw profiler row vocabulary exposed through the public
  profiler facade.
- `postgresCatalogRowsToSnapshot()` maps profiled rows into the existing `CatalogSnapshot` shape,
  derives primary-key and unique-index candidates, and delegates freshness hashing to the existing
  catalog normalization path. The rows-to-snapshot orchestration lives in
  `packages/dpm/src/catalog/profiler-postgres-rows.ts`, with row-kind filters in
  `packages/dpm/src/catalog/profiler-postgres-row-filters.ts`, catalog element mappers in
  `packages/dpm/src/catalog/profiler-postgres-row-mappers.ts`, and unique candidate derivation in
  `packages/dpm/src/catalog/profiler-postgres-unique-candidates.ts`.
- `profiler-postgres-sources.ts` owns source map assembly, while `profiler-postgres-row-utils.ts`
  owns required-field guards and DB source coordinate construction.

### DPM-13 - Gateway Runtime Adapter

Status: implemented 2026-07-01.

Artifacts:
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/gateway/runtime-operation-ids.ts`
- `packages/dpm/src/gateway/runtime-response-types.ts`
- `packages/dpm/src/gateway/runtime-manifest-types.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-manifest.ts`
- `packages/dpm/src/gateway/runtime-manifest-validate.ts`
- `packages/dpm/src/gateway/runtime-manifest-compile.ts`
- `packages/dpm/src/gateway/runtime-manifest-dry-run.ts`
- `packages/dpm/src/gateway/runtime-manifest-catalog.ts`
- `packages/dpm/src/gateway/runtime-response.ts`
- `packages/dpm/test/gateway-runtime.test.ts`
- `packages/dpm/test/gateway-runtime-manifest.test.ts`

Tasks:
- Bind gateway operations to existing validate, compile, and dry-run implementation APIs.
- Keep manifest policy validation in JSON Schema and DPM semantic validator code.
- Return machine-readable diagnostics and plan/report payloads.
- Do not add execute-job tokenization behavior in this unit.

Exit criteria:
- Runtime adapter can serve validate/compile/dry-run without source DB access.
- Gateway runtime output matches CLI output shape where the operation is equivalent.
- Secret-bearing operations remain absent.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm typecheck`

Implementation notes:
- `packages/dpm/src/gateway/runtime-manifest.ts` remains the manifest runtime compatibility barrel.
  Manifest runtime handlers live in `runtime-manifest-validate.ts`, `runtime-manifest-compile.ts`,
  and `runtime-manifest-dry-run.ts`; loaded catalog snapshot resolution lives in
  `runtime-manifest-catalog.ts`. They are composed by
  `packages/dpm/src/gateway/runtime-factory.ts:createDpmGatewayRuntime()`.
- Runtime handlers accept already-loaded manifest, catalog, registry, and optional estimated row
  inputs; they do not read files, connect to source databases, or expose execute-job/report APIs.
- Runtime response bodies keep the same machine-readable `{ command, result }` shape as the CLI
  where the operation is equivalent, while HTTP-like status codes identify blocking diagnostics.

### DPM-14 - Job And Validation Report Persistence

Status: implemented 2026-07-01.

Artifacts:
- `packages/dpm/src/storage/job-repository.ts`
- `packages/dpm/src/storage/report-repository.ts`
- `packages/dpm/src/storage/report-repository-types.ts`
- `packages/dpm/src/storage/report-row-builder.ts`
- `packages/dpm/src/storage/report-gateway-projection.ts`
- `packages/dpm/test/storage-report.test.ts`

Tasks:
- Persist compile/dry-run job metadata, diagnostics, plan identity, freshness tuple, and validation
  report references.
- Store impact summaries without raw values.
- Add report retrieval contracts that match the gateway OpenAPI surface.

Exit criteria:
- Reports preserve deterministic diagnostics.
- Persisted payloads exclude source credentials, vault material, token reverse lookup data, and raw
  sensitive samples.
- Report retrieval can be smoke-tested from fixture-backed jobs.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- storage-report`
- `pnpm --filter @oa-sdk/dpm typecheck`

Implementation notes:
- `createDpmJobRepository()` persists compile/dry-run job rows through an injected storage adapter
  and stores diagnostics, plan identity, freshness, and report references.
- `packages/dpm/src/storage/report-repository-types.ts` owns validation report row/request/repository
  vocabulary, `packages/dpm/src/storage/report-row-builder.ts` owns sanitized report row assembly,
  and `packages/dpm/src/storage/report-gateway-projection.ts` owns gateway-compatible report
  projection.
- `createDpmReportRepository()` persists sanitized validation report rows and exposes
  `getJobReport()` with the gateway-compatible job report shape.
- Job/report row builders copy only explicit metadata fields, preserving deterministic diagnostics
  while excluding source credentials, vault material, reverse lookup maps, and raw sample values.

### DPM-15 - Storage-Backed Demo And Smoke Gate

Status: implemented 2026-07-01.

Artifacts:
- `packages/dpm/examples/customer-orders-storage/`
- `packages/dpm/test/storage-demo.test.ts`
- README updates for the new demo command

Tasks:
- Add a storage-backed version of the customer-orders demo using fixture or local ephemeral Postgres
  inputs.
- Prove registry export, catalog snapshot profiling, validate, compile, dry-run, and report retrieval.
- Keep the existing file-backed `pnpm demo:dpm` demo as the fast primary demo.

Exit criteria:
- Storage-backed demo is reproducible in CI or clearly marked local-only with a skip-safe test.
- File-backed demo remains fast and deterministic.
- Smoke output proves no source DB mutation and no raw sensitive value persistence.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- storage-demo`
- `pnpm --filter @oa-sdk/dpm typecheck`
- storage demo command documented in README

Implementation notes:
- `packages/dpm/examples/customer-orders-storage/` provides fixture-backed catalog profile rows,
  registry rows, manifest, estimated row counts, README, and a runnable `demo:storage` script.
- The storage demo uses an explicit read-only catalog query adapter, storage-backed registry export,
  validator/compiler/dry-run APIs, job/report repositories, and gateway-compatible report retrieval.
- `pnpm demo:dpm:storage` is documented at the repository root and delegates to the package-level
  `demo:storage` command.

## Breakpoints

Stop and update this goal before implementation if any unit requires:
- production vault storage or token generation,
- source DB mutation,
- automatic approval of discovered relationships,
- physical FK creation,
- non-Postgres catalog semantics,
- authentication or tenancy policy beyond local runtime contracts.

## Verification Ladder

| Stage | Gate |
|---|---|
| docs-only | `git diff --check` |
| storage model | focused storage tests + `pnpm --filter @oa-sdk/dpm typecheck` |
| catalog profiler | focused profiler tests + no-production-DB fixture path |
| gateway runtime | gateway runtime tests + existing CLI parity checks |
| report persistence | report storage tests + raw-value exclusion assertions |
| storage demo | demo smoke test + documented command |
