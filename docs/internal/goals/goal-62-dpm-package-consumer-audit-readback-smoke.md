# Goal 62 - DPM Package Consumer Audit Readback Smoke

**Status: complete 2026-07-08**

> Predecessor: [Goal 61 - DPM Registry Conflict Blocking Stabilization](./goal-61-dpm-registry-conflict-blocking-stabilization.md)

## Purpose

The built package consumer workflow proved profile-to-registry approval and approved-conflict blocking through focused public subpaths. Product users also need to read the approval audit timeline immediately after approval without reaching into internal modules.

Goal 62 extends the built public subpath workflow smoke so the representative consumer path covers approval, persisted audit timeline readback, and conflict non-duplication.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| built-package smoke using `@oa-sdk/dpm/profile`, `/gateway`, and `/storage` | new public API exports |
| registry audit timeline readback through `createDpmGatewayRuntime()` | new audit storage schema |
| audit event count remains stable after blocked approved-conflict retry | live database audit query |
| docs/feature matrix/progress index updates | browser/editor UI |

## Implementation Units

### DPM-82 - Public Subpath Audit Readback Smoke

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/test/package-consumer-workflow-smoke.mjs`
- `packages/dpm/README.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The smoke builds `@oa-sdk/dpm` and imports only public package subpaths.
- The smoke approves a Kafka-derived relationship hint and reads back the persisted audit event through the public gateway runtime.
- The smoke asserts the audit event id and relationship version returned by timeline readback.
- The smoke retries a conflicting approved version and proves the audit timeline remains a single approval event.
- The smoke keeps the raw-value/secret fragment exclusion assertion over approval, audit readback, and blocking outputs.

Verification:
- `pnpm --filter @oa-sdk/dpm run smoke:consumer-workflow`
- `pnpm check:dpm-surface`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers have automated proof that focused DPM subpaths can approve a profile-derived relationship and read back the approval audit timeline without internal imports.
- Blocking retries do not create additional relationship rows or audit events in the representative built-package workflow.
