# Goal 8 - DPM Profile Baseline Storage

**Status: complete 2026-07-07**

> Predecessor: [Goal 7 - DPM Profile/Connector Contract](./goal-7-dpm-profile-connector-contract.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 7 made profile artifacts and analysis reports usable for source-neutral Kafka/database evidence
inspection, editor review, and current-vs-previous drift analysis. Goal 8 adds the first persistence
boundary for that loop: product code can store profile artifacts as named measurement baselines and
retrieve them later for repeatable drift comparison.

The goal is not to introduce a database schema migration or a hosted baseline service. The goal is to
fix the SDK repository contract and row shape so adapters can persist measured profile baselines
without mutating connector output, exposing raw samples, or coupling profile storage to manifest
compile/report storage.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| profile baseline row kind and public storage repository surface | concrete SQL table migration |
| save/get/list adapter-backed repository contract | hosted baseline API |
| persisted profile artifact and optional analysis report snapshots | automatic baseline selection policy |
| profile/report freshness references for drift comparison | source Kafka or DB connection runtime |
| defensive copy and report/profile consistency guard | raw payload sample persistence |

## Implementation Units

### DPM-28 - Profile Baseline Repository

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-report-copy.ts`
- `packages/dpm/src/storage/profile-baseline-kind.ts`
- `packages/dpm/src/storage/profile-baseline-request-types.ts`
- `packages/dpm/src/storage/profile-baseline-row-types.ts`
- `packages/dpm/src/storage/profile-baseline-row-builder.ts`
- `packages/dpm/src/storage/profile-baseline-repository-contract-types.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/src/public/storage.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Tasks:
- Define `DpmProfileBaselineRow` as the persisted profile measurement baseline envelope.
- Store a defensive copy of `DpmProfileArtifact` and optional matching `DpmProfileAnalysisReport`.
- Preserve profile version hash, report hash, and previous profile version hash for repeatable drift
  comparison.
- Expose adapter-backed `saveProfileBaseline`, `getProfileBaseline`, and `listProfileBaselines`
  repository operations.
- Copy rows before adapter writes and after adapter reads so storage objects and caller-returned
  objects do not share mutable identity.
- Preserve stored hash metadata when an adapter returns a metadata-only row without the optional
  analysis report body.
- Reject an analysis report whose dataset, profile identity, profile version, or profile version
  hash does not match the artifact being stored.
- Export the repository through the public `@oa-sdk/dpm` storage surface.

Acceptance:
- Consumers can persist a Kafka profile artifact baseline and later retrieve/list it through the
  same SDK repository contract.
- Saved and retrieved baseline rows are isolated from caller-side mutation.
- A baseline row can include the analysis report generated for that same artifact.
- A metadata-only baseline row can keep report hash references without including the report body.
- A mismatched report/artifact pair is rejected before the row reaches the storage adapter.
- Stored rows do not include source credentials, vault material, token reverse lookup data, or raw
  sensitive samples.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Breakpoints

Stop and update this goal before implementation if the next unit requires:
- concrete production SQL migration ownership,
- baseline retention or automatic selection policy,
- HTTP gateway endpoints for baseline storage,
- live Kafka/database connector scheduling,
- source credential or raw payload persistence.

## Done Criteria

- The public DPM storage surface includes a profile baseline repository.
- Profile baseline rows persist artifact/report snapshots with freshness references.
- Tests prove defensive copy behavior, list/get adapter calls, unsafe fragment exclusion, and
  mismatched report rejection.
- API index, feature-test matrix, and internal spec describe the implemented surface.
