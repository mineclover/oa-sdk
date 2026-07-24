# OA SDK TypeSpec Extension Schema v2

Status: accepted for request body media examples, dated 2026-06-22.

Schema version: `oa-sdk.typespec-extensions.v2`.

Lifecycle note: this decision predates the production source-path switch. The current default
production source is `packages/schemas/typespec/`; the current promotion and validation procedure
is maintained in [`production-operations.md`](./production-operations.md).

v2 extends [`oa-sdk.typespec-extensions.v1`](./oa-sdk-typespec-extensions.v1.md) with request body media examples. The v1 vocabulary remains frozen for sidecar-less bundles that only restore parameter examples, response media examples, and security scheme metadata.

## Decision

Accept `oa-sdk.typespec-extensions.v2` as the narrow restore-bearing extension schema for OA SDK request body media examples.

At the time of this decision, it did not make TypeSpec the default production schema source of truth. It only meant a sidecar-less authored TypeSpec bundle could own request body `example` / `examples` semantics through `x-oa-sdk-operation-examples.requestBody` when its manifest declared `compatibility.oaSdkExtensionSchemaVersion: "oa-sdk.typespec-extensions.v2"`.

No other metadata family is accepted into v2. Explicit public operation security is standardized separately in [`oa-sdk-typespec-extensions.v3.md`](./oa-sdk-typespec-extensions.v3.md).

## Purpose

The v2 extension vocabulary lets authored `.tsp` bundles keep OA SDK request body example semantics in TypeSpec-owned metadata while still restoring them onto OpenAPI-native request body media targets.

The restore loop remains the same as v1:

1. Compile TypeSpec with `@typespec/openapi3`.
2. Convert recognized `x-oa-sdk-*` metadata into in-memory `oa-sdk.typespec-compat-sidecar.v1` entries.
3. Strip restore-only `x-oa-sdk-*` metadata.
4. Apply the in-memory entries to OpenAPI-native targets.
5. Re-extract compatibility sidecar semantics and compare for stability.
6. Validate and diff the restored OpenAPI.

## Bundle Contract

A sidecar-less v2 bundle declares the schema version in `oa-sdk.typespec-bundle.v1`:

```json
{
  "schemaVersion": "oa-sdk.typespec-bundle.v1",
  "entrypoint": "main.tsp",
  "expectedOpenapi": "expected.openapi.yaml",
  "compatibility": {
    "openapiVersion": "3.2.0",
    "oaSdkExtensionSchemaVersion": "oa-sdk.typespec-extensions.v2"
  }
}
```

## Operation Examples

v2 keeps the v1 `x-oa-sdk-operation-examples.parameters` and `x-oa-sdk-operation-examples.responses` shapes and adds `requestBody`.

Recognized request body shape:

```json
{
  "requestBody": {
    "<authoringKey>": {
      "mediaType": "application/json",
      "example": {},
      "examples": {}
    }
  }
}
```

Rules:

- `requestBody` may be nested for authoring readability.
- Any nested record with `mediaType` and at least one of `example` or `examples` becomes a `request-media-examples` compatibility entry.
- The restored target is `paths.<path>.<method>.requestBody.content.<mediaType>`.
- Extension-owned examples replace the matching TypeSpec-emitted examples for the same media target. They are not deep-merged.
- The final restored OpenAPI must not contain `x-oa-sdk-operation-examples`.

## Reference Fixture

The focused v2 fixture is:

- `docs/internal/typespec-roundtrip/fixtures/authored-request-body-extension-bundle/`

Required gate:

```bash
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-request-body-extension-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
```

Current evidence:

- The fixture reports 1 sidecar-equivalent entry: 1 request body media example.
- Restore applies 1/1 targets with 0 missing targets.
- Re-extraction reports 1/1 expected entries satisfied and 1/1 actual entries covered.
- Restored OpenAPI has 0 breaking endpoint changes against `expected.openapi.yaml`.
