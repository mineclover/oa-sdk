# OA SDK TypeSpec Extension Schema v3

Status: accepted for explicit public operation security overrides, dated 2026-06-22.

Schema version: `oa-sdk.typespec-extensions.v3`.

v3 extends [`oa-sdk.typespec-extensions.v2`](./oa-sdk-typespec-extensions.v2.md) with operation-level public security override metadata. v1 and v2 remain unchanged for sidecar-less bundles that do not need to restore explicit `security: []` onto public operations.

## Decision

Accept `oa-sdk.typespec-extensions.v3` as the narrow restore-bearing extension schema for OpenAPI operation `security: []` overrides.

This keeps protected auth semantics TypeSpec-native through declarations such as `model bearerAuth is BearerAuth;` and `@useAuth(bearerAuth)`. The extension is only for the OpenAPI distinction between an omitted operation `security` field and an explicit empty security requirement array.

## Bundle Contract

A sidecar-less v3 bundle declares the schema version in `oa-sdk.typespec-bundle.v1`:

```json
{
  "schemaVersion": "oa-sdk.typespec-bundle.v1",
  "entrypoint": "main.tsp",
  "expectedOpenapi": "expected.openapi.yaml",
  "compatibility": {
    "openapiVersion": "3.2.0",
    "oaSdkExtensionSchemaVersion": "oa-sdk.typespec-extensions.v3"
  }
}
```

## Operation Security

`x-oa-sdk-operation-security` is placed on an OpenAPI Operation Object through TypeSpec `@extension(...)`.

Recognized shape:

```json
[]
```

Rules:

- The extension becomes an `operation-security` compatibility entry.
- The restored target is the same operation's OpenAPI `security` field.
- v3 accepts only the empty array form, which represents an explicit public/no-auth operation override.
- Protected operation auth requirements remain TypeSpec-native and must not be hidden in this extension.
- The final restored OpenAPI must not contain `x-oa-sdk-operation-security`.

Example TypeSpec authoring:

```tsp
@route("/health")
@get
@extension("x-oa-sdk-operation-security", #[])
op getHealth(): HealthResponse;
```

## Restore Semantics

The restore loop is the same as v2, with one additional recognized extension family:

1. Compile TypeSpec with `@typespec/openapi3`.
2. Convert recognized `x-oa-sdk-*` metadata into in-memory `oa-sdk.typespec-compat-sidecar.v1` entries, including `operation-security` entries from `x-oa-sdk-operation-security`.
3. Strip restore-only `x-oa-sdk-*` metadata.
4. Apply the in-memory entries to OpenAPI-native targets.
5. Re-extract compatibility sidecar semantics and compare for stability.
6. Validate and diff the restored OpenAPI.

## Production Evidence

The production TypeSpec bundle declares v3 and restores explicit no-auth overrides for public operations. The schema gate reports 114 extension-derived semantic entries and keeps the reviewed restored-vs-reference drift at 52 hash-pinned entries.
