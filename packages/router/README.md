# @oa-sdk/router

OpenAPI 3.1 and 3.2 multi-framework router generator and framework-independent pure TypeScript handler contract engine.

## Overview

`@oa-sdk/router` translates normalized OpenAPI 3.1 and 3.2 operations into typed route handlers and decoupled handler contracts for **Hono**, **Express**, **Fastify**, and **Bun Elysia** applications.

It operates in two complementary paradigms:
1. **Framework Router Binding (`generateRouter`)**: Renders framework-specific router definitions (Hono, Express, Fastify plugin, Bun Elysia instance) bound to typed handlers.
2. **Pure Handler Contract Generation (`generateHandlerContract`)**: Emits framework-independent pure TypeScript handler signatures (`*.contract.ts`), completely decoupling business logic from routing plumbing.

The generators run at build time and depend only on `@oa-sdk/core` and `@oa-sdk/parser`. Generated handler contracts import no framework; a generated router imports the framework it targets.

## Features

- **Multi-Framework Targets**:
  - **Fastify**: `FastifyPluginAsync` with inlined JIT JSON Schema compilation for `fast-json-stringify` 2-3x serialization speedups.
  - **Bun Elysia**: Fluent builder chaining with selective zero-copy context destructuring (only accesses used fields, preventing `TS6133` unused parameter warnings).
  - **Hono**: Idiomatic `Hono` app with `c.body(...)` binary/stream routing and `app.on(...)` verb dispatch.
  - **Express**: Standard `Router` with method guards and piped/chunked streaming support.
- **First-Class Streaming & HTTP 206 Partial Content**:
  - `StreamingBody` contract supporting `AsyncIterable<Uint8Array | string>`, `ReadableStream`, `NodeJS.ReadableStream`, `{ pipe(destination: any): any }`, and `Uint8Array`.
  - `StreamingResponse` envelope for HTTP 200/206 streaming and range request handling.
  - Transparent framework adaptation (e.g. `c.body()` on Hono, chunk iteration on Express).
- **Decoupled Pure Handler Contracts (`*.contract.ts`)**:
  - Eliminates codegen overwrite issues by isolating business logic into `ApiHandlers`.
  - Pure context parameters (`params`, `query`, `querystring`, `headers`, `body`) without framework object leakage.
  - Multi-status typed error unions (`HandlerResponse<TSuccess, TErrorMap>`) with 100% compile-time type safety.
- **Strict Envelope Collision Defense**:
  - 3-part heuristic (`'body' in result && typeof status === 'number' && typeof headers === 'object'`) ensuring business entities with `status` (e.g. `'ACTIVE'`) or `body` fields are never mistaken for HTTP envelopes.
- **OAS 3.2 Non-Standard Verbs**:
  - First-class support for `HEAD`, `TRACE`, and `QUERY` methods across all supported routers.
  - Raw querystring parameter extraction (`in: 'querystring'`).

## Installation

```bash
npm install --save-dev @oa-sdk/router
```

`oa-gen generate` from `@oa-sdk/codegen` loads this package as a companion package to emit handler contracts and routers. Within the `oa-sdk` monorepo, build it with `pnpm --filter @oa-sdk/router build`.

## Quick Start

### 1. Generating Pure Handler Contracts

```typescript
import { generateHandlerContract } from '@oa-sdk/router'
import { parseDocument } from '@oa-sdk/parser'

const contractSource = generateHandlerContract(spec, {
  typesImport: './types.js',
  contractName: 'OrderApiHandlers',
})
```

Generated contract (`orders.contract.ts`):

```typescript
export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
  | TSuccess
  | { status: 200; body: TSuccess; headers?: THeaders }
  | StreamingResponse<THeaders>
  | { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]

export interface OrderApiHandlers {
  getOrder(ctx: GetOrderContext): Promise<HandlerResponse<Order, { 404: NotFoundError }>>
  streamLogs(ctx: StreamLogsContext): Promise<HandlerResponse<StreamingResponse>>
}
```

### 2. Streaming Responses & HTTP 206 Partial Content

Handlers can return real-time asynchronous streams or range chunks by returning a `StreamingResponse`:

```typescript
import type { OrderApiHandlers, StreamingResponse } from './orders.contract.js'

export const handlers: OrderApiHandlers = {
  async getOrder({ params }) {
    const order = await db.orders.find(params.id)
    if (!order) return { status: 404, body: { code: 'NOT_FOUND', message: 'Order not found' } }
    return order // HTTP 200 raw data
  },

  async streamLogs({ params }): Promise<StreamingResponse> {
    const logStream = createLogReadableStream(params.id)
    return {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: logStream, // ReadableStream or AsyncIterable<Uint8Array>
    }
  },

  async downloadRange({ headers }): Promise<StreamingResponse> {
    const chunk = await readFileChunk(headers['Range'])
    return {
      status: 206, // Partial Content
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': 'bytes 0-1023/4096',
        'Accept-Ranges': 'bytes',
      },
      body: chunk, // Uint8Array or AsyncIterable
    }
  },
}
```

### 3. Binding to Framework Routers

#### Fastify

```typescript
import Fastify from 'fastify'
import { generateRouter } from '@oa-sdk/router'
import { handlers } from './orders.service.js'

const fastifySource = generateRouter(spec, {
  target: 'fastify',
  typesImport: './types.js',
  contractImport: './orders.contract.js',
})
```

#### Hono

```typescript
import { Hono } from 'hono'
import { generateRouter } from '@oa-sdk/router'

const honoSource = generateRouter(spec, {
  target: 'hono',
  typesImport: './types.js',
  contractImport: './orders.contract.js',
})
```

## API Reference

### `generateRouter(spec, options)`

Generates framework router binding source code.

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `'hono' \| 'express' \| 'fastify' \| 'elysia'` | `'hono'` | Target framework router |
| `mode` | `'stub' \| 'contract'` | `'stub'` | Standalone stub or bound to handler contract |
| `typesImport` | `string` | — | Path to import generated API types |
| `contractImport` | `string` | — | Path to import handler contract |
| `contractName` | `string` | `'ApiHandlers'` | Aggregate handlers interface name |
| `banner` | `boolean` | `true` | Include header comment banner |
| `basePath` | `string` | — | Base path for resolving relative external $refs |

### `generateHandlerContract(spec, options)`

Generates decoupled pure TypeScript handler contract signatures.

| Option | Type | Default | Description |
|---|---|---|---|
| `typesImport` | `string` | — | Path to import generated API types |
| `contractName` | `string` | `'ApiHandlers'` | Aggregate handlers interface name |
| `banner` | `boolean` | `true` | Include header comment banner |
| `basePath` | `string` | — | Base path for resolving relative external $refs |
