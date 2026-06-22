# Authored Canonical TypeSpec Bundle

This fixture is the G7 full canonical authored bundle candidate.

It starts from the canonical `oa-gen tsp-export` scaffold for `packages/schemas/src/.merged.yaml`, then moves OA SDK compatibility sidecar semantics into TypeSpec `@extension(...)` metadata using `oa-sdk.typespec-extensions.v2`.

The generated canonical sidecar has 102 entries. G6 conversion can move 99 entries directly into extension metadata and leaves 3 path-level parameter examples as residual sidecar entries. For this sidecar-less fixture, those 3 path-level examples are expanded into 5 operation-level parameter extension entries:

- `POST /admin/users/{id}/purge`
- `GET /users/{id}`
- `DELETE /users/{id}`
- `PATCH /users/{id}`
- `GET /users/{id}/public`

That yields 104 extension-owned entries and no residual sidecar.

Required gate:

```bash
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
```

This fixture does not make TypeSpec the production schema source of truth by itself. It provides the full-canonical evidence required before ADR-009 can be promoted by G8.
