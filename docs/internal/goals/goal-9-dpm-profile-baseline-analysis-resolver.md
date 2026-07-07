# Goal 9 - DPM Profile Baseline Analysis Resolver

**Status: complete 2026-07-07**

> Predecessor: [Goal 8 - DPM Profile Baseline Storage](./goal-8-dpm-profile-baseline-storage.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 8 made profile baselines persistable. Goal 9 connects that stored measurement baseline to the
profile analysis runtime path: product code can accept an OpenAPI profile analysis request that names
a previous profile baseline by ref, resolve it through the SDK baseline repository, and pass a loaded
previous profile artifact to the existing `analyzeDpmProfile` runtime handler.

The goal is not to add hosted HTTP storage endpoints or automatic baseline selection. The goal is the
consumer-side resolver contract that keeps gateway request bodies ref-based while preserving the
existing source-free runtime handler shape.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| profile analysis request baseline ref vocabulary | concrete HTTP route implementation |
| resolver-backed request to runtime input conversion | automatic baseline retention or selection |
| OpenAPI request schema support for `previousProfileBaseline` | live Kafka/database connector scheduling |
| Kafka profile demo using stored baseline ref resolution | production SQL migration |
| ambiguous/missing baseline guard errors | source credential or raw payload persistence |

## Implementation Units

### DPM-29 - Profile Baseline Analysis Resolver

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-profile-analysis-request-types.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-exchange-schemas.ts`
- `packages/dpm/test/gateway-runtime-profile-analysis.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/examples/profile-kafka/README.md`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Tasks:
- Define a profile analysis request shape that can carry `previousProfileBaseline`.
- Resolve a stored profile baseline row into `previousProfileArtifact` before calling the loaded
  runtime analysis handler.
- Reject requests that provide both inline `previousProfileArtifact` and `previousProfileBaseline`.
- Reject unresolved baseline refs before runtime analysis.
- Keep the OpenAPI `DpmProfileAnalysisRequest` schema aligned with the new baseline ref request shape.
- Update the Kafka profile demo to store a previous baseline and analyze the current profile through
  baseline ref resolution.

Acceptance:
- Consumers can resolve a stored profile baseline ref into a profile analysis runtime input.
- Runtime analysis emits drift signals against the resolved previous profile artifact.
- Profile analysis request schema accepts the baseline ref form.
- The documented Kafka profile demo proves baseline repository save plus baseline ref resolution.
- Missing or ambiguous baseline requests fail before producing misleading drift analysis.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-analysis.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm demo:dpm:profile`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Breakpoints

Stop and update this goal before implementation if the next unit requires:
- hosted profile baseline CRUD endpoints,
- baseline retention policy or automatic baseline selection,
- concrete SQL migration ownership,
- live source connector scheduling,
- source credential, raw payload, or reverse lookup persistence.

## Done Criteria

- Public gateway runtime exports include the profile analysis baseline resolver.
- OpenAPI profile analysis request schema includes `previousProfileBaseline`.
- Tests prove schema-valid baseline ref analysis, drift output, and missing/ambiguous request guards.
- The Kafka profile demo uses a stored baseline ref rather than direct previous artifact wiring.
- API index, feature-test matrix, and internal spec describe the implemented resolver surface.
