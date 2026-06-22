# OA SDK TypeSpec Production Candidate

Status: G9 production TypeSpec source layout candidate.

This bundle is the production-owned TypeSpec authoring candidate for the staged ADR-009 migration. It was bootstrapped from the accepted canonical authored fixture, but it lives under `packages/schemas/` so G10 can wire schema validation and build commands without treating docs fixtures as production source.

Current boundary:

- `packages/schemas/typespec/main.tsp` is the planned TypeSpec authoring source for the migration.
- `packages/schemas/typespec/oa-sdk.typespec-bundle.json` is the bundle manifest and declares `oa-sdk.typespec-extensions.v2`.
- `packages/schemas/typespec/expected.openapi.yaml` is the bundle-local expected OpenAPI 3.2 artifact for diff gates.
- `packages/schemas/src/.merged.yaml` is still produced by the existing OpenAPI/Definition Builder path until G10 and G11 land.

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

Do not make `schema:validate` or `schema:bundle` depend on this directory until G11 rollback evidence lands.
