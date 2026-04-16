# OpenAPI Projection Contract

`@oa-sdk/openapi-projection-contract` defines the source-agnostic envelope shared by OpenAPI projection adapters. The contract describes projected OpenAPI artifacts, profile semantics, refs, diagnostics, source coordinates, version hashes, and optional type targets. It does not load files, query databases, run CLIs, or import OA SDK parser/codegen internals or bun-graph-db runtime code.

## Projection Profiles

| Profile | Paths rule | Components rule | Validation rule |
|---|---|---|---|
| `component-bundle` | `paths` may be absent or empty. | `components.schemas` is required. | Profile-aware validation should allow the empty-path component bundle shape while requiring reusable schemas. |
| `operation-contract` | `paths` must contain at least one operation under a path item. | `components.schemas` is optional unless referenced by operations. | Profile-aware validation should combine normal OpenAPI checks with the operation requirement. |
| `full-api-document` | Uses normal OpenAPI document rules. | Uses normal OpenAPI document rules. | Validators should apply normal OpenAPI document validation. |

The profile names are exported through `OPENAPI_PROJECTION_PROFILES`, runtime profile checks use `isOpenApiProjectionProfile()`, and shape rules are exported through `OPENAPI_PROJECTION_PROFILE_SEMANTICS`.

## First Emitters

OA SDK should emit `full-api-document` first because Definition Builder already materializes complete OpenAPI 3.2 documents from file-backed definition fragments.

bun-graph-db should emit `component-bundle` first because table metadata already maps cleanly to reusable schemas. `operation-contract` should follow when create/update node operations are represented as OpenAPI request contracts. bun-graph-db should only emit `full-api-document` after it has a complete API document surface rather than table-scoped schema material.

These recommendations are migration order guidance only. Profile semantics are based on the emitted OpenAPI projection shape, not on which system produced it.
