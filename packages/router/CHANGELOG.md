# @oa-sdk/router

## 0.2.3

### Patch Changes

- da09240: Follow Accept q-values in response negotiation and answer null-body statuses without a body.

  - `negotiateResponseMediaType` follows Accept q-values and wildcards (RFC 9110 §12.5.1). It ranks the server's types (the declared ones, `application/json` when none are declared, then the codec types) by the weight of the most specific Accept range that matches each. A `q=0` range, `type/*;q=0` and `*/*;q=0` included, refuses the types it governs. Ties go to the more specific range, then header order, then server order, and the fallback skips refused types. A declared type is returned exactly as it was passed, with its case and parameters, instead of the lowercased Accept entry. It used to ignore q-values and wildcards.
  - Generated Hono contract routers answer 204, 205 and 304 envelopes with `c.body(null, status)`, so a chunk-stream 304 Not Modified no longer becomes a 500, and error envelopes without a body are sent empty.
  - The Hono and Express stubs generated outside contract mode no longer reference an undeclared `options` binding for binary request bodies. They read the raw bytes (Express needs the `express.raw()` middleware) and leave decoding to the implementation.

- e4e82a7: Shared `@traceId` variants are accepted as lineage, ast-sync type boundaries are modelled, and Fastify/Hono streaming is verified with the real frameworks.

  **@oa-sdk/typespec-decorators**

  - `@traceId` now emits `x-oa-sdk-trace.declarationId` next to `trackingId`. It is a hash of the
    declaration the application is written on, so visibility variants and `MergePatchUpdate<T>`
    clones (and shared parameter/anonymous types and derived scalars) carry the same evidence.
  - The `.tsp` documentation and README describe the shared-variant policy instead of listing it as
    a known defect that fails `oa-gen trace --verify`.

  **@oa-sdk/codegen**

  - `buildSpecTraceabilityGraph` accepts one explicit `trackingId` when every node has the same
    `declarationId`; an id shared by independent declarations, or without evidence, still reports
    `traceability/duplicate-tracking-id`.
  - The trace sidecar validator accepts the optional `declarationId` field.

  **@oa-sdk/ast-sync**

  - JSON Schema `read()`/`patch()` validate parsed input through `toJsonSchemaObject` /
    `parseJsonSchemaObject`; typia `@default` tags go through `parseJsonDefaultTag`.
  - Replaced the remaining explicit `any` escapes: TypeScript's internal `symbol.id` and declaration
    names have modelled accessors, virtual-program temp directories live in a `WeakMap` exposed by
    `getProgramTempDir`, and Ajv/standalone imports plus format validators are typed.

  **@oa-sdk/spec-lens-contract**

  - Added `customData?: Record<unknown>` to `ScenarioMachineContext` in `scenario.tsp`, matching the
    TypeScript interface, with a drift test.

  **@oa-sdk/router**

  - Added real Fastify 5.12 / Hono 4.12 streaming tests: `AsyncIterable`, Web `ReadableStream` and
    Node streams send with the declared content type, and client disconnects cancel the source
    iterator. Documentation now describes the verified behaviour instead of the retired defects.

- Updated dependencies [9743fb4]
  - @oa-sdk/parser@0.5.0

## 0.2.2

First version published to npm. The earlier versions below were workspace-only and never published.

`@oa-sdk/router` generates server code from an OpenAPI 3.1 or 3.2 document or from a `ParsedDocument` of `@oa-sdk/parser`. Each generator throws when the document's `$ref`s do not resolve completely. The Node entry point accepts `basePath` for relative external `$ref`s; `@oa-sdk/router/browser` offers the same generators for in-memory documents.

- `generateHandlerContract()` writes a framework-independent handler contract (`*.contract.ts`): one handler per operation that receives typed `params`, `query`, `querystring`, `headers` and `body`, and returns a `HandlerResponse`: the success body, a `{ status, body, headers? }` envelope for any documented status, or a streaming response.
- `generateRouter()` writes a router for `hono` (the default), `express`, `fastify` or `elysia`, as a standalone stub (`mode: 'stub'`) or bound to a handler contract (`mode: 'contract'`, the default when `contractImport` is set).
- `generateCrdtHandlerContract()`, `generateCrdtRouter()` and `extractCrdtEntities()` generate collaboration code for models that carry the `x-oa-sdk-crdt-entity` and `x-oa-sdk-crdt` extensions (`@crdtEntity` and `@crdt` of `@oa-sdk/typespec-decorators`).
- `demuxChunkStream()` reads a newline-delimited JSON chunk stream on the server side.

### Patch Changes

Changes since 0.2.1:

- Streaming response contracts. The generated contract declares `StreamingBody` (async iterable of `Uint8Array` or `string`, Web `ReadableStream`, `Uint8Array`, or an object with `pipe()`) and `StreamingResponse` (`{ status?: 200 | 206, body, headers? }`), and `HandlerResponse` accepts a 206 envelope and a `StreamingResponse`. Generated Hono routers send a `Uint8Array` or `ReadableStream` body with `c.body(...)` and turn an async-iterable body returned in a `{ status, body }` envelope into a `ReadableStream`; generated Express routers pipe a body that has `pipe()`, send a `Uint8Array`, and write an async-iterable body chunk by chunk. Generated Fastify and Elysia routers return the body to the framework unchanged.
- CRDT targets. `generateCrdtHandlerContract()` writes a `CrdtApiHandlers` interface (name configurable) with optional per-entity `onConnect`, `loadSnapshot`, `saveSnapshot`, `appendUpdates`, `onAwareness` and `onDisconnect` hooks and the `CrdtSessionContext` and `CrdtWireMessage` types. `generateCrdtRouter()` writes a WebSocket router for `hono` (the default), `fastify`, `elysia` or `express` (with `ws`), one route per entity under `routePrefix` (default `/ws`) keyed by the entity's partition key, and a `CrdtRoomHub` that relays each peer's messages to the other peers of its room.
- `demuxChunkStream(stream, options?)` splits a byte or string stream into newline-delimited JSON chunks, checks each with an optional `guard`, and yields a synthetic empty chunk (reported through `onInvalidChunk`) instead of failing on a line that does not parse or that the guard rejects. A null or primitive body, such as the null `Response.body` of a 204 or HEAD response, yields no chunks.
- Updated dependencies
- Updated dependencies
- Updated dependencies [b4f5dd4]
  - @oa-sdk/core@0.3.1
  - @oa-sdk/parser@0.4.0

## 0.2.1

### Patch Changes

- Resolve 9 platform deficiencies across router envelope defense, handler error typing, AbortSignal pass-through, infinite queries, monorepo import resolution, RouterRenderOptions typing, unified oa-gen generate pipeline, init outputRouting presets, and Linux file watching fallback.

## 0.2.0

### Minor Changes

- - @oa-sdk/codegen: Add Output Path Routing Customization Engine (`outputRouting`), Target-Separated Interactive Onboarding Engine (`oa-gen init`), TanStack Query generation CLI (`oa-gen generate:tanstack`), and Live Mock Hot-Reloading (`oa-gen mock --watch`).
  - @oa-sdk/client: Implement TanStack Query (React Query) v5 3-Tier Generator (Tier 1 hierarchical query keys, Tier 2 pure options factories, Tier 3 client composition wrappers).
  - @oa-sdk/router: Implement multi-framework router stubs (Fastify JIT schema, Elysia zero-copy context, Hono, Express) and decoupled handler contracts (`*.contract.ts`).

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
