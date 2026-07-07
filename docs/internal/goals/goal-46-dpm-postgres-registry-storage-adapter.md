# Goal 46 - DPM Postgres Registry Storage Adapter

**Status: complete 2026-07-08**

> Predecessor: [Goal 44 - DPM Registry Approval Commit Hook](./goal-44-dpm-registry-approval-commit-hook.md), [Goal 45 - DPM Registry Write Receipt Audit Link](./goal-45-dpm-registry-write-receipt-audit-link.md)

## Purpose

Goal 44 and Goal 45 made registry approval persistence transaction-friendly and made gateway write receipts link only to persisted approval audit events. Product consumers still needed a concrete storage adapter that maps the canonical `dpm.relationship_registry` and `dpm.relationship_registry_audit_events` schema to the SDK repository contract without adding a `pg` dependency.

Goal 46 adds a dependency-free Postgres registry storage adapter over a generic query client plus transaction callback.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| generic Postgres registry query client contract | adding `pg` as a package dependency |
| relationship row list/upsert SQL mapping | running live database integration tests |
| approval audit event insert/list SQL mapping | changing registry table schema |
| transaction-backed approval commit adapter | UI/editor timeline rendering |
| Postgres row hydration guards | full runtime JSON schema validation |
| public storage subpath exports and type smoke | migrations runner |

## Implementation Units

### DPM-66 - Postgres Registry Storage Adapter

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/storage/registry-postgres-storage.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/storage/registry-repository-types.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-postgres.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Consumers can create `DpmRegistryStorage` from a dependency-free Postgres client contract.
- The adapter lists registry relationship rows by dataset and registry version.
- The adapter rejects invalid Postgres row taxonomy, JSON object, JSON array, and source coordinate shapes while hydrating SDK rows.
- The adapter upserts canonical relationship rows into `dpm.relationship_registry`.
- The adapter inserts and lists approval audit events in `dpm.relationship_registry_audit_events`.
- Approval commit helpers use the provided transaction callback and return the persisted relationship row and audit event.
- Public storage subpath exports expose the adapter helpers and client types.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-postgres.test.ts test/storage-registry-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm check:dpm-surface`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers have a concrete registry storage adapter they can bind to their own Postgres client.
- Approval writes can be committed with relationship row and audit event in one transaction callback.
- Existing in-memory/test adapter contract remains compatible.
