# Goal 21 - DPM Subpath Consumer Smoke

**Status: complete 2026-07-07**

> Predecessor: [Goal 20 - DPM Category Subpath Exports](./goal-20-dpm-category-subpath-exports.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 20 opened DPM category subpaths in the package export map. Goal 21 proves those subpaths are
usable by a package consumer after build: Node can resolve the runtime modules, and TypeScript can resolve
the declaration entrypoints through package exports.

This closes the library-consumption gap for product code that wants focused DPM imports such as
`@oa-sdk/dpm/profile`, `@oa-sdk/dpm/gateway`, and `@oa-sdk/dpm/storage` without depending on internal source
paths.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| build-before-smoke package script | publishing package tarball verification |
| runtime self-reference imports for every DPM category subpath | browser-specific DPM subpath bundle |
| TypeScript declaration consumer smoke for every DPM category subpath | exposing implementation deep imports |
| docs/feature matrix/progress index updates | changing root export compatibility |

## Implementation Units

### DPM-41 - Built DPM Subpath Runtime And Type Consumer Smoke

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/package.json`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths` builds the package before checking subpaths.
- Runtime import smoke resolves `@oa-sdk/dpm/package`, `/catalog`, `/profile`, `/relationship`, `/gateway`, `/storage`, and `/publishing`.
- Type consumer smoke resolves exported values and types from the same subpaths through declaration files.
- Feature-test matrix points at the runtime/type consumer smoke artifacts and the package smoke command.

Verification:
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- DPM category package subpaths are automatically verified as build outputs, runtime imports, and TypeScript declaration imports.
- API index, feature-test matrix, progress index, and internal spec describe the implemented consumer smoke.
