# @oa-sdk/surface-ir

## 0.2.0

### Minor Changes

- fadcf07: **Behavior change:** `canonicalJsonStringify` and `computeCanonicalHash` throw a `TypeError` for input that has no RFC 8785 form: non-finite numbers, `bigint`, strings or keys with lone surrogates, `Map`, `Set` and class instances without `toJSON`, and a top-level `undefined`, function or symbol. They used to return colliding or invalid output for such values. `toJSON` and boxed primitives are handled as `JSON.stringify` handles them, and `undefined`, function and symbol array elements become `null`, so a value hashes the same before and after a JSON round trip.
- f0edbd0: Make Interface Sketch parsing, trace graphs and the contract canary match the source they read. Review the items marked **behavior change** when upgrading.

  - `@oa-sdk/surface-ir` **behavior change:** `INTERFACE_SKETCH_IR_VERSION` is `oa-sdk.interface-sketch-ir.v2`. `InterfaceSketchIr` has a required `diagnostics: SketchDiagnostic[]` and `SketchUnionOrEnumIr` a required `members: SketchVariantIr[]`; `SketchModelIr` gains `templateParameters`, and `baseModel` also covers `extends` and keeps template arguments. `versionHash` values change. The parser is a tokenizer and recursive-descent scanner, so `extends`, templated and `is X;` models and bodies with nested braces are no longer dropped or truncated, and doc comments and decorators attach only to the declaration that follows them.
  - `@oa-sdk/codegen`: `emitSketchArtifacts` accepts a v2 or a v1 IR, upgrading the v1 one, and throws for any other version. Emitted OpenAPI refs point to `#/components/schemas/`, enums carry their values instead of their member names, unions become `anyOf`, undeclared types are tagged `x-oa-sdk-sketch-unresolved-type`, and the Python stub uses `@dataclass(kw_only=True)` (Python 3.10+) so it imports whatever the field order. `oa-gen sketch verify` and `check-contract` use the domain (`--domain`, else the file basename) as the spec name, so `versionHash` no longer depends on the machine, and `verify`, `emit`, `check-contract` and `compare` exit 1 when the IR has error diagnostics. The CLI governance manifest declares the sketch report schema `oa-sdk.interface-sketch-ir.v2`.
  - `@oa-sdk/codegen`: `oa-gen trace` links path-item-level `parameters` `$ref`s to every operation of the path, includes the generated `*PathParams`, `*QueryParams` and `*HeaderParams` symbols of `$ref` parameters, and reads `x-persona` arrays and object-shaped storage, behavior and DPM refs. **Behavior change:** `SpecTraceGovernanceCapabilities` has a required `personas: string[]` (`persona` is deprecated), and interface operation ids are qualified as `operation:<file>:<Interface>.<op>`, with a new `typespec-provenance/duplicate-declaration-id` diagnostic. The spec, provenance map and manifest inputs of `oa-gen trace` are validated, and `loadSpecTraceabilitySidecar` validates the whole sidecar.
  - `@oa-sdk/ast-sync`: `checkImplementationContract` counts a contracted name only when the file binds it. Comments, strings, call sites, property reads and plain imports of an operation no longer count. It honors `language` (`'auto'` detects Python), no longer treats TypeScript `#private` member lines as comments, and matches lock-reflex patterns only in code.

- 4538f7c: Project TypeSpec/OpenAPI operations onto typed RPC procedures.

  - `@oa-sdk/surface-ir`: `buildRpcContract(document, options?)` and `toRpcContract(ir, document, options?)` produce the JSON contract `oa-sdk.rpc-contract.v1`. Each operation becomes a dotted-name procedure (`@rpc` service/method names, else the camel-cased first tag and the operationId) with one object input that merges its parameters and request body, its success output, declared error responses, and the HTTP binding needed to rebuild the REST request. Streaming operations are skipped with a warning; collisions are reported as diagnostics.
  - `@oa-sdk/codegen`: `pluginRpc()` and `generateRpcModule(contract, options?)` emit a module with the `<Name>Procedures` type map and the `<name>Contract` data.
  - `@oa-sdk/rpc` (new, private): `createRpcClient` / `createRpcServer` with JSON-RPC 2.0 (`createJsonRpcTransport`, `createJsonRpcFetchHandler`, `handleJsonRpc`) and REST binding (`createHttpTransport`, `createRestFetchHandler`) transports, `createLocalTransport`, `RpcError`, and an Ajv validator at `@oa-sdk/rpc/ajv`.

### Patch Changes

- Updated dependencies [9743fb4]
  - @oa-sdk/parser@0.5.0

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
