# OA SDK TypeSpec Extension Schema v4

Status: accepted for root OpenAPI info metadata, dated 2026-06-22.

Schema version: `oa-sdk.typespec-extensions.v4`.

v4 extends [`oa-sdk.typespec-extensions.v3`](./oa-sdk-typespec-extensions.v3.md) with root `info` metadata restoration. v1, v2, and v3 remain unchanged for sidecar-less bundles that do not need to restore OpenAPI `info` fields beyond TypeSpec's native title/version projection.

## Decision

Accept `oa-sdk.typespec-extensions.v4` as the narrow restore-bearing extension schema for OpenAPI root `info` metadata that TypeSpec does not roundtrip in the current emitter path.

This keeps TypeSpec-native `@service` and `@info` as the owner for title/version. The extension is only for preserving OpenAPI-native metadata such as `description` and SPDX `license.identifier` without weakening the restored OpenAPI diff gate.

## Bundle Contract

A sidecar-less v4 bundle declares the schema version in `oa-sdk.typespec-bundle.v1`:

```json
{
  "schemaVersion": "oa-sdk.typespec-bundle.v1",
  "entrypoint": "main.tsp",
  "expectedOpenapi": "expected.openapi.yaml",
  "compatibility": {
    "openapiVersion": "3.2.0",
    "oaSdkExtensionSchemaVersion": "oa-sdk.typespec-extensions.v4"
  }
}
```

## Root Info

`x-oa-sdk-info` is placed on the OpenAPI Document Object through TypeSpec `@extension(...)`.

Recognized shape:

```json
{
  "title": "OA SDK API",
  "description": "OpenAPI 3.2 API",
  "version": "0.1.0",
  "license": {
    "name": "MIT",
    "identifier": "MIT"
  }
}
```

Rules:

- The extension becomes a `root-info` compatibility entry.
- The restored target is the OpenAPI root `info` field.
- If `title` or `version` is omitted from the extension payload, the TypeSpec-emitted `info.title` or `info.version` is used.
- The final restored OpenAPI must not contain `x-oa-sdk-info`.

Example TypeSpec authoring:

```tsp
@extension("x-oa-sdk-info", #{
  title: "OA SDK API",
  description: "OpenAPI 3.2 API",
  version: "0.1.0",
  license: #{ name: "MIT", identifier: "MIT" }
})
@service(#{ title: "OA SDK API" })
@info(#{ version: "0.1.0" })
namespace OaSdkApi;
```

## Restore Semantics

The restore loop is the same as v3, with one additional recognized extension family:

1. Compile TypeSpec with `@typespec/openapi3`.
2. Convert recognized `x-oa-sdk-*` metadata into in-memory `oa-sdk.typespec-compat-sidecar.v1` entries, including a `root-info` entry from `x-oa-sdk-info`.
3. Strip restore-only `x-oa-sdk-*` metadata.
4. Apply the in-memory entries to OpenAPI-native targets.
5. Re-extract compatibility sidecar semantics and compare for stability.
6. Validate and diff the restored OpenAPI.

## Production Evidence

The production TypeSpec bundle declares v4 and restores root info metadata, richer bearer component metadata, request/response examples, and explicit public operation security. The schema gate reports 115 extension-derived semantic entries and keeps the reviewed restored-vs-reference drift at 51 hash-pinned entries.
