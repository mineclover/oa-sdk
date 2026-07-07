# Goal 39 - DPM Profile Hint Approval Workflow

**Status: complete 2026-07-07**

> Predecessor: [Goal 31 - DPM Profile Relationship Candidate Bridge](./goal-31-dpm-profile-relationship-candidate-bridge.md), [Goal 32 - DPM Registry Approval Persistence Bridge](./goal-32-dpm-registry-approval-persistence-bridge.md), [Goal 38 - DPM Profile Hint Endpoint Resolution](./goal-38-dpm-profile-hint-endpoint-resolution.md)

## Purpose

Profile relationship hints could already be resolved into import-ready relationship candidates, and approved relationship
payloads could already be saved through the registry repository. Product consumers still had to wire the common path
manually: resolve hint, import candidate, approve, save, and export a compile-ready registry snapshot.

Goal 39 adds a thin runtime workflow that owns that orchestration while preserving the existing review boundary and
approved-only registry storage guard.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| profile hint to candidate import review workflow | automatic approval without reviewer metadata |
| review-only approval guard for candidates | live Kafka or source DB access |
| approved relationship save through `DpmRegistryWritableRepository` | implicit topic-to-table inference |
| exported registry snapshot after save | immutable audit/event storage |
| profile demo use of the product workflow | new OpenAPI endpoint |

## Implementation Units

### DPM-59 - Profile Hint Approval Workflow

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-profile-relationship-hint-approval.ts`
- `packages/dpm/src/gateway/runtime-relationship-approve.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/gateway-runtime-relationship-approval.test.ts`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `approveDpmProfileRelationshipHintRuntime()` resolves a profile hint into a candidate input, imports a normalized review report, approves the review candidate, saves the approved row, and exports the registry snapshot.
- `createDpmGatewayRuntime()` exposes `approveDpmProfileRelationshipHint()` for the same workflow.
- `approveDpmRelationshipCandidateRuntime()` rejects candidates whose recommendation is not `review`.
- Workflow rejects low-confidence/rejected candidates before registry mutation.
- Profile demo uses the workflow for its main approval/persistence path.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-runtime-relationship-approval.test.ts test/gateway-runtime.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- profile-demo`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers have one public runtime workflow for the profile hint approval path instead of hand-assembling the primitive sequence.
- Rejected relationship candidates cannot be promoted to approved registry payloads by the approval runtime.
- Public docs, package subpath smoke, feature-test matrix, and profile demo describe the implemented surface.
