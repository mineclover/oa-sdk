# @oa-sdk/router

Build-time generator for framework-independent TypeScript handler contracts and for Hono, Express,
Fastify, and Elysia routers bound to them, from an OpenAPI 3.1 or 3.2 document.

## Overview

`@oa-sdk/router` returns generated source code as strings; write them to files from a build script.
It has no runtime API and no CLI.

1. **Handler contracts (`generateHandlerContract`)**: an `ApiHandlers` interface with one handler per
   operation, a `<Operation>Context` type per operation, and the `HandlerResponse`, `StreamingBody`
   and `StreamingResponse` types. The contract file imports nothing but your types module, so it has
   no framework or runtime dependency.
2. **Framework routers (`generateRouter`)**: a Hono, Express, Fastify, or Elysia router that parses
   each request, calls the matching handler, and writes its `HandlerResponse`. A generated router
   imports the framework it targets.

Business logic lives in your own files, which the generators never write, so regenerating the
contract and router leaves it untouched.

## Installation

```bash
npm install --save-dev @oa-sdk/router
```

Requires Node.js 22 or later. The package depends on `@oa-sdk/core` and `@oa-sdk/parser`.
`@oa-sdk/router` is published to npm for the first time with the `@oa-sdk/codegen` 0.9.0 release;
it cannot be installed from npm before that release.

`oa-gen generate` from `@oa-sdk/codegen` loads this package as a companion package to emit handler
contracts (`<spec target id>.contract.ts`), and CRDT contract and router modules for schemas marked
with `x-oa-sdk-crdt-entity`. Those contracts are untyped (`oa-gen generate` passes no `typesImport`).
No `oa-gen` command writes framework routers: call `generateRouter()` in a build script.

Inside the oa-sdk source repository, build it with `pnpm --filter @oa-sdk/router build`.

### Entry points

| Import | Use |
|---|---|
| `@oa-sdk/router` | Node. Accepts `basePath` to resolve relative external `$ref`s. |
| `@oa-sdk/router/browser` | Browser bundles. The same generators for in-memory documents (internal `$ref`s only). |

Both throw when the document's `$ref`s do not resolve completely.

## Quick start

Generate the types with `oa-gen typegen`, then the contract and a router:

```bash
npx oa-gen typegen --spec ./openapi.yaml -o src/types.ts
node scripts/gen-router.mjs
```

```js
// scripts/gen-router.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generateHandlerContract, generateRouter } from '@oa-sdk/router'

const spec = parse(readFileSync('openapi.yaml', 'utf8'))

writeFileSync('src/api.contract.ts', generateHandlerContract(spec, { typesImport: './types.js' }))
writeFileSync(
  'src/api.hono.ts',
  generateRouter(spec, { target: 'hono', contractImport: './api.contract.js', typesImport: './types.js' }),
)
```

Generated contract (excerpt):

```ts
export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
| TSuccess
| { status: 200; body: TSuccess; headers?: THeaders }
| { status: 206; body: StreamingBody | TSuccess; headers?: THeaders }
| StreamingResponse<THeaders>
| { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]

/** Context for GET /users/{userId} */
export interface GetUserByIdContext<TContext = unknown> {
  params: GetUserByIdPathParams
  context?: TContext
}

/** Handler signature for GET /users/{userId} */
export type GetUserByIdHandler<TContext = unknown> = (
  ctx: GetUserByIdContext<TContext>
) => HandlerResponse<GetUserByIdResponse> | Promise<HandlerResponse<GetUserByIdResponse>>

export interface ApiHandlers<TContext = unknown> {
  getUserById: GetUserByIdHandler<TContext>
  // ...one property per operation
}
```

A context has only the members its operation uses: `params`, `query`, `querystring`, `headers`,
`body`, and `context` (filled by a router with context injection).

Implement the handlers and mount the router:

```ts
import { Hono } from 'hono'
import type { ApiHandlers } from './api.contract.js'
import { createRouter } from './api.hono.js'

const handlers: ApiHandlers = {
  async getUserById({ params }) {
    const user = await db.users.find(params.userId)
    if (!user) return { status: 404, body: { code: 'NOT_FOUND', message: 'User not found' } }
    return user // the operation's default success status (its lowest 2xx)
  },
  // ...every other operation
}

const app = new Hono()
app.route('/v1', createRouter(handlers))
```

| Target | Generated export | Mount |
|---|---|---|
| `hono` | `createRouter(handlers): Hono` | `app.route('/v1', createRouter(handlers))` |
| `express` | `createRouter(handlers): Router` | `app.use(express.json()); app.use('/api', createRouter(handlers))` |
| `fastify` | `apiRouter: FastifyPluginAsync<ApiRouterOptions>` (also the default export) | `await app.register(apiRouter, { handlers })` |
| `elysia` | `createRouter(handlers)` returning an `Elysia` instance | `new Elysia().use(createRouter(handlers))` |

`createRouter()` and the Fastify `handlers` option take a complete `ApiHandlers`; combine partial
service objects into one (`{ ...userHandlers, ...auditHandlers } satisfies ApiHandlers`).
On Node.js, Elysia's default adapter has no `.listen()`; create the app with
`new Elysia({ adapter: node() })` from `@elysiajs/node` to serve it.

## Handler responses

- **Body only**: `return user` answers with the operation's default success status (the lowest
  documented 2xx) as JSON.
- **Envelope**: `return { status, body, headers? }` sets the status and headers.
- **Streaming**: with status 200 or 206 (`StreamingResponse`), a stream in `body` is sent as is
  instead of being serialized to JSON. A Node stream (anything with `pipe()`), a
  `ReadableStream<Uint8Array>`, and a `Uint8Array` work with all four routers. The contract's
  `StreamingBody` type also accepts an `AsyncIterable<Uint8Array | string>`, but the routers handle
  it differently, so wrap an async generator in `Readable.from()` from `node:stream`:
  `return { status: 200, body: Readable.from(events()), headers: { 'content-type': 'text/event-stream' } }`.
  - Fastify cannot send an `AsyncIterable` (known defect). The router hands `body` to Fastify
    unchanged, which answers 500 `FST_ERR_REP_INVALID_PAYLOAD_TYPE` when the `Content-Type` is not
    JSON (for example `text/event-stream`), and 200 `{}` when none is set.
  - Elysia on Node.js with its default adapter (`app.handle()`, `app.fetch`) fails on an
    `AsyncIterable` of strings with `Received non-Uint8Array chunk`. Elysia also adds its own
    `content-type` to `ReadableStream` and `AsyncIterable` bodies, so a handler header named
    `'Content-Type'` goes out as two values (`text/event-stream, text/plain`); write header names in
    lowercase.
  - Hono repeats the first chunk forever for an object whose `[Symbol.asyncIterator]()` returns a
    new iterator on each call (`{ async *[Symbol.asyncIterator]() { ... } }`) (known defect).
    Generator objects and Node streams are fine.

A router treats a returned object as an envelope when it has a `body` property, its `status` is
absent or a number, and its `headers` are absent or an object; it then sends only `body`. Wrap an
entity that has its own `body` field: `return { status: 200, body: entity }`.

Typing covers request members (typed when the contract has `typesImport`) and the success body.
The request types restate the spec; the routers do not convert values to them (see the list below).
Error statuses and bodies are not narrowed: the error map is `Record<number, unknown>`, so any
`{ status: <number>, body: <value> }` compiles.

What the generated routers do not do:

- Authentication: security requirements appear only as a `// Requires: <scheme>` comment above the
  route. Add authentication middleware in the framework.
- Request validation and coercion: Hono, Express, and Elysia routers pass requests to the handlers
  unvalidated, with the framework's path, query, and header values cast `as any`. Those values are
  strings even where the contract types them as `number` or `boolean`: `?limit=5` arrives as `"5"`,
  and `?notify=false` as `"false"`, which is truthy. Fastify routes carry a `schema` (querystring,
  params, body, response), so Fastify validates requests, coerces path and query values (`5`,
  `false`), and serializes responses with it.
- Header names: all four routers pass the framework's request headers, whose keys are lowercase.
  The contract types headers with the spec's names (`'X-Audit-Reason'`), but the value is under
  `'x-audit-reason'`. The Fastify route `schema` has no headers, so header values are not coerced
  there either.
- Error masking: when a handler throws, the router answers 500 with
  `{ error: { code: 'INTERNAL_ERROR', message: <the exception message>, details: [] } }`.

On Hono, Express, and Elysia, convert and check request values in the handler; these forms also
work with the values Fastify coerced:

```ts
async updateUser({ params, query, headers, body }) {
  const notify = String(query?.notify) === 'true'
  const reason = (headers as Record<string, string | undefined> | undefined)?.['x-audit-reason']
  // ...
}
```

To leave path and query coercion and validation to the framework, use the Fastify router.

## API reference

### `generateRouter(spec, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `'hono' \| 'express' \| 'fastify' \| 'elysia'` | `'hono'` | Framework |
| `mode` | `'stub' \| 'contract'` | `'contract'` when `contractImport` is set, otherwise `'stub'` | `stub` writes a standalone router whose routes hold `// TODO: implement <operationId>` placeholders; `contract` binds it to the contract's handlers interface |
| `contractImport` | `string` | — | Module of the handler contract |
| `contractName` | `string` | `'ApiHandlers'` | Handlers interface name |
| `typesImport` | `string` | — | Module of the `oa-gen typegen` types |
| `contextInjection` (alias `context`) | `boolean` | `false` | Adds an options argument (`getContext(c)` or a static `context`) whose value reaches handlers as `ctx.context` |
| `contextImport`, `contextTypeName` | `string` | — | Module and name of your context type (implies context injection) |
| `banner` | `boolean` | `true` | Header comment |
| `basePath` | `string` | — | Path of the OpenAPI file, to resolve relative external `$ref`s (Node entry point only) |

### `generateHandlerContract(spec, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `typesImport` | `string` | — | Module of the `oa-gen typegen` types; without it, members are `Record<string, string>`, `unknown`, and `HandlerResponse<unknown>` |
| `contractName` | `string` | `'ApiHandlers'` | Handlers interface name |
| `contextImport`, `contextTypeName` | `string` | — | Imports your context type and makes it the default of the `TContext` parameter |
| `banner` | `boolean` | `true` | Header comment |
| `basePath` | `string` | — | Path of the OpenAPI file, to resolve relative external `$ref`s |

### Other exports

| Export | Description |
|---|---|
| `generateCrdtHandlerContract(spec, options?)` | Contract for schemas marked with `x-oa-sdk-crdt-entity` (`typesImport`, `contractName` default `'CrdtApiHandlers'`, `banner`, `basePath`) |
| `generateCrdtRouter(spec, options?)` | CRDT WebSocket router (`target`: `hono` (default), `fastify`, `elysia`, `express`; `contractImport`, `contractName`, `typesImport`, `routePrefix`, `banner`, `basePath`) |
| `extractCrdtEntities(spec)` | The CRDT entity and field metadata those generators read, from an OpenAPI document or a `ParsedDocument` |
| `demuxChunkStream(stream, options?)` | Async generator that reads an NDJSON `StreamingBody` line by line and yields each parsed item, or a synthetic empty chunk for a line that does not parse or that `guard` rejects (`signal`, `guard`, `onInvalidChunk`, `defaultPayloadFormat`) |
| Types | `RouterTarget`, `RouterMode`, `RouterOptions`, `RouterRenderOptions`, `HandlerContractOptions`, `CrdtContractOptions`, `CrdtRouterOptions`, `CrdtRouterTarget`, `CrdtEntityMeta`, `CrdtFieldMeta`, `DemuxChunkStreamOptions`, `SyntheticEmptyChunk` |
