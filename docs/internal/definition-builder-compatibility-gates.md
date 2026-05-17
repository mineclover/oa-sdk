# Definition Builder Validation Gates

Definition Builder is now the canonical schema composition path. The legacy
domain merge script has been removed, so this document records the active gates
for the generated `packages/schemas/src/.merged.yaml` artifact.

## Canonical Command

```bash
pnpm schema:validate
```

The root command performs the full OpenAPI contract gate:

1. Builds `@oa-sdk/parser`.
2. Builds `@oa-sdk/codegen`.
3. Runs `@oa-sdk/schemas` validation.
4. Runs strict `oa-gen validate --require-32` against `packages/schemas/src/.merged.yaml`.

Inside `@oa-sdk/schemas`, validation is:

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
pnpm --filter @oa-sdk/schemas run build:merged
pnpm --filter @oa-sdk/schemas run build:merged:staging
pnpm --filter @oa-sdk/schemas run build:merged:production
```

Each command selects a target config under `packages/schemas/src/targets/` and
writes the selected artifact to `src/.merged.yaml` for downstream validation or
bundling.

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

Rollback is now a normal git rollback of the Definition Builder replacement
change. There is no supported in-repo legacy merge command after this
transition.
