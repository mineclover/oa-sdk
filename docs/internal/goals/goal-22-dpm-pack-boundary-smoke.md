# Goal 22 - DPM Pack Boundary Smoke

**Status: complete 2026-07-07**

> Predecessor: [Goal 21 - DPM Subpath Consumer Smoke](./goal-21-dpm-subpath-consumer-smoke.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 21 proved that built DPM category subpaths can be imported at runtime and by TypeScript consumers.
Goal 22 closes the package-file boundary: the build now starts from a clean `dist`, and dry-run packaging
proves the exported files are included while source, tests, examples, and stale build leftovers are excluded.

This matters for the DPM platform because product consumers should be able to trust the package artifact,
not only the source tree, when using DPM as a library contract.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| clean `dist` before DPM build | publishing to a registry |
| stale dist sentinel check before pack smoke | package size optimization |
| `npm pack --dry-run --json` file boundary validation | creating an actual tarball artifact |
| export/bin file inclusion checks | changing package privacy or release policy |

## Implementation Units

### DPM-42 - Clean Build And Pack Dry-Run Boundary

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/package.json`
- `packages/dpm/test/package-pack-smoke.mjs`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `pnpm --filter @oa-sdk/dpm build` removes existing `dist` before emitting package outputs.
- `pnpm --filter @oa-sdk/dpm run smoke:pack` plants a stale dist sentinel, runs the clean build, and performs `npm pack --dry-run --json`.
- Pack smoke verifies every package export import/types file and bin file is present in the dry-run file list.
- Pack smoke rejects files outside `dist/` plus `package.json`, and rejects the stale sentinel if build cleanup regresses.

Verification:
- `pnpm --filter @oa-sdk/dpm run smoke:pack`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- DPM package build and dry-run packaging prove the library artifact contains the exported runtime/declaration files without stale or out-of-boundary package content.
- API index, feature-test matrix, progress index, and internal spec describe the implemented pack boundary smoke.
