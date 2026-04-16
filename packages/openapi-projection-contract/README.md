# OpenAPI Projection Contract

`@oa-sdk/openapi-projection-contract` defines the source-agnostic envelope shared by OpenAPI projection adapters. The contract describes projected OpenAPI artifacts, profile semantics, refs, diagnostics, source coordinates, version hashes, and optional type targets. It does not load files, query databases, run CLIs, or import OA SDK parser/codegen internals or bun-graph-db runtime code.

## Projection Profiles

| Profile | Paths rule | Components rule | Validation rule |
|---|---|---|---|
| `component-bundle` | `paths` may be absent or empty. | `components.schemas` is required. | Profile-aware validation should allow the empty-path component bundle shape while requiring reusable schemas. |
| `operation-contract` | `paths` must contain at least one operation under a path item. | `components.schemas` is optional unless referenced by operations. | Profile-aware validation should combine normal OpenAPI checks with the operation requirement. |
| `full-api-document` | Uses normal OpenAPI document rules. | Uses normal OpenAPI document rules. | Validators should apply normal OpenAPI document validation. |

The profile names are exported through `OPENAPI_PROJECTION_PROFILES`, runtime profile checks use `isOpenApiProjectionProfile()`, and shape rules are exported through `OPENAPI_PROJECTION_PROFILE_SEMANTICS`.

## Validation

`validateOpenApiProjection(result)` is the shared dependency-light validation entrypoint. It accepts unknown input, returns `SchemaValidateResult`, and reports ordinary invalid projection data as structured diagnostics instead of throwing.

The built-in OpenAPI check is intentionally structural rather than a broad spec engine. It verifies the document object, OpenAPI 3.x version marker, required `info.title` and `info.version`, `paths` shape, operation `responses`, and `components.schemas` shape. Profile-aware rules then require `components.schemas` for `component-bundle`, require at least one operation for `operation-contract`, and require a normal `paths` object for `full-api-document`.

Envelope validation also checks required ref fields, diagnostic severity/code/message fields, supported file or DB source coordinate variants, version hash presence, and optional type target metadata. Any existing projection diagnostic with `severity: "error"` makes the returned validation result invalid.

This validator does not read files, query repositories, open SQLite, construct MCP servers, execute GraphQL, or import OA SDK parser/codegen internals. Callers that need full OpenAPI conformance validation should run their own source-specific validator before or after this shared contract check and map results into `diagnostics`.

## First Emitters

OA SDK should emit `full-api-document` first because Definition Builder already materializes complete OpenAPI 3.2 documents from file-backed definition fragments.

bun-graph-db should emit `component-bundle` first because table metadata already maps cleanly to reusable schemas. `operation-contract` should follow when create/update node operations are represented as OpenAPI request contracts. bun-graph-db should only emit `full-api-document` after it has a complete API document surface rather than table-scoped schema material.

These recommendations are migration order guidance only. Profile semantics are based on the emitted OpenAPI projection shape, not on which system produced it.
