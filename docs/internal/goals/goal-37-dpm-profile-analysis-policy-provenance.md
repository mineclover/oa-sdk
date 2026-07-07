# Goal 37 - DPM Profile Analysis Policy Provenance

**Status: complete 2026-07-07**

> Predecessor: [Goal 33 - DPM Profile Analysis Policy Contract](./goal-33-dpm-profile-analysis-policy-contract.md)

## Purpose

Profile analysis policy thresholds affect relationship hints, key candidate confidence, risk indicators, and report
hashes. Before this goal, consumers could pass policy overrides, but the resulting analysis report did not retain
which resolved policy produced the signals.

Goal 37 makes profile analysis reports reproducible by carrying the resolved analysis policy and a deterministic
policy hash in the report freshness envelope.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| resolved analysis policy on report output | new policy fields |
| deterministic analysis policy hash | policy version migration registry |
| report hash sensitivity to policy changes | UI diff visualizations |
| OpenAPI report/freshness schema updates | long-term baseline retention policy |
| baseline defensive copy of policy provenance | automatic relationship approval |

## Implementation Units

### DPM-57 - Profile Analysis Policy Provenance

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-policy.ts`
- `packages/dpm/src/profile/analysis-report.ts`
- `packages/dpm/src/profile/analysis-report-types.ts`
- `packages/dpm/src/profile/analysis-report-freshness-types.ts`
- `packages/dpm/src/profile/analysis-report-signals.ts`
- `packages/dpm/src/profile/analysis-report-structural.ts`
- `packages/dpm/src/profile/analysis-report-copy.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-report-envelope-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-freshness-schemas.ts`
- `packages/dpm/test/profile-analysis-policy.test.ts`
- `packages/dpm/test/profile-analysis-report.test.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `createDpmProfileAnalysisReport()` resolves policy once and includes it as `analysisPolicy`.
- `DpmProfileAnalysisFreshness.analysisPolicyHash` records a deterministic hash of the resolved policy.
- Report hash changes when policy changes because the structural report includes `analysisPolicy`.
- Gateway analysis report schemas expose `analysisPolicy` and `analysisPolicyHash`.
- Profile baseline repository copy boundaries preserve policy provenance and isolate caller-side mutations.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-policy.test.ts test/profile-analysis-report.test.ts test/gateway-runtime-profile-analysis.test.ts test/storage-profile-baseline-repository.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm --filter @oa-sdk/dpm test -- profile-analysis`
- `pnpm --filter @oa-sdk/dpm test -- storage-profile-baseline`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Analysis reports are self-describing enough to explain which threshold policy produced their signals.
- Baseline storage preserves analysis policy provenance for later current-vs-previous review.
- Public docs and package subpath smoke expose the policy hash helper and report contract.
