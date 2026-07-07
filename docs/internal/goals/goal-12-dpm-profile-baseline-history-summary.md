# Goal 12 - DPM Profile Baseline History Summary

**Status: complete 2026-07-07**

> Predecessor: [Goal 11 - DPM Profile Baseline Measurement History](./goal-11-dpm-profile-baseline-measurement-history.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 11 made baseline rows history-safe for same-version measurements. Goal 12 adds a body-free summary
projection so product code can render baseline history lists, compare measurement identities, and inspect
analysis availability without sending the stored profile artifact or full analysis report body through UI
or gateway-adjacent surfaces.

This remains an SDK projection helper, not hosted baseline CRUD. Storage adapters still own persistence,
and gateway/runtime analysis still resolves full rows only when product code explicitly provides a
repository.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `DpmProfileBaselineSummary` and artifact count summary types | hosted baseline history endpoints |
| one-row and multi-row summary projection helpers | pagination or retention policy |
| profile counts and optional analysis summary reuse | raw profile/report body projection |
| Kafka profile demo output using baseline history summaries | production SQL view migration |

## Implementation Units

### DPM-32 - Body-Free Profile Baseline History Summary

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-summary-types.ts`
- `packages/dpm/src/storage/profile-baseline-summary.ts`
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
- Consumers can project baseline rows into summaries that keep identity, measurement, hash, stored time,
  profile counts, and optional analysis summary.
- The summary projection does not expose `profileArtifact` or `analysisReport` body fields.
- Summary copies analysis summary values so caller mutation does not mutate the original report.
- Kafka profile demo output includes a baseline history summary alongside the selected baseline ref.

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
- hosted HTTP baseline history endpoints,
- concrete SQL view/migration ownership,
- pagination, retention, or aging policy,
- raw payload/profile/report body projection.

## Done Criteria

- Public storage exports include summary types and projection helpers.
- Tests prove body-free summary projection, metadata preservation, counts, and defensive summary copying.
- The profile Kafka demo exposes baseline history summary in the comparison step.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
