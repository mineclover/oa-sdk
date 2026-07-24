# OA SDK TypeSpec Production Source

Status: default production schema source. The OpenAPI/Definition Builder path remains available through `:openapi` rollback commands.

This bundle is the production-owned TypeSpec authoring source accepted by ADR-009. It was bootstrapped from the accepted canonical authored fixture, but it lives under `packages/schemas/` so default schema validation, build, preview, and bundle commands can emit production OpenAPI artifacts from TypeSpec.

For source ownership and versioning rules, see the [TypeSpec authoring conventions](../../../docs/guides/typespec-authoring-conventions.md). For promotion, recovery, rollback, and release gates, see the [production operations runbook](../../../docs/internal/typespec-roundtrip/production-operations.md).

Current boundary:

- `packages/schemas/typespec/main.tsp` is the bundle entrypoint. It owns root-level service metadata,
  shared component metadata, and imports the domain modules.
- `packages/schemas/typespec/version.tsp` owns `ContractVersion`, the single source for the emitted OpenAPI `info.version`.
- `packages/schemas/typespec/common.tsp` owns shared authentication models and common error models.
- `packages/schemas/typespec/auth.tsp` owns authentication models, responses, and operations.
- `packages/schemas/typespec/health.tsp` owns health/version models, responses, and operations.
- `packages/schemas/typespec/me.tsp` owns self-service models, responses, and operations.
- `packages/schemas/typespec/users.tsp` owns user administration, moderation, and user-facing models,
  responses, and operations.
- `packages/schemas/typespec/oa-sdk.typespec-bundle.json` is the bundle manifest and declares `oa-sdk.typespec-extensions.v5`.
- `packages/schemas/typespec/approved.openapi.yaml` is the reviewed OpenAPI 3.2 snapshot for diff gates. It is generated from the restored TypeSpec artifact and must not be edited directly.
- `packages/schemas/typespec/accepted-restored-drift.json` pins any accepted TypeSpec-restored-vs-reference drift by normalized OpenAPI value hash.
- Current accepted drift is reviewed as 0 entries.
- `packages/schemas/src/.merged.yaml` is generated from this bundle by `pnpm --filter @oa-sdk/schemas run build:typespec`, which is the default `validate`, `build`, `bundle`, and `preview` source path.
- The OpenAPI/Definition Builder rollback path remains explicit through `pnpm schema:validate:openapi`, `pnpm schema:bundle:openapi`, `pnpm schema:preview:openapi`, and package-level `build:openapi` / `validate:openapi`.

Bootstrap or intentionally rebase this TypeSpec source from the current canonical OpenAPI artifact:

```bash
pnpm typespec:create-canonical-fixture -- --fixture-dir packages/schemas/typespec
```

Required G9 gate:

```bash
pnpm typespec:bundle-check -- --manifest packages/schemas/typespec/oa-sdk.typespec-bundle.json --fail-on-breaking
```

Schema-level G10 gate:

```bash
pnpm schema:typespec-check
```

The schema-level gate runs the bundle check, verifies that `approved.openapi.yaml` is still normalized-diff equivalent to the reviewed snapshot, and checks that the TypeSpec-restored artifact matches the pinned `accepted-restored-drift.json` manifest. Any new restored-vs-reference drift, missing accepted drift, or changed normalized value hash fails the gate.

To create a local candidate under `.oa-sdk/typespec-candidates/` without
changing the approved snapshot:

```bash
pnpm schema:approve-typespec-reference
```

After the generated diff is reviewed, update the manifest-bound committed
snapshot explicitly:

```bash
pnpm schema:approve-typespec-reference -- --write
```

If a reviewed `accepted-restored-drift.json` has entries, promotion requires
`--clear-accepted-restored-drift` so the snapshot and drift reset are reviewed
together.

Reusable parameter/response component identity is restored through `oa-sdk.typespec-extensions.v5`; response wrapper projection schemas and component schema metadata drift have been eliminated through TypeSpec authoring, and operation/path metadata drift is eliminated through TypeSpec-restored OpenAPI normalization.

`ContractVersion` is independent from workspace package versions, bundle/extension schema versions,
and deployment metadata returned by `GET /version`. See the [authoring conventions](../../../docs/guides/typespec-authoring-conventions.md#versioning) for bump rules.

Rollback G11 gate:

```bash
pnpm schema:rollback-check
```

The rollback gate runs `pnpm schema:typespec-check` and then `pnpm schema:validate:openapi`, so the TypeSpec source and the OpenAPI/Definition Builder path stay explicitly reversible.

Downstream G12 gate:

```bash
pnpm schema:downstream-check
```

The downstream gate writes a TypeSpec-restored production OpenAPI artifact, imports built package `dist` exports, feeds the artifact to parser validation, codegen typegen, router generation, client generation, and mock-server handler creation, and compiles generated typegen/router/client TypeScript consumers plus a synthetic webhook/header fixture.
