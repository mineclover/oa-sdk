# Goal 20 - DPM Category Subpath Exports

**Status: complete 2026-07-07**

> Predecessor: [Goal 19 - DPM Profile Baseline Summary Consumer Smoke](./goal-19-dpm-profile-baseline-summary-consumer-smoke.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

The DPM package had an internally well-grouped public surface, but library consumers still had to import
through the root `@oa-sdk/dpm` entrypoint. Goal 20 makes the category structure explicit at the package
boundary so product code can depend on focused surfaces such as catalog, profile, gateway, storage, and
publishing without reaching into implementation modules.

This keeps the implementation aligned with the long-term platform direction: DPM can be consumed as a set
of stable, machine-checkable library contracts for data structure profiling, pseudonymization planning,
gateway integration, storage-backed baseline history, and product/editor workflows.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| package export map for DPM category barrels | publishing `@oa-sdk/dpm` outside the private workspace |
| tsup build entrypoints for exported category barrels | exposing every internal implementation file as a package subpath |
| package smoke test for export map/build entrypoint parity | changing root `@oa-sdk/dpm` compatibility exports |
| docs/API index/feature matrix/progress index updates | changing package versioning or release policy |

## Implementation Units

### DPM-40 - DPM Category Package Subpath Surface

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/package.json`
- `packages/dpm/test/package-subpath-exports.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `@oa-sdk/dpm` remains the compatibility root entrypoint.
- `@oa-sdk/dpm/package`, `@oa-sdk/dpm/catalog`, `@oa-sdk/dpm/profile`, `@oa-sdk/dpm/relationship`, `@oa-sdk/dpm/gateway`, `@oa-sdk/dpm/storage`, and `@oa-sdk/dpm/publishing` are package exports.
- The DPM build emits JS and declaration files for every category subpath.
- Package smoke coverage fails if an exported subpath is missing from either the export map or the build entrypoints.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- built package self-reference import smoke from `packages/dpm`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Product consumers have stable category subpaths for DPM library imports.
- The package export map, build entrypoints, API index, feature-test matrix, progress index, and internal spec all describe the implemented surface.
