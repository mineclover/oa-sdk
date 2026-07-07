# Goal 41 - DPM Registry Audit Event Timeline Runtime

**Status: complete 2026-07-07**

> Predecessor: [Goal 40 - DPM Registry Approval Audit Events](./goal-40-dpm-registry-approval-audit-events.md)

## Purpose

Goal 40 made registry approval audit events durable at the storage boundary, but product/editor surfaces still needed a
gateway-level read model to inspect that history. Goal 41 exposes approval audit events as a schema-valid runtime and
OpenAPI timeline operation without requiring live DB/Kafka access or registry mutation.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| read-only audit event repository contract | hosted HTTP server implementation |
| runtime audit event timeline handler | full UI timeline rendering |
| OpenAPI request/response schemas and path | new audit event kinds beyond approval |
| consumer smoke over approval persistence and timeline readback | transactional adapter implementation |

## Implementation Units

### DPM-61 - Registry Audit Event Timeline Runtime

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/registry-repository-contract-types.ts`
- `packages/dpm/src/storage/registry-repository-types.ts`
- `packages/dpm/src/public/storage-registry.ts`
- `packages/dpm/src/gateway/runtime-relationship-types.ts`
- `packages/dpm/src/gateway/runtime-relationship-registry-audit-events.ts`
- `packages/dpm/src/gateway/runtime-operation-ids.ts`
- `packages/dpm/src/gateway/runtime-response-types.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/public/gateway-runtime.ts`
- `packages/dpm/src/gateway/openapi-operation-ids.ts`
- `packages/dpm/src/gateway/openapi-relationship-paths.ts`
- `packages/dpm/src/gateway/openapi-relationship-registry-schemas.ts`
- `packages/dpm/test/gateway-runtime-registry-audit-events.test.ts`
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Public storage exports include a read-only `DpmRegistryAuditEventReader` contract.
- Gateway runtime exposes `listDpmRegistryRelationshipAuditEvents()`.
- OpenAPI exposes `POST /dpm/registry/audit-events/list` with request/response component schemas.
- Runtime responses defensively copy repository-provided audit events.
- Consumer smoke proves approval persistence can be followed by schema-valid audit timeline readback.
- Package subpath smoke covers the new gateway runtime function and storage audit taxonomy.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime-registry-audit-events.test.ts test/gateway-consumer-smoke.test.ts test/gateway-runtime.test.ts test/gateway-schema-requests.test.ts test/gateway-schema-response-required.test.ts test/gateway-schema-response-taxonomy.test.ts test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/editor code can retrieve registry approval audit event timelines through the same gateway/runtime package surface used for relationship review workflows.
- The timeline operation is schema-valid, raw-value-free, and read-only.
- Docs, feature matrix, API index, subpath smoke, and focused runtime/consumer tests describe the implemented surface.
