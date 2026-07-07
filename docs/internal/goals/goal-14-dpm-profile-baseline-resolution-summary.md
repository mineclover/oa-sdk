# Goal 14 - DPM Profile Baseline Resolution Summary

**Status: complete 2026-07-07**

> Predecessor: [Goal 13 - DPM Profile Baseline Summary Repository](./goal-13-dpm-profile-baseline-summary-repository.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 13 made baseline history summaries available through the repository. Goal 14 carries the selected
baseline summary through the profile analysis request resolver so product code can audit and visualize
which stored baseline was used by an exact `baselineRef` or by `latest_previous` selection.

The existing `resolveDpmGatewayProfileAnalysisRuntimeInput()` API remains compatible for consumers that
only need runtime input. The new resolved-request API is the product-oriented path for UI, audit, and
demo output because it returns the runtime input and selected body-free baseline summary together.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| resolved profile analysis request API with selected baseline summary metadata | hosted baseline resolution endpoint |
| OpenAPI mutual exclusion for inline previous profile vs stored baseline | production pagination or retention policy |
| positive integer `previousProfileBaseline.limit` contract | storage adapter summary-only query |
| Kafka profile demo output based on actual resolver selection | live Kafka/database connector scheduling |

## Implementation Units

### DPM-34 - Profile Baseline Resolution Summary

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-profile-analysis-request-types.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-exchange-schemas.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/test/gateway-runtime-profile-analysis.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Consumers can call `resolveDpmGatewayProfileAnalysisRequest()` to get runtime input and selected `DpmProfileBaselineSummary`.
- The existing `resolveDpmGatewayProfileAnalysisRuntimeInput()` remains available and delegates to the resolved-request path.
- Exact `baselineRef` and `latest_previous` selection both expose selected baseline summary metadata.
- OpenAPI rejects requests that provide both `previousProfileArtifact` and `previousProfileBaseline`.
- `previousProfileBaseline.limit` is accepted only with a selection strategy and must be positive.
- The Kafka profile demo reports the selected baseline summary from the resolver result.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-analysis.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm demo:dpm:profile`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Runtime resolver output keeps selected baseline identity available to product surfaces.
- Gateway schema and runtime validation agree on profile analysis previous input exclusivity and selection limit rules.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
