# OA SDK TypeSpec Extension Schema v5

Schema version: `oa-sdk.typespec-extensions.v5`.

v5 extends [`oa-sdk.typespec-extensions.v4`](./oa-sdk-typespec-extensions.v4.md) with reusable OpenAPI component identity restoration for shared parameters and responses. v1 through v4 remain unchanged for sidecar-less bundles that do not need to restore `components.parameters`, `components.responses`, or operation usage `$ref` identity.

## Decision

Accept `oa-sdk.typespec-extensions.v5` as the restore-bearing extension schema for OpenAPI reusable parameter/response component catalogs and operation-level component reference usage that TypeSpec's current emitter path does not preserve.

## Manifest Declaration

A sidecar-less v5 bundle declares the schema version in `oa-sdk.typespec-bundle.v1`:

```json
{
  "schemaVersion": "oa-sdk.typespec-bundle.v1",
  "entrypoint": "main.tsp",
  "expectedOpenapi": "expected.openapi.yaml",
  "compatibility": {
    "openapiVersion": "3.2.0",
    "oaSdkExtensionSchemaVersion": "oa-sdk.typespec-extensions.v5"
  }
}
```

## Root Component Catalog

`x-oa-sdk-components` is placed on the OpenAPI Document Object through TypeSpec `@extension(...)`.

The extension contains TypeSpec-safe arrays for OpenAPI maps:

- `parameters`: array of `{ name, value }` entries restored under `components.parameters[name]`.
- `responses`: array of `{ name, value }` entries restored under `components.responses[name]`.
- Response `content` maps are authored as arrays of `{ mediaType, value }`.
- Response `headers` maps are authored as arrays of `{ name, value }`.
- Local `$ref` values inside component values are authored as `{ ref: "#/..." }` and restored as `{ "$ref": "#/..." }`.

## Operation Component References

`x-oa-sdk-operation-component-refs` is placed on OpenAPI Operation Objects through TypeSpec `@extension(...)`.

The extension contains:

- `parameters`: array of `{ index, ref }` entries. `index` targets the emitted operation parameter array slot, and `ref` must point at `#/components/parameters/*`.
- `responses`: array of `{ statusCode, ref }` entries. `ref` must point at `#/components/responses/*`.

These entries restore operation usage identity after TypeSpec compile, so reusable components remain referenced rather than becoming unused restored catalog entries.

## Restore Semantics

The restore loop is the same as v4, with two additional recognized extension families:

1. Compile TypeSpec to OpenAPI.
2. Convert recognized `x-oa-sdk-*` metadata into in-memory `oa-sdk.typespec-compat-sidecar.v1` entries, including component catalog and operation reference entries.
3. Apply the sidecar.
4. Strip all restore-only `x-oa-sdk-*` metadata from the final OpenAPI.
5. Re-extract the sidecar from the restored OpenAPI and require semantic coverage.

The final restored OpenAPI must contain the restored OpenAPI-native `components.parameters`, `components.responses`, and `$ref` operation usages, but must not contain `x-oa-sdk-components` or `x-oa-sdk-operation-component-refs`.

## Production Evidence

The production TypeSpec bundle declares v5 and restores root info metadata, richer bearer component metadata, request/response examples, explicit public operation security, and reusable parameter/response component identity. The schema gate reports 193 extension-derived semantic entries and keeps reviewed restored-vs-reference drift at 0 entries.
