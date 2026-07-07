# Goal 19 - DPM Profile Baseline Summary Consumer Smoke

**Status: complete 2026-07-07**

> Predecessor: [Goal 18 - DPM Profile Baseline Summary Invariants](./goal-18-dpm-profile-baseline-summary-invariants.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 16 exposed body-free profile baseline summaries through the gateway runtime and OpenAPI contract.
Goal 19 closes the consumer-facing proof gap: a product integration can read the documented OpenAPI
operation, validate the request and response schemas, route to the runtime handler, and receive a body-free
summary response without live DB or Kafka access.

This keeps DPM's machine-checkable gateway surface aligned with the platform goal of making flattened
Kafka/profile evidence measurable, editable, visualizable, and safe to analyze through stable contracts.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| OpenAPI operationId/request/response schema smoke for profile baseline summary listing | hosted HTTP server implementation |
| runtime handler invocation through `createDpmGatewayRuntime()` | production auth/rate-limit/error envelope mapping |
| request schema validation for `DpmProfileBaselineSummaryListRequest` | new baseline storage adapter implementation |
| response schema validation and body-free summary assertions | changing the gateway path or response shape |

## Implementation Units

### DPM-39 - Profile Baseline Summary Consumer Gateway Smoke

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The consumer smoke reads `/dpm/profiles/baselines/summaries` from `getDpmGatewayOpenApiDocument()`.
- The documented operation id is routed to `runtime.listDpmProfileBaselineSummaries()`.
- `DpmProfileBaselineSummaryListRequest` and `DpmProfileBaselineSummaryListResponse` validate through the gateway component schema compiler.
- The runtime response keeps baseline history body-free and does not expose `profileArtifact` or `analysisReport` bodies.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-consumer-smoke.test.ts test/gateway-runtime-profile-baselines.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- The profile baseline summary gateway operation is covered by consumer-level OpenAPI-to-runtime smoke.
- Feature-test matrix, progress index, and internal spec describe the implemented consumer proof.
