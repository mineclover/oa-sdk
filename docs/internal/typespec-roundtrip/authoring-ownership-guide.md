# TypeSpec Authoring Ownership Guide

Status: implementation-backed guide, not an ADR and not a TypeSpec-first declaration.

This guide maps OA SDK contract facts to the authoring surface that owns them today. Use it when writing or reviewing an `oa-sdk.typespec-bundle.v1` bundle.

The rule of thumb is simple: use TypeSpec-native syntax when the OpenAPI emitter carries the fact stably, use an OA SDK TypeSpec extension when a sidecar-less authored bundle must restore an OpenAPI-native target, use the compatibility sidecar when generated or unsupported metadata must stay OpenAPI-owned, and keep runtime-only behavior out of `.tsp` comments.

## Ownership Buckets

| Bucket | Use When | Current Source |
|---|---|---|
| TypeSpec-native syntax | The TypeSpec source and OpenAPI emitter can express the fact directly and the emitted/restored OpenAPI passes OA SDK validation and diff gates. | `.tsp` source and `@typespec/openapi3` output |
| OA SDK TypeSpec extension | A sidecar-less authored bundle needs restore-bearing OA SDK metadata that maps to an OpenAPI-native target after TypeSpec compile. | `x-oa-sdk-operation-examples`, `x-oa-sdk-security-schemes` emitted from TypeSpec `@extension(...)` |
| Compatibility sidecar | Generated bundles, `.tsp + sidecar` authored bundles, or unsupported extension semantics need to preserve OpenAPI-owned facts without pretending TypeSpec owns them. | `oa-sdk.typespec-compat-sidecar.v1` |
| Runtime data or adapter policy | The fact changes mock/runtime behavior, review policy, generation priority, or downstream orchestration but is not itself an OpenAPI contract target. | Mock server, personas, review policy, or downstream adapter code |

## Bundle Shapes

| Bundle Shape | Required Files | Compatibility Source | Use For |
|---|---|---|---|
| Generated `.tsp + sidecar` | `main.tsp`, `oa-sdk.typespec-compat-sidecar.json`, `oa-sdk.typespec-bundle.json`, optional `expected.openapi.yaml` | `sidecar` | OpenAPI-to-TypeSpec export and canonical roundtrip probes. |
| Authored `.tsp + sidecar` | Hand-written `main.tsp`, authored sidecar, manifest, expected OpenAPI | `sidecar` | Contract slices whose metadata is not yet standardized as a TypeSpec extension. |
| Authored sidecar-less `.tsp` | Hand-written `main.tsp`, manifest with `compatibility.oaSdkExtensionSchemaVersion`, expected OpenAPI | `typespec-extensions` | Maintainer-authored bundles using `oa-sdk.typespec-extensions.v1` or `v2`. |

If `sidecar` is absent, the manifest must declare `compatibility.oaSdkExtensionSchemaVersion`. If `sidecar` is present, the bundle check uses the sidecar and does not infer extension semantics as the compatibility source.

## Contract Fact Map

| Contract Fact | Owner | How To Author | Notes |
|---|---|---|---|
| API title and version | TypeSpec-native syntax | `@service`, `@info` | Must remain visible in emitted OpenAPI. |
| Servers | TypeSpec-native syntax | `@server` | Keep variable-heavy or runtime-selected server behavior outside this track until proven. |
| Path, HTTP method, operation id | TypeSpec-native syntax | `@route`, `@get`/`@post`/etc., `@operationId` | Operation identity must stay stable across emitted/restored OpenAPI. |
| Operation summary, description, tags | TypeSpec-native syntax | `@summary`, `@doc`, `@tag` | Tag descriptions use `@tagMetadata` when stable. |
| Component object schema shape | TypeSpec-native syntax | `model`, required/optional properties, scalar/array/union/intersection syntax | Use the bundle expected OpenAPI to prove emitted shape is acceptable. |
| Object sealing | TypeSpec-native syntax | `...Record<never>;` | Expected OpenAPI currently accepts TypeSpec's sealed-object projection shape. |
| Property docs, scalar constraints, formats, defaults, deprecated marker | TypeSpec-native syntax | `@doc`, `@minLength`, `@maxValue`, `@format`, value defaults, `#deprecated` | These belong in `.tsp` when the emitted artifact remains stable. |
| Schema and property examples | TypeSpec-native syntax when projection is stable | `@example` | Do not use this bucket for operation parameter, request body media, or response media examples. |
| Parameters | TypeSpec-native syntax | `@path`, `@query`, `@header`, `@cookie` | Parameter locations and schema constraints belong in `.tsp`. |
| Parameter examples with `dataValue` / `serializedValue` | OA SDK TypeSpec extension or compatibility sidecar | `x-oa-sdk-operation-examples.parameters` or `parameter-examples` sidecar entry | v1 and v2 support the sidecar-less extension path. |
| Request body schema | TypeSpec-native syntax | `@body` parameter | The request body schema belongs in `.tsp`; media examples do not. |
| Request body media examples with `dataValue` / `serializedValue` | OA SDK TypeSpec extension v2 or compatibility sidecar | `x-oa-sdk-operation-examples.requestBody` or `request-media-examples` sidecar entry | Requires manifest `oa-sdk.typespec-extensions.v2` for sidecar-less bundles. |
| Response status and body schema | TypeSpec-native syntax | Response model with `@statusCode` and `@body` | Response shape must remain valid OpenAPI 3.2 after emit. |
| Response headers | TypeSpec-native syntax when schema-only header projection is enough | `@header` | Header content schemas and links remain explicit diagnostics until supported. |
| Response media examples with `dataValue` / `serializedValue` | OA SDK TypeSpec extension or compatibility sidecar | `x-oa-sdk-operation-examples.responses` or `response-media-examples` sidecar entry | v1 and v2 support the sidecar-less extension path. |
| Bearer auth requirement | TypeSpec-native syntax | `model bearerAuth is BearerAuth;`, `@useAuth(bearerAuth)` | Supported bearer requirements are contract-bearing and should not be sidecar-only. |
| Unsupported security scheme component metadata | OA SDK TypeSpec extension or compatibility sidecar | `x-oa-sdk-security-schemes` or `security-scheme` sidecar entry | Safe only as metadata when not changing operation auth semantics. |
| Referenced unsupported auth requirement | Not accepted as metadata-only | No silent sidecar/extension hiding | Remains contract-bearing until an explicit mapping or policy exists. |
| Read/write visibility, annotations, role-specific projection | Not extension-first | Define OA SDK visibility policy first | Do not hide this in comments or generic extension payloads. |
| Callbacks, links, webhooks | TypeSpec-native if proven; otherwise dedicated design | Separate fixture and extension design if needed | Do not place runtime semantics in the examples extension. |
| Component projection artifacts and diff normalization | Review policy | Roundtrip report and focused equivalence tests | These are review facts, not authoring vocabulary. |
| Mock priority, generated examples, personas, adapter behavior | Runtime data or adapter policy | Runtime package fixtures/configuration | `.tsp` may restore OpenAPI examples, but runtime priority rules live in runtime code. |

## Extension Versions

`oa-sdk.typespec-extensions.v1` is frozen at:

- `x-oa-sdk-operation-examples.parameters`
- `x-oa-sdk-operation-examples.responses`
- `x-oa-sdk-security-schemes`

`oa-sdk.typespec-extensions.v2` adds:

- `x-oa-sdk-operation-examples.requestBody`

A restore-bearing addition requires a new extension schema version. Do not silently expand v1 just because older consumers ignore unknown fields; if the field changes restored OpenAPI output, version it.

## Review Checklist

Before accepting a new authored TypeSpec bundle:

1. Confirm every contract fact is assigned to exactly one ownership bucket.
2. Confirm sidecar-less bundles declare `compatibility.oaSdkExtensionSchemaVersion`.
3. Confirm restored OpenAPI contains no restore-only `x-oa-sdk-*` metadata.
4. Run `pnpm typespec:bundle-check -- --manifest <bundle>/oa-sdk.typespec-bundle.json --fail-on-breaking`.
5. For broader readiness claims, also run `pnpm typespec:roundtrip -- --fail-on-breaking`, `pnpm check:feature-tests`, `pnpm check:api-index`, and `pnpm check:cli-spec`.
6. If a fact lands in runtime data or review policy, name the owning package or follow-up design instead of encoding it as an unvalidated TypeSpec comment.

## Implementation References

- `packages/codegen/src/cli/lib/typespec-sidecar.ts` — sidecar entry kinds, restore, and re-extraction comparison.
- `packages/codegen/src/cli/lib/typespec-oa-sdk-extensions.ts` — TypeSpec extension metadata extraction.
- `packages/codegen/src/cli/lib/typespec-bundle-manifest.ts` — manifest parsing and extension schema version validation.
- `packages/codegen/src/cli/lib/typespec-bundle-check.ts` — compile, restore, validation, and expected diff gate.
- `packages/codegen/src/cli/lib/typespec-roundtrip-report.ts` — diagnostic ownership policy.
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v1.md` — v1 extension schema.
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v2.md` — v2 request body examples schema.
- `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/` — representative sidecar-less authored fixture.
- `docs/internal/typespec-roundtrip/fixtures/authored-request-body-extension-bundle/` — focused v2 request body fixture.
