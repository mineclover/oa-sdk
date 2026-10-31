import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import type { OasDocument } from '@oa-sdk/parser'
import { generateClient } from '../index.js'

const fullFeatureSpec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'ExactOptionalPropertyTypes Verification API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      basicAuth: { type: 'http', scheme: 'basic' },
      headerKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      cookieKey: { type: 'apiKey', in: 'cookie', name: 'session_token' },
    },
  },
  paths: {
    '/tasks/{taskId}': {
      get: {
        operationId: 'getTask',
        parameters: [
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'includeMeta', in: 'query', required: false, schema: { type: 'boolean' } },
          { name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Task detail',
            headers: {
              'X-Rate-Limit': { schema: { type: 'integer' } },
              'X-Tags': { schema: { type: 'array', items: { type: 'string' } } },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      patch: {
        operationId: 'updateTask',
        parameters: [
          { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '204': { description: 'Updated' },
        },
      },
    },
    '/tasks': {
      post: {
        operationId: 'createTask',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/search': {
      get: {
        operationId: 'rawSearch',
        parameters: [
          { name: 'raw', in: 'querystring', required: false, content: { 'application/x-www-form-urlencoded': {} } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    '/events/sse': {
      get: {
        operationId: 'streamTaskSse',
        parameters: [
          { name: 'topic', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'SSE stream',
            content: {
              'text/event-stream': {
                schema: {
                  type: 'object',
                  required: ['seq'],
                  properties: { seq: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
    '/events/ndjson': {
      get: {
        operationId: 'streamTaskNdjson',
        responses: {
          '200': {
            description: 'NDJSON stream',
            content: {
              'application/x-ndjson': {
                schema: {
                  type: 'object',
                  required: ['seq'],
                  properties: { seq: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
  },
  webhooks: {
    taskChanged: {
      post: {
        operationId: 'onTaskChanged',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id'],
                properties: {
                  id: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

const companionTypesModule = `
export type GetTaskPathParams = { taskId: string }
export type GetTaskQueryParams = { includeMeta?: boolean | undefined }
export type GetTaskHeaderParams = { 'X-Trace-Id'?: string | undefined }
export type GetTaskResponse = { id: string; title: string }
export type GetTaskResponseHeaders = { 'X-Rate-Limit'?: number | undefined; 'X-Tags'?: string[] | undefined }
export type GetTaskErrorByStatus = { 404: { code: string; message: string } }
export type GetTaskError = GetTaskErrorByStatus[404]

export type UpdateTaskPathParams = { taskId: string }
export type UpdateTaskBody = { title?: string | undefined }

export type CreateTaskBody = { title: string }
export type CreateTaskResponse = { id: string; title: string }

export type RawSearchQueryString = string
export type RawSearchResponse = string[]

export type StreamTaskSseQueryParams = { topic?: string | undefined }
export type StreamTaskSseResponse = { seq: number }

export type StreamTaskNdjsonResponse = { seq: number }
`

function compileWithExactOptionalPropertyTypes(rootDir: string, entryFiles: string[]): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    skipLibCheck: false,
    noEmit: true,
  }

  const program = ts.createProgram(entryFiles.map(file => join(rootDir, file)), options)
  const diagnostics = ts.getPreEmitDiagnostics(program)

  return diagnostics.map(diag => {
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
    if (!diag.file || diag.start === undefined) return `TS${diag.code}: ${msg}`
    const pos = diag.file.getLineAndCharacterOfPosition(diag.start)
    return `${diag.file.fileName}:${pos.line + 1}:${pos.character + 1} - TS${diag.code}: ${msg}`
  })
}

describe('generateClient exactOptionalPropertyTypes compatibility', () => {
  let scratchDir = ''

  beforeAll(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'oa-client-exact-optional-'))
  })

  afterAll(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
  })

  it('compiles typed and untyped generated clients with zero diagnostics under exactOptionalPropertyTypes: true', () => {
    const typedClientCode = generateClient(fullFeatureSpec, { typesImport: './types.js' })
    const untypedClientCode = generateClient(fullFeatureSpec)

    const consumerCode = `
import {
  createClient,
  ClientError,
  bearerAuth,
  isGetTaskClientError,
  type ClientConfig,
  type ClientMethodOptions,
  type ClientMiddleware,
} from './typed-client.js'
import { createClient as createUntypedClient } from './untyped-client.js'

const explicitUndefinedMiddleware: ClientMiddleware = {
  onRequest: undefined,
  onResponse: undefined,
  onError: undefined,
}

const explicitUndefinedConfig: ClientConfig = {
  baseUrl: undefined,
  headers: undefined,
  middleware: [bearerAuth('token'), explicitUndefinedMiddleware],
  timeout: undefined,
  retry: { maxRetries: undefined, baseDelay: undefined },
  validate: true,
  codecs: undefined,
}

const explicitUndefinedOptions: ClientMethodOptions = {
  signal: undefined,
  headers: undefined,
}

export async function verifyClientCalls(): Promise<void> {
  const client = createClient(explicitUndefinedConfig)
  const untyped = createUntypedClient()
  const controller = new AbortController()

  const detail = await client.getTask(
    { taskId: 'task-1' },
    { includeMeta: undefined },
    { 'X-Trace-Id': undefined },
    explicitUndefinedOptions,
  )
  void detail.id

  const withHeaders = await client.withResponse.getTask(
    { taskId: 'task-1' },
    undefined,
    undefined,
    { signal: controller.signal },
  )
  void withHeaders.headers['X-Rate-Limit']

  await client.updateTask({ taskId: 'task-1' }, undefined, explicitUndefinedOptions)
  await client.createTask({ title: 'Ship' }, { signal: null })
  await client.rawSearch(undefined, explicitUndefinedOptions)
  await untyped.getTask({ taskId: 'task-1' })

  for await (const chunk of client.streamTaskSse(undefined, explicitUndefinedOptions)) {
    void chunk
  }
  for await (const chunk of client.streamTaskNdjson(explicitUndefinedOptions)) {
    void chunk
  }

  const err = new ClientError(404, { code: 'NOT_FOUND', message: 'Missing' }, new Response(), undefined)
  if (isGetTaskClientError(err, 404)) {
    void err.body.code
  }
}
`

    writeFileSync(join(scratchDir, 'package.json'), JSON.stringify({ type: 'module' }))
    writeFileSync(join(scratchDir, 'types.ts'), companionTypesModule)
    writeFileSync(join(scratchDir, 'typed-client.ts'), typedClientCode)
    writeFileSync(join(scratchDir, 'untyped-client.ts'), untypedClientCode)
    writeFileSync(join(scratchDir, 'consumer.ts'), consumerCode)

    const errors = compileWithExactOptionalPropertyTypes(scratchDir, [
      'types.ts',
      'typed-client.ts',
      'untyped-client.ts',
      'consumer.ts',
    ])

    expect(errors).toEqual([])
  })
})
