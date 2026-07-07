# Goal 33 - DPM Profile Analysis Policy Contract

**Status: complete 2026-07-07**

> Predecessor: [Goal 32 - DPM Registry Approval Persistence Bridge](./goal-32-dpm-registry-approval-persistence-bridge.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Profile analysis already produced relationship hints, key candidates, risk indicators, and drift signals, but
the analysis thresholds were fixed inside implementation files. That made the Kafka fixture path deterministic
but left product consumers without a stable way to explain, tune, validate, or replay profile-analysis
decisions across domains.

Goal 33 turns those hidden thresholds into an explicit policy contract. Consumers can keep the default behavior
or pass ratio-based overrides through the SDK or gateway request resolver before analysis.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| profile analysis policy type, defaults, and resolver | persisted policy history/audit table |
| measured relationship hint threshold and confidence cap | model training or probabilistic inference |
| risk threshold and identifier fallback confidence overrides | automatic relationship approval |
| OpenAPI profile analysis request policy schema | manifest policy body ownership |
| public profile subpath exports and subpath consumer smoke | UI policy editor |
| API index, feature matrix, spec, and progress updates | live Kafka or source DB access |

## Implementation Units

### DPM-53 - Profile Analysis Policy Contract

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-policy-types.ts`
- `packages/dpm/src/profile/analysis-policy.ts`
- `packages/dpm/src/profile/analysis-input-types.ts`
- `packages/dpm/src/profile/analysis-report-signals.ts`
- `packages/dpm/src/profile/analysis-hints.ts`
- `packages/dpm/src/profile/analysis-key-candidates.ts`
- `packages/dpm/src/profile/analysis-risk-metrics.ts`
- `packages/dpm/src/profile/analysis-risks.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request-types.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-exchange-schemas.ts`
- `packages/dpm/src/public/profile-analysis.ts`
- `packages/dpm/test/profile-analysis-policy.test.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `DEFAULT_DPM_PROFILE_ANALYSIS_POLICY` preserves the previous analysis behavior.
- `resolveDpmProfileAnalysisPolicy()` merges partial overrides and rejects non-finite or out-of-range ratios.
- `createDpmProfileAnalysisReport()` applies policy overrides to measured relationship hints, risk thresholds, and identifier fallback confidence.
- `DpmProfileAnalysisRequest` accepts an optional partial policy object and request resolution forwards it into runtime analysis input.
- Public profile subpath exports the policy type, default policy, and resolver for consumer code.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-policy.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-analysis-risk.test.ts test/profile-analysis-key-candidates.test.ts test/gateway-runtime-profile-analysis.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- profile-analysis`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers can make profile-analysis thresholds explicit without forking analyzer internals.
- Gateway and SDK usage paths resolve the same policy contract.
- Existing defaults remain compatible with current Kafka profile analysis outputs.
