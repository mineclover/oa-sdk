# @oa-sdk/client

## 0.3.0

### Minor Changes

- 3063402: TanStack options/keys now work for Vue and Svelte, streaming operations no longer emit unusable cache artifacts, and guard generation accepts dotted TypeSpec contract names.

  **@oa-sdk/client**

  - Tier 2 (pure query/mutation options) imports the framework-neutral `QueryObserverOptions`,
    `MutationObserverOptions` and `InfiniteQueryObserverOptions` types that every TanStack adapter
    re-exports from `@tanstack/query-core`, instead of React-only `UndefinedInitialDataOptions` /
    `UseMutationOptions`. `generate:tanstack --framework vue|svelte` output now compiles.
  - Streaming operations (SSE, NDJSON, JSONL, `application/stream+json` in the response or request
    body) keep their query keys but no longer generate `QueryOptions`, `MutationOptions` or hooks,
    because a `queryFn` returning an `AsyncGenerator` cannot be cached.
  - Infinite query options use a distinct key (`[...<listKey>, 'infinite']`). List and infinite
    caches with the same filters no longer collide, and invalidating the list key still matches the
    infinite entry by prefix.
  - `TError` for operations with a documented error model is now `<Op>Error | Error`, so transport
    failures (network errors, aborts, `ApiClientResponseError`) are part of the generated type.

  **@oa-sdk/codegen**

  - `generate:tanstack --split --tier options|hooks` emits the lower tiers the requested tier imports
    (`options` → keys + queries, `hooks` → keys + queries + hooks), so the output compiles.
  - `generate:tanstack --framework vue|svelte --tier hooks` fails with a clear error instead of writing
    React hooks against a Vue/Svelte package.
  - `check-artifact` and `drift:check` read targets through `resolveConfigWithDefaults`, so a config
    that declares only `product.specs` no longer fails with `specs 목록이 비어 있습니다`.
  - Added a regression test for pattern-based `outputRouting` with `--split`, resolving every generated
    relative import against the routed files.

  **@oa-sdk/ast-sync**

  - Standalone guards normalize component names that are not JavaScript identifiers (for example the
    TypeSpec namespace-qualified `OaSdkTypeSpec.StandardError` to `isOaSdkTypeSpec_StandardError`)
    while keeping the qualified type in the `data is ...` declaration. Split mode uses the normalized
    file name and imports the namespace root (`import type { OaSdkTypeSpec }`) because
    `import type { A.B }` is invalid TypeScript. `--schemas` matching accepts the original dotted name.

### Patch Changes

- da09240: Harden `encodeMessagePack`, `decodeMessagePack` and `messagePackAdapter`.

  - Decoding stores map keys as own data properties, so a `__proto__` key can no longer replace the decoded object's prototype. Truncated str, bin, array or map payloads and trailing bytes throw `RangeError` instead of returning corrupted values. uint64/int64 values outside ±(2^53 − 1) decode to `bigint` instead of a rounded `number`.
  - Encoding writes a `bigint` as an integer (uint64/int64 beyond the safe range, `RangeError` beyond 64 bits) instead of a string, honors `toJSON()` so a `Date` becomes its ISO string instead of `{}`, writes every `ArrayBuffer` view as bin, and throws `TypeError` for symbols, functions, `Map` and `Set`.

- Updated dependencies [9743fb4]
  - @oa-sdk/parser@0.5.0

## 0.2.2

First version published to npm. The earlier versions below were workspace-only and never published.

`@oa-sdk/client` generates client code from an OpenAPI 3.1 or 3.2 document or from a `ParsedDocument` of `@oa-sdk/parser`, and ships runtime helpers for that code. Each generator throws when the document's `$ref`s do not resolve completely. The Node entry point accepts `basePath` for relative external `$ref`s; `@oa-sdk/client/browser` offers the same API for in-memory documents, except the TanStack Query generators.

- `generateClient()` writes a typed fetch client: `createClient({ baseUrl, headers, middleware, timeout, retry, validate })` with one method per operation, `ClientError` and `isClientError()`, per-operation error unions with `is<Op>ErrorBody()` and `is<Op>ClientError()` guards, request validation (`validate: true`), retries of idempotent operations (or those marked `x-oa-sdk-retryable`), `AbortSignal` support, and SSE/NDJSON streaming methods. The generated code imports only the types module given as `typesImport`, not this package.
- `generateTanstackQuery()` and the key, options and hook factory generators write TanStack Query v5 query keys, `queryOptions()`/`mutationOptions()` factories and React hooks.
- `generateCrdtClient()` and `generateCrdtHooks()` write collaboration clients and React hooks for models that carry the `x-oa-sdk-crdt-entity` and `x-oa-sdk-crdt` extensions; `LwwJsonAdapter` is a dependency-free last-write-wins engine for them.
- `createResilientChunkReader()`, `createResilientNdjsonReader()`, `createChunkStreamStore()` and `generateChunkStreamReactHooks()` read chunk streams with retries and empty-chunk fallback.
- `ClientError`, `isClientError()`, the `bearerAuth()`, `basicAuth()` and `apiKeyAuth()` middleware and the `ClientConfig`, `ClientMiddleware`, `ClientMethodOptions` and `ClientResponse` types are exported for code that handles generated clients.

### Patch Changes

Changes since 0.2.1:

- CRDT client generation. `generateCrdtClient()` writes, for each entity, a `create<Entity>CrdtClient(roomId, config)` factory returning a `CrdtRoomSession` that connects over WebSocket (`wsUrl`, optional `WebSocketImpl`), exchanges `sync-step-1`/`sync-step-2`, `update` and `awareness` messages, and exposes `connect()`, `disconnect()`, `getState()`, `updateField()`, `setAwareness()`, `onStatus()`, `onChange()` and `onAwareness()`. A session does not reconnect by itself. The engine is pluggable through `CrdtEngineAdapter`; without one, the generated code uses its own `DefaultLwwJsonAdapter`. `generateCrdtHooks()` writes `useCrdtRoom`, `useCrdtField`, `useCrdtAwareness` and one `use<Entity>Session` hook per entity. `extractCrdtEntitiesFromDoc()` returns the entity and field metadata these generators read.
- `LwwJsonAdapter` validates what peers send. `applyUpdate()` skips entries without a finite numeric timestamp and ignores a payload that is not an object, and `encodeDiff()` treats a state-vector entry that is not a finite number as unseen, so a peer cannot pin the logical clock at `Infinity`. The `DefaultLwwJsonAdapter` that `generateCrdtClient()` writes into generated code does not apply these checks.
- Chunk-stream reading. `createResilientChunkReader(fetchChunk, descriptors, options?)` fetches chunks in order, retries a failed or guard-rejected chunk with exponential backoff that honors `Retry-After` (`maxRetries`, `initialDelayMs`, `maxDelayMs`, `backoffFactor`, `onRetry`), and yields a synthetic empty chunk (`onFallback`) when the retries run out. `createResilientNdjsonReader(url, options?)` retries the connection the same way, then reads the live NDJSON response line by line and yields a synthetic empty chunk for a line that does not parse or that the guard rejects. `createChunkStreamStore()` wraps either reader in a store for `useSyncExternalStore`, and `generateChunkStreamReactHooks()` writes a `useResilientChunkStream()` hook on top of it. `retryAfterMs()` and `synthesizeEmptyChunk()` are exported too.
- `ClientError`, `isClientError()`, the auth middleware and the client types listed above are exported from the package; before, they existed only inside generated code. The generated `ClientError` gains `statusText` and `data` (an alias of `body`) getters, and `isClientError()` also accepts an error that carries `data` instead of `body`.
- Generated methods accept the `{ signal, headers }` options object in place of an omitted optional argument, accept a single object (`{ params, body, query, querystring, headers, signal }`) for operations with path parameters (for other operations, a `{ body, ... }` or `{ query, ... }` object that also carries `signal` or `headers`), and take a `signal` passed inside the query object as the request signal.
- The request validation and error-body guards of generated clients check a schema that the parsed document shares between several locations in full at each of them. Before, the serializer wrote `{}`, which accepts anything, at every location after the first. Shared subschemas became common with `@oa-sdk/parser` 0.4.0, which shares `$ref` expansions.
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

- - @oa-sdk/core: Introduce recursive `JsonPrimitive<T>` and `Resolved<T>` wire-format types stripping methods, getters, and symbols to guarantee JSON wire safety.
  - @oa-sdk/parser: Add zero-decorator `@oaOperation <METHOD> <PATH>` JSDoc route extraction (`extractTsOperationsFromSource`, `extractTsOperationsFromFile`).
  - @oa-sdk/codegen: Implement OpenAPI 3.2 Schema Object to Zod 4 generator (`generateZodFromSpec`, `oa-gen generate:zod`) with automated preflight validation/normalization, and add `oa-gen audit:shape` CLI for 24-feature TypeScript shape taxonomy auditing.
  - @oa-sdk/client: Apply wire-safe response payload signatures using `Resolved<T>`.
  - @oa-sdk/spec-lens: Add transitive `tsconfig` universe dependency digestion (`computeTsconfigUniverse`) and SQLite cache key invalidation.
- Updated dependencies
  - @oa-sdk/core@0.3.0
  - @oa-sdk/parser@0.3.0

## 0.1.2

### Patch Changes

- a8e9a60: Fix generated SSE and NDJSON methods without query parameters so their operation ID is passed to the streaming helper in the correct argument position.
- Updated dependencies
  - @oa-sdk/core@0.2.0
  - @oa-sdk/parser@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/core@0.1.2
  - @oa-sdk/parser@0.1.2
