# Goal 25 - DPM Discovery Gateway Candidate Contract

**Status: complete 2026-07-07**

> Predecessor: [Goal 24 - DPM Measured Relationship Proposals](./goal-24-dpm-measured-relationship-proposals.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 24 made profile analysis produce measured review proposals. Goal 25 closes the next gateway
contract gap: relationship discovery/import endpoints must expose the same reviewable candidate
structure as the core discovery model, not a thin name/evidence reference placeholder.

This gives product/editor flows a machine-readable candidate shape with endpoints, evidence,
confidence, warnings, recommendations, exclusions, and non-executable status before anything can
be promoted into a relationship registry.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| OpenAPI schemas for full relationship candidate input/output | mutating registry rows from candidate import |
| discovery evidence, endpoint, threshold, exclusion, and summary schemas | auto-approving candidate relationships |
| discovery taxonomy const arrays shared by TypeScript and gateway schemas | inferring physical targets from measured profile proposals |
| gateway request/response fixtures using the core discovery fixture shape | changing compiler approved-registry semantics |

## Implementation Units

### DPM-45 - Relationship Discovery Gateway Candidate Contract

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/discovery/discovery-taxonomy.ts`
- `packages/dpm/src/discovery/discovery-relationship-candidate-types.ts`
- `packages/dpm/src/discovery/discovery-exclusion-types.ts`
- `packages/dpm/src/discovery/types.ts`
- `packages/dpm/src/public/relationship-discovery.ts`
- `packages/dpm/src/gateway/openapi-relationship-discovery-schemas.ts`
- `packages/dpm/src/gateway/openapi-relationship-candidate-import-schemas.ts`
- `packages/dpm/test/support/discovery-fixtures.ts`
- `packages/dpm/test/support/gateway-request-minimal-fixtures.ts`
- `packages/dpm/test/support/gateway-workflow-response-relationship-fixtures.ts`
- `packages/dpm/test/support/gateway-response-taxonomy-fixtures.ts`
- `packages/dpm/test/support/gateway-taxonomy-workflow-fixtures.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Gateway discovery response schema accepts the full `RelationshipDiscoveryReport` shape.
- Gateway candidate import request accepts full `RelationshipCandidateInput` entries.
- Candidate type, evidence kind, confidence level, recommendation, and exclusion reason enums come from runtime taxonomy const arrays.
- Discovery candidates remain `executable: false` and recommendations remain review/reject, not approval.
- Existing gateway request/response schema smoke tests exercise the richer candidate contract.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-schema-requests.test.ts test/gateway-schema-response-minimal.test.ts test/gateway-schema-response-required.test.ts test/gateway-schema-response-taxonomy.test.ts test/gateway-taxonomy-workflow.test.ts test/discovery-report.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm test -- discovery`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- DPM gateway relationship discovery/import contracts expose reviewable candidate evidence instead of placeholder names.
- Product/editor flows can validate candidate endpoints, evidence, confidence, warnings, and exclusion summaries before registry promotion.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
