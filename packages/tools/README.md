# @oa-sdk/tools

Define a tool once, with a JSON Schema (Draft 2020-12) or Zod input schema, and serve it as a Model
Context Protocol (MCP) tool, a Commander CLI command, and a Hono REST route with OpenAPI 3.1 output.

You write each tool yourself with `defineTool()` or `createSchemaTool()`. The package does not
generate tools from an OpenAPI or TypeSpec contract; `createSchemaTool()` wraps a JSON Schema object
you pass in, such as a component schema emitted from your TypeSpec or OpenAPI source.

> This README describes the package source, which includes changes made after 0.1.1, the version
> currently on npm. They are listed in [Changes since 0.1.1](#changes-since-011); several of them
> change default behavior.

---

## Installation

```bash
npm install @oa-sdk/tools
```

Requires Node.js 22 or later.

| Optional package | When you need it |
|---|---|
| `zod` (`>=3.0.0`, optional peer) | Tools whose `inputSchema` is a Zod schema |
| `@oa-sdk/chunk-stream-ui` | `createChunkStreamTools()` building a stream from `getDocument`, and type-checking with `skipLibCheck: false` (its declarations import types from it). Not a dependency; install it yourself |
| `@oa-sdk/peer-transport` | Used by `createWebMcpPeerApp()` when it can be imported next to this package; otherwise a built-in client is used. Not a dependency, and not on npm yet |

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
  async execute(ctx, input) {
    // input has passed JSON Schema validation
    return `File uploaded: ${input.name}`
  },
})

const app = createToolApp({ name: 'drive-tools', version: '1.0.0' }).tools(driveUploadTool)

// await app.runMcpStdio()            // MCP over stdio (Claude Desktop, Cursor, ...)
// await app.serveMcp({ port: 3333 }) // MCP over HTTP (stateless)
// await app.serveApi({ port: 3000 }) // REST API + OpenAPI + Swagger UI + MCP endpoint
// await app.runCli()                 // Commander CLI
```

Handlers are always called as `execute(ctx, input)`. Wrap a handler written input-first with
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

Route statuses follow `api.statusCodes`: `created` for a `POST` tool that sets it, otherwise `success`
(default 200), `validationError` (default 400) for invalid input, and `serverError` (default 500)
when the tool throws.

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
- `adaptInputFirstHandler(handler)`, `executeTool()`, `composeToolMiddleware()`, `createToolContext()`.

### `createToolApp(config)` → `ToolApp`

`tools(...defs)`, `getTools()`, `getTool(name)`, `buildMcp(options?)`, `runMcpStdio(options?)`,
`serveMcp(options?)` (resolves with the Node `http.Server`), `mountMcpRoute(app, path?, options?)`,
`buildCli(options?)`, `runCli(argv?, options?)`, `buildApi(options?)`, `serveApi(options?)`.

### MCP

- `createMcpServer(tools, options)` → `McpServerInstance` with `runStdio()`, `serveHttp(options?)`,
  `dispatcher`, `handleFetch(request)`, `handleNode(req, res)`, `getTools()`.
  `McpServerOptions`: `name`, `version?`, `description?`, `port?`, `hostname?`, `authToken?`,
  `allowedOrigins?`, `maxBodyBytes?`, `publicHealth?`.
- `createStatelessMcpDispatcher()`, `MCP_PROTOCOL_VERSION_2026_07_28`, `McpHeaders`.

### CLI and HTTP

- `createCli(tools, { name?, version?, description?, outputFormat?, interactive? })` → a Commander
  `Command`; `promptMissingFields()`.
- `createHttpApp(tools, options)` → Hono app; `serveHttpApp(tools, options)` starts it.
  `HttpAdapterOptions`: `title?`, `version?`, `description?`, `port?`, `hostname?`, `enableMcp?`,
  `mcpPath?`, `onListen?`, `authToken?`, `allowedOrigins?`, `maxBodyBytes?`, `publicHealth?`.
- Boundary helpers: `authorizeToolHttpRequest()`, `readToolJsonRequest()`, `readToolNodeJsonRequest()`,
  `validateToolHttpOptions()`, `ToolHttpError`.
- Schema helpers: `createJsonSchemaValidator()`, `validateToolInput()`, `normalizeJsonSchema()`,
  `isZodSchema()`.

### Chunk streams and WebMCP peers

- `createChunkStreamTools(options)`, `registerChunkStreamTools(app, options)`.
- `createWebMcpPeerApp(options)`, `WebMcpPeerBridgeClient`. A present non-array `allowedTools` value
  in a peer document (including `null`) is treated as an empty allow-list.

---

## Changes since 0.1.1

These apply from the release after 0.1.1:

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
