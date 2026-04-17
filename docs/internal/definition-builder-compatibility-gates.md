# Definition Builder Compatibility Gates

This document records the local compatibility gate for the current-domain
definition builder parity artifact.

## Command

```bash
pnpm schema:parity:compat
```

The command keeps `packages/schemas/src/.merged.yaml` as the source-of-truth
artifact and validates the ignored parallel artifact
`packages/schemas/src/.builder/local-parity-api.yaml`.

## Gate Coverage

`pnpm schema:parity:compat` performs these checks:

1. Rebuilds the current merge artifact with `pnpm --filter @oa-sdk/schemas run merge`.
2. Rebuilds the builder artifact with `pnpm --filter @oa-sdk/schemas run parity:build`.
3. Compares current `.merged.yaml` and builder `.builder/local-parity-api.yaml` with the normalized OpenAPI diff.
4. Runs `oa-gen validate` against the builder artifact.
5. Downgrades the builder artifact to OpenAPI 3.1 at `.builder/local-parity-api.3.1.yaml` and writes `.builder/local-parity-api.3.1.meta.json`.
6. Runs the same Spectral ruleset against the builder OpenAPI 3.2 artifact.
7. Runs the same Redocly ruleset against the downgraded builder OpenAPI 3.1 artifact.
8. Generates typegen output from both current and builder artifacts and compares the generated declarations.
9. Generates router and client output from the builder artifact.
10. Creates MSW handlers and a Node mock-server adapter from the builder artifact without binding a socket.

The generated report is written to
`packages/schemas/src/.builder/local-parity-api.compatibility.json`.

## Validation Equivalence

The current `pnpm schema:validate` flow is tied to `.merged.yaml`. The builder
equivalent applies the same validation surfaces to the builder artifact:

- `oa-gen validate --spec packages/schemas/src/.builder/local-parity-api.yaml`
- `spectral lint src/.builder/local-parity-api.yaml --ruleset .spectral.yaml`
- `downgrade-3.1.ts` transform to `.builder/local-parity-api.3.1.yaml` plus sidecar
- `redocly lint src/.builder/local-parity-api.3.1.yaml --config redocly.yaml`

## Accepted Differences

OpenAPI artifact drift: none. The local parity target carries the current root
`info`, `tags`, profile `servers`, selected paths, and retained shared
security schemes, so `pnpm schema:parity:diff` must report no differences.

Generated typegen declaration order: accepted. Owner:
definition-builder maintainers. Rationale: the builder emits equivalent
schemas and operations from fragment traversal order, while the current merge
emits from domain-file order. TypeScript type aliases can reference later
declarations, so declaration ordering does not change the generated API
surface. The compatibility gate normalizes exported declaration blocks and
fails if any declaration content differs.

## Retained Definitions

Target configs use `includeDefinitions` for current merge components that must
remain in the emitted artifact even when no selected path references them. The
local/staging/production parity targets use this for
`securityScheme:shared/common/OAuth2`, preserving the current generated client
auth helper and the current `components.securitySchemes.oauth2` surface.
