# OA SDK TypeSpec Production Candidate

Status: G9-G12 production TypeSpec migration candidate.

This bundle is the production-owned TypeSpec authoring candidate for the staged ADR-009 migration. It was bootstrapped from the accepted canonical authored fixture, but it lives under `packages/schemas/` so G10 can wire schema validation and build commands without treating docs fixtures as production source.

Current boundary:

- `packages/schemas/typespec/main.tsp` is the planned TypeSpec authoring source for the migration.
- `packages/schemas/typespec/oa-sdk.typespec-bundle.json` is the bundle manifest and declares `oa-sdk.typespec-extensions.v2`.
- `packages/schemas/typespec/expected.openapi.yaml` is the bundle-local expected OpenAPI 3.2 artifact for diff gates.
- `packages/schemas/src/.merged.yaml` is still produced by the existing OpenAPI/Definition Builder path until the source-path switch is explicitly approved.

Bootstrap or refresh this candidate from the current canonical OpenAPI artifact:

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

The schema-level gate runs the bundle check and verifies that `expected.openapi.yaml` is still normalized-diff equivalent to `packages/schemas/src/.merged.yaml`.

Rollback G11 gate:

```bash
pnpm schema:rollback-check
```

The rollback gate runs `pnpm schema:typespec-check` and then `pnpm schema:validate`, so the TypeSpec candidate and the current OpenAPI/Definition Builder path stay explicitly reversible.

Downstream G12 gate:

```bash
pnpm schema:downstream-check
```

The downstream gate writes a TypeSpec-restored production OpenAPI artifact and feeds it to parser validation, codegen typegen, router generation, client generation, and mock-server handler creation.

Do not make `schema:validate` or `schema:bundle` depend on this directory until the source-path switch is explicitly approved.
