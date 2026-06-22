# OA SDK TypeSpec Extension Schema v1

Status: implementation-backed draft.

Schema version: `oa-sdk.typespec-extensions.v1`.

This document standardizes the OA SDK-owned TypeSpec extension vocabulary used by sidecar-less authored TypeSpec bundles. It is intentionally narrow: v1 covers only the semantics that the current TypeSpec OpenAPI emitter does not carry in a stable OA SDK-compatible form and that are already proven by the authored extension fixture.

## Purpose

The v1 extension vocabulary lets a `.tsp` bundle act as the single authoring surface for OA SDK contract semantics that otherwise live in `oa-sdk.typespec-compat-sidecar.v1`.

This vocabulary is authoring metadata, not a final OpenAPI artifact contract. The bundle check reads `x-oa-sdk-*` metadata from TypeSpec-emitted OpenAPI, converts it to sidecar-equivalent entries, strips the `x-oa-sdk-*` metadata, applies the entries to the emitted OpenAPI, and validates/diffs the restored OpenAPI.

Related implementation:

- `packages/codegen/src/cli/lib/typespec-oa-sdk-extensions.ts` recognizes and strips the extension metadata.
- `packages/codegen/src/cli/lib/typespec-bundle-check.ts` chooses `typespec-extensions` as the compatibility source when a manifest has no sidecar.
- `packages/codegen/src/cli/lib/typespec-bundle-manifest.ts` validates the extension schema version marker.
- `docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/` is the reference fixture.

## Bundle Contract

A sidecar-less TypeSpec bundle must declare the extension schema version in `oa-sdk.typespec-bundle.v1`:

```json
{
  "schemaVersion": "oa-sdk.typespec-bundle.v1",
  "entrypoint": "main.tsp",
  "expectedOpenapi": "expected.openapi.yaml",
  "compatibility": {
    "openapiVersion": "3.2.0",
    "oaSdkExtensionSchemaVersion": "oa-sdk.typespec-extensions.v1"
  }
}
```

Selection rules:

- If `sidecar` is present, `tsp-bundle-check` uses `compatibilitySource: "sidecar"`.
- If `sidecar` is absent, the manifest must declare `compatibility.oaSdkExtensionSchemaVersion: "oa-sdk.typespec-extensions.v1"`, and `tsp-bundle-check` uses `compatibilitySource: "typespec-extensions"`.
- `expectedOpenapi` is optional in the manifest format, but standard sidecar-less fixtures should include it so the restored output is compared against an explicit OpenAPI target.

## Extension Names

v1 defines two extension names:

| Extension | Placement | Meaning |
|---|---|---|
| `x-oa-sdk-operation-examples` | OpenAPI Operation Object | Parameter examples and response media examples that OA SDK must restore onto OpenAPI-native targets. |
| `x-oa-sdk-security-schemes` | OpenAPI Document root | Security scheme component metadata that OA SDK must restore under `components.securitySchemes`. |

These fields are normally authored through TypeSpec `@extension(...)` decorators from `@typespec/openapi`.

## Operation Examples

`x-oa-sdk-operation-examples` is placed on an operation.

Recognized shape:

```json
{
  "parameters": {
    "<authoringKey>": {
      "name": "<parameterName>",
      "in": "query",
      "example": {},
      "examples": {}
    }
  },
  "responses": {
    "<authoringKey>": {
      "<nestedKey>": {
        "statusCode": "200",
        "mediaType": "application/json",
        "example": {},
        "examples": {}
      }
    }
  }
}
```

Parameter rules:

- Each `parameters` entry becomes a `parameter-examples` compatibility entry.
- `name` selects the OpenAPI parameter name. If omitted, the authoring key is used as the fallback name.
- `in` selects the OpenAPI parameter location. If omitted, `query` is used as the fallback location.
- At least one of `example` or `examples` must be present for an entry to be restored.

Response rules:

- `responses` may be nested for authoring readability.
- Any nested record with `statusCode`, `mediaType`, and at least one of `example` or `examples` becomes a `response-media-examples` compatibility entry.
- `statusCode` is normalized to string.
- The restored target is `paths.<path>.<method>.responses.<statusCode>.content.<mediaType>`.

Example values:

- `example` and `examples` are copied as JSON-compatible values.
- OA SDK examples may include fields such as `dataValue` and `serializedValue`; the restored document must pass OA SDK OpenAPI 3.2 validation.
- Extension-owned examples replace the matching TypeSpec-emitted examples for the same target. They are not deep-merged.

## Security Schemes

`x-oa-sdk-security-schemes` is placed on the emitted OpenAPI document root.

Recognized shape:

```json
{
  "<schemeName>": {
    "type": "oauth2",
    "flows": {
      "authorizationCode": {
        "authorizationUrl": "https://auth.example.com/authorize",
        "tokenUrl": "https://auth.example.com/token",
        "scopes": [
          { "name": "read:users", "description": "Read users" }
        ]
      }
    }
  }
}
```

Rules:

- Each root entry becomes a `security-scheme` compatibility entry.
- The restored target is `components.securitySchemes.<schemeName>`.
- Security scheme values are otherwise preserved as JSON-compatible values.
- OAuth `scopes` may be authored as a TypeSpec-friendly array of `{ "name": string, "description": string }` records. The restore path normalizes that array to the OpenAPI scopes map, so scope names such as `read:users` do not depend on TypeSpec object key syntax.

## Restore Semantics

The restore sequence for sidecar-less bundles is:

1. Compile TypeSpec with `@typespec/openapi3`.
2. Read `x-oa-sdk-security-schemes` and operation-level `x-oa-sdk-operation-examples` from the emitted OpenAPI.
3. Convert recognized extension metadata to `oa-sdk.typespec-compat-sidecar.v1` entries in memory.
4. Remove the `x-oa-sdk-*` metadata from the emitted OpenAPI.
5. Apply the in-memory entries to OpenAPI-native targets.
6. Re-extract compatibility sidecar semantics from the restored OpenAPI and compare them to the in-memory entries.
7. Validate the restored OpenAPI with OA SDK OpenAPI 3.2 validation and run the expected diff gate when `expectedOpenapi` is present.

The final restored OpenAPI should not contain `x-oa-sdk-operation-examples` or `x-oa-sdk-security-schemes`.

## Non-Goals In v1

v1 does not standardize:

- Request body examples.
- Callback, link, or webhook-specific metadata.
- Read/write visibility, annotations, or role-specific projection policy.
- Arbitrary OpenAPI extension transport.
- Automatic conversion from generated sidecars back into `.tsp` decorators.

Generated OpenAPI-to-TypeSpec bundles may continue to use `oa-sdk.typespec-compat-sidecar.v1`. The v1 TypeSpec extension schema is the authored sidecar-less path.

## Versioning

`oa-sdk.typespec-extensions.v1` is stable for the two extension names above.

Compatible changes:

- Adding optional fields that are ignored by current consumers.
- Adding new extension names only when older consumers can ignore them without changing restored OpenAPI for v1 fixtures.

Breaking changes require a new schema version:

- Renaming extension fields.
- Changing fallback target resolution.
- Changing example overwrite semantics.
- Changing security scheme scope normalization.

## Required Gates

The reference sidecar-less bundle must pass:

```bash
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
```

The TypeSpec roundtrip feature gate should also include:

```bash
pnpm --filter @oa-sdk/codegen test -- src/__tests__/typespec-authored-bundle.test.ts
pnpm check:feature-tests
```
