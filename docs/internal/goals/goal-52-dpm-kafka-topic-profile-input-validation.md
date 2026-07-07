# Goal 52 - DPM Kafka Topic Profile Input Validation

**Status: complete 2026-07-08**

> Predecessor: [Goal 51 - DPM Kafka Topic Profile Connector Contract](./goal-51-dpm-kafka-topic-profile-connector-contract.md)

## Purpose

Goal 51 added the public `profileKafkaTopic()` connector contract for already captured Kafka topic bundle evidence. Product consumers can call that contract from JavaScript, generated adapters, demos, or future platform import flows, so malformed captured bundles must be rejected before graph construction.

Goal 52 adds a runtime validation boundary for Kafka topic profile input. The validator reports machine-readable connector diagnostics and `profileKafkaTopic()` converts malformed input into a failed connector result instead of throwing or emitting a partial profile artifact.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| captured Kafka topic profile input runtime shape validation | live Kafka client integration |
| `CONN201` diagnostics for malformed input fields | schema registry network validation |
| failed connector result path for malformed input | raw payload inspection |
| public validator export through `@oa-sdk/dpm/profile` | proposal id migration |
| subpath runtime/type smoke coverage | advanced semantic inference |

## Implementation Units

### DPM-72 - Kafka Topic Profile Input Validation

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/kafka-topic-profile-input-validation.ts`
- `packages/dpm/src/profile/kafka.ts`
- `packages/dpm/src/public/profile-kafka.ts`
- `packages/dpm/test/profile-kafka-connector.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `validateDpmKafkaTopicProfileInput()` is exported from the profile public surface.
- Malformed captured Kafka topic input returns `valid: false` with `CONN201` diagnostics.
- Invalid `captureMode` diagnostics preserve short rejected string values and escape/truncate unsafe previews.
- `profileKafkaTopic()` returns `status: "failed"` with no `profileArtifact` for malformed input.
- Failed Kafka connector results still pass the generic connector result validator.
- Fixture wrapper callers that pass malformed runtime values get a failed result instead of a thrown exception.
- Public subpath runtime and type consumer smokes cover the new validator API.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Kafka profile graph generation is protected by a runtime input validation boundary.
- Malformed captured input is represented as deterministic connector diagnostics, not partial graph state.
