# Goal 13 - DPM Profile Baseline Summary Repository

**Status: complete 2026-07-07**

> Predecessor: [Goal 12 - DPM Profile Baseline History Summary](./goal-12-dpm-profile-baseline-history-summary.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 12 added body-free baseline history summary projection helpers. Goal 13 makes that projection a
first-class repository surface so product code can request baseline history summaries through the same
adapter-backed repository it already uses for save/get/list/select. This removes the extra consumer-side
step of listing full rows and then remembering which summary helper to call.

This is still SDK-level repository composition. It does not introduce hosted HTTP endpoints, storage
pagination semantics, retention policy, or a production SQL view.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `listProfileBaselineSummaries()` on the repository contract | hosted baseline summary endpoint |
| facade implementation using storage rows plus body-free summary projection | storage adapter summary-only query |
| demo route using the repository summary method | pagination/retention semantics |
| tests proving repository summary listing stays body-free | SQL view or migration |

## Implementation Units

### DPM-33 - Repository-Backed Profile Baseline Summary Listing

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-repository-contract-types.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Consumers can call `listProfileBaselineSummaries()` directly on `DpmProfileBaselineRepository`.
- The repository method forwards the same list request shape to storage.
- Returned summaries stay body-free and match the summary projection helper output.
- The Kafka profile demo uses the repository summary method for `baselineHistory`.

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
- hosted HTTP or gateway summary endpoints,
- storage adapter summary-only query contracts,
- pagination cursor ownership,
- retention/aging policy,
- raw profile/report body projection.

## Done Criteria

- Profile baseline repository contract and facade expose the summary list method.
- Tests prove request forwarding and body-free repository summary output.
- The profile Kafka demo uses the repository summary method rather than helper-only composition.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
