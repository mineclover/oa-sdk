# Goal 55 - DPM Profile Hint Target Catalog Authority

**Status: complete 2026-07-08**

> Predecessor: [Goal 38 - DPM Profile Hint Endpoint Resolution](./goal-38-dpm-profile-hint-endpoint-resolution.md), [Goal 54 - DPM Kafka Relationship Hint Source Pointer](./goal-54-dpm-kafka-relationship-hint-source-pointer.md)

## Purpose

Profile relationship hint endpoint resolution must not silently erase the catalog authority from `catalog://authority/schema.table.column` target references. The relationship discovery endpoint still uses the existing `table` and `columns` shape, but product review surfaces need enough provenance to detect cross-catalog ambiguity before approval.

Goal 55 preserves target catalog authority as resolver evidence and lets consumers require an expected authority before a profile hint is converted into an importable relationship candidate.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| parse catalog targetRef authority | changing `RelationshipDiscoveryEndpoint` shape |
| expose parsed targetRef resolution metadata | registry relationship identity redesign |
| add optional expected target catalog authority guard | automatic catalog lookup |
| preserve target authority in candidate warnings/evidence metadata | live catalog access |
| gateway request schema support for the guard | broad `targetRef` URI grammar migration |

## Implementation Units

### DPM-75 - Profile Hint Target Catalog Authority

Status: implemented 2026-07-08.

Artifacts:
- `packages/dpm/src/profile/analysis-relationship-candidate.ts`
- `packages/dpm/src/public/profile-analysis.ts`
- `packages/dpm/src/gateway/profile-openapi-relationship-hint-approval-schemas.ts`
- `packages/dpm/test/profile-analysis-relationship-candidate-bridge.test.ts`
- `packages/dpm/test/gateway-runtime-profile-relationship-hint-approval.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `catalog://commerce/public.customers.customer_no` still resolves to parent endpoint `public.customers.customer_no`.
- Resolver output includes parsed target endpoint path and catalog authority.
- Resolved candidate inputs carry `target-ref-catalog-authority:<authority>` warnings.
- Candidate evidence metadata preserves `targetRefCatalogAuthority` and `targetRefEndpointPath`.
- `targetCatalogAuthority` rejects mismatched catalog target refs before candidate import or registry mutation.
- Gateway profile hint approval request schema accepts `targetCatalogAuthority`.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/gateway-schema-profile-editor.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-connector.test.ts test/profile-kafka-connector-freshness.test.ts test/profile-kafka-graph-fields.test.ts test/profile-kafka-graph-hints.test.ts test/profile-kafka-graph-sections.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-runtime-profile-relationship-hint-approval.test.ts test/profile-demo-command.test.ts test/package-subpath-exports.test.ts`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm demo:dpm:profile`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product/editor flows can preserve and verify profile hint target catalog authority without changing discovery endpoint shape.
- Mismatched catalog authorities block before relationship candidate import or registry mutation.
