# @oa-sdk/tools

Define a tool once, with a JSON Schema (Draft 2020-12) or Zod input schema, and serve it as a Model
Context Protocol (MCP) tool, a Commander CLI command, and a Hono REST route with OpenAPI 3.1 output.

You write each tool yourself with `defineTool()` or `createSchemaTool()`. The package does not
generate tools from an OpenAPI or TypeSpec contract; `createSchemaTool()` wraps a JSON Schema object
you pass in, such as a component schema emitted from your TypeSpec or OpenAPI source.

> npm has 0.2.0. This README describes the 0.2.0 surface; 0.2.1 is a dependency-only patch that is
> not on npm yet. If you install 0.1.1, read [Upgrading from 0.1.1](#upgrading-from-011) first: its
> HTTP servers have none of the [HTTP boundary](#http-boundary) checks, so they accept any `Origin`,
> have no bearer token option, and answer a thrown tool error with the exception message.

---

## Installation

```bash
npm install @oa-sdk/tools
```

This installs 0.2.0, which requires Node.js 22 or later. (0.1.1 also needed
`@oa-sdk/chunk-stream-ui`; see [Upgrading from 0.1.1](#upgrading-from-011).)

| Optional package | When you need it |
|---|---|
| `zod` (`>=3.0.0`, optional peer) | Tools whose `inputSchema` is a Zod schema |
| `@oa-sdk/chunk-stream-ui` | `createChunkStreamTools()` building a stream from `getDocument`, and type-checking with `skipLibCheck: false` (its declarations import types from it). Not a dependency; install it yourself. 0.1.1 needed it to load at all |
| `@oa-sdk/peer-transport` | Used by `createWebMcpPeerApp()` when it can be imported next to this package; otherwise a built-in client is used. Not a dependency |

---

## Quick start

```ts
import { createSchemaTool, createToolApp } from '@oa-sdk/tools'

// A JSON Schema object, e.g. a component schema from your contract
const UploadFileSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'File name with extension' },
    content: { type: 'string', description: 'File content payload' },
    folderId: { type: 'string', description: 'Parent folder ID' },
    internalAuditId: { type: 'string', description: 'Internal audit secret' },
  },
  required: ['name', 'content'],
}

export const driveUploadTool = createSchemaTool({
  name: 'drive_upload_file',
  description: 'Upload a file to cloud storage.',
  category: 'drive',
  schema: UploadFileSchema,
  omit: ['internalAuditId'], // drop fields the agent should not see (also from `required`)
  overrides: {
    content: { description: 'File content (plain text, markdown, or base64)' },
  },
  extend: {
    isBase64: { type: 'boolean', default: false, description: 'True if content is base64 encoded' },
  },
  cli: {
    command: 'upload',
    arguments: [{ name: 'name', description: 'File name', required: true }],
  },
  execute: async (ctx, input) => {
    // input has passed JSON Schema validation
    return `File uploaded: ${input.name}`
  },
})

const app = createToolApp({ name: 'drive-tools', version: '1.0.0' }).tools(driveUploadTool)

// await app.runMcpStdio()            // MCP over stdio (Claude Desktop, Cursor, ...)
// await app.serveMcp({ port: 3333 }) // MCP over HTTP
// await app.serveApi({ port: 3000 }) // REST API + OpenAPI + Swagger UI (+ MCP endpoint)
// await app.runCli()                 // Commander CLI
```

Handlers are called as `execute(ctx, input)`. 0.1.1 instead picks the argument order from the
handler's source text ([Upgrading from 0.1.1](#upgrading-from-011)); the arrow function above works
with both versions. Wrap a handler written input-first with
`adaptInputFirstHandler((input, ctx) => ...)`.

### Interactive CLI prompts

In a terminal (TTY), the CLI prompts for required options that were not given:

```bash
$ my-cli drive upload my-file.txt
? content (File content (plain text, markdown, or base64)): Hello World
File uploaded: my-file.txt
```

---

## MCP over HTTP

`McpServerInstance.serveHttp()`, `ToolApp.serveMcp()`, and `createHttpApp()` serve a stateless MCP
2026-07-28 JSON-RPC endpoint at `POST /mcp`:

- Methods: `initialize`, `ping`, `tools/list`, `tools/call`, `server/discover`.
- No sessions (`Mcp-Session-Id`) and no streaming: `GET /mcp` answers 404.
- Responses carry `MCP-Protocol-Version: 2026-07-28`. Optional `Mcp-Method` and `Mcp-Name` request
  headers must match the body.
- The MCP server's `/health` reports `protocolVersion`.
- Mount the endpoint elsewhere with `ToolApp.mountMcpRoute(honoApp, path?, options?)`, or with
  `createMcpServer(...).handleFetch(request)` / `.handleNode(req, res)`. `createHttpApp()` mounts it
  unless `enableMcp: false`; `mcpPath` moves it.

## REST API

`createHttpApp(tools, options)` (or `ToolApp.buildApi()` / `serveApi()`) returns a Hono app:

| Route | Description |
|---|---|
| `/{category}/{name}` and `/api/v1/{category}/{name}` | One route per tool (`api.path` overrides it). `GET` for tools with `hints.readOnly`, otherwise `POST`, unless `api.method` is set |
| `/openapi.json`, `/api/v1/openapi.json` | OpenAPI 3.1 document of the routes |
| `/docs`, `/api/v1/docs` | Swagger UI |
| `/health` | `{ status, service, version, toolsCount }` |
| `POST /mcp` | The MCP endpoint above |

Route statuses follow `api.statusCodes`: `created` for a `POST` tool that sets it,
otherwise `success` (default 200), `validationError` (default 400) for invalid input, and
`serverError` (default 500) when the tool throws. 0.1.1 ignores `api.statusCodes`.

`serveApi()`, `serveHttpApp()`, `serveMcp()`, and `serveHttp()` listen on `0.0.0.0` unless you pass
`hostname`.

## HTTP boundary

Both the REST app and the MCP HTTP server apply the same request checks:

- **Origin**: a request with an `Origin` header gets 403 unless the origin is in `allowedOrigins`
  (empty by default), so browser clients must be listed.
- **Bearer token**: with `authToken`, the tool routes, `/openapi.json`, `/docs`, and the MCP endpoint
  require `Authorization: Bearer <token>` (401 otherwise), and the OpenAPI output declares a
  `bearerAuth` scheme. `/health` stays public unless `publicHealth: false`.
- **Body size**: JSON bodies above `maxBodyBytes` (default 1 MiB) get 413.
- **Body shape**: a REST request other than `GET` must send a JSON object; a missing or malformed body
  gets 400.
- **Input validation**: JSON Schema inputs are validated with Ajv (Draft 2020-12, with formats);
  `additionalProperties`, enums, nested objects and arrays are enforced.
- **Error masking**: a tool that throws is reported as `Tool execution failed (requestId: <id>)` over
  REST and MCP, not with the exception message.

---

## API reference

### Defining tools

- `defineTool({ name, description, category?, inputSchema, outputSchema?, execute, hints?, cli?, api?, mcp?, middleware? })`:
  a tool with a JSON Schema or Zod `inputSchema`.
- `createSchemaTool({ name, description, schema, pick?, omit?, overrides?, extend?, execute, ... })`:
  a tool built from a JSON Schema object. `pick`/`omit` select properties (`omit` also cleans
  `required`), `overrides` patches property schemas, `extend` adds properties.
- `executeTool()`, `composeToolMiddleware()`, `createToolContext()`;
  `adaptInputFirstHandler(handler)`.

### `createToolApp(config)` → `ToolApp`

`tools(...defs)`, `getTools()`, `getTool(name)`, `buildMcp(options?)`, `runMcpStdio(options?)`,
`serveMcp(options?)`, `buildCli(options?)`, `runCli(argv?, options?)`, `buildApi(options?)`,
`serveApi(options?)`. `serveMcp()` takes `McpServerOptions` and resolves with the
Node `http.Server`; `mountMcpRoute(app, path?, options?)`.

### MCP

- `createMcpServer(tools, options)` → `McpServerInstance` with `runStdio()`, `serveHttp(options?)`,
  `getTools()`; `dispatcher`, `handleFetch(request)`, `handleNode(req, res)`.
  `McpServerOptions`: `name`, `version?`, `description?`, `port?`, `hostname?`;
  `authToken?`, `allowedOrigins?`, `maxBodyBytes?`, `publicHealth?`.
- `createStatelessMcpDispatcher()`, `MCP_PROTOCOL_VERSION_2026_07_28`, `McpHeaders`.

### CLI and HTTP

- `createCli(tools, { name?, version?, description?, outputFormat?, interactive? })` → a Commander
  `Command`; `promptMissingFields()`.
- `createHttpApp(tools, options)` → Hono app; `serveHttpApp(tools, options)` starts it.
  `HttpAdapterOptions`: `title?`, `version?`, `description?`, `port?`, `hostname?`, `onListen?`;
  `enableMcp?`, `mcpPath?`, `authToken?`, `allowedOrigins?`, `maxBodyBytes?`,
  `publicHealth?`.
- Boundary helpers: `authorizeToolHttpRequest()`, `readToolJsonRequest()`,
  `readToolNodeJsonRequest()`, `validateToolHttpOptions()`, `ToolHttpError`.
- Schema helpers: `validateToolInput()`, `normalizeJsonSchema()`, `isZodSchema()`;
  `createJsonSchemaValidator()`.

### Chunk streams and WebMCP peers

- `createChunkStreamTools(options)`, `registerChunkStreamTools(app, options)`.
- `createWebMcpPeerApp(options)`, `WebMcpPeerBridgeClient`. A present non-array
  `allowedTools` value in a peer document (including `null`) is treated as an empty allow-list.

---

## Upgrading from 0.1.1

0.1.1 is the previous release. Compared with 0.2.0:

- Install `@oa-sdk/chunk-stream-ui` with it. 0.1.1 imports that package when it loads and fails with
  `ERR_MODULE_NOT_FOUND` without it:

  ```bash
  npm install @oa-sdk/tools@0.1.1 @oa-sdk/chunk-stream-ui@0.1.0
  ```

- Write `execute` as a function whose first parameter is named `ctx`, such as
  `execute: async (ctx, input) => ...`. 0.1.1 reads the handler's source text and calls it as
  `execute(input, ctx)` unless the text starts with a `ctx` (or `_ctx`) parameter, so a method
  `async execute(ctx, input) { ... }` receives the input as `ctx`.
- The HTTP servers (`serveApi()`, `serveHttpApp()`, `serveMcp()`, `serveHttp()`) do none of the
  [HTTP boundary](#http-boundary) checks: no `Origin` check, no `authToken`, no body size
  limit. A tool that throws reports its exception message (over REST, 500
  `{ "error": <the exception message> }`), and JSON Schema inputs get only shallow top-level checks.
  They listen on `0.0.0.0` by default; pass `hostname: '127.0.0.1'` and keep them off untrusted
  networks.
- `serveHttp()` and `serveMcp()` serve MCP Streamable HTTP with `Mcp-Session-Id` sessions, and
  `createHttpApp()` has no MCP endpoint.

### Changes in 0.2.0

- `serveHttp()` serves the stateless MCP 2026-07-28 endpoint described above instead of
  `Mcp-Session-Id` sessions; `/health` reports `protocolVersion` instead of `activeSessions`.
- `createHttpApp()` mounts the MCP endpoint at `POST /mcp` by default.
- The HTTP boundary: `allowedOrigins` (requests with an `Origin` header are rejected by default),
  `authToken`, `maxBodyBytes`, and the JSON object body rule.
- Thrown tool errors are masked as `Tool execution failed (requestId: <id>)`.
- REST routes honor `api.statusCodes` (a `POST` tool with `created: 201` now answers 201).
- JSON Schema inputs are validated in full with Ajv instead of shallow top-level type checks.
- `executeTool()` always calls `execute(ctx, input)`; it no longer guesses the argument order from the
  handler's source text.
- `@oa-sdk/chunk-stream` and `@oa-sdk/chunk-stream-ui` are no longer optional peer dependencies.
