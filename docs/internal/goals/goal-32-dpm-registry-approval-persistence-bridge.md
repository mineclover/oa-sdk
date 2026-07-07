# Goal 32 - DPM Registry Approval Persistence Bridge

**Status: complete 2026-07-07**

> Predecessor: [Goal 31 - DPM Profile Relationship Candidate Bridge](./goal-31-dpm-profile-relationship-candidate-bridge.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 31 connected profile/Kafka relationship hints to relationship candidate import, but the approved
relationship payload still had to be manually placed into a registry snapshot for compile-ready workflow
tests.

Goal 32 closes the next product persistence gap: approved relationship payloads can now be converted into
canonical registry storage rows and upserted through a consumer-backed registry storage adapter before
snapshot export. The gateway approval runtime remains non-mutating; consumers explicitly choose when and
where to persist approved relationships.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `RegistryRelationshipInput` to `DpmRegistryRelationshipRow` builder | live database client implementation |
| writable registry storage/repository adapter contract | approval runtime side effects |
| defensive copy boundary for persisted rows | automatic approval from profile hints |
| consumer smoke proving approval -> save -> export -> compile | registry auth/concurrency control |
| profile Kafka demo approval persistence step | token vault or reverse lookup APIs |
| API index, feature matrix, spec, and progress updates | physical FK creation |

## Implementation Units

### DPM-52 - Registry Approval Persistence Bridge

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/registry-repository-request-types.ts`
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-row-relationship.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/examples/profile-kafka/README.md`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `createDpmRegistryRelationshipRow()` converts a registry relationship payload into a canonical storage row.
- `copyDpmRegistryRelationshipRow()` preserves the adapter boundary with defensive copies.
- `createDpmRegistryRepository()` remains export-only for reader adapters and returns a writable repository when `upsertRelationshipRow` is supplied.
- `saveRelationship()` writes a copied row to storage and returns an independent saved row.
- Gateway consumer smoke persists the approval result through the writable repository before exporting a compile-ready registry snapshot.
- Profile Kafka demo shows profile hint -> candidate import -> approval -> registry row persistence without live Kafka or source DB access.
- Public storage subpath exposes the new builder, save input type, and writable repository type.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-registry-repository.test.ts test/gateway-consumer-smoke.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- storage-registry`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- profile-demo`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run demo:profile`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers can persist approved relationship payloads as registry rows without giving the approval runtime database side effects.
- Registry export/compile workflows can be proven from saved rows rather than hand-built snapshots.
- API/spec docs, feature-test matrix, demos, package surface smoke, and progress index match the implemented behavior.
