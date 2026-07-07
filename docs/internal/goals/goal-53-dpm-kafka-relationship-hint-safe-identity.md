# Goal 53 - DPM Kafka Relationship Hint Safe Identity

**Status: complete 2026-07-08**

> Predecessor: [Goal 52 - DPM Kafka Topic Profile Input Validation](./goal-52-dpm-kafka-topic-profile-input-validation.md)

## Purpose

Kafka relationship hints are user- or connector-provided evidence. Their ids flow into profile graph node ids, candidate relationship edge ids, evidence source ids, review proposal ids, and relationship candidate import ids.

Goal 53 makes relationship hint identities safe for machine editing and downstream proposal/candidate workflows when hint ids contain path-sensitive characters such as `.`, `/`, or `~`, while preserving the existing canonical `hint:...` fixture identity.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| safe relationship hint identity segment helper | changing approved registry identity |
| escaped hint graph node/edge/evidence ids | live Kafka/schema registry integration |
| escaped hint coordinate path and pointer | changing existing canonical fixture ids |
| reviewer proposal propagation from escaped edge id | broad proposal id migration outside Kafka hints |
| graph/proposal regression coverage | UI rendering changes |

## Implementation Units

### DPM-73 - Kafka Relationship Hint Safe Identity

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/kafka-profile-hint-identity.ts`
- `packages/dpm/src/profile/kafka-profile-hint-evidence.ts`
- `packages/dpm/src/profile/kafka-profile-hint-node.ts`
- `packages/dpm/src/profile/kafka-profile-hint-edge.ts`
- `packages/dpm/src/profile/kafka-profile-hint-diagnostic.ts`
- `packages/dpm/test/profile-kafka-graph-hints.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Canonical `hint:orders-created-customer` graph/proposal ids remain unchanged.
- Hint ids containing `.`, `/`, and `~` are escaped in graph node ids, edge ids, evidence ids, and coordinate paths.
- JSON Pointer coordinates preserve the original hint id through RFC6901 escaping.
- Escaped candidate relationship edges still produce reviewer proposals through `createDpmProfileAnalysisReport()`.
- Unresolved relationship hint diagnostics use the same safe path/pointer helper.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-graph-hints.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm demo:dpm:profile`
- `pnpm build:scripts && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Kafka relationship hint ids can safely pass through graph evidence and reviewer proposal generation without path/pointer collisions.
- Existing canonical fixture proposal ids remain stable for current consumers.
