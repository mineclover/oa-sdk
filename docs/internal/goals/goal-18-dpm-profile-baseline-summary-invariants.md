# Goal 18 - DPM Profile Baseline Summary Invariants

**Status: complete 2026-07-07**

> Predecessor: [Goal 17 - DPM Profile Baseline Summary-First Selection](./goal-17-dpm-profile-baseline-summary-first-selection.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 17 made summary metadata part of the baseline selection path. Goal 18 hardens that adapter boundary:
storage-provided profile baseline summaries are now checked for stable identity, non-negative count fields,
and analysis availability consistency before they can reach repository or gateway runtime consumers.

The guard remains shape-focused. It does not require adapters to project an analysis summary whenever
`hasAnalysisReport` is true, because some storage projections may only expose report availability and hashes.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `assertDpmProfileBaselineSummary()` public guard | full JSON Schema validator for every storage row |
| repository validation of adapter-provided summary lists | hosted API error envelope mapping |
| gateway runtime rejection of invalid repository summaries | requiring analysis summary for every stored report |
| tests for inconsistent analysis availability and invalid counts | production SQL constraint generation |

## Implementation Units

### DPM-38 - Profile Baseline Summary Invariant Guard

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-summary.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `packages/dpm/test/gateway-runtime-profile-baselines.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Summary copies reject invalid kind, empty required identity strings, and negative count fields.
- A summary with `analysisSummary` and `hasAnalysisReport: false` is rejected.
- Repository summary list and summary-first selection validate adapter-provided summaries before returning or selecting.
- Gateway runtime summary responses fail before producing invalid result bodies.
- Analysis summary remains optional when `hasAnalysisReport` is true.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts test/gateway-runtime-profile-baselines.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Invalid adapter-provided summary projections fail at SDK boundaries before UI/gateway use.
- API index, feature-test matrix, progress index, and internal spec describe the implemented guard.
