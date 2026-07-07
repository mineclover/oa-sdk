# Goal 10 - DPM Profile Baseline Selection

**Status: complete 2026-07-07**

> Predecessor: [Goal 9 - DPM Profile Baseline Analysis Resolver](./goal-9-dpm-profile-baseline-analysis-resolver.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 9 allowed product code to resolve an explicit previous profile baseline ref before running profile
analysis. Goal 10 adds the first deterministic selection policy for the common case where a product
has a current profile artifact and a stored baseline history, but does not want to manually choose the
baseline ref.

The policy is deliberately small: select the latest stored previous baseline for the same
`datasetId`/`profileId`, excluding the current profile version hash by default. This keeps automatic
analysis repeatable without taking ownership of retention, scheduling, hosted CRUD, or production SQL
schema migrations.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| `latest_previous` baseline selection taxonomy | retention window policy |
| deterministic selector helper over baseline rows | hosted baseline CRUD endpoints |
| repository method that lists and selects prior baselines | production SQL migration |
| gateway profile analysis request selection strategy | live Kafka/database connector scheduling |
| Kafka profile demo using selection strategy | credential/raw payload persistence |

## Implementation Units

### DPM-30 - Latest Previous Profile Baseline Selection

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/storage/profile-baseline-selection-taxonomy.ts`
- `packages/dpm/src/storage/profile-baseline-selector.ts`
- `packages/dpm/src/storage/profile-baseline-request-types.ts`
- `packages/dpm/src/storage/profile-baseline-repository-contract-types.ts`
- `packages/dpm/src/storage/profile-baseline-repository-facade.ts`
- `packages/dpm/src/storage/profile-baseline-repository.ts`
- `packages/dpm/src/public/storage-profile-baseline.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request-types.ts`
- `packages/dpm/src/gateway/runtime-profile-analysis-request.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-exchange-schemas.ts`
- `packages/dpm/test/storage-profile-baseline-repository.test.ts`
- `packages/dpm/test/gateway-runtime-profile-analysis.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/examples/profile-kafka/README.md`
- `packages/dpm/test/profile-demo-command.test.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Tasks:
- Define `latest_previous` as the first profile baseline selection strategy.
- Add a deterministic selector that filters to the same profile history, excludes the current profile
  version hash by default, sorts by newest `storedAt` with stable tie-breakers, and applies candidate
  limits only after SDK-side ordering.
- Add `selectPreviousProfileBaseline()` to the repository facade while keeping storage adapters list-only.
- Extend profile analysis request resolution to accept `previousProfileBaseline.selectionStrategy`.
- Keep explicit `baselineRef` and selection strategy mutually exclusive in both runtime validation and
  the gateway OpenAPI request schema.
- Update the Kafka profile demo to analyze through `latest_previous` selection.

Acceptance:
- Consumers can select the latest previous baseline without manually naming a baseline ref.
- The selector ignores the current profile hash by default.
- Gateway runtime analysis can resolve `selectionStrategy: "latest_previous"` into a previous profile
  artifact and produce drift signals.
- Baseline selection does not depend on storage adapter return ordering when request `limit` is provided.
- Missing selector support or ambiguous baseline request shapes fail before misleading analysis output.
- The documented Kafka profile demo proves the selection strategy route.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/storage-profile-baseline-repository.test.ts test/gateway-runtime-profile-analysis.test.ts test/profile-demo-command.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm demo:dpm:profile`
- `pnpm check:api-index`
- `pnpm check:feature-tests`
- `git diff --check`

## Breakpoints

Stop and update this goal before implementation if the next unit requires:
- baseline retention or aging policy,
- hosted profile baseline CRUD endpoints,
- concrete SQL migration ownership,
- live connector scheduling,
- source credential, raw payload, or reverse lookup persistence.

## Done Criteria

- Public storage exports include the baseline selection taxonomy and selector helper.
- Profile baseline repository exposes `selectPreviousProfileBaseline()`.
- Gateway profile analysis request schema accepts `selectionStrategy: "latest_previous"`.
- Tests prove latest previous selection, current hash exclusion, schema-valid runtime analysis, storage
  order independence under `limit`, and ambiguous request guards.
- The Kafka profile demo uses `latest_previous` selection and still emits drift evidence.
- API index, feature-test matrix, and internal spec describe the implemented selection surface.
