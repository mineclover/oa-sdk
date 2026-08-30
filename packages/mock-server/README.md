# @oa-sdk/mock-server

OpenAPI-native mock engine with structured validation errors, streaming support, and pluggable adapters for MSW and Node HTTP.

## Workspace availability

`@oa-sdk/mock-server` is currently a private oa-sdk workspace package, not a public npm
distribution candidate. Do not install it from an unrelated project with `pnpm add
@oa-sdk/mock-server`.

From an oa-sdk source checkout, install dependencies and build the private downstream
packages before using these examples:

```bash
pnpm install
pnpm build:downstream
```

An internal workspace that uses the MSW adapter must declare `@oa-sdk/mock-server` with a
`workspace:*` dependency and provide `msw >= 2.0`. A public installation guide will be added
only if this package becomes an approved distribution candidate.

## Quick Start — MSW adapter (browser / Vitest)

Use `createMswHandlers` to generate MSW `RequestHandler[]` from an OpenAPI spec. The handlers intercept requests, validate them against the spec, and return example-driven or schema-generated responses.

```ts
import { setupServer } from 'msw/node'
import { createMswHandlers } from '@oa-sdk/mock-server'

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

From the oa-sdk source checkout, start a mock server from a validated OpenAPI JSON or YAML
file through the built workspace entry point:

```bash
pnpm --filter @oa-sdk/mock-server build
node packages/mock-server/dist/cli/index.js --spec path/to/openapi.yaml --port 4010
```

`oa-mock` is the package binary name for a workspace that explicitly exposes it; it is not a
publicly installable CLI today. The direct source-checkout equivalent is:

```bash
node packages/mock-server/dist/cli/index.js --spec path/to/openapi.json --port 4010
```

The CLI parses JSON and YAML, validates the document before binding a port, and exits with a non-zero status when loading or validation fails. It never selects a bundled or workspace schema implicitly.

| Flag | Requirement | Default |
|------|-------------|---------|
| `--spec`, `-s` | Required JSON/YAML path | None |
| `--port`, `-p` | Integer from `0` through `65535` | `4010` |
| `--help`, `-h` | Optional | — |

Press `Ctrl+C` to stop. The server logs its URL and the resolved spec path on startup.

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

| Export | Description |
|--------|-------------|
| `createMswHandlers(spec, options?)` | Build MSW `RequestHandler[]` from an OpenAPI spec |
| `MswHandlerOptions` | `{ onRequest? }` — hook called on every intercepted request |
| `createNodeMockServer(spec, options?)` | Create a Node HTTP mock server |
| `NodeMockServer` | `{ start(), stop(), url }` — server lifecycle interface |
| `NodeMockServerOptions` | `{ port?, host? }` — defaults to `4010` / `127.0.0.1` |
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
