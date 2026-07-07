# Goal 38 - DPM Profile Hint Endpoint Resolution

**Status: complete 2026-07-07**

> Predecessor: [Goal 31 - DPM Profile Relationship Candidate Bridge](./goal-31-dpm-profile-relationship-candidate-bridge.md), [Goal 37 - DPM Profile Analysis Policy Provenance](./goal-37-dpm-profile-analysis-policy-provenance.md)

## Purpose

Profile relationship hints already carry source coordinates and, for explicit Kafka hints, a catalog target reference.
Before this goal, the bridge from profile hints to relationship candidates required callers to provide both parent and
child discovery endpoints manually.

Goal 38 adds a conservative resolver that turns explicit profile hint coordinates into relationship endpoints when the
evidence is strong enough, while keeping topic/source-to-table mapping under consumer control.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| parse explicit `targetRef` into parent `schema.table` + column endpoint | automatic approval |
| preserve and validate `catalog://authority/...` target authority | automatic catalog lookup |
| derive child column from profile source coordinate pointer/path | registry mutation |
| require consumer-provided child table mapping | implicit topic-to-table inference |
| expose resolved bridge helper through `@oa-sdk/dpm/profile` | source DB/Kafka access |
| test import-ready non-executable candidates from resolved endpoints | physical FK creation |

## Implementation Units

### DPM-58 - Profile Hint Endpoint Resolution

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-relationship-candidate.ts`
- `packages/dpm/src/public/profile-analysis.ts`
- `packages/dpm/test/profile-analysis-relationship-candidate-bridge.test.ts`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- `resolveDpmRelationshipCandidateEndpointsFromProfileHint()` parses `catalog://.../schema.table.column` target refs into parent relationship discovery endpoints.
- Resolver preserves `catalog://authority/...` authority in targetRef resolution metadata and candidate warnings.
- Optional `targetCatalogAuthority` rejects mismatched catalog target refs before candidate import.
- Resolver derives the child column from the profile source coordinate pointer/path.
- Resolver requires one explicit child table mapping path: `childTable`, `childTableBySourceId`, or `childTableByPathPrefix`.
- `createDpmRelationshipCandidateInputFromResolvedProfileHint()` creates the existing import-ready non-executable relationship candidate input using resolved endpoints.
- Public profile subpath exposes resolver types and helpers.
- Resolver fails before candidate import when the source node, target ref, or child table mapping is missing.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-relationship-candidate-bridge.test.ts test/gateway-consumer-smoke.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- profile-analysis`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run smoke:subpaths`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Profile relationship hints can be converted to discovery endpoints without manual parent/child endpoint construction when the hint target and source mapping are explicit.
- Ambiguous source-to-table inference remains outside the library core.
- Public docs, package subpath smoke, and feature-test matrix describe the implemented surface.
