# @oa-sdk/client

Generates a typed `fetch` client and TanStack Query v5 code from an OpenAPI 3.1 or 3.2 document, and
ships the runtime helpers that code uses.

- `oa-gen` from `@oa-sdk/codegen` loads this package as a companion package for
  `oa-gen generate:client`, `oa-gen pack:client`, `oa-gen generate:tanstack`, and the client,
  TanStack Query, and CRDT outputs of `oa-gen generate`.
- The generators are also a library you can call from a build script.
- The generated client depends on nothing but `fetch`; generated TanStack Query code imports types
  from this package.

## Installation

```bash
npm install --save-dev @oa-sdk/client
```

Requires Node.js 22 or later. The package depends on `@oa-sdk/core` and `@oa-sdk/parser`.
`@oa-sdk/client` is published to npm for the first time with the `@oa-sdk/codegen` 0.9.0 release;
it cannot be installed from npm before that release.

Without this package, `oa-gen generate:client`, `pack:client` and `generate:tanstack` print the
install command for the version range they were built against and exit with code 1. `oa-gen generate`
fails the same way when `oa.config.ts` sets `core.client.enabled: true`, and otherwise skips the client
and TanStack Query outputs with a warning.

### Entry points

| Import | Use |
|---|---|
| `@oa-sdk/client` | Node. All generators; `basePath` resolves relative external `$ref`s. |
| `@oa-sdk/client/browser` | Browser bundles. The client, CRDT, and chunk-stream APIs for in-memory documents (internal `$ref`s only). No TanStack Query generators. |

Generators throw when the document's `$ref`s do not resolve completely.

## Generating a client

The client and the TanStack Query code must be generated the same way: both without types, or
both with types. TanStack Query code generated without types does not compile against a typed
client (TS2345).

### Without types

With the CLI:

```bash
npx oa-gen generate:client --spec ./openapi.yaml -o src/api/client.ts
npx oa-gen generate:tanstack --spec ./openapi.yaml -o src/api
```

With the library:

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generateClient, generateTanstackQuery } from '@oa-sdk/client'

const spec = parse(readFileSync('openapi.yaml', 'utf8'))

writeFileSync('src/api/client.ts', generateClient(spec))
// The TanStack Query code imports the ApiClient type from ./client.js (option clientImport)
const { combinedCode } = generateTanstackQuery(spec)
writeFileSync('src/api/tanstack-query.ts', combinedCode)
```

Without `typesImport` the client is untyped: methods take `Record<string, string>`,
`Record<string, unknown>` and `unknown`, and return `unknown`. Query data is `unknown` as well.

### With types

Pass the module that `oa-gen typegen` writes as `typesImport`. The client then uses those
types, and also exports per-operation error types and guards.

The TanStack Query code needs `typesImport` too, but not the typegen module itself. Its import line
names types that typegen does not always write:

- `<Operation>ClientError` for every operation. typegen never writes it.
- `<Operation>Response` for every operation that declares a response. typegen writes it only when
  the success response (the lowest 2xx status, or `default` when there is none) has an
  `application/json` schema. It is missing for a streaming response, a response without content
  (a `204`, for example), and any other media type such as `text/csv`.
- `<Operation>Body` for every operation with a request body. typegen writes it only for an
  `application/json` body. It is missing for `application/octet-stream`, `multipart/form-data` and
  any other media type.

Point it at a module that re-exports the typegen output and adds the missing names. Copy the names
from the import line of the generated `tanstack-query.ts` and add every one that `types.ts` does not
export. For an API with `listUsers`, `getUserById`, a streaming `streamAuditEvents`, a `deleteUser`
that answers `204` without content, and an `uploadAvatar` that takes an `application/octet-stream`
body and answers `204`:

```ts
// src/api/wire-types.ts
export * from './types.js'
import type { ClientError } from './client.js'
// Every operation
export type ListUsersClientError = ClientError
export type GetUserByIdClientError = ClientError
export type StreamAuditEventsClientError = ClientError
export type DeleteUserClientError = ClientError
export type UploadAvatarClientError = ClientError
// Success responses without an application/json schema
export type StreamAuditEventsResponse = unknown
export type DeleteUserResponse = void
export type UploadAvatarResponse = void
// Request bodies that are not application/json
export type UploadAvatarBody = unknown
```

Alias a missing `<Operation>Response` to `void` when the success response has no content, and to
`unknown` otherwise. Alias a missing `<Operation>Body` to `unknown`.

For an operation that documents error responses, the typed client exports its own
`<Operation>ClientError`; re-export that instead of the alias
(`export type { GetUserByIdClientError } from './client.js'`) to keep the error body types.

```bash
npx oa-gen typegen --spec ./openapi.yaml -o src/api/types.ts
npx oa-gen generate:client --spec ./openapi.yaml --types-import ./types.js -o src/api/client.ts
npx oa-gen generate:tanstack --spec ./openapi.yaml -o src/api --types-import ./wire-types.js
```

With the library, pass the same values: `generateClient(spec, { typesImport: './types.js' })` and
`generateTanstackQuery(spec, { typesImport: './wire-types.js' })`.

## The generated client

```ts
import { createClient, bearerAuth, isClientError } from './api/client.js'

const client = createClient({
  baseUrl: 'https://api.example.com', // defaults to the spec's servers[0] URL
  headers: { 'X-App': 'web' },
  timeout: 10_000, // per attempt, in ms
  retry: { maxRetries: 3, baseDelay: 500 }, // defaults: 0 retries, 1000 ms
  validate: true, // check parameters and body against the spec before sending
  middleware: [bearerAuth(token)],
})

const user = await client.getUserById({ userId: 'u-1' }) // path parameters are an object
```

- **Methods**: one per operation, named by its operationId. Arguments come in this order, skipping
  what the operation lacks: path parameters object, body, query object, header parameters object,
  options `{ signal?, headers? }`. Pass `undefined` for a skipped optional argument.
- **Middleware**: `{ onRequest?(url, init), onResponse?(response), onError?(error) }`. `onRequest`
  must return the `RequestInit`; it runs once before any retry.
- **Retries**: GET, HEAD, OPTIONS and DELETE operations, and operations marked
  `x-oa-sdk-retryable: true`, retry network errors and 5xx responses with exponential backoff,
  honoring `Retry-After`. Streaming methods do not retry.
- **Auth helpers**: one function per `components.securitySchemes` entry, named after the scheme key
  (`Auth` appended unless it already ends in `auth`). This package also exports `bearerAuth(token)`,
  `basicAuth(username, password)` and `apiKeyAuth(...)`, which work with any generated client.
- **Response headers**: operations that document response headers (and do not stream) also get
  `client.withResponse.<operationId>()`, which resolves to `{ body, headers, response }`. Header keys
  keep the spec's casing, and values are parsed to the declared type.
- **Errors**: non-2xx responses throw `ClientError` (`status`, `statusText`, `body`/`data`,
  `response`, `operationId`). `isClientError()` also recognizes errors from another realm by shape.
  A typed client adds `<Operation>ClientError`, `is<Operation>ClientError(error, status?)` and
  `is<Operation>ErrorBody(body, status?)` for operations that document error responses.
- **Streaming**: SSE and NDJSON operations become `AsyncGenerator<unknown>` methods. Narrow each item
  before use. SSE `data` frames that are not JSON, and `[DONE]` frames, are skipped.

The generated client imports nothing except the `typesImport` module. Generated TanStack Query code
imports `JsonPrimitive` and `Resolved` from `@oa-sdk/client`, `@tanstack/react-query`, and
`ApiClient` from `./client.js` (or `clientImport`).

## Known limitations

- `generateTanstackQuery({ typesImport })` with the plain `oa-gen typegen` output does not compile
  (TS2305/TS2724). The generated code imports `<Operation>ClientError` for every operation,
  `<Operation>Response` for every operation that declares a response, and `<Operation>Body` for every
  operation with a request body. typegen never emits `<Operation>ClientError`, emits
  `<Operation>Response` only for an `application/json` success response, and emits
  `<Operation>Body` only for an `application/json` request body, so streaming responses, responses
  without content (`204`) and other media types also leave names missing.
  The `wire-types.ts` module under [With types](#with-types) adds them. A typed client combined with
  TanStack Query code generated without `typesImport` does not compile either (TS2345: the untyped
  code passes `Record<string, string>` and `unknown` to the typed methods). Use one of the two
  combinations under [Generating a client](#generating-a-client).
- Tier 2 options are framework-neutral: they import `QueryObserverOptions`,
  `MutationObserverOptions` and `InfiniteQueryObserverOptions`, which every adapter re-exports from
  `@tanstack/query-core`. Keys and options therefore compile for React, Vue and Svelte. Tier 3 hooks
  are React-only (`useQuery`/`UseQueryResult`); `oa-gen generate:tanstack --framework vue|svelte
  --tier hooks` fails instead of emitting them.
- In split mode tiers are cumulative: `options` writes `keys.ts` and `queries.ts`, and `hooks` writes
  all three. The combined file inlines the lower tiers, so a single `--tier options|hooks` file is
  self-contained. The library's `keysCode`/`queriesCode`/`hooksCode` are the split modules and keep
  their `./keys.js` / `./queries.js` imports; write them as `keys.ts`, `queries.ts`, `hooks.ts`.
- The combined file (`tanstack-query.ts`) and the hooks file start with `'use client'`. In a React
  Server Component (for example to prefetch in the Next.js App Router), calling an options factory
  imported from the combined file fails with `Attempted to call ...() from the server but ... is on
  the client`. Server code imports options factories from `queries.ts`, which has no directive.
- The runtime accepts single-object calls (`{ params, body, query, headers, signal }`), an options
  object in place of a skipped argument, and `signal` inside the query object, but the typed
  signatures do not declare them, so TypeScript rejects them.
- `<operationId>InfiniteQueryOptions` uses `[...<listKey>, 'infinite']`, so a list query and an
  infinite query with the same filters do not share a cache entry. Invalidating the list key still
  matches the infinite entry by prefix.
- Cursor-based `<operationId>InfiniteQueryOptions` sends `cursor=null` on the first request; pass
  `initialPageParam: undefined` (with `getNextPageParam`) in the options to omit it.
- Streaming operations (SSE, NDJSON, JSONL, `application/stream+json`) keep their query keys but
  generate no `QueryOptions`, `MutationOptions` or hooks, because a `queryFn` cannot cache an
  `AsyncGenerator`. Read streams with the client method instead.
- With a documented error model, `TError` is `<Operation>Error | Error`: transport failures and
  `ApiClientResponseError` are part of the type. Narrow HTTP errors with `instanceof
  ApiClientResponseError` / `isClientError`.

## API reference

### Client generation

| Export | Description |
|---|---|
| `generateClient(spec, options?)` | Client source. Options: `typesImport`, `banner` (default `true`), `basePath` (Node) |
| `ClientError`, `isClientError` | Runtime error class and guard, for code that handles generated clients |
| `bearerAuth`, `basicAuth`, `apiKeyAuth` | Auth middleware factories |
| `ClientConfig`, `ClientMiddleware`, `ClientMethodOptions`, `ClientResponse` | Types matching the generated client |
| `JsonPrimitive`, `Resolved` | Wire-format types used by generated code (from `@oa-sdk/core`) |

### TanStack Query generation (Node entry point only)

| Export | Description |
|---|---|
| `generateTanstackQuery(spec, options?)` | Returns `{ keysCode, queriesCode, hooksCode, combinedCode }`. Options: `queryPackage` (default `@tanstack/react-query`, the only package whose output compiles), `typesImport`, `clientImport` (default `./client.js`), `clientName` (default `ApiClient`), `keysImport`, `queriesImport`, `tier` (`all`, `keys`, `options`, `hooks`), `includeHooks`, `banner`, `basePath` |
| `generateKeyFactory`, `generateOptionsFactory`, `generateHookFactory` | One tier at a time |
| `isQueryOperation`, `getOperationTag`, `toKeyFactoryName` | The naming rules the generators use |

Generated names: key factories `<camelCase tag>Keys` (plus a singular or plural alias) and
`queryKeys`; `<operationId>QueryOptions`, `<operationId>MutationOptions`, and
`<operationId>InfiniteQueryOptions` for operations with a `cursor`, `page`, or `offset`-style query
parameter; React hooks `use<OperationId>Query`, `use<OperationId>Mutation`,
`use<OperationId>InfiniteQuery`, and `createApiHooks(useClient)`.

### CRDT generation

| Export | Description |
|---|---|
| `generateCrdtClient`, `generateCrdtClientFromParsed` | WebSocket collaboration clients for schemas marked with `x-oa-sdk-crdt-entity` and `x-oa-sdk-crdt` |
| `generateCrdtHooks`, `generateCrdtHooksFromParsed` | React hooks for those clients |
| `extractCrdtEntitiesFromDoc` | The entity and field metadata the generators read |
| `LwwJsonAdapter` | Dependency-free last-write-wins engine |

### Chunk streams

| Export | Description |
|---|---|
| `createResilientChunkReader(fetchChunk, descriptors, options?)` | Fetches chunks in order with retries and an empty-chunk fallback |
| `createResilientNdjsonReader(url, options?)` | Reads a live NDJSON response with the same retry and fallback rules |
| `createChunkStreamStore`, `generateChunkStreamReactHooks` | A store for `useSyncExternalStore` and a generated React hook on top of it |
| `retryAfterMs`, `synthesizeEmptyChunk` | Helpers used by the readers |
