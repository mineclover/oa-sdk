# Goal 54 - DPM Kafka Relationship Hint Source Pointer

**Status: complete 2026-07-08**

> Predecessor: [Goal 53 - DPM Kafka Relationship Hint Safe Identity](./goal-53-dpm-kafka-relationship-hint-safe-identity.md)

## Purpose

Kafka relationship hints should be authorable by product surfaces, automatic profilers, and editors without requiring callers to know DPM's internal flattened path percent-escape rules.

Goal 54 lets relationship hints identify their source field with an RFC6901 JSON Pointer through `fromPointer`, while keeping `fromPath` as the compatibility path for existing fixtures and consumers.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| optional `fromPointer` relationship hint source selector | changing profile coordinate pointer semantics |
| source selector normalization into canonical field path | live Kafka/schema registry integration |
| validation that at least one selector is present | broad relationship hint targetRef resolver changes |
| validation that dual selectors resolve to the same source field | UI authoring surface |
| graph/proposal regression coverage for pointer selectors | migration of existing fixtures away from `fromPath` |

## Implementation Units

### DPM-74 - Kafka Relationship Hint Source Pointer

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/kafka-fixture-hint-types.ts`
- `packages/dpm/src/profile/kafka-profile-hint-source.ts`
- `packages/dpm/src/profile/kafka-profile-hint-node.ts`
- `packages/dpm/src/profile/kafka-profile-hint-edge.ts`
- `packages/dpm/src/profile/kafka-profile-hint-diagnostic.ts`
- `packages/dpm/src/profile/kafka-topic-profile-input-validation.ts`
- `packages/dpm/test/profile-kafka-connector.test.ts`
- `packages/dpm/test/profile-kafka-graph-fields.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Existing `fromPath` relationship hints remain valid.
- `fromPointer` relationship hints resolve to the same flattened field node ids used by existing profile graph fields.
- `fromPointer` handles JSON Pointer escaping for `.`, `/`, and `~` field names without requiring pre-escaped `fromPath`.
- Missing source selectors fail input validation before graph generation.
- Dual `fromPath` and `fromPointer` selectors fail input validation when they resolve to different fields.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm demo:dpm:profile`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/editor callers can author Kafka relationship hints with JSON Pointer source selectors.
- DPM still rejects ambiguous or missing relationship hint source selectors before emitting graph artifacts.
