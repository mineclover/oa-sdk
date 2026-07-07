# Goal 57 - DPM Package Consumer Surface Guide

**Status: complete 2026-07-08**

> Predecessor: [Goal 56 - DPM Kafka Invalid Capture Mode Audit](./goal-56-dpm-kafka-invalid-capture-mode-audit.md)

## Purpose

DPM has grown into a multi-surface product package. Consumers need a package-local guide that explains which public subpath to import, what each category owns, and which safety boundaries apply in production flows.

Goal 57 makes the consumer-facing package surface explicit without widening or reshaping the actual API.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| package-local README for public subpath routing | removing the root compatibility aggregate |
| DPM contract version vs package version clarification | npm publishing enablement |
| pack smoke alignment for README inclusion | new runtime behavior |
| storage adapter production guidance | storage adapter redesign |

## Implementation Units

### DPM-77 - Package Consumer Surface Guide

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/README.md`
- `packages/dpm/test/package-pack-smoke.mjs`
- `docs/internal/spec.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`

Acceptance:
- The package-local README maps each public subpath to its use case and source owner.
- The README states that root `@oa-sdk/dpm` is a compatibility aggregate and new consumers should prefer subpaths.
- The README distinguishes DPM contract baseline version from the package implementation version.
- The README documents safety boundaries for connectors, read-only catalog profiling, publishing, and production registry approval storage.
- Pack smoke treats README inclusion as intentional package documentation while continuing to reject source/test/example leakage.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm run smoke:pack`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers can select the DPM import surface without reading internal implementation files.
- Package pack boundary remains explicit and still excludes source/test/example files.
