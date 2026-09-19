# @oa-sdk/tools

Universal Tool Engine for Model Context Protocol (MCP), Commander CLI, and Hono REST APIs.

## Features

- **MCP Protocol Native**: Low-level JSON-RPC protocol server integration with full Model Context Protocol compliance.
- **TypeSpec & OpenAPI 3.1 First**: Accepts pure JSON Schema Draft 2020-12 and OpenAPI 3.1 objects without forcing runtime Zod constraints.
- **Zero-Bloat Multi-Interface**:
  - Expose tools as MCP servers over stdio or Streamable HTTP.
  - Expose tools as typed CLI subcommands with Commander.js.
  - Expose tools as REST endpoints with Hono, OpenAPI 3.1 JSON (`/openapi.json`), and Swagger UI (`/docs`).
- **Flexible Schema Support**: Supports both pure TypeSpec / JSON Schema 2020-12 objects and Zod schemas with automatic inference.

## Quick Start

```typescript
import { createToolApp, defineTool } from '@oa-sdk/tools'
import { z } from 'zod'

const echoTool = defineTool({
  name: 'echo',
  description: 'Echoes back the message',
  inputSchema: z.object({ message: z.string() }),
  execute: async (ctx, input) => {
    return { echo: input.message }
  }
})

const app = createToolApp({
  name: 'my-service',
  version: '1.0.0',
}).tools(echoTool)

// Run as MCP server on stdio:
await app.runMcpStdio()

// Or run as CLI:
// await app.runCli()

// Or serve as HTTP REST API:
// await app.serveApi({ port: 3000 })
```
