# Goal 59 - DPM Registry Snapshot Approval Metadata Guard

**Status: complete 2026-07-08**

> Predecessor: [Goal 58 - DPM Approved Registry Conflict Contract](./goal-58-dpm-approved-registry-conflict-contract.md)

## Purpose

Approved registry relationships are executable DPM inputs. Storage save paths already require approved metadata, but direct snapshot inputs and YAML review artifacts also need the same runtime guard so malformed approved relationships cannot become executable by bypassing storage.

Goal 59 makes approved relationship execution selection depend on complete approval metadata at the registry snapshot boundary.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| shared approved approval metadata field guard | changing approval metadata vocabulary |
| direct `createRegistrySnapshot()` approved metadata rejection | JSON Schema redesign |
| YAML approved relationship metadata rejection | registry storage schema migration |
| manual snapshot `selectApprovedRelationships()` guard | adding a new public API |
| storage save guard reuse of the shared field list | changing non-approved lifecycle history rules |

## Implementation Units

### DPM-79 - Registry Snapshot Approval Metadata Guard

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/registry/registry-approved-relationship-metadata.ts`
- `packages/dpm/src/registry/registry-normalize.ts`
- `packages/dpm/src/registry/registry-executable.ts`
- `packages/dpm/src/storage/registry-row-relationship.ts`
- `packages/dpm/test/registry-snapshot-yaml.test.ts`
- `packages/dpm/test/gateway-runtime-relationship-registry-export.test.ts`
- `packages/dpm/test/support/storage-registry-approved-row-fixtures.ts`
- `packages/dpm/test/support/storage-registry-projection-fixtures.ts`
- `packages/dpm/README.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- YAML approved relationships missing `approval.approvedBy` or `approval.reason` are rejected before snapshot creation succeeds.
- Direct `createRegistrySnapshot()` approved relationships missing required approval metadata are rejected before they can become executable.
- `selectApprovedRelationships()` rejects manually constructed malformed approved snapshots instead of selecting them as executable.
- Storage save guard keeps its existing error message while sharing the same required approval field list.
- Existing valid storage row fixtures include complete approved metadata.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/registry-snapshot-yaml.test.ts test/registry-executable.test.ts test/storage-registry-repository.test.ts test/storage-registry-row-mapper.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Approved registry snapshot relationships cannot become executable unless approval metadata is complete.
- YAML, direct snapshot input, manual snapshot selection, and storage save paths use the same required field list.
