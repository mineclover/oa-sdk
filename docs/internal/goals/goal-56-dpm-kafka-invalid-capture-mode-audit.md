# Goal 56 - DPM Kafka Invalid Capture Mode Audit

**Status: complete 2026-07-08**

> Predecessor: [Goal 52 - DPM Kafka Topic Profile Input Validation](./goal-52-dpm-kafka-topic-profile-input-validation.md)

## Purpose

Failed Kafka profile connector results must remain valid connector envelopes, but product operators still need to see a safe preview of the invalid `captureMode` value that was rejected.

Goal 56 preserves short rejected string values in the `CONN201` diagnostic message, escapes/truncates unsafe previews, and keeps failed connector results on a valid fallback connector `captureMode`.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| bounded invalid `captureMode` diagnostic message audit detail | connector result envelope metadata redesign |
| failed result compatibility with existing connector validator | accepting unsupported capture modes |
| focused regression coverage | raw payload inspection |

## Implementation Units

### DPM-76 - Kafka Invalid Capture Mode Audit

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/kafka-topic-profile-input-validation.ts`
- `packages/dpm/test/profile-kafka-connector.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Invalid short string capture modes are preserved in the `CONN201` diagnostic message.
- Long or control-character capture modes are escaped/truncated in the diagnostic message.
- Failed connector results still use a valid connector `captureMode` and pass `validateDpmProfileConnectorResult()`.
- Non-string invalid capture modes are described by type rather than serializing arbitrary payload objects.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm demo:dpm:profile`
- `pnpm build:scripts && pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Operators can see a bounded preview of the rejected Kafka capture mode in machine-readable connector diagnostics.
- The connector result envelope remains valid and compatible for failed runs.
