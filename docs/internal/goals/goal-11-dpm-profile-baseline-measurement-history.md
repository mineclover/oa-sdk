# Goal 11 - DPM Profile Baseline Measurement History

**Status: complete 2026-07-07**

> Predecessor: [Goal 10 - DPM Profile Baseline Selection](./goal-10-dpm-profile-baseline-selection.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 10 made previous profile baseline selection automatic, but the baseline row identity still centered
on a profile version hash. Goal 11 adds a lightweight measurement-history identity so product code can
store more than one baseline measurement for the same `datasetId`/`profileId`/profile version when the
measurements came from different capture times or connector runs.

The implementation keeps the old default baseline ref shape when no measurement metadata is provided.
When `measuredAt`, `measurementRunHash`, or an explicit `measurementId` is provided, the SDK records a
measurement id and includes it in the default baseline ref.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| deterministic profile baseline measurement id helper | hosted measurement CRUD endpoints |
| optional `measurementId`, `measuredAt`, and `measurementRunHash` row fields | retention/window policy |
| default baseline refs that can distinguish same-version measurements | new selection strategies |
| Kafka profile demo showing measurement identity in the baseline summary | production SQL migration |

## Implementation Units

### DPM-31 - Profile Baseline Measurement Identity

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-measurement-identity.ts`
- `packages/dpm/src/storage/profile-baseline-row-types.ts`
- `packages/dpm/src/storage/profile-baseline-request-types.ts`
- `packages/dpm/src/storage/profile-baseline-row-builder.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Consumers can store two same-version profile baselines as distinct history rows by providing
  measurement metadata.
- The generated measurement id is deterministic and starts with the existing `sha256:` freshness style.
- Default baseline refs include the generated measurement id only when measurement metadata is present.
- Row copying and retrieval preserve measurement metadata.
- Kafka profile demo output includes the selected baseline measurement id, measured time, and run hash.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm demo:dpm:profile`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Breakpoints

Stop and update this goal before implementation if the next unit requires:
- production SQL migration ownership,
- baseline retention policy,
- `latest_previous` semantic changes,
- hosted CRUD/API endpoints,
- raw payload, source credential, or reverse lookup persistence.

## Done Criteria

- Public storage exports include the measurement identity input type and helper functions.
- Baseline save input and stored rows can carry measurement id, measured time, and run hash metadata.
- Tests prove same-version measurement baselines remain addressable as distinct rows.
- The profile Kafka demo exposes measurement identity in the baseline comparison step.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
