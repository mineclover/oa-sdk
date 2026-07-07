# Goal 42 - DPM Profile Hint Approval Gateway Contract

**Status: complete 2026-07-07**

> Predecessor: [Goal 41 - DPM Registry Audit Event Timeline Runtime](./goal-41-dpm-registry-audit-event-timeline-runtime.md)

## Purpose

Goal 39 introduced the product workflow that turns a profile relationship hint into a registry-approved relationship. Goal 42 exposes that workflow as a documented gateway contract so product/editor consumers can route a profile hint approval request through OpenAPI, validate success and blocking responses, persist the approved relationship through a consumer repository, and read back a registry snapshot without direct DB/Kafka access.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| OpenAPI profile relationship hint approval path | hosted HTTP server implementation |
| request body schema excluding path-owned relationship name and runtime repository | transaction manager or database-specific adapter |
| success response schema with candidate import, approved relationship, write receipt, and registry snapshot | UI approval screen |
| blocking response schema for endpoint resolution and non-reviewable candidate diagnostics | automatic relationship approval |
| consumer smoke from OpenAPI schema refs to runtime response | source DB/Kafka access |

## Implementation Units

### DPM-62 - Profile Hint Approval Gateway Contract

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/openapi-operation-ids.ts`
- `packages/dpm/src/gateway/openapi-profile-paths.ts`
- `packages/dpm/src/gateway/profile-openapi.ts`
- `packages/dpm/src/gateway/profile-openapi-relationship-hint-approval-schemas.ts`
- `packages/dpm/src/gateway/openapi-relationship-registry-schemas.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-profile-relationship-hint-approval.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/gateway-blocking-response-contract.test.ts`
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `packages/dpm/test/gateway-schema-profile-editor.test.ts`
- `packages/dpm/test/support/gateway-contract-fixtures.ts`
- `packages/dpm/test/support/gateway-request-minimal-fixtures.ts`
- `packages/dpm/test/support/gateway-request-schema-fixtures.ts`
- `packages/dpm/test/support/gateway-workflow-response-profile-fixtures.ts`
- `packages/dpm/test/support/gateway-workflow-response-schema-fixtures.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- OpenAPI exposes `POST /dpm/profiles/relationship-hints/{relationshipName}/approve`.
- Request schema excludes runtime-only repository injection and path-owned relationship name.
- Request schema requires at least one child table resolver input.
- Success response validates candidate import, review candidate, approved relationship, logical registry write receipt, and exported registry snapshot.
- Blocking response validates endpoint resolution failures as `PROF202` and non-reviewable candidate failures as `PROF203`.
- Runtime returns blocking responses before registry mutation for non-reviewable candidates.
- Consumer smoke proves OpenAPI schema refs can route to the runtime and receive a schema-valid registry save/snapshot response.
- Public subpath type smoke covers the request body type.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-blocking-response-contract.test.ts test/gateway-schema-profile-editor.test.ts test/gateway-schema-requests.test.ts test/gateway-schema-response-minimal.test.ts test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-consumer-smoke.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-schema-requests.test.ts test/gateway-schema-response-minimal.test.ts test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/editor code can approve profile relationship hints through the documented gateway surface rather than calling a private runtime shape.
- The operation is schema-valid for both success and expected blocking paths.
- The API remains source-access-free and repository-backed, preserving the logical DPM boundary over physical database design.
