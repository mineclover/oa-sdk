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

The default port and host are `4010` and `127.0.0.1`. When `spec.servers[0].url` has a path
(`https://api.example.com/v1`), `server.url` already ends with it (`http://127.0.0.1:<port>/v1`), so
request `${server.url}/items`; `${server.url}/v1/items` becomes `/v1/v1/items` and returns 404. Pick
another server with `serverIndex` and fill its variables with `serverVariables`.

The examples pass the spec as an object. Load your own document with `JSON.parse(readFileSync(...))`,
an import attribute (`import spec from './openapi.json' with { type: 'json' }`), or the `parse()`
function of the `yaml` package.

For Playwright, let the test runner start the mock server through the [CLI](#cli) with `webServer`,
and point `baseURL` at it:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  webServer: {
    command: 'npx oa-mock --spec ./openapi.yaml --port 4010',
    url: 'http://127.0.0.1:4010/items', // any documented GET route that answers 200
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://127.0.0.1:4010' },
})
```

### Testing helpers

The package root also exports small helpers for tests:

```ts
import { createNodeMockServer, createTestClient, type MockErrorResponse } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

const res = await client.post('/users', {}) // a documented POST route whose body has a required field
if (res.status === 422) {
  const { error } = res.json as MockErrorResponse // `json` is typed `unknown`
  console.log(error.details.map((detail) => `${detail.code} ${detail.path}`))
}
```

| Export | Description |
|--------|-------------|
| `createTestClient(server)` | `get`, `post`, `put`, `patch`, `delete` against a started `NodeMockServer`; each resolves to `{ status, headers, body, json, ok }` (`json` is `unknown`, `null` for a non-JSON body) |
| `createCoverageTracker()` | Records operation IDs through `onRequest({ operationId })` and reports `called`, `uncalled(ids)` and `coverage(ids)` (0 to 1) |
| `createCallbackTracker()` | Collects simulated callback POST attempts through `onCallback`; pass it as the adapter's `onCallback` option |

`createNodeMockServer` has no request hook, so feed a coverage tracker from a plugin:
`plugins: [{ name: 'coverage', onMatch: ({ entry }) => tracker.onRequest({ operationId: entry.operationId }) }]`.
Plugins run only for requests that pass validation. With the MSW adapter, pass
`onRequest: tracker.onRequest` instead; it runs before validation.

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

A spec split across files is served as one document: the `$ref`s it makes into other files (`./schemas.yaml#/User`, `./paths/user.yaml`) resolve relative to the spec file, for validation and for serving, so the operations of a path item in another file are served too. A `$ref` that cannot be resolved, such as one to a missing file or a cycle of references, fails before a port is bound and names the reference.

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

- A collection path (`/users`): `GET` returns the items as an array. When the query has `limit`,
  `pageSize` or `per_page` (with `offset` or `page`), it returns that page, wrapped as
  `{ items, total, page?, limit }` or `{ data, total }` when the documented 200 schema has `items` or
  `data`. Store responses are not validated against the documented schema. `POST` appends the
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

`DerefFolder` (re-exported from `@oa-sdk/parser`) extends `SchemaFolder` to inline `$ref` references. Internal refs (`#/components/schemas/...`) are always resolved; relative file refs (`./foo.yaml`) are resolved when a `basePath` option is given and are otherwise left as written. Siblings of a `$ref` are merged into the resolved target. Circular references are detected through a stack of (document, JSON Pointer) keys and replaced with `{}`, or kept as a `$ref` with `cycleStrategy: 'preserve-ref'`. The result can share one sub-object between several locations, so treat it as read-only.

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

### Response reuse per route

With the built-in generator an operation's response is the same for every
request: its status, media type, header values and body (example or generated)
depend only on the spec. Both adapters therefore pick, validate against the
response schema, serialize and (for streams) generate that response once per
route and reuse it; the same holds for the documented `401` served to requests
without credentials and the documented `422` as written. `updateSpec()` on the
Node adapter, or building new MSW handlers, starts from scratch with the new
spec.

Everything that depends on the request is still computed per request: request
validation and the validation details in a `422`, callback URLs, stateful-store
responses and other plugin responses. Plugins that only implement `onMatch` and
return nothing let the shared response through. `handleRequest()` returns a
fresh response on every call.

**A customized shared generator turns reuse off.** The adapters generate bodies,
header values and stream events with the exported `generator` and `streamer`.
While either is customized, every request picks, validates, serializes and
streams its response anew, exactly as without reuse, so a handler that keeps
state or changes over time is called on every request and its values are sent.
This includes header values generated next to an example body: the Node
adapter sends the response as picked for the request rather than the one it
serialized when the server was created or updated. Customizing means any
of: replacing or adding a `generateAlgebra` handler; replacing `fold`,
`algebra()` or `generateString()` on `generator` or on
`GenerateFolder.prototype` (a test spy on `generator.fold` counts); changing
the prototype of `generator`; replacing `generate` on `streamer` or on
`StreamFolder.prototype`, or the folder `streamer` uses. Reuse resumes once the
customization is undone, and a response generated while it was in place is
never reused. Generators you create yourself (`new GenerateFolder()`, a
subclass, `new StreamFolder(folder)`) are not used by the adapters.

**Spec objects are read-only once an adapter is built.** Changing the spec's
response objects in place, through a `ParsedDocument` passed to an adapter or
through `context.entry` in a plugin, is not supported. A reused response does
not see the change: the Node adapter keeps the response it picked with the
built-in generator when the server was created or updated, and MSW handlers
keep the one they picked on the route's first request. Only requests that pick
a fresh response (when a plugin has an `onResponse` hook, or while the shared
generator is customized) see it. To change responses at runtime, use
`override()`, `updateSpec()` (Node), new MSW handlers, or a plugin whose
`onMatch` returns its own response.

A plugin `onResponse` hook receives a newly picked response object on every
request, with its own `headers` and `links` records. Its body may still hold
the spec's own objects: an example-backed body is the spec's example object
itself, and a generated body is a new object whose `example`, `default` and
`const` values are the schema's own. Those objects are shared by every request
and by the spec, so a hook must not change them in place; return the response
with a changed copy instead, for example
`{ ...response, body: { ...response.body, extra: true } }`.

A response schema check is reused only once the schema has compiled. The
response validator reports a schema that violates the JSON Schema meta-schema
(for example an OAS 3.0-style keyed `examples` map) on the first compile of
that schema object only, so the first request validated against it, on any
route that shares it, gets a `500` `SCHEMA_COMPILE_ERROR` and later requests
get the response. A check that failed to compile is therefore repeated on the
next request, so the same requests get the error as without reuse.

The Node adapter's per-route state is bounded by the number of operations in
the spec; nothing is retained per concrete request URL.

The built-in generation skips the optional properties of an object instead of
generating values for them and then dropping them: a `GenerateFolder` whose
`algebra()` and `generateString()` are not overridden (by a subclass, on the
instance or on the prototype), with every `generateAlgebra` handler unchanged,
folds only the `required` properties. Those handlers have no side effects, so
the generated values are the same; only an error a built-in handler would have
raised inside a dropped property (such as a `minLength` beyond the engine's
string length limit) no longer occurs. A folder with any customized handler is
folded with `foldSchema` as before, so its handlers are called for every
property, optional ones included, in the same order.

### Request-path performance

`pnpm bench:request-path` serves the `@oa-sdk/schemas` spec with both adapters
and reports, per scenario, the median request latency and the CPU time per
request of the process running the mock. It also reports the time the
generator takes and the heap a Node server retains after serving many distinct
concrete URLs. Build this package and `@oa-sdk/schemas` first. With
`--baseline <dist directory>` it measures a second build alongside,
alternating between the two every round so that both see the same machine
load; the other options are described at the top of
`scripts/bench-request-path.mjs`.

To compare with an earlier commit, build that commit's sources into a
directory of this package that git ignores, so that the build's imports
resolve to this package's dependencies:

```sh
# from packages/mock-server
mkdir -p .tmp-baseline
git archive <commit> src | tar -x -C .tmp-baseline
pnpm exec tsup .tmp-baseline/src/index.ts --no-config --format esm --target node24 --out-dir .tmp-baseline/dist
pnpm bench:request-path --baseline .tmp-baseline/dist
```

Response reuse, the per-request `405` header and the required-only generation
were measured this way against `9adb26d6`, the commit before them, with
`pnpm bench:request-path --baseline .tmp-baseline/dist --rounds 9`: 2,000
requests per scenario and build in each of 9 rounds, 20,000 URLs for the heap
check, Node 24.19.0, on a shared machine (load average 8.4 at the start, 5.8 at
the end). Every figure is a median over rounds. A run that compared the
current build with a copy of itself in the same session shows the noise:
server CPU time differed by up to 5%, Node HTTP latency by up to 13%, MSW
figures and generator times by up to 1.5%, and retained heap by up to 230 KiB.

| Node HTTP adapter, server CPU µs per request | `9adb26d6` | after | change |
| --- | ---: | ---: | ---: |
| static example (`GET /version`) | 36.9 | 30.8 | −16.5% |
| static generated (`GET /world-model/execution-profiles`) | 41.2 | 31.5 | −23.6% |
| templated example (`GET /users/{id}`) | 40.8 | 33.7 | −17.4% |
| templated generated (`GET /worlds/{worldId}`) | 43.8 | 35.9 | −18.2% |
| validated body, example `201` (`POST /users`) | 39.7 | 34.5 | −13.2% |
| validated body, generated `201` (`POST /worlds`) | 47.3 | 36.8 | −22.2% |
| invalid body, `422` (`POST /users`) | 53.8 | 46.6 | −13.4% |
| method not allowed (`PUT /users/{id}`) | 31.5 | 30.4 | −3.8% |

- Node HTTP median latency, which includes the client and the connection,
  changed by −17.6% to +4.9% across the same scenarios.
- MSW latency (about 200 to 290 µs per request, mostly `msw`'s own request
  handling) and CPU time changed by −3.2% to 0%.
- Generator time per fold of the spec's 127 media type schemas went from
  41.0 µs to 27.0 µs. A synthetic schema whose optional properties share
  subtrees 8 levels deep went from 5,544 µs to 0.4 µs. A synthetic schema whose
  properties are all required, 4 levels deep and 4 wide, went from 13.7 µs to
  6.7 µs.
- Heap a Node server retained after 20,000 distinct URLs on the `405` path went
  from 2.96 MiB (155 B per URL) to 115 KiB (5.9 B per URL), and on a templated
  `200` route from 186 KiB to 154 KiB.

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

Spreading leaves `generateAlgebra` itself unchanged, so the adapters keep
generating with the built-in handlers. Assigning a handler to `generateAlgebra`
changes what the adapters generate, and turns per-route response reuse off
while the change is in place (see [Response reuse per route](#response-reuse-per-route)).

### Custom `GenerateFolder` subclass

For class-based extension with method overrides:

```ts
import { GenerateFolder, StreamFolder } from '@oa-sdk/mock-server'
import type { OasSchema } from '@oa-sdk/parser' // a dependency of this package; install it to import its types

class RealisticFolder extends GenerateFolder {
  protected override generateString(schema: OasSchema): string {
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
import { createNodeMockServer, loadSchema, runPipeline, DEFAULT_PASSES, type SpecPass } from '@oa-sdk/mock-server'

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
// path prefix: mock only the routes under /users
const handlers = createMswHandlers(spec, { include: { paths: ['/users'] } })

// selected operation IDs
const handlers = createMswHandlers(spec, { include: { operations: ['listUsers', 'getUser'] } })

// by tag
const handlers = createMswHandlers(spec, { include: { tags: ['projects'] } })

// custom predicate
const handlers = createMswHandlers(spec, {
  include: { filter: (_path, _method, entry) => !entry.deprecated },
})

// the Node HTTP adapter takes the same option
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
| `RouteFilter` | Route filter: `paths`, `operations`, `tags`, or a `filter(path, method, entry)` predicate (OR semantics) |
| `handleRequest(parts, entry, securitySchemes, options?)` | The adapter-independent validate-then-respond step both adapters use |
| `HandlerResult` | `handleRequest` result: `success`, `validation-error` (422), `schema-error` (500) or `no-response` (500) |

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
| `loadSchema(spec, passes?)` | Parse a spec into a `RouteIndex` after running the pipeline (re-exported from `@oa-sdk/parser`) |
| `matchRoute(index, method, path)` | Look up a route; returns `found`, `method_not_allowed`, or `not_found`. A concrete path (`/users/me`) wins over a templated one (`/users/{id}`); path parameter values are returned as sent, without percent-decoding |
| `filterRouteIndex(index, filter)` | Keep only the routes of a `RouteIndex` that match a `RouteFilter` |
| `validateRequest(input, parameters, requestBody, security?)` | Validate security credentials, `Content-Type`, path/query/header parameters and the body |
| `validateRequestSchemas(index)`, `assertValidRequestSchemas(index)` | Compile every request schema of a `RouteIndex` up front; the adapters do this at creation unless `validateRequestSchemas: false` |
| `pickResponse(responses)` | Select a `PickedResponse` from an operation's responses map |
| `PickedResponse` | `{ status, contentType, body, headers, links, schema?, stream? }` |

### Errors

| Export | Description |
|--------|-------------|
| `MockErrorCode` | Union of machine-readable error code strings |
| `MockErrorDetail` | Single field-level error with `path`, `code`, `message`, and optional redacted `received`/`value` summaries plus `expected`/`constraint` |
| `MockValidationResult` | `{ valid: true }` or `{ valid: false; errors: MockErrorDetail[] }` |
| `MockErrorResponse` | Top-level error envelope returned by the adapters (422, 404, and the 500 responses below) |
| `classifyAjvErrors` | Convert raw AJV error objects into `MockErrorDetail[]` |

## Validation errors

Requests are checked in this order: route match, security credentials, `Content-Type`, parameters,
body. The adapters answer:

| Situation | Response |
|-----------|----------|
| No route for the path | 404 with `{ error: { code: 'NOT_FOUND', ... } }` |
| The path exists but not for the method | 405 with an `Allow` header (Node HTTP adapter) |
| A security requirement has no credential | 401: the operation's documented 401 response, or `{ code: 'UNAUTHORIZED', message }`. Only the presence of the credential is checked, not its value |
| Parameters, body, or `Content-Type` fail validation | 422: the operation's documented 422 response when it has one (with `details` when its schema accepts them), otherwise the envelope below |
| A request schema does not compile | 500 with code `SCHEMA_COMPILE_ERROR` |
| The picked response does not satisfy its schema, or no response is defined | 500 |

Otherwise, invalid requests receive a `422` response with this shape:

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
  stage?: 'parse' | 'coerce' | 'validate'
}

type MockReceivedValueSummary =
  | { type: 'string'; length: number }
  | { type: 'array' | 'object'; count: number }
  | { type: 'number' | 'boolean' | 'bigint' | 'symbol' | 'function' | 'null' | 'undefined' }
```

`received` and the legacy `value` alias are intentionally content-free. This
keeps validation output safe to return, serialize, and log when a request
contains passwords, tokens, XML, multipart fields, or nested objects.

The top-level `code` of a 422 envelope is `CONSTRAINT_VIOLATION`; each detail carries its own code.
The `code` values and when they fire:

| Code | Trigger |
|------|---------|
| `TYPE_ERROR` | Field value has the wrong JS type |
| `CONSTRAINT_VIOLATION` | `minimum`, `maxLength`, `minItems`, etc. violated; also the 500 code when a generated response fails its schema |
| `MISSING_REQUIRED_FIELD` | A `required` field, parameter, or body is absent |
| `INVALID_ENUM_VALUE` | Value is not in the declared `enum` |
| `FORMAT_MISMATCH` | `email`, `uuid`, `date-time`, etc. format invalid |
| `PATTERN_MISMATCH` | String does not match `pattern` |
| `PROTOCOL_MISMATCH` | `Content-Type` header does not match any declared request body media type, or a JSON body does not parse |
| `SCHEMA_COMPILE_ERROR` | A request or response schema cannot be compiled (500) |
| `NOT_FOUND` | No route for the path (404), or the operation defines no response (500) |

## OAS 3.2 features supported

| Feature | Behavior |
|---------|----------|
| `examples[n].dataValue` | Used as the response body in preference to `examples[n].value` or `example` |
| `itemSchema` | When present on a streaming schema, each generated event uses `itemSchema` as its schema rather than the container schema |
| `type` as an array (e.g. `["string", "null"]`) | `foldSchema` picks the first element of the array for dispatch |
| Status code selection | `pickResponse` prefers the lowest exact `2xx` code, then the lowest exact code, then range codes (`2XX` → `200`, `4XX` → `400`), and `default` last |
| Internal `$ref` (`#/components/schemas/...`) | Inlined by `DerefFolder` / `derefPass` before validation and generation |
| Circular `$ref` | Detected through a stack of (document, JSON Pointer) keys; replaced with `{}` by default |
