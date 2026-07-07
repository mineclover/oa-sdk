# Goal 45 - DPM Registry Write Receipt Audit Link

**Status: complete 2026-07-08**

> Predecessor: [Goal 43 - DPM Registry Write Receipt Gateway Boundary](./goal-43-dpm-registry-write-receipt-gateway-boundary.md), [Goal 44 - DPM Registry Approval Commit Hook](./goal-44-dpm-registry-approval-commit-hook.md)

## Purpose

Goal 43 made profile hint approval responses storage-row-free, and Goal 44 made registry approval persistence transaction-friendly. Product and editor consumers still need a stable way to jump from a successful write receipt to the approval audit timeline row created by that write.

Goal 45 carries an optional approval audit event id through the profile hint approval request and registry save input, then links the logical write receipt only to the actual approval audit event returned by the repository.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| optional `auditEventId` profile hint approval request field | server-generated audit id API |
| registry save input propagation | changing registry storage schema |
| persisted `approvalAuditEventId` write receipt field | new audit event types |
| OpenAPI/runtime/demo tests for the link | UI timeline rendering |

## Implementation Units

### DPM-65 - Registry Write Receipt Audit Link

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-profile-relationship-hint-approval.ts`
- `packages/dpm/src/gateway/profile-openapi-relationship-hint-approval-schemas.ts`
- `packages/dpm/src/gateway/openapi-relationship-registry-schemas.ts`
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-repository.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/storage-registry-repository.test.ts`
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `packages/dpm/test/support/gateway-workflow-response-profile-fixtures.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Profile hint approval requests can carry optional `auditEventId`.
- Runtime passes that id into the registry save input.
- Registry repositories can return `DpmRegistryRelationshipSaveResult` from `saveRelationshipWithAuditEvent()`, containing the saved relationship row and actual approval audit event when one was committed or appended.
- Registry write receipts return `approvalAuditEventId` only when the repository save result contains an actual approval audit event.
- OpenAPI request and response schemas accept the audit-linked payload.
- The Kafka profile demo stores an approval audit event and exposes its id in the registry write receipt summary.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-consumer-smoke.test.ts test/gateway-schema-profile-editor.test.ts test/gateway-schema-response-minimal.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm test -- profile-demo`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/editor consumers can correlate a successful profile hint approval write receipt with the registry approval audit event timeline.
- Repositories without an audit event result do not cause the gateway receipt to echo an unpersisted request id.
- Existing requests without `auditEventId` remain valid.
- Docs, feature matrix, API index, gateway schema/runtime tests, and profile demo describe the implemented link.
