# @oa-sdk/mock-server

OpenAPI-native mock engine with structured validation errors, streaming support, and pluggable adapters for MSW and Node HTTP.

## Installation

```bash
npm install --save-dev @oa-sdk/mock-server
```

The MSW adapter imports `msw` 2.x, an optional peer dependency that is not installed with this
package. Only the two entry points that export the adapter need it:
`@oa-sdk/mock-server/adapters/msw` (Node and Vitest) and `@oa-sdk/mock-server/browser` (browser
bundles). Install `msw` next to this package before you import them:

```bash
npm install --save-dev msw
```

The package root (`@oa-sdk/mock-server`), which does not export the MSW adapter, and
`@oa-sdk/mock-server/adapters/node-http` load without `msw`. The `oa-mock` CLI needs no peer
dependency either, and neither does `oa-gen mock` from `@oa-sdk/codegen`, which runs this package
as a companion package.

Inside the oa-sdk source repository, declare it with `workspace:*` and build it with
`pnpm build:downstream` before running these examples.

## Quick Start — MSW adapter (browser / Vitest)

Use `createMswHandlers` to generate MSW `RequestHandler[]` from an OpenAPI spec. The handlers intercept requests, validate them against the spec, and return example-driven or schema-generated responses.

`msw` is an optional peer dependency, so package managers do not install it for you. The MSW
adapter is therefore not part of the root `@oa-sdk/mock-server` entry point, which loads without
`msw`: import it from `@oa-sdk/mock-server/adapters/msw` (Node and Vitest) or
`@oa-sdk/mock-server/browser` (browser bundles), and install `msw >= 2.0` next to it.

```ts
import { setupServer } from 'msw/node'
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'

const spec = {
  openapi: '3.2.0',
  info: { title: 'My API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                examples: { default: { dataValue: [{ id: 1, name: 'alpha' }] } },
              },
            },
          },
        },
      },
    },
  },
}

// Vitest / Node test setup
const server = setupServer(...createMswHandlers(spec))

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// In browser: use setupWorker instead of setupServer
// export const worker = setupWorker(...createMswHandlers(spec))
```

The `onRequest` hook provides observability without changing handler behavior:

```ts
const handlers = createMswHandlers(spec, {
  onRequest: ({ method, path, operationId }) => {
    console.log(`[mock] ${method.toUpperCase()} ${path} — ${operationId}`)
  },
})
```

The MSW adapter prefixes all paths with the pathname from `spec.servers[0].url`. A spec with `servers: [{ url: 'https://api.example.com/v2' }]` registers handlers under `/v2/*`.

## Quick Start — Node HTTP adapter (Playwright / E2E)

`createNodeMockServer` starts a real HTTP server. Pass `port: 0` to let the OS pick a free port; the actual URL is available on `server.url` after `start()`.

```ts
import { createNodeMockServer } from '@oa-sdk/mock-server'
import type { NodeMockServer } from '@oa-sdk/mock-server'

let server: NodeMockServer

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 })
  await server.start()
  // server.url → e.g. "http://127.0.0.1:52341"
})

afterAll(() => server.stop())

it('GET /items returns 200', async () => {
  const res = await fetch(`${server.url}/items`)
  expect(res.status).toBe(200)
})
```

Configure Playwright to point its `baseURL` at `server.url` before the test run starts.

```ts
// playwright.config.ts
import { createNodeMockServer } from '@oa-sdk/mock-server'
import spec from './openapi.json'

const mockServer = createNodeMockServer(spec, { port: 4010 })

export default defineConfig({
  globalSetup: async () => { await mockServer.start() },
  globalTeardown: async () => { await mockServer.stop() },
  use: { baseURL: mockServer.url },
})
```

## CLI

The package installs the `oa-mock` binary, which starts a mock server from a validated OpenAPI
JSON or YAML file:

```bash
npx oa-mock --spec path/to/openapi.yaml --port 4010
```

From the oa-sdk source checkout, run the built workspace entry point instead:

```bash
pnpm --filter @oa-sdk/mock-server build
node packages/mock-server/dist/cli/index.js --spec path/to/openapi.json --port 4010
```

The CLI parses JSON and YAML, validates the document before binding a port, and exits with a non-zero status when loading or validation fails. It never selects a bundled or workspace schema implicitly.

| Flag | Requirement | Default | Description |
|------|-------------|---------|-------------|
| `--spec`, `-s` | Required JSON/YAML path | None | OpenAPI specification file |
| `--port`, `-p` | Integer from `0` through `65535` | `4010` | Server listen port |
| `--stateful` | Optional | Off | Serve collection CRUD from the in-memory store (see [Plugins and stateful CRUD](#plugins-and-stateful-crud)) |
| `--throttle` | Optional rate (e.g. `500kbps`, `1mbps`, `50000`) | None | Transfer bandwidth throttle in bytes/sec |
| `--ttfb` | Integer milliseconds (>= 0) | `0` | Time to first byte latency delay |
| `--jitter` | Integer milliseconds (>= 0) | `0` | Random jitter (+/- ms) added to TTFB |
| `--packet-loss` | Percentage or rate (e.g. `5%` or `0.05`) | `0` | Probability of simulated packet drop |
| `--loss-mode` | `'drop'` or `'status'` | `'drop'` | Packet loss action: socket drop vs HTTP 503 |
| `--help`, `-h` | Optional | — | Show usage help |

Press `Ctrl+C` to stop. The server logs its URL and the resolved spec path on startup.

## Network Chaos Engine

`createNodeMockServer` and the `oa-mock` CLI include a built-in network chaos injection engine to test client resiliency under hostile network conditions (high latency, jitter, packet loss, and throttled bandwidth).

### Programmatic Usage

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, {
  port: 0,
  chaos: {
    ttfbMs: 150,                // 150ms simulated latency
    jitterMs: 30,               // +/- 30ms jitter (120ms - 180ms total)
    packetLoss: 0.05,           // 5% packet loss
    lossMode: 'status',         // Return HTTP 503 (or 'drop' to forcibly close socket)
    throttleBytesPerSec: 62500, // 500kbps bandwidth throttling
  },
})

await server.start()
```

### CLI Usage

```bash
npx oa-mock \
  --spec openapi.yaml \
  --port 4010 \
  --throttle 500kbps \
  --ttfb 100 \
  --jitter 25 \
  --packet-loss 5% \
  --loss-mode drop
```

When bandwidth throttling is enabled, responses are divided into small chunks and paced over time, applying equally to static precomputed bodies, error responses, and live Server-Sent Events / NDJSON streams.

## Plugins and stateful CRUD

`createMswHandlers`, `createMswMockServer`, and `createNodeMockServer` accept `plugins: MockPlugin[]`.
A plugin runs only for a request that passed validation:

- `onMatch(context)` may return a response (`{ status, contentType?, body?, headers? }`). The first
  plugin that returns one replaces the spec-generated response.
- `onResponse(response, context)` transforms the chosen response; every plugin's hook runs in order.
- `reset()` clears plugin state; `server.reset()` calls it on every plugin.

A response returned by `onMatch` without a `schema` is not validated against the documented
response schema.

`stateful: true` (or `--stateful` on the CLI) adds the built-in `inMemoryStorePlugin()`, which
serves collection CRUD from memory. `stateful: { seed, generateId }` passes its options.

```ts
const server = createNodeMockServer(spec, {
  port: 0,
  stateful: { seed: { '/users': [{ id: 'u1', name: 'Ada' }] } },
})
```

- A collection path (`/users`): `GET` lists the items, paged when the query has `limit`,
  `pageSize` or `per_page` (with `offset` or `page`) and wrapped as `{ items, total, page?, limit }`
  or `{ data, total }` when the documented 200 schema has `items` or `data`. `POST` appends the
  request body, gives an object without `id` one from `generateId` (default `crypto.randomUUID()`),
  and answers 201 unless only 200 is documented.
- A member path (`/users/{id}`): `GET`, `PUT` (replace), `PATCH` (merge) and `DELETE` find the item
  by `id` or by the path parameter's name and answer 404 with `NOT_FOUND` when it is missing.
  `DELETE` answers 204 unless only 200 is documented. A member path whose collection the store
  has never held falls back to the spec-generated response.

## Core concepts

### Schema Algebra pattern — `foldSchema` + `SchemaAlgebra<T>`

`foldSchema` is a generic tree-fold that separates traversal from semantics. It handles recursion, type-dispatch, and `example`/`default` short-circuits. Callers supply a `SchemaAlgebra<T>` that defines what to produce at each node type.

```ts
import { foldSchema, type SchemaAlgebra } from '@oa-sdk/mock-server'

// Produce a human-readable type string instead of a value
const typeAlgebra: SchemaAlgebra<string> = {
  string:  (s) => s.format ?? 'string',
  integer: ()  => 'integer',
  number:  ()  => 'number',
  boolean: ()  => 'boolean',
  null:    ()  => 'null',
  object:  (_, props) => `{ ${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ')} }`,
  array:   (_, items) => `${items ?? 'unknown'}[]`,
  allOf:   (_, branches) => branches.join(' & '),
  oneOf:   (_, branches) => branches.join(' | '),
  anyOf:   (_, branches) => branches.join(' | '),
  ref:     (ref) => ref,
  example: (v)  => JSON.stringify(v),
  default_:(v)  => JSON.stringify(v),
  fallback:()   => 'unknown',
}

foldSchema({ type: 'object', properties: { id: { type: 'integer' } } }, typeAlgebra)
// → '{ id: integer }'
```

`foldSchema` dispatches:
- `example` / `default` — short-circuit before type dispatch
- `$ref` — delegated to `algebra.ref`
- `allOf` / `oneOf` / `anyOf` — all branches are folded first, then passed to the combinator
- `type: 'object'` — properties folded first, results passed to `algebra.object`
- `type: 'array'` — `items` folded first, result passed to `algebra.array`

### Spec transformation — `SchemaFolder`, `DerefFolder`, `SpecPass` pipeline

`SchemaFolder` is an abstract class for whole-spec AST transformations. It recursively walks every node in the spec and returns a new tree. Subclass it and override `foldRef` or `foldObject` to intercept specific node kinds.

`DerefFolder` extends `SchemaFolder` to inline internal `$ref` references (`#/components/schemas/...`). It detects circular references via a traversal stack and replaces them with `{}`. External refs (`./foo.yaml`, `https://...`) are left untouched.

`SpecPass` models a single named transformation step over an `OpenAPIObject`. Multiple passes compose left-to-right through `runPipeline`:

```ts
import { runPipeline, derefPass, type SpecPass } from '@oa-sdk/mock-server'

const stripXFields: SpecPass = {
  name: 'strip-x-fields',
  run: (spec) => JSON.parse(
    JSON.stringify(spec, (key, val) => key.startsWith('x-') ? undefined : val)
  ),
}

const processed = runPipeline(spec, [derefPass, stripXFields])
```

`loadSchema` accepts a custom pass list as its second argument:

```ts
import { loadSchema, DEFAULT_PASSES } from '@oa-sdk/mock-server'

const index = loadSchema(spec, [...DEFAULT_PASSES, myCustomPass])
```

### Streaming — SSE vs NDJSON

When a response content-type is `text/event-stream`, `application/x-ndjson`, or `application/jsonl`, the adapters use `StreamFolder` to emit multiple events from a single schema definition.

For `text/event-stream`, schema-driven adapters emit only documented frames and
terminate by closing the HTTP response. Generic SSE frames use
`data: <json>\n\n`; a native OpenAPI 3.2 named event additionally uses
`event: <name>\ndata: <json>\n\n`. Adapters never synthesize `data: [DONE]`,
because it would violate an `itemSchema` that requires a named event.

For NDJSON/JSONL, each event is a bare JSON line with no `data:` prefix and no terminator.

If the response has an `examples` entry (with `dataValue`), a single fixed event is emitted instead of schema-generated ones.

```yaml
# SSE — schema-driven, 3 documented events then response close
'text/event-stream':
  schema:
    type: object
    required: [type]
    properties:
      type: { type: string, enum: [ping] }

# SSE — example-driven, 1 fixed event, no [DONE]
'text/event-stream':
  examples:
    item:
      dataValue: { id: fixed-id, type: ping }
```

## Customization

### Custom algebra (spread override)

Override individual handlers without reimplementing the full algebra:

```ts
import { foldSchema, generateAlgebra } from '@oa-sdk/mock-server'

const myAlgebra = {
  ...generateAlgebra,
  integer: (s) => s.maximum ?? 100,   // use maximum instead of minimum
  string:  ()  => crypto.randomUUID(), // random UUIDs for all strings
}

const value = foldSchema(schema, myAlgebra)
```

### Custom `GenerateFolder` subclass

For class-based extension with method overrides:

```ts
import { GenerateFolder, StreamFolder } from '@oa-sdk/mock-server'
import type { SchemaObject } from 'openapi3-ts/oas31'

class RealisticFolder extends GenerateFolder {
  protected override generateString(schema: SchemaObject): string {
    if (schema.format === 'email') return 'user@example.org'
    if (schema.format === 'uuid')  return crypto.randomUUID()
    return super.generateString(schema)
  }
}

// Use with the generator directly
const folder = new RealisticFolder()
folder.fold(schema)

// Or inject into StreamFolder
const customStreamer = new StreamFolder(new RealisticFolder())
```

### Custom `SpecPass`

Inject spec normalization or enrichment steps before route indexing:

```ts
import { createNodeMockServer, loadSchema, DEFAULT_PASSES, type SpecPass } from '@oa-sdk/mock-server'

const injectExamples: SpecPass = {
  name: 'inject-examples',
  run: (spec) => ({
    ...spec,
    // add synthetic examples to paths that have none
    paths: injectMissingExamples(spec.paths),
  }),
}

// loadSchema with custom passes
const index = loadSchema(spec, [...DEFAULT_PASSES, injectExamples])

// Or pass to the adapter — adapters call loadSchema internally,
// but you can pre-process the spec before passing it:
const processedSpec = runPipeline(spec, [...DEFAULT_PASSES, injectExamples])
const server = createNodeMockServer(processedSpec)
```

### Route filtering — `include` option

Both adapters support the `include` option to generate handlers for a subset of routes:

```typescript
// path prefix — /users 하위만 모킹
const handlers = createMswHandlers(spec, { include: { paths: ['/users'] } })

// 특정 operationId만
const handlers = createMswHandlers(spec, { include: { operations: ['listUsers', 'getUser'] } })

// 태그 기반
const handlers = createMswHandlers(spec, { include: { tags: ['projects'] } })

// 커스텀 predicate
const handlers = createMswHandlers(spec, {
  include: { filter: (_path, _method, entry) => !entry.deprecated },
})

// Node HTTP도 동일
const server = createNodeMockServer(spec, { port: 0, include: { paths: ['/users'] } })
```

Multiple conditions use OR semantics — if any condition matches, the route is included.

## API Reference

### Adapters

The MSW exports (`createMswHandlers`, `createMswMockServer`, `MswHandlerOptions`,
`MswMockServer`) come from `@oa-sdk/mock-server/adapters/msw` and `@oa-sdk/mock-server/browser`,
which need `msw`; the root entry point does not export them.

| Export | Description |
|--------|-------------|
| `createMswHandlers(spec, options?)` | Build MSW `RequestHandler[]` from an OpenAPI document or a `ParsedDocument` |
| `createMswMockServer(spec, options?)` | MSW handlers plus `override()`, `clearOverride()`, `clearOverrides()` and `reset()` |
| `MswHandlerOptions` | `{ onRequest?, include?, validateRequestSchemas?, onCallback?, plugins?, stateful? }` |
| `createNodeMockServer(spec, options?)` | Create a Node HTTP mock server from an OpenAPI document or a `ParsedDocument` |
| `NodeMockServer` | `{ start(), stop(), url, override(), clearOverride(), clearOverrides(), updateSpec(), reset() }` |
| `NodeMockServerOptions` | `{ port?, host?, serverIndex?, serverVariables?, include?, validateRequestSchemas?, onCallback?, chaos?, plugins?, stateful? }` — defaults to `4010` / `127.0.0.1` |
| `NetworkChaosOptions` | `{ ttfbMs?, jitterMs?, packetLoss?, lossMode?, throttleBytesPerSec? }` |
| `MockPlugin` | `{ name, onMatch?, onResponse?, reset? }` — see [Plugins and stateful CRUD](#plugins-and-stateful-crud) |
| `inMemoryStorePlugin(options?)` | Built-in collection CRUD store (`InMemoryStoreOptions`: `seed?`, `generateId?`) |
| `RouteFilter` | 라우트 필터 조건 (paths/operations/tags/custom predicate) |
| `HandlerResult` | `handleRequest` 반환 타입 (`success` \| `validation-error` \| `no-response`) |

### Schema Algebra

| Export | Description |
|--------|-------------|
| `foldSchema(node, algebra)` | Fold an OAS schema node into `T` using the supplied algebra |
| `SchemaAlgebra<T>` | Interface defining a handler per schema node kind |
| `generateAlgebra` | Built-in algebra that produces minimal schema-satisfying values |
| `GenerateFolder` | Class wrapper around `generateAlgebra`; subclass to override `generateString` or the full algebra |
| `generator` | Shared singleton `GenerateFolder` instance |
| `StreamFolder` | Async generator that yields schema-generated events |
| `streamer` | Shared singleton `StreamFolder` instance |
| `StreamOptions` | `{ count?, includeTerminator? }` — streaming parameters; the default is no terminator |
| `SSE_DONE` | Explicit raw `[DONE]` formatter value; schema-driven adapters do not emit it |
| `formatSseChunk(data, event?)` | Format a generic or named SSE frame |
| `formatNdjsonLine(data)` | Format a value as `<json>\n` |
| `isStreamingContentType(ct)` | Returns `true` for SSE, NDJSON, and JSONL content-types |

### Spec transformation

| Export | Description |
|--------|-------------|
| `SchemaFolder` | Abstract base class for whole-spec AST transformations |
| `DerefFolder` | `SchemaFolder` subclass that inlines internal `$ref` nodes |
| `derefSpec(spec)` | Convenience function: run `DerefFolder` over a full spec |
| `SpecPass` | Interface: `{ name: string; run(spec): spec }` |
| `runPipeline(spec, passes)` | Run an ordered list of `SpecPass` transforms |
| `derefPass` | Built-in `SpecPass` that calls `derefSpec` |
| `DEFAULT_PASSES` | `[derefPass]` — the default pipeline used by `loadSchema` |

### Routing and request handling

| Export | Description |
|--------|-------------|
| `loadSchema(spec, passes?)` | Parse a spec into a `RouteIndex` after running the pipeline |
| `matchRoute(index, method, path)` | Look up a route; returns `found`, `method_not_allowed`, or `not_found` |
| `toMswPath(openApiPath)` | Convert `{param}` syntax to `:param` for MSW |
| `filterRouteIndex(index, filter)` | `RouteIndex`에서 조건에 맞는 라우트만 추출 |
| `validateRequest(input, parameters, requestBody?)` | Validate path/query/header/body against OAS parameter definitions |
| `pickResponse(responses)` | Select a `PickedResponse` from an operation's responses map |
| `PickedResponse` | `{ status, contentType, body, stream? }` |

### Errors

| Export | Description |
|--------|-------------|
| `MockErrorCode` | Union of machine-readable error code strings |
| `MockErrorDetail` | Single field-level error with `path`, `code`, `message`, and optional redacted `received`/`value` summaries plus `expected`/`constraint` |
| `MockValidationResult` | `{ valid: true }` or `{ valid: false; errors: MockErrorDetail[] }` |
| `MockErrorResponse` | Top-level error envelope returned by the adapters on `422` |
| `classifyAjvErrors` | Convert raw AJV error objects into `MockErrorDetail[]` |

## Validation errors

Invalid requests receive a `422` response with this shape:

```ts
type MockErrorResponse = {
  error: {
    code: MockErrorCode        // top-level category
    message: string
    details: MockErrorDetail[] // one entry per violated constraint
    _meta?: {
      operationId?: string
      method: string
      path: string
    }
  }
}

type MockErrorDetail = {
  path: string        // JSON Pointer to the failing field, e.g. "/body/email"
  code: MockErrorCode
  message: string
  received?: MockReceivedValueSummary  // type/length/count only; never the value that was sent
  value?: MockReceivedValueSummary     // legacy alias; follows the same redaction rule
  expected?: string   // what was expected
  constraint?: Record<string, unknown>  // e.g. { minLength: 8 }
}

type MockReceivedValueSummary =
  | { type: 'string'; length: number }
  | { type: 'array' | 'object'; count: number }
  | { type: 'number' | 'boolean' | 'bigint' | 'symbol' | 'function' | 'null' | 'undefined' }
```

`received` and the legacy `value` alias are intentionally content-free. This
keeps validation output safe to return, serialize, and log when a request
contains passwords, tokens, XML, multipart fields, or nested objects.

The `code` values and when they fire:

| Code | Trigger |
|------|---------|
| `TYPE_ERROR` | Field value has the wrong JS type |
| `CONSTRAINT_VIOLATION` | `minimum`, `maxLength`, `minItems`, etc. violated |
| `MISSING_REQUIRED_FIELD` | A `required` field is absent |
| `INVALID_ENUM_VALUE` | Value is not in the declared `enum` |
| `FORMAT_MISMATCH` | `email`, `uuid`, `date-time`, etc. format invalid |
| `PATTERN_MISMATCH` | String does not match `pattern` |
| `PROTOCOL_MISMATCH` | `Content-Type` header does not match any declared request body media type |
| `NOT_FOUND` | Path or method is not defined in the spec |

## OAS 3.2 features supported

| Feature | Behavior |
|---------|----------|
| `examples[n].dataValue` | Used as the response body in preference to `examples[n].value` or `example` |
| `itemSchema` | When present on a streaming schema, each generated event uses `itemSchema` as its schema rather than the container schema |
| `type` as an array (e.g. `["string", "null"]`) | `foldSchema` picks the first element of the array for dispatch |
| Range status codes (`2XX`, `4XX`) | `pickResponse` maps `2XX` → `200`, `4XX` → `400`, etc., falling back to `default` last |
| Internal `$ref` (`#/components/schemas/...`) | Inlined by `DerefFolder` / `derefPass` before validation and generation |
| Circular `$ref` | Detected via traversal stack; replaced with `{}` to avoid infinite loops |
