# @oa-sdk/openapi-projection-contract

## 0.2.0

_Reconstructed from the repository history: 0.2.0 was published to npm on 2026-09-11 from source revision 0f69f47a without a changeset, so it had no entry here._

### Minor Changes

- Add `projectDiscriminatedUnion()` and `projectDiscriminatedUnionDocument()`. They project a set of variants keyed by a discriminator value (for example a multiplexed RPC or MCP request) into an OpenAPI 3.1 `oneOf` schema with a `discriminator`, one component schema per variant and, for the `operation-contract` profile or with a `pathPrefix`, one `POST` operation per variant under the path prefix (default `/rpc`). The document form returns an `OpenApiProjectionResult` with the complete document.
- Add the surface extension vocabulary: the `x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style` and `x-surface-patch-policy` names (`OPENAPI_SURFACE_EXTENSION_NAMES`), their metadata types, and type guards (`isOpenApiSurfaceExtensionName()`, `isSurfaceQuoteStyle()`, `isSurfaceFingerprint()`, `isSurfaceAnchorMetadata()`, `isSurfaceParamRangeMetadata()`, `isSurfacePatchPolicyMetadata()`).
- The manifest declares `main`, `types` and a `default` export condition, so CommonJS-style resolvers and tools that read `main` find the entry point.

## 0.1.2

### Patch Changes

- e0f2d5b: Prepare the OA Gen CLI and its runtime dependency closure (including the TypeSpec decorator
  library required by provenance tooling) for public npm distribution,
  including explicit package boundaries, Node runtime requirements, and a packed-artifact smoke test.
