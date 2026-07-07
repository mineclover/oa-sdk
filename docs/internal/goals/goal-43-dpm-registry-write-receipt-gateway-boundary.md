# Goal 43 - DPM Registry Write Receipt Gateway Boundary

**Status: complete 2026-07-07**

> Predecessor: [Goal 42 - DPM Profile Hint Approval Gateway Contract](./goal-42-dpm-profile-hint-approval-gateway-contract.md)

## Purpose

Goal 42 exposed profile relationship hint approval as a product gateway operation, but its success response still mirrored the registry storage row shape. Goal 43 replaces that gateway-facing row readback with a logical write receipt so product/editor APIs can confirm the approved relationship write without depending on physical storage columns.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| logical registry write receipt type | changing the storage repository row contract |
| OpenAPI write receipt schema | database transaction implementation |
| profile hint approval success response projection | new approval workflows |
| consumer/runtime/schema tests for receipt shape | UI rendering |

## Implementation Units

### DPM-63 - Registry Write Receipt Gateway Boundary

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-profile-relationship-hint-approval.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/src/gateway/openapi-relationship-registry-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-relationship-hint-approval-schemas.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `packages/dpm/test/support/gateway-workflow-response-profile-fixtures.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `DpmGatewayRegistryRelationshipWriteReceipt` is exported through the gateway package surface.
- Profile hint approval success responses expose `relationshipWriteReceipt` instead of a storage row payload.
- OpenAPI exposes `DpmRegistryRelationshipWriteReceipt` and no longer uses `DpmRegistryRelationshipStorageRow` for the approval response.
- Receipt payloads include stable logical identifiers needed for follow-up registry snapshot or audit lookup.
- Focused runtime, consumer smoke, response schema, typecheck, and API index checks pass.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-consumer-smoke.test.ts test/gateway-schema-response-minimal.test.ts test/gateway-schema-response-required.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Gateway consumers can treat registry approval persistence as a logical write result instead of coupling to the storage table row model.
- The profile hint approval response still proves persistence through repository-backed save and snapshot export.
- Docs, API index, feature matrix, subpath smoke, and focused runtime/schema tests describe the implemented receipt surface.
