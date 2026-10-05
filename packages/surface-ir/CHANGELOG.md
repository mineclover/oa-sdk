# @oa-sdk/surface-ir

## 0.1.1

First version published to npm; 0.1.0 was never published.

`@oa-sdk/surface-ir` describes the SDK and CLI surface of an API, separately from its wire contract. It reads a `ParsedDocument` of `@oa-sdk/parser` and projects the result for Forge. `oa-gen surface` of `@oa-sdk/codegen` uses it. It runs on Node.js 22 or later.

- `buildSurfaceIr(document, options?)` returns a `SurfaceIr` (`schemaVersion: 'oa-sdk.surface-ir.v1'`). For each operation it records the wire contract (path, method, tags, summary), the SDK projection (group path, method name, availability, visibility, aliases), CLI argument and parameter overrides, runtime facts (envelope, error style, pagination, streaming media type) and the operation's OpenAPI pointer, and it adds a hash of the source surface (`artifactHash`) and of the IR (`versionHash`). Options choose the target (`generic` or `forge`), the default availability, envelope and error style, functions that derive group and method names, and per-operation overrides.
- `buildSurfaceIr()` reports problems as diagnostics instead of throwing: an incompletely resolved document, an operation without `operationId`, an unsupported HTTP method, two operations assigned the same group and method name, and, for the `forge` target, OpenAPI `QUERY` operations.
- `toForgeProjection(ir, document)` returns the `x-fern-*` and `x-forge-*` metadata of each operation and a command catalog. `emitForgeOverlays()` emits one OpenAPI Overlay document per top-level Forge command, and `emitForgeOverlay()` a single one.

### Patch Changes

- Updated dependencies
- Updated dependencies [b4f5dd4]
  - @oa-sdk/parser@0.4.0
