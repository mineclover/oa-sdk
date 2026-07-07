# Goal 24 - DPM Measured Relationship Proposals

**Status: complete 2026-07-07**

> Predecessor: [Goal 23 - DPM Gateway Blocking Response Contract](./goal-23-dpm-gateway-blocking-response-contract.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 23 closed gateway failure-contract drift. Goal 24 closes the next profile-analysis gap:
Kafka profile analysis should not depend only on supplied relationship hints. Flattened profile fields and
their measurement metrics can produce review-only relationship proposals that are machine-generated,
schema-valid, and still non-executable.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| measurement-derived relationship review proposals from high-presence identifier-like fields | auto-approving or writing registry relationships |
| proposal `source` taxonomy for explicit vs measured candidates | guessing physical target references without evidence |
| optional `hintNodeId` for analysis-owned measured proposals | mutating profile artifact graph nodes or edges during analysis |
| OpenAPI schema and taxonomy projection for the new proposal source | changing proposal review decision statuses |

## Implementation Units

### DPM-44 - Measurement-Derived Relationship Review Proposals

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-hints.ts`
- `packages/dpm/src/profile/analysis-relationship-hint-types.ts`
- `packages/dpm/src/profile/analysis-taxonomy.ts`
- `packages/dpm/src/profile/analysis-report-copy.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-relationship-hint-schemas.ts`
- `packages/dpm/src/gateway/runtime-profile-proposal-review.ts`
- `packages/dpm/src/public/profile-analysis.ts`
- `packages/dpm/test/profile-analysis-relationship-hints.test.ts`
- `packages/dpm/test/support/gateway-taxonomy-profile-fixtures.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Explicit Kafka relationship hints remain review-only proposals with `source: "explicit_hint"`.
- High-presence identifier-like flattened fields can become review-only proposals with `source: "measured_key_candidate"`.
- Measured proposals do not require `hintNodeId` or `targetRef`, because analysis has not proven a target relationship.
- Explicit candidate relationships suppress duplicate measured proposals for the same source node.
- Gateway schemas expose and validate the relationship proposal source taxonomy.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-relationship-hints.test.ts test/gateway-taxonomy-profile.test.ts test/gateway-runtime-profile-proposal-review.test.ts test/gateway-blocking-response-contract.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- profile-analysis`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- DPM profile analysis can surface machine-derived relationship review candidates from measured Kafka fields without source DB/Kafka access.
- The measured candidates remain review-only and schema-valid across gateway/runtime copies.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
