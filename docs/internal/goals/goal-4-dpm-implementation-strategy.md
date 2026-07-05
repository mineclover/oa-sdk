# Goal 4 - DPM Implementation Strategy

**Status: implemented**

> Parent roadmap: [Relationship-First DPM Roadmap](./goal-4-dpm-relationship-first-roadmap.md)\
> Product PRD: [Relationship-First Data Pseudonymization Manifest](../../../tasks/prd-data-pseudonymization-manifest.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
> Runtime/storage follow-up: [Goal 5 - DPM Runtime/Storage Integration](./goal-5-dpm-runtime-storage-integration.md)

## Strategy Summary

Implement DPM as an independent relationship governance slice, not as a codegen extension.
The first implementation path should prove the deterministic contract loop:

1. decide relationship-first defaults,
2. scaffold `@oa-sdk/dpm`,
3. validate DPM manifest syntax,
4. load catalog and registry snapshots,
5. reject unsafe relationship and column policies,
6. compile an execution plan,
7. expose the gateway contract after the core loop is stable.

The MVP should remain CLI-first. HTTP gateway, runtime execution, vault storage, and physical
constraint creation are follow-up phases.

## Implementation Closure

Goal 4 closes the deterministic, file-backed DPM contract loop:

1. relationship-first decisions are recorded in ADR-010,
2. `@oa-sdk/dpm` is a private workspace package,
3. manifest syntax and semantic validation are fixture-backed,
4. catalog and registry snapshots are loaded without source DB access,
5. compiler and dry-run output preserve relationship-first execution units,
6. gateway OpenAPI and publishing context expose contracts without owning policy semantics,
7. `pnpm demo:dpm` runs the customer-orders validate/compile/dry-run loop plus guard scenarios.

Runtime execution, canonical registry storage, source catalog profiling, job persistence, vault
integration, and physical DB mutation remain outside Goal 4. Those follow-ups start in Goal 5.

## Workstream Boundaries

| Workstream | Owns | Does not own |
|---|---|---|
| Decision baseline | ADR, defaults, goal boundaries | package code |
| Manifest schema | JSON Schema, fixtures, syntax diagnostics | DB catalog discovery |
| Catalog adapter | structural DB snapshot model | relationship approval |
| Relationship registry | approved relationship snapshot and lifecycle model | raw PII classification |
| Semantic validator | REL/SAF diagnostics and blocking gates | token generation runtime |
| Compiler | deterministic plan, namespace bindings, dry-run inputs | real DB mutation |
| Gateway contract | OpenAPI/TypeSpec API surface | manifest policy source of truth |
| Publishing context | AI schema relationship metadata | vault reverse lookup |

## Package Boundary Map

| Category | Packages | DPM relationship |
|---|---|---|
| API contract/spec SSOT | `@oa-sdk/schemas`, `@oa-sdk/parser`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen` | Provide OpenAPI/TypeSpec validation, projection envelope, parser/codegen path, and gateway contract checks. They do not own DPM policy semantics. |
| Logical data contract | `@oa-sdk/dpm`, `@oa-sdk/personas` | Own relationship-first manifest policy, catalog snapshot interpretation, logical entity namespace, approved relationship registry, and pseudonymized data audience obligations. |
| Runtime/consumer outputs | `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/typia-mock` | Consume the gateway OpenAPI artifact after the DPM core loop is stable. They do not decide relationship approval or namespace policy. |
| Governance/observation | `@oa-sdk/spec-lens` | Can observe gateway/spec drift and release review history. It does not replace DPM freshness, REL/SAF diagnostics, or compiled-plan validation. |
| Operations/tooling | `@oa-sdk/core`, `@oa-sdk/markdown-editor`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/infra-gitlab` | Provide supporting utilities or workflow infrastructure only. They are outside the DPM policy boundary. |

The package split follows a no-physical-mutation default:

```text
Physical DB schema
  -> catalog snapshot / projection evidence
  -> DPM logical entity + relationship registry
  -> compiled pseudonymization plan
  -> gateway OpenAPI / reports / AI schema context
```

`@oa-sdk/dpm` may emit physical foreign key recommendations in publishing context, but those
recommendations are not schema migrations and must not be treated as the default execution path.

## Implementation Units

### Unit 0 - Decision Landing

Goal id: `DPM-00`

Artifacts:
- `docs/internal/architecture/010-dpm-relationship-first.md`
- update to the parent roadmap if any default changes

Tasks:
- Lock package name as `@oa-sdk/dpm`.
- Lock manifest schema source as JSON Schema-first.
- Lock gateway source as TypeSpec/OpenAPI after the CLI loop.
- Lock registry storage target as Postgres canonical model with YAML snapshots.
- Lock MVP engine as PostgreSQL first.
- Lock CLI-first execution mode.
- Record deferred breakpoints for predicate AST, vault, physical FK creation, and auto approval.

Exit criteria:
- Every locked decision has a chosen option, rejected alternatives, and consequence notes.
- The next implementation unit can start without re-asking ownership questions.

Verification:
- `git diff --check`

### Unit 1 - Package Scaffold And Contract Skeleton

Goal id: `DPM-01A`

Artifacts:
- `packages/dpm/package.json`
- `packages/dpm/tsconfig.json`
- `packages/dpm/vitest.config.ts`
- `packages/dpm/src/index.ts`
- `packages/dpm/src/public/*.ts`
- `packages/dpm/src/types.ts`
- `packages/dpm/test/smoke.test.ts`

Tasks:
- Create `@oa-sdk/dpm` as a private workspace package.
- Keep `src/index.ts` as the root entrypoint and group stable public exports through `src/public/*.ts`.
- Add local `build`, `test`, `typecheck`, and `clean` scripts.
- Add a smoke test that proves the package can be imported.
- Do not add root build/test wiring until the package has meaningful gates.

Exit criteria:
- `pnpm --filter @oa-sdk/dpm build` passes.
- `pnpm --filter @oa-sdk/dpm test` passes.
- `pnpm --filter @oa-sdk/dpm typecheck` passes.

### Unit 2 - Manifest Vocabulary And JSON Schema

Goal id: `DPM-01B`

Artifacts:
- `packages/dpm/src/schema/dpm-manifest.schema.json`
- `packages/dpm/src/schema/index.ts`
- `packages/dpm/test/fixtures/valid/*.json`
- `packages/dpm/test/fixtures/invalid/*.json`
- `packages/dpm/test/schema.test.ts`

Tasks:
- Define `dpm_version`, top-level sections, entity declarations, registry snapshot reference,
  column roles, transform kinds, orphan policies, and freshness metadata.
- Treat legacy `manifest_version` as an import warning, not the v1 canonical field.
- Add invalid fixtures for direct identifier `keep`, foreign identifier with missing relationship,
  non-approved relationship execution, and legacy `relationships.from/to` syntax.

Exit criteria:
- Valid fixtures pass JSON Schema validation.
- Invalid fixtures fail with stable fixture-specific assertions.
- Schema does not require source DB credentials or vault configuration.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- schema`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 3 - Catalog Snapshot Model

Goal id: `DPM-02`

Artifacts:
- `packages/dpm/src/catalog/types.ts`
- `packages/dpm/src/catalog/source-types.ts`
- `packages/dpm/src/catalog/structure-types.ts`
- `packages/dpm/src/catalog/integrity-types.ts`
- `packages/dpm/src/catalog/diagnostic-types.ts`
- `packages/dpm/src/catalog/projection-types.ts`
- `packages/dpm/src/catalog/snapshot-types.ts`
- `packages/dpm/src/catalog/snapshot.ts`
- `packages/dpm/src/catalog/snapshot-copy.ts`
- `packages/dpm/src/catalog/snapshot-diagnostic-copy.ts`
- `packages/dpm/src/catalog/snapshot-ordering.ts`
- `packages/dpm/src/catalog/snapshot-projection-copy.ts`
- `packages/dpm/src/catalog/snapshot-source-copy.ts`
- `packages/dpm/src/catalog/freshness.ts`
- `packages/dpm/src/catalog/postgres.ts`
- `packages/dpm/src/catalog/projection.ts`
- `packages/dpm/test/fixtures/catalog/*.json`
- `packages/dpm/test/catalog.test.ts`

Tasks:
- Model schemas, tables, columns, primary keys, foreign keys, unique candidates, indexes,
  nullability, and source coordinates.
- Add a PostgreSQL catalog snapshot shape as the MVP canonical fixture.
- Add a projection adapter boundary for existing OpenAPI projection contract data.
- Include a deterministic catalog freshness hash.

Exit criteria:
- Catalog snapshot fixtures can be normalized into one internal model.
- Projection input is structural evidence only and cannot approve a relationship.
- Freshness hash changes when catalog structure changes.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- catalog`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 4 - Relationship Discovery Report

Goal id: `DPM-03`

Artifacts:
- `packages/dpm/src/discovery/candidate.ts`
- `packages/dpm/src/discovery/classification.ts`
- `packages/dpm/src/discovery/copy.ts`
- `packages/dpm/src/discovery/types.ts`
- `packages/dpm/src/discovery/report.ts`
- `packages/dpm/test/fixtures/discovery/*.json`
- `packages/dpm/test/discovery.test.ts`

Tasks:
- Define candidate relationship identity, endpoints, evidence, confidence, warnings, and
  exclusion reason shape.
- Keep `auto_approve_enabled` false by default.
- Support query log and ORM evidence as optional evidence blocks, not required MVP inputs.
- Emit candidate reports that can be reviewed before registry import.

Exit criteria:
- Discovery output is not executable by the compiler.
- Candidate reports preserve evidence without creating approval status.
- Low-confidence or ambiguous candidates are explicitly marked.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- discovery`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 5 - Registry Snapshot And Lifecycle

Goal id: `DPM-04`

Artifacts:
- `packages/dpm/src/registry/types.ts`
- `packages/dpm/src/registry/snapshot.ts`
- `packages/dpm/src/registry/registry-identity.ts`
- `packages/dpm/src/registry/registry-normalize.ts`
- `packages/dpm/src/registry/registry-executable.ts`
- `packages/dpm/src/registry/registry-summary.ts`
- `packages/dpm/src/registry/registry-yaml.ts`
- `packages/dpm/src/registry/registry-yaml-relationship.ts`
- `packages/dpm/src/registry/registry-yaml-values.ts`
- `packages/dpm/test/fixtures/registry/*.yaml`
- `packages/dpm/test/registry.test.ts`

Tasks:
- Define approved, proposed, rejected, deprecated, and superseded statuses.
- Model dataset id, relationship name, version, endpoints, condition metadata, namespace,
  transform strategy, orphan policy, evidence, owner, and approval metadata.
- Support YAML snapshot fixtures as deterministic review artifacts.
- Keep YAML parsing, relationship row mapping, and scalar/object guards as separate
  implementation boundaries.
- Reserve Postgres schema design for the ADR or a later storage unit.

Exit criteria:
- Only approved relationships can be selected for compilation.
- Rejected, deprecated, and superseded relationships are loadable but non-executable.
- Snapshot identity is versioned and stable.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- registry`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 6 - Entity And Logical Relationship Model

Goal id: `DPM-05`

Artifacts:
- `packages/dpm/src/model/canonical-key.ts`
- `packages/dpm/src/model/endpoint.ts`
- `packages/dpm/src/model/entity.ts`
- `packages/dpm/src/model/entity-types.ts`
- `packages/dpm/src/model/entity-normalize.ts`
- `packages/dpm/src/model/entity-canonical-key.ts`
- `packages/dpm/src/model/relationship.ts`
- `packages/dpm/src/model/relationship-types.ts`
- `packages/dpm/src/model/relationship-normalize.ts`
- `packages/dpm/src/model/relationship-canonical-key.ts`
- `packages/dpm/test/model.test.ts`

Tasks:
- Define entity root, single/composite key strategy, canonical key rendering, relationship kinds,
  cardinality, polymorphic predicates, temporal predicates, and tenant namespace inputs.
- Keep v1 condition representation as text plus metadata unless the breakpoint chooses AST.
- Keep logical relationship vocabulary, normalization, and canonical key rendering as separate
  implementation boundaries.
- Add canonical key tests for single key, composite key, tenant-scoped key, and polymorphic key.

Exit criteria:
- Entity declarations do not bind child columns directly.
- Composite key rendering is deterministic.
- Polymorphic relationships require a predicate.
- Temporal relationships require an explicit valid-time field or documented absence.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- model`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 7 - Semantic Validator

Goal id: `DPM-06` and `DPM-07`

Artifacts:
- `packages/dpm/src/validator/diagnostics.ts`
- `packages/dpm/src/validator/manifest.ts`
- `packages/dpm/src/validator/manifest-syntax.ts`
- `packages/dpm/src/validator/relationships.ts`
- `packages/dpm/src/validator/relationship-catalog-gates.ts`
- `packages/dpm/src/validator/relationship-catalog-context.ts`
- `packages/dpm/src/validator/relationship-catalog-table-gates.ts`
- `packages/dpm/src/validator/relationship-catalog-column-gates.ts`
- `packages/dpm/src/validator/relationship-catalog-key-gates.ts`
- `packages/dpm/src/validator/relationship-registry.ts`
- `packages/dpm/src/validator/relationship-registry-diagnostics.ts`
- `packages/dpm/src/validator/relationship-registry-snapshot.ts`
- `packages/dpm/src/validator/relationship-shape-gates.ts`
- `packages/dpm/src/validator/relationship-types.ts`
- `packages/dpm/src/validator/relationship-utils.ts`
- `packages/dpm/src/validator/safety.ts`
- `packages/dpm/src/validator/safety-column-gates.ts`
- `packages/dpm/src/validator/safety-manifest-gates.ts`
- `packages/dpm/src/validator/safety-types.ts`
- `packages/dpm/src/validator/validation-types.ts`
- `packages/dpm/src/validator/value-utils.ts`
- `packages/dpm/test/validator.test.ts`
- `packages/dpm/test/validator-relationship.test.ts`
- `packages/dpm/test/validator-safety.test.ts`

Tasks:
- Add deterministic REL diagnostics for missing, stale, non-approved, ambiguous, and
  catalog-mismatched relationships.
- Keep catalog relationship context, table scope gates, column compatibility gates, and parent
  key uniqueness gates as separate implementation boundaries.
- Add deterministic SAF diagnostics for direct identifier keep, unsafe foreign identifier,
  namespace mismatch, raw PII leakage, and vault-only operations in non-runtime phases.
- Keep column-level SAF gates and manifest-level SAF gates as separate implementation boundaries.
- Include source pointer, severity, code, message, and catalog/registry coordinate where possible.

Exit criteria:
- Unsafe manifests produce stable diagnostics without touching source DB data.
- Warning vs error severity is deterministic and fixture-backed.
- Validator can run with manifest + catalog snapshot + registry snapshot only.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- validator`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 8 - Compiler And Dry Run

Goal id: `DPM-08`

Artifacts:
- `packages/dpm/src/compiler/plan.ts`
- `packages/dpm/src/compiler/plan-builder.ts`
- `packages/dpm/src/compiler/plan-column-steps.ts`
- `packages/dpm/src/compiler/plan-namespace-bindings.ts`
- `packages/dpm/src/compiler/plan-relationship-steps.ts`
- `packages/dpm/src/compiler/plan-staleness.ts`
- `packages/dpm/src/compiler/plan-value-utils.ts`
- `packages/dpm/src/compiler/compile.ts`
- `packages/dpm/src/dry-run/report.ts`
- `packages/dpm/test/compiler.test.ts`
- `packages/dpm/test/dry-run.test.ts`

Tasks:
- Compile validated inputs into `namespace_bindings`, `relationship_steps`, `column_steps`,
  orphan handling, and freshness tuple.
- Mark plans stale when manifest, catalog, or registry freshness changes.
- Produce dry-run impact reports without raw sensitive values.

Exit criteria:
- Compiler refuses invalid validator output.
- Compiled plan contains approved relationships only.
- Dry-run report includes impact counts/categories but no raw PII.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- compiler`
- `pnpm --filter @oa-sdk/dpm test -- dry-run`
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 9 - CLI Surface

Goal id: `DPM-08A`

Artifacts:
- `packages/dpm/src/cli/args.ts`
- `packages/dpm/src/cli/index.ts`
- `packages/dpm/src/cli/inputs.ts`
- `packages/dpm/src/cli/result.ts`
- `packages/dpm/src/cli/types.ts`
- `packages/dpm/test/cli.test.ts`

Tasks:
- Add CLI commands for `validate`, `compile`, and `dry-run`.
- Accept explicit manifest, catalog snapshot, and registry snapshot paths.
- Print machine-readable JSON diagnostics by default.
- Avoid DB network access in the first CLI version.

Exit criteria:
- CLI can validate fixture triplets.
- CLI exits non-zero on blocking REL/SAF errors.
- CLI output can be snapshotted without timestamps or unstable ordering.

Verification:
- `pnpm --filter @oa-sdk/dpm build`
- `pnpm --filter @oa-sdk/dpm test -- cli`

### Unit 10 - Gateway OpenAPI Contract

Goal id: `DPM-09`

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/src/gateway/openapi-core-schemas.ts`
- `packages/dpm/src/gateway/openapi-common-schemas.ts`
- `packages/dpm/src/gateway/openapi-catalog-schemas.ts`
- `packages/dpm/src/gateway/openapi-relationship-schemas.ts`
- `packages/dpm/src/gateway/openapi-manifest-schemas.ts`
- `packages/dpm/src/gateway/openapi-job-schemas.ts`
- `packages/dpm/src/gateway/openapi-execution-schemas.ts`
- `packages/dpm/src/gateway/openapi-execution-plan-schemas.ts`
- `packages/dpm/src/gateway/openapi-execution-dry-run-schemas.ts`
- `packages/dpm/src/gateway/openapi-validation-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi.ts`
- `packages/dpm/src/gateway/profile-openapi-artifact-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-schemas.ts`
- `packages/dpm/src/gateway/openapi-operation.ts`
- `packages/dpm/src/gateway/openapi-operation-ids.ts`
- `packages/dpm/src/gateway/openapi-paths.ts`
- `packages/dpm/src/gateway/openapi-catalog-paths.ts`
- `packages/dpm/src/gateway/openapi-profile-paths.ts`
- `packages/dpm/src/gateway/openapi-relationship-paths.ts`
- `packages/dpm/src/gateway/openapi-manifest-paths.ts`
- `packages/dpm/src/gateway/openapi-job-paths.ts`
- `packages/dpm/test/gateway.test.ts`
- `packages/dpm/test/gateway-taxonomy.test.ts`
- `packages/dpm/test/gateway-schema-validation.test.ts`

Tasks:
- Model catalog profiling, relationship discovery, candidate import, approval, snapshot export,
  manifest validate, compile, dry-run, execute job, and report operations.
- Keep manifest policy JSON Schema as the manifest source of truth.
- Keep compiled plan, dry-run result, and validation diagnostic component schemas as separate
  implementation boundaries.
- Keep catalog, profile, relationship, manifest, and job path groups as separate implementation
  boundaries while preserving a single gateway path map assembly.
- Ensure AI consumer operations never expose source DB credentials, vault keys, or token reverse lookup.

Exit criteria:
- Gateway contract validates with the OA SDK OpenAPI validation path.
- Contract references DPM schemas without taking ownership of their policy semantics.

Verification:
- `pnpm schema:validate` or focused `oa-gen validate --require-32` path
- `pnpm --filter @oa-sdk/dpm typecheck`

### Unit 11 - Publishing Context

Goal id: `DPM-10`

Artifacts:
- `packages/dpm/src/publishing/context.ts`
- `packages/dpm/src/publishing/types.ts`
- `packages/dpm/src/publishing/relationship-metadata.ts`
- `packages/dpm/src/publishing/ai-schema-context.ts`
- `packages/dpm/src/publishing/physical-fk.ts`
- `packages/dpm/test/publishing.test.ts`

Tasks:
- Generate `relationship_metadata` and `ai_schema_context` from compiled plans.
- Include join predicates, cardinality, namespace, descriptions, examples where enabled, and
  readonly grant hints.
- Keep physical FK creation as a separate optional output, never a default mutation.
- Keep relationship metadata, AI schema context, and physical FK recommendation mapping as
  separate implementation boundaries.

Exit criteria:
- AI context is generated only from validated relationships.
- Physical FK recommendations are explicitly marked as recommendations.
- Publishing context excludes vault and reverse token lookup information.

Verification:
- `pnpm --filter @oa-sdk/dpm test -- publishing`
- `pnpm --filter @oa-sdk/dpm typecheck`

## Suggested File Layout

```text
packages/dpm/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    types.ts
    schema/
    catalog/
    discovery/
    registry/
    model/
    validator/
    compiler/
    dry-run/
    cli/
    gateway/
    publishing/
  test/
    fixtures/
      catalog/
      discovery/
      invalid/
      registry/
      valid/
```

## Root Wiring Strategy

Do not wire `@oa-sdk/dpm` into root `build`, `test`, and `typecheck` scripts in the scaffold-only
unit. Add root wiring after Unit 2 or Unit 3, when the package has meaningful schema/model tests.

When root wiring lands, update:
- `package.json`
- `docs/internal/goals/goal-4-dpm-relationship-first-roadmap.md`
- `docs/internal/spec.md` if the package becomes part of the implemented surface
- release policy manifest if tracked package coverage requires it

## Breakpoint Policy

Stop and record a decision when any of these appear:
- predicate text is not enough for polymorphic or temporal relationships,
- discovery evidence needs query logs or ORM metadata to avoid low-confidence noise,
- compiler needs real token vault behavior,
- HTTP runtime requires authentication or job persistence,
- publishing context wants physical FK creation,
- multi-tenant key rendering needs escaping beyond the v1 canonical format.

The next unit should not absorb those decisions silently. Split the goal and update this strategy.

## Verification Ladder

| Stage | Gate |
|---|---|
| docs-only | `git diff --check` |
| scaffold | `pnpm --filter @oa-sdk/dpm build`, `test`, `typecheck` |
| schema/model | fixture tests + `pnpm --filter @oa-sdk/dpm typecheck` |
| validator/compiler | focused unit tests + deterministic snapshot checks |
| CLI | build + CLI fixture test |
| gateway | OA SDK OpenAPI validation path |
| root integration | root `build`, `test`, `typecheck`, API index check if public exports change |

## Non-Goals For V1

- no source DB mutation,
- no vault implementation,
- no reversible token API,
- no automatic approval by default,
- no physical FK creation by default,
- no multi-engine discovery before PostgreSQL semantics are stable,
- no AI consumer access to source DB credentials or token reverse lookup.

## Recommended Next Step

Move to [Goal 5 - DPM Runtime/Storage Integration](./goal-5-dpm-runtime-storage-integration.md).
Start with `DPM-11 Registry Storage Canonical Model` so the approved relationship lifecycle has a
database-backed shape before catalog profiling, HTTP runtime, or persisted validation reports are
implemented.
