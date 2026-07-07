# Goal 15 - DPM Profile Baseline Summary Storage Projection

**Status: complete 2026-07-07**

> Predecessor: [Goal 14 - DPM Profile Baseline Resolution Summary](./goal-14-dpm-profile-baseline-resolution-summary.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 13 exposed repository-backed baseline history summaries, but the repository still had to read full
profile baseline rows when the storage adapter only needed to serve list/UI summary data. Goal 15 makes
summary-only storage projection an optional adapter capability so product history screens can avoid loading
stored profile artifact and analysis report bodies when a storage backend can project summary columns directly.

The row-based storage contract remains the compatibility baseline. Existing adapters keep working without
implementing the optional summary projection.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| optional `listProfileBaselineSummaries()` on profile baseline storage adapters | hosted HTTP baseline summary endpoint |
| repository preference for adapter-provided summaries | production pagination or retention policy |
| defensive copy of storage-provided summaries | SQL migration or concrete database view |
| tests proving row bodies are not loaded when summary projection exists | changing `latest_previous` selection row requirements |

## Implementation Units

### DPM-35 - Summary-Only Profile Baseline Storage Projection

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-repository-contract-types.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/src/storage/profile-baseline-summary.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Storage adapters can optionally implement `listProfileBaselineSummaries()`.
- Repository `listProfileBaselineSummaries()` uses the adapter summary projection when available.
- Repository summary listing falls back to row listing plus SDK summary projection when the adapter does not provide summaries.
- Storage-provided summaries are defensively copied before reaching callers.
- Tests prove summary-only adapters do not load full profile baseline row bodies.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Profile baseline storage contract supports optional summary-only list projection.
- Repository summary list behavior is tested for both fallback row projection and adapter-provided summary projection.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
