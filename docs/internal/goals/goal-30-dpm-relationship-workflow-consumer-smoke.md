# Goal 30 - DPM Relationship Workflow Consumer Smoke

**Status: complete 2026-07-07**

> Predecessor: [Goal 29 - DPM Candidate Import Review Report Runtime](./goal-29-dpm-candidate-import-review-report-runtime.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 29 made candidate import return a normalized review report, which gave editor and automated
analysis surfaces a concrete handoff into approval.

Goal 30 closes the product integration proof gap: a consumer can read the documented OpenAPI gateway
contract and run the relationship workflow from discovery through candidate import, approval, registry
snapshot export, and manifest compile without live DB/Kafka access or registry mutation.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| consumer-level relationship workflow smoke | new runtime operation behavior |
| OpenAPI operationId/request/response schema ref checks | writing registry rows |
| catalog snapshot resolver and manifest snapshot resolver use | live source DB/Kafka access |
| discovery -> import -> approval -> registry export -> compile proof | editor UI rendering |
| manifest registry-version-aligned export proof | physical FK creation |
| feature matrix/spec/progress updates | vault/reverse token lookup |

## Implementation Units

### DPM-50 - Relationship Workflow Consumer Smoke

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/test/gateway-consumer-smoke.test.ts`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- The consumer smoke reads relationship operation ids and request/response schema refs from `getDpmGatewayOpenApiDocument()`.
- Discovery request resolution uses a catalog snapshot ref and consumer resolver before runtime execution.
- Candidate import accepts discovery-derived candidate input and returns a normalized non-executable review report.
- Approval turns the normalized review candidate into a registry-compatible approved relationship payload.
- Registry snapshot export reads through a consumer repository and returns a schema-valid snapshot with executable approved relationships.
- Manifest compile succeeds only after the exported registry snapshot matches the manifest registry reference and relationship name.
- The workflow remains non-mutating, source-access-free, and raw-value-free.
- Feature-test matrix, progress index, and internal spec match the implemented proof.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-consumer-smoke.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- gateway-runtime`
- `pnpm --filter @oa-sdk/dpm test -- gateway`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Product consumers have a single OpenAPI-to-runtime smoke covering the practical relationship workflow.
- The workflow proves discovery/import/approval/export can produce a compile-ready registry snapshot.
- API/spec docs, feature-test matrix, and progress index match the implemented behavior.
