# `@oa-sdk/rpc`

Call and serve the operations of a TypeSpec (or any OpenAPI 3.x) contract as typed RPC procedures.
`users.getUserById` becomes `client.users.getUserById({ id })` on the caller side and
`handlers.users.getUserById(input, ctx)` on the server side. The same handlers answer JSON-RPC 2.0
calls and the original REST routes, and the same client can call either.

> Usage guide with the contract rules, both transports, and the binary wire path:
> [TypeSpec 계약을 RPC로 쓰기](../../docs/guides/typespec-rpc.md).

> Private workspace package: it is not published to npm and is used inside the oa-sdk repository
> only ([scope decision](../../docs/internal/platform-scope.md#typespec-contract-rpc-runtime--2026-10-12)).

```text
.tsp ──tsp compile──▶ OpenAPI ──parseDocument──▶ ParsedDocument
                                                     │ buildRpcContract (@oa-sdk/surface-ir)
                                                     ▼
                                              RpcContract (JSON data)
                          ┌──────────────────────────┴──────────────────────────┐
              createRpcClient + transport                          createRpcServer + handlers
       createHttpTransport · createJsonRpcTransport        createRestFetchHandler · createJsonRpcFetchHandler
              createLocalTransport                                  handleJsonRpc (any message channel)
```

The root entry has no runtime dependencies and uses only web-standard `fetch`, `Request`,
`Response`, `URL`, `FormData`, and `structuredClone`. `./ajv` imports the optional peer `ajv`.

## Contract

`buildRpcContract(document, options?)` of `@oa-sdk/surface-ir` turns a `ParsedDocument` into an
`RpcContract`, a plain JSON object. Each operation becomes one procedure:

| Procedure part | Derived from |
| --- | --- |
| Name | `[...group, method].join('.')`. Group: `@rpc(#{ serviceName })`, else the first tag in camelCase, else none. Method: `@rpc(#{ methodName })`, else the operationId. Surface IR `operationOverrides`, `groupForOperation`, and `methodForOperation` override both |
| `input` | One object schema: every parameter (path, query, querystring, header, cookie) is a field named after the parameter, and the request body is either spread into the input or kept in the `body` field |
| `output` | The schema of the lowest 2xx response with content; `null` when the success response has no content |
| `errors` | The other declared responses, keyed by status |
| `http` | The method, path template, parameter `style`/`explode`, body placement, and success status, so a call can be turned back into the REST request |

The request body is spread when it is a plain object schema (an `allOf` of plain object schemas is
flattened), none of its properties collides with a parameter name, and either the body is required
or it has no required properties. Otherwise it stays under `body` (`bodyField` renames it, and
`bodyMode: 'field'` never spreads).

Streaming operations (`text/event-stream`, `application/x-ndjson`, or `@rpc(#{ streaming })` other
than `none`) are left out with an `rpc-contract/streaming-not-supported` warning. Problems are
reported in `contract.diagnostics`, not thrown.

## Generated types

The `pluginRpc()` plugin of `@oa-sdk/codegen` (or `generateRpcModule(contract)`) writes one module
with the procedure types and the contract data:

```ts
import { defineTspConfig, pluginRpc } from '@oa-sdk/codegen'

export default defineTspConfig({
  input: 'typespec/main.tsp',
  outputDir: 'src/generated',
  plugins: [pluginRpc({ name: 'api', output: 'rpc.ts' })],
})
```

```ts
// src/generated/rpc.ts (excerpt)
export type ApiProcedures = {
  'users.getUserById': {
    input: { id: string }
    output: { id: string; email: string; name: string; role: 'admin' | 'user' | 'guest'; createdAt: string }
  }
  // ...
}
export const apiContract: RpcContract = { /* ... */ }
```

## Server

```ts
import { createRpcServer, createJsonRpcFetchHandler, createRestFetchHandler, RpcError } from '@oa-sdk/rpc'
import { createAjvValidator } from '@oa-sdk/rpc/ajv'
import { apiContract, type ApiProcedures } from './generated/rpc.js'

type Context = { userId: string }

const server = createRpcServer<ApiProcedures, Context>(apiContract, {
  users: {
    getUserById: async ({ id }, { context }) => {
      const user = await db.users.find(id)
      if (!user) throw new RpcError('NOT_FOUND', 'User not found', { data: { code: 'NOT_FOUND', message: id } })
      return user
    },
    // every procedure needs a handler unless `allowPartial: true`
  },
}, { validator: createAjvValidator() })

const createContext = (request: Request) => ({ userId: request.headers.get('x-user-id') ?? 'anonymous' })
const rpc = createJsonRpcFetchHandler(server, { path: '/rpc', createContext })
const rest = createRestFetchHandler(server, { basePath: '/v1', createContext })

// Any fetch-style runtime: Bun, Deno, Cloudflare Workers, Hono (`app.all('*', c => ...)`), Node with an adapter.
export default {
  async fetch(request: Request) {
    return (await rpc(request)) ?? (await rest(request)) ?? new Response('Not found', { status: 404 })
  },
}
```

| Function | Description |
| --- | --- |
| `createRpcServer(contract, handlers, options?)` | Binds handlers nested like the procedure names. Throws when a handler is missing, unless `allowPartial` (calls then fail with `NOT_IMPLEMENTED`). `validator` checks input (`INVALID_INPUT`, 400) and, with `validateOutput`, results (`INVALID_OUTPUT`, 500). An error that is not an `RpcError` reaches callers as `INTERNAL` with the message `Internal server error`; `onError` receives the original |
| `server.call(name, input, { context, request, signal })` | Runs one procedure; the building block of every transport |
| `handleJsonRpc(server, message, options?)` | Answers a JSON-RPC 2.0 request, notification, or batch given as text or parsed JSON. Resolves `undefined` when only notifications arrived. Use it for WebSocket, WebRTC data channel, or `postMessage` channels |
| `createJsonRpcFetchHandler(server, { path, createContext })` | JSON-RPC over HTTP `POST` at `path` (default `/rpc`); 405 for other methods, 204 for notifications |
| `createRestFetchHandler(server, { basePath, createContext })` | Matches the contract's REST routes, decodes the parameters and body back into the input (numbers and booleans are coerced by schema; a form or multipart field whose schema is an array stays an array even when it occurs once), and answers with the declared success status. 405 with `Allow` for a known path with another method |

Both fetch handlers resolve `undefined` for requests that are not theirs, so they compose.

## Client

```ts
import { createRpcClient, createHttpTransport, createJsonRpcTransport } from '@oa-sdk/rpc'
import { apiContract, type ApiProcedures } from './generated/rpc.js'

const rest = createRpcClient<ApiProcedures>(apiContract, createHttpTransport({
  baseUrl: 'https://api.example.com/v1',
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
}))
const user = await rest.users.getUserById({ id })   // GET /v1/users/{id}

const rpc = createRpcClient<ApiProcedures>(apiContract, createJsonRpcTransport({ url: 'https://api.example.com/rpc' }))
await rpc.users.updateUser({ id, name: 'Alice' })     // POST /rpc {"method":"users.updateUser",...}
```

| Function | Description |
| --- | --- |
| `createRpcClient<P>(contract, transport, { validator? })` | Nested client; methods take `(input, { signal, headers })`. With `validator`, invalid input rejects before the transport runs |
| `createRpcCaller<P>(contract, transport)` | `caller.call('users.getUserById', input)` by dotted name. Without `P` any input is accepted and results are `unknown` |
| `createHttpTransport({ baseUrl, fetch?, headers? })` | Sends each call to its REST route. Parameters follow the OpenAPI `style`/`explode` rules (`simple`, `label`, `matrix`, `form`, `spaceDelimited`, `pipeDelimited`, `deepObject`; `content` parameters use their media type). Bodies: JSON, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/*`, or binary. A path parameter that serializes to an empty or dot segment (`''`, `.`, `..`) rejects with `INVALID_INPUT` before any request is sent, since the URL would reach another route |
| `createJsonRpcTransport({ url, fetch?, headers? })` | Sends each call as a JSON-RPC 2.0 request. The answer must be a single JSON-RPC 2.0 response for that request id (or id `null` with an error) carrying an error object (integer `code`, string `message`) or a `result`; an `"error": null` member next to the result counts as no error. Any other answer rejects with `TRANSPORT` |
| `createLocalTransport(server, { context })` | Calls a server in the same process; input and output are structured-cloned |

A transport is just `(request: { procedure, input, signal?, headers? }) => Promise<output>`, so other
channels plug in directly.

## Errors

Failures reject with `RpcError` (`code`, `status`, `data`). A call cancelled through its `signal`
rejects with the error the cancelled `fetch` raised instead, which is the signal's reason (an
`AbortError` `DOMException` by default), also when the cancellation lands while the response body
is being read.

| Source | `code` | `status` | `data` |
| --- | --- | --- | --- |
| Handler throws `new RpcError(code, message, { status?, data? })` | as thrown | `status` or the code's default | as thrown; the REST error body |
| Invalid input | `INVALID_INPUT` | 400 | `{ code, message, issues: [{ path, message }] }` |
| Unknown procedure | `PROCEDURE_NOT_FOUND` | 404 | — |
| REST response with a non-2xx status | the body's string `code`, else from the status (`NOT_FOUND`, `CONFLICT`, ... or `HTTP_<status>`) | the response status | the response body |
| Network failure, unreadable or non-JSON-RPC response | `TRANSPORT` | 502 for a network failure; the response status when a response arrived but its body could not be read or is not a JSON-RPC response | — |

Over JSON-RPC, protocol errors use the standard codes (`-32700`, `-32600`, `-32601`, `-32602`,
`-32603`); application errors use `-32000`, and `error.data` carries `{ code, status, data }` so the
client restores the same `RpcError`.

A result or error payload that JSON cannot represent (a `bigint`, a cyclic object) is answered as
`INTERNAL` (`-32603` over JSON-RPC, 500 over REST) instead of failing the whole response; in a
JSON-RPC batch only that call's entry is replaced.

## Validation

`createAjvValidator({ ajv? })` from `@oa-sdk/rpc/ajv` compiles contract schemas with Ajv's JSON
Schema 2020-12 dialect (`strict: false`, so OpenAPI keywords such as `example` are ignored).
Formats are not validated by default; pass an Ajv instance with `ajv-formats` added to check them.
Binary values described the OpenAPI 3.0 way, `{ type: string, format: binary }`, arrive as a
`Uint8Array` (`application/octet-stream` and other binary bodies), a `File` (multipart file part),
or a `Blob` (client input) rather than as JSON strings, so their `type` and `format` are left out
when compiling; `required` and the other keywords still apply. The OpenAPI 3.1 form
(`contentMediaType` without `type`) needs no such step.
Any other validator fits the `RpcValidator` type: `(schema, contract) => (value) => issues[]`.

## Limits

- Unary calls only; streaming operations are not part of the contract.
- No batching on the client side; `handleJsonRpc` answers batches sent by other clients.
- Authentication, rate limiting, and CORS belong to the code around the fetch handlers.
