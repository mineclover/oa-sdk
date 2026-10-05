# @oa-sdk/mock-server

## 0.1.4

First version published to npm. The earlier versions below were workspace-only and never published.

`@oa-sdk/mock-server` serves an OpenAPI 3.x document, or a `ParsedDocument` of `@oa-sdk/parser`, as a mock API. Both adapters and the CLI reject a document whose `$ref`s do not resolve completely.

- `createMswHandlers()` and `createMswMockServer()` build MSW 2 request handlers, and `createNodeMockServer()` and the `oa-mock` CLI start a Node HTTP server. `oa-gen mock` of `@oa-sdk/codegen` runs this package as a companion package.
- `msw` is an optional peer dependency, but the package root, `@oa-sdk/mock-server/browser` and `@oa-sdk/mock-server/adapters/msw` import it. Install `msw` to use them; `@oa-sdk/mock-server/adapters/node-http` and the `oa-mock` CLI work without it, and so does `oa-gen mock` of `@oa-sdk/codegen` 0.9.0, which loads only `@oa-sdk/mock-server/adapters/node-http`.
- A request is validated against the operation's parameters, request body and security requirements: an invalid one gets a 422 `MockErrorResponse` whose details never echo the received values, and one without the required credentials a 401. A response comes from the documented examples (`dataValue` first) or is generated from its schema and validated against it, and SSE and NDJSON responses are streamed.
- The servers support route filtering (`include`), per-operation overrides, simulated callbacks, plugins with an in-memory CRUD store, network chaos (Node server and CLI), and replacing the document of a running Node server (`updateSpec()`).
- The package also exports the schema folding and generation building blocks (`foldSchema`, `generateAlgebra`, `GenerateFolder`, `StreamFolder`), the request validator and response picker, re-exports of the `@oa-sdk/parser` loading pipeline, and test helpers (`createTestClient()`, `createCoverageTracker()`, `createCallbackTracker()`). `@oa-sdk/mock-server/browser` is the browser-safe entry point.

### Patch Changes

Changes since 0.1.3:

- Network chaos. `createNodeMockServer({ chaos })` and the CLI flags `--ttfb`, `--jitter`, `--packet-loss`, `--loss-mode` and `--throttle` add latency with jitter, drop a share of requests (closing the socket, or answering 503 with `--loss-mode status`), and throttle response bandwidth, streamed responses included. The CLI rejects a negative or non-integer delay, a loss rate outside 0-100%, and a non-positive throttle rate.
- Plugins and stateful CRUD. Both adapters accept `plugins: MockPlugin[]`: after a request passes validation, the first `onMatch()` that returns a response replaces the generated one, and every `onResponse()` can transform the chosen response. A plugin response without a `schema` is not validated against the documented response schema. `stateful: true | InMemoryStoreOptions` (CLI: `--stateful`) adds `inMemoryStorePlugin()`, which lists, creates, reads, replaces, merges and deletes items of a collection path in memory, with optional `seed` data and `generateId`. `reset()` on the servers calls every plugin's `reset()`; the store restores its seed. `handleRequest()` takes `{ plugins }` as an optional last argument.
- The adapters accept a `ParsedDocument` and use it without parsing again.
- The MSW adapter parses the document itself instead of dereferencing it first, like the Node adapter. A document with an alias-only `$ref` cycle (`A` → `B` → `A`) is now rejected when the handlers are created; recursive object schemas are still accepted.
- b4f5dd4: @oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes.

  These changes apply to every document, including fully dereferenced ones on the default pipeline:

  - `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions onto route entries.
  - In both `loadSchema()` and `parseDocument()`, an `additionalOperations` entry is now ignored when it repeats a method that the same Path Item defines as a fixed field. The method names are compared case-insensitively. Code generated from `parseDocument()`, such as typegen output and generated clients and routers, no longer includes that entry.

  The following changes only affect documents that still contain Reference Objects at operation positions (Path Item, parameter, requestBody, response, callback) after the pass pipeline. What happens to them depends on whether a pass of the pipeline resolves `$ref`s. `SpecPass` has a new optional `resolvesRefs` flag for this. `createDerefPass()` sets it, so `derefPass`, the default passes and the deref pass that `parseDocument()` builds from its options have it. Set it on a custom pass that resolves references, for example one that wraps `derefSpec()`.

  Before this change, the two entry points handled such references differently, whatever the pipeline:

  - `parseDocument()` resolved a parameter or response `$ref` one hop against the entry document, without `summary`/`description` overrides, and dropped it when that hop found no object. It dropped requestBody `$ref`s and every Path Item that has a `$ref`, including the operations declared beside it. It kept callback Reference Objects as written.
  - `loadSchema()` returned parameter, requestBody, response and callback Reference Objects as written. Several `$ref` parameters collapsed into one entry under the merge key `undefined:undefined`. For a Path Item with a `$ref`, it indexed only the operations declared beside the `$ref`.

  With a pass that resolves `$ref`s, a reference left at an operation position is one the pass could not resolve, such as an external file without `basePath`, a missing target or a cycle. Route entries now omit it.

  - The reference keeps the spelling of the file it was written in. With `basePath`, that can be an external file that the pass inlined, so resolving it against the entry document could return an unrelated object with the same pointer.
  - This includes the default pipeline. `loadSchema()`, which `@oa-sdk/mock-server` re-exports, no longer returns Reference Objects in `parameters`, `requestBody`, `responses` or `callbacks`, and `parseDocument()` no longer returns callback Reference Objects. To detect references that stayed unresolved, check `parseDocument(...).resolution`: its status is `partial` and its diagnostics list the unresolved `$ref` values.
  - Fields declared beside a Path Item `$ref` that could not be resolved still apply.

  Without such a pass, for example with a custom pass list like `[]`, local references at operation positions are now resolved by following the reference chain, and the overrides below apply.

  - At parameter, requestBody, response and callback positions, the `$ref` is an OAS 3.2 Reference Object. Only a `summary` or `description` beside it overrides the target, and only when the target's object type defines that field: `description` for parameters and request bodies, both for responses, neither for callbacks. Other sibling fields are ignored.
  - Fields declared beside a Path Item `$ref` overlay the referenced Path Item.
  - A reference that cannot be resolved locally (an external file, a missing target, a cycle) is omitted at parameter, requestBody, response and callback positions.
  - When a Path Item `$ref` chain cannot be followed to its end, the fields declared beside every `$ref` up to the failing hop still apply, and the outermost wins. The deref pass keeps the same fields, so both pipelines index the same operations.

  References that the default pipeline's deref pass resolves are not affected by these changes. That pass resolves them before indexing and still merges every sibling field into the target.

  `derefSpec()`, `DerefFolder` and the deref pass, which `@oa-sdk/mock-server` re-exports, now dereference the fields beside a `$ref` they cannot resolve, as `derefInternalSpec()` already did. The `$ref` itself stays as written. Before, the whole object was kept as written, so, for example, the operations declared beside an unresolvable Path Item `$ref` kept their own parameter, requestBody, response and callback references unresolved. Inside an external file, those fields resolve against that file.

  @oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses with `parseDocument(spec, [])`. Its output changes in the following cases.

  Local references at operation positions:

  - A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`. Whether the body is required comes from the referenced request body.
  - A Path Item `$ref` in `paths` or `webhooks` now emits the operation types of the referenced Path Item.
    - Operations, `parameters` and other fields declared beside the `$ref` replace the referenced ones.
    - Operations declared beside a Path Item `$ref` that cannot be resolved, such as one into another file, are now emitted too. This includes the operations declared beside every `$ref` of a Path Item `$ref` chain whose later hop cannot be followed. Before, the whole Path Item was skipped.
  - A `description` beside a parameter `$ref` now replaces the referenced description in the generated JSDoc.
  - A parameter or response `$ref` whose target is itself a Reference Object is now followed to the final target. The parameter field and `<Op>Response` are now emitted.
  - A callback `$ref` is now resolved. Typegen emits no callback types, but nested component schema references inside the referenced callback, such as `#/components/schemas/Pet/properties/owner`, now get exported alias declarations. Inline callbacks already got them.
  - Other fields beside a Reference Object, such as `required`, `name`, `in`, `schema` or `content`, are still ignored and do not change the generated types.

  Other changes:

  - An `additionalOperations` entry that repeats a fixed-field method of the same Path Item no longer emits operation types.
  - An exported name that typegen numbered or renamed to avoid a collision can now refer to a different operation or schema. Typegen numbers operation types in sorted `operationId` order and nested schema aliases in sorted reference order, and it renames external schema aliases that collide with operation type names. The cases above add or remove operations and nested schema references, which changes those collisions. For example, when an ignored `additionalOperations` entry has an `operationId` with the same type name as the fixed operation, the fixed operation's types can lose their numeric suffix and take the names the ignored entry had.

  `generateTypesFromSpec()` from `@oa-sdk/codegen/typegen/browser` parses with the browser `parseDocument()`, which resolves internal references in memory before indexing. Of the changes above, only the `additionalOperations` rule, the operations beside an unresolvable Path Item `$ref`, and the resulting name changes affect it.

  For local references at operation level (a Path Item under `paths` or `webhooks`, and an operation's parameters, requestBody and responses) that carry no fields other than `summary` and `description`, the generated `types.ts` now declares the operation types that the generated client imports for them.

  The generated client and `types.ts` can still disagree in these cases:

  - References nested inside those objects, such as a response header `$ref` or an OAS 3.2 media-type `$ref` under `content`. Typegen does not resolve them, so the client can import `<Op>ResponseHeaders`, `<Op>Body` or `<Op>Response` without `types.ts` declaring it.
  - Operation-level references into other files, which typegen does not resolve either.
  - Fields other than `summary` and `description` beside a parameter, requestBody or response Reference Object. `generateClient()` parses with the default deref pass, which still merges every such field into the target, while typegen ignores them.
    - `in: header` beside a `$ref` to a query parameter makes the client import `<Op>HeaderParams`, which `types.ts` does not declare.
    - A `content` sibling that adds `application/json` to a request body without a JSON media type makes the client import `<Op>Body`, which `types.ts` does not declare.
    - `required: true` beside a parameter `$ref` makes the client reject calls without that parameter, while `types.ts` keeps it optional.

    This lasts until the deref pass applies only `summary` and `description` at Reference Object positions.

- Updated dependencies
- Updated dependencies
- Updated dependencies [b4f5dd4]
  - @oa-sdk/core@0.3.1
  - @oa-sdk/parser@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.3.0
  - @oa-sdk/parser@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.2.0
  - @oa-sdk/parser@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/core@0.1.2
  - @oa-sdk/parser@0.1.2
