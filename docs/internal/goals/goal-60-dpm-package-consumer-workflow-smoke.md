# Goal 60 - DPM Package Consumer Workflow Smoke

**Status: complete 2026-07-08**

> Predecessor: [Goal 59 - DPM Registry Snapshot Approval Metadata Guard](./goal-59-dpm-registry-snapshot-approval-metadata-guard.md)

## Purpose

Package subpath smoke tests proved that DPM public exports resolve at runtime and in TypeScript, but product consumers also need proof that the focused public subpaths can run a real workflow without deep imports or the root compatibility aggregate.

Goal 60 adds a built-package consumer workflow smoke that imports only public subpaths and executes the profile-to-registry approval path.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| built-package smoke using `@oa-sdk/dpm/profile`, `/gateway`, and `/storage` | new public API exports |
| captured Kafka fixture to profile artifact | live Kafka consumer loop |
| profile analysis to relationship hint approval | browser UI demo |
| in-memory registry repository save/export/audit assertions | production database adapter requirement |
| root `check:dpm-surface` gate integration | release publishing enablement |

## Implementation Units

### DPM-80 - Public Subpath Consumer Workflow Smoke

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/test/package-consumer-workflow-smoke.mjs`
- `packages/dpm/package.json`
- `package.json`
- `packages/dpm/README.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The smoke builds `@oa-sdk/dpm` and imports only public package subpaths.
- The smoke profiles a captured Kafka topic bundle through `@oa-sdk/dpm/profile`.
- The smoke analyzes and approves a profile relationship hint through `@oa-sdk/dpm/gateway`.
- The smoke saves the approved relationship and audit event through `@oa-sdk/dpm/storage`.
- The smoke asserts that the exported registry snapshot contains the approved relationship and no unsafe raw-value fragments.
- Root `pnpm check:dpm-surface` includes the workflow smoke.

Verification:
- `pnpm --filter @oa-sdk/dpm run smoke:consumer-workflow`
- `pnpm check:dpm-surface`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers have an automated proof that the focused DPM subpaths can run a profile-to-registry workflow without internal imports.
- CI package surface checks fail if built public subpaths can resolve but cannot execute the representative product flow.
