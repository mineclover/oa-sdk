# Goal 16 - DPM Profile Baseline Summary Gateway

**Status: complete 2026-07-07**

> Predecessor: [Goal 15 - DPM Profile Baseline Summary Storage Projection](./goal-15-dpm-profile-baseline-summary-storage-projection.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 15 made body-free profile baseline summaries available through storage adapters, but product/API
consumers still had to call the storage repository directly. Goal 16 promotes that summary projection to
the DPM gateway contract and runtime so history UIs, editor selection panels, and automated analysis
flows can request baseline summary history without loading stored profile artifact or analysis report bodies.

The gateway remains source-access-free. It accepts an already-bound consumer repository and returns only
summary metadata.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `listDpmProfileBaselineSummaries` runtime operation | hosted HTTP server implementation |
| OpenAPI request/response schemas for profile baseline summary lists | production pagination cursor or retention policy |
| demo path using the gateway summary list command | changing `latest_previous` row-body selection requirements |
| schema/runtime tests for body-free summary responses | SQL migration or concrete database view |

## Implementation Units

### DPM-36 - Profile Baseline Summary Gateway Operation

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-profile-baseline-summaries.ts`
- `packages/dpm/src/gateway/runtime-profile-types.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-operation-ids.ts`
- `packages/dpm/src/gateway/runtime-response-types.ts`
- `packages/dpm/src/gateway/openapi-operation-ids.ts`
- `packages/dpm/src/gateway/openapi-profile-paths.ts`
- `packages/dpm/src/gateway/profile-openapi-baseline-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/test/gateway-runtime-profile-baselines.test.ts`
- `packages/dpm/test/gateway-schema-requests.test.ts`
- `packages/dpm/test/gateway-schema-response-minimal.test.ts`
- `packages/dpm/test/gateway.test.ts`
- `packages/dpm/test/profile-demo-command.test.ts`

Acceptance:
- Gateway OpenAPI exposes a profile baseline summary list request/response shape.
- Runtime factory exposes `listDpmProfileBaselineSummaries`.
- Runtime summary list responses are schema-valid and exclude baseline row bodies.
- Non-positive summary list limits fail before adapter access.
- The Kafka profile demo obtains baseline history through the gateway runtime command.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-baselines.test.ts test/gateway.test.ts test/gateway-schema-requests.test.ts test/gateway-schema-response-minimal.test.ts test/gateway-schema-response-required.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Done Criteria

- Profile baseline summary history is reachable through both public gateway runtime exports and OpenAPI.
- Product demos use the gateway summary list operation instead of direct repository summary calls.
- API index, feature-test matrix, progress index, and internal spec describe the implemented surface.
