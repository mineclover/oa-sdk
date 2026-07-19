# Definition Builder Validation Gates

Definition Builder is now the explicit OpenAPI rollback/reference composition
path. The default production schema path is TypeSpec-first; this document
records the fallback gates for generating `packages/schemas/src/.merged.yaml`
from OpenAPI fragments when the TypeSpec path needs comparison or repair.

## Rollback Command

```bash
pnpm schema:validate:openapi
```

The root command performs the full OpenAPI contract gate:

1. Builds `@oa-sdk/parser`.
2. Builds `@oa-sdk/codegen`.
3. Runs `@oa-sdk/schemas` validation.
4. Runs strict `oa-gen validate --require-32` against `packages/schemas/src/.merged.yaml`.

Inside `@oa-sdk/schemas`, fallback validation is:

1. `pnpm build:merged` — emits `.merged.yaml` with `oa-gen build-spec`.
2. `pnpm downgrade:3.1` — derives `.merged.3.1.yaml` and `.merged.3.1.meta.json`.
3. `pnpm validate:spectral` — lints the OpenAPI 3.2 artifact.
4. `pnpm validate:redocly` — lints the downgraded OpenAPI 3.1 artifact.

## Builder Outputs

`build:merged` writes:

- `src/.merged.yaml`
- `src/.builder/local-api.diagnostics.json`
- `src/.builder/local-api.collisions.json`

The active local target must keep build diagnostics at zero errors, warnings,
and infos unless a future policy explicitly allows informational findings.

## Target Variants

The same builder path supports environment variants:

```bash
pnpm schema:build:openapi
pnpm schema:build:openapi:staging
pnpm schema:build:openapi:production
```

Each command selects a target config under `packages/schemas/src/targets/` and
writes the selected artifact to `src/.merged.yaml` for downstream validation or
bundling.

The package-level `build:merged*` commands explicitly prepare the parser and
codegen CLI first, so both these root commands and direct package invocation are
safe on a clean checkout.

## Required Invariants

- Emitted OpenAPI must contain only local OpenAPI `$ref` values.
- No `oa://` source refs may survive in `.merged.yaml`.
- `openapi` must remain `3.2.0`.
- The active target must retain all intended root `info`, `servers`, `tags`,
  paths, components, security schemes, examples, and OpenAPI 3.2 fields.
- `.merged.3.1.meta.json` must preserve all downgraded 3.2-only fields needed
  for round-trip restoration.
- Spectral and Redocly must stay clean.

## Rollback

Rollback from TypeSpec-generated artifacts is explicit: run
`pnpm schema:validate:openapi` or `pnpm schema:bundle:openapi` to regenerate
the artifact from Definition Builder while repairing the TypeSpec source. A
permanent return to Definition Builder as the default production source requires
a separate source-path decision or git revert of the TypeSpec switch.
