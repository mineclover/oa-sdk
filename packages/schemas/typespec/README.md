# OA SDK TypeSpec Production Source

Status: default production schema source. The OpenAPI/Definition Builder path remains available through `:openapi` rollback commands.

This bundle is the production-owned TypeSpec authoring source accepted by ADR-009. It was bootstrapped from the accepted canonical authored fixture, but it lives under `packages/schemas/` so default schema validation, build, preview, and bundle commands can emit production OpenAPI artifacts from TypeSpec.

Current boundary:

- `packages/schemas/typespec/main.tsp` is the TypeSpec authoring source for the production schema.
- `packages/schemas/typespec/oa-sdk.typespec-bundle.json` is the bundle manifest and declares `oa-sdk.typespec-extensions.v2`.
- `packages/schemas/typespec/expected.openapi.yaml` is the reviewed OpenAPI 3.2 reference artifact for diff gates.
- `packages/schemas/typespec/accepted-restored-drift.json` pins the currently accepted TypeSpec-restored-vs-reference drift by normalized OpenAPI value hash.
- Current accepted drift is reviewed as 61 hash-pinned entries: root metadata (1), explicit public operation security metadata (9), path-level projection differences (22), and component projection differences (29).
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

The schema-level gate runs the bundle check, verifies that `expected.openapi.yaml` is still normalized-diff equivalent to the reviewed reference, and checks that the TypeSpec-restored artifact matches the pinned `accepted-restored-drift.json` manifest. Any new restored-vs-reference drift, missing accepted drift, or changed normalized value hash fails the gate.

The accepted drift should burn down in this order after the source-path switch: metadata alignment, reusable parameter/response identity, response wrapper projection schemas, and finally operation/path metadata differences.

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
