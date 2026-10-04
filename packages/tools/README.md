# @oa-sdk/tools

Universal Tool Engine for Model Context Protocol (MCP), Commander CLI, and Hono REST APIs.

Designed as the high-ROI bridge between **TypeSpec (`.tsp`) / OpenAPI 3.1 / JSON Schema 2020-12** contracts, **AI Agent Tool Servers (MCP)**, and **Interactive Human CLIs**.

---

## Features

- **TypeSpec & Draft 2020-12 First**: Directly consumes TypeSpec compiled JSON Schemas (`$defs` / DTO models) with **0 schema drift** and zero duplicate typing.
- **Pragmatic Schema Bridge (`createSchemaTool`)**:
  - Declaratively `pick` or `omit` fields to maintain a focused 15~25 high-level agent toolset.
  - Override descriptions with LLM-specific prompt instructions (`overrides`).
  - Add agent convenience helper fields (`extend: { isBase64: { type: 'boolean' } }`).
- **Official MCP Protocol Support (`createMcpServer`)**:
  - Low-level `@modelcontextprotocol/sdk` integration.
  - Exposes tools via `tools/list` and executes calls via `tools/call`.
  - Supports standard Stdio and Streamable HTTP transports.
- **Interactive Commander CLI (`createCli`)**:
  - Automatically derives subcommands, positional arguments, and type-coerced flags from schemas.
  - **Interactive Prompt Fallback (`promptMissingFields`)**: Automatically prompts the user for missing required options in TTY environments using Node.js standard `readline/promises` (zero external runtime dependencies).
- **Embedded REST & Documentation**: Serves OpenAPI 3.1 JSON (`/openapi.json`) and Swagger UI (`/docs`) via Hono.

---

## Quick Start: TypeSpec JSON Schema Bridge

When working with `oa-sdk`, TypeSpec compiles models into Draft 2020-12 JSON Schemas (e.g. in `dist/` or `generated/schemas.ts`). You can bridge them directly into MCP Tools and CLI commands without writing redundant Zod schemas:

```typescript
import { createSchemaTool, createToolApp } from '@oa-sdk/tools'

// 1. TypeSpec-generated JSON Schema (from *.schema.json or generated/schemas.ts)
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

// 2. Define an MCP & CLI Tool using the TypeSpec Schema Bridge
export const driveUploadTool = createSchemaTool({
  name: 'drive_upload_file',
  description: 'Upload a file to cloud storage.',
  category: 'drive',
  schema: UploadFileSchema,
  // Omit internal fields not relevant to the AI agent
  omit: ['internalAuditId'],
  // Add agent-tailored instructions
  overrides: {
    content: { description: 'File content (plain text, markdown, or base64)' },
  },
  // Add agent convenience helper options
  extend: {
    isBase64: { type: 'boolean', default: false, description: 'True if content is base64 encoded' },
  },
  cli: {
    command: 'upload',
    arguments: [{ name: 'name', description: 'File name', required: true }],
  },
  async execute(ctx, input) {
    // input is fully validated against the TypeSpec schema
    return `✅ File uploaded: ${input.name}`
  },
})

// 3. Compose Multi-Interface App
const app = createToolApp({
  name: 'drive-tools',
  version: '1.0.0',
}).tools(driveUploadTool)

// Run as MCP Server over stdio for Claude / Gemini / Windsurf / Cursor:
// await app.runMcpStdio()

// Or run as an interactive CLI:
// await app.runCli()
```

---

## CLI Interactive Prompt Fallback

When executed from a terminal (TTY), if required options are omitted, the CLI automatically prompts the user interactively:

```bash
# When executed with all flags:
$ my-cli drive upload my-file.txt --content "Hello World"
✅ File uploaded: my-file.txt

# When executed without required flags in terminal:
$ my-cli drive upload my-file.txt
? content (File content (plain text, markdown, or base64)): Hello World
✅ File uploaded: my-file.txt
```

---

## API Reference

### `createSchemaTool(options)`
- `schema`: TypeSpec JSON Schema Draft 2020-12 object.
- `pick?: string[]`: Include only specified properties.
- `omit?: string[]`: Exclude specified properties (automatically cleans `required`).
- `overrides?: Record<string, Partial<JsonSchemaProperty>>`: Update descriptions or constraints.
- `extend?: Record<string, JsonSchemaProperty>`: Add new properties.
- `execute: (ctx: ToolContext, input: TInput) => Promise<TOutput>`: Handler function.

### `createMcpServer(tools, options)`
- `tools: ToolDefinition[]`: Registered tools.
- `options: McpServerOptions`: Server name, version, host, port, optional `authToken`, `allowedOrigins`, and `maxBodyBytes`.
- Returns `McpServerInstance` with `.runStdio()` and `.serveHttp()`.

HTTP와 MCP 요청은 설정된 Bearer token/origin 정책과 bounded JSON reader를 공유합니다. 입력은
`additionalProperties`, enum, integer, nested object/array까지 protocol boundary에서 검증됩니다.

### `createCli(tools, options)`
- `tools: ToolDefinition[]`: Registered tools.
- `options: CliAdapterOptions`: CLI name, version, output format, interactive flag.
- Returns a Commander.js `Command` instance with full subcommand routing and prompt fallbacks.
