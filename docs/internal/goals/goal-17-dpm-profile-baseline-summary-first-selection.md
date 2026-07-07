# Goal 17 - DPM Profile Baseline Summary-First Selection

**Status: complete 2026-07-07**

> Predecessor: [Goal 16 - DPM Profile Baseline Summary Gateway](./goal-16-dpm-profile-baseline-summary-gateway.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 16 made body-free baseline history reachable through the gateway. Goal 17 applies the same
projection boundary to `latest_previous` selection: when a storage adapter can provide baseline summaries,
the repository selects the previous baseline ref from summary metadata first and loads only the selected
baseline row body for analysis.

This keeps UI/history selection and automated analysis aligned with the platform goal of measuring,
validating, and editing DPM profile state without eagerly loading stored artifact/report bodies.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| summary selector for latest previous profile baseline refs | changing the public `latest_previous` strategy name |
| repository use of summary projection before selected row body load | removing row-list fallback for existing adapters |
| tests proving row list bodies are not loaded for summary-capable adapters | production pagination cursor or retention policy |
| public selector export for direct summary callers | hosted HTTP baseline storage implementation |

## Implementation Units

### DPM-37 - Summary-First Previous Baseline Selection

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-selector.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Direct callers can select the latest previous baseline summary using body-free summary data.
- Repository selection uses adapter-provided summaries when available.
- Summary-capable adapters do not have to list full baseline row bodies for `latest_previous` selection.
- Repository loads only the selected baseline row by `baselineRef`.
- Row-list fallback remains available for existing adapters.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts test/gateway-runtime-profile-analysis.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- `latest_previous` can choose from body-free summary metadata before row-body loading.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
