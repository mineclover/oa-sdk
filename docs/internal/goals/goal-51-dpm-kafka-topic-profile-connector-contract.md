# Goal 51 - DPM Kafka Topic Profile Connector Contract

**Status: complete 2026-07-08**

> Predecessor: [Goal 7 - DPM Profile/Connector Contract](./goal-7-dpm-profile-connector-contract.md)

## Purpose

The Kafka profile surface previously exposed `profileKafkaTopicFixture()` as the only public topic profiling entrypoint. That was useful for deterministic tests, but product consumers need a non-fixture-named contract for already captured and flattened Kafka topic evidence.

Goal 51 introduces `profileKafkaTopic()` as the public captured topic bundle connector contract. It does not connect to Kafka or consume live messages; it converts caller-provided topic shape, schema, metric, field, and relationship-hint evidence into the existing DPM profile artifact and connector result envelopes.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| captured Kafka topic bundle input vocabulary | live Kafka client integration |
| product default connector id/version | schema registry network access |
| `snapshot` capture mode default | raw message payload sampling |
| fixture wrapper compatibility | credential handling |
| profile demo using the product connector function | streaming consumer loop |

## Implementation Units

### DPM-71 - Kafka Topic Profile Connector Contract

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/kafka-topic-profile-input-types.ts`
- `packages/dpm/src/profile/kafka.ts`
- `packages/dpm/src/profile/kafka-topic-profile.ts`
- `packages/dpm/src/profile/kafka-topic-source.ts`
- `packages/dpm/src/public/profile-kafka.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/examples/profile-kafka/README.md`
- `packages/dpm/test/profile-kafka-connector.test.ts`
- `packages/dpm/test/profile-kafka-connector-freshness.test.ts`
- `packages/dpm/test/profile-kafka-graph-sections.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `profileKafkaTopic()` is exported from the profile public surface.
- The default product connector id is `dpm.kafka.topic-profile`.
- The default capture mode is `snapshot`.
- The fixture API remains available and preserves `fixture` capture mode.
- The profile demo exercises `profileKafkaTopic()` instead of only the fixture wrapper.
- Public subpath runtime and type consumer smokes cover the new profile API.
- Kafka source version hashes change with captured source evidence, not profile run metadata.
- Header/schema section coordinates use escaped path/pointer segments.
- Empty schema version evidence remains schema-valid and emits a `PROF302` diagnostic instead of unsafe shape values.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm demo:dpm:profile`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Product code can call a non-fixture-named Kafka topic profile connector contract for captured topic bundle evidence.
- Existing fixture-backed tests continue to use the compatibility wrapper without changing their semantics.
