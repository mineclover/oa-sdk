/**
 * Fixture for the adapter response-bytes regression tests.
 *
 * One spec exercises every way a mock response body is produced (media type
 * examples, schema generation, response headers, XML/text/stream
 * serialization) and every request-validation outcome (default 422 envelope,
 * documented 422 with and without validation details, 401 for missing
 * credentials, response-schema violations), so a transcript of requests
 * against it pins the exact wire output of both adapters.
 */
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

const widgetSchema: OasSchema = {
  type: 'object',
  required: ['id', 'name', 'kind', 'createdAt', 'tags', 'owner', 'size', 'status', 'flags', 'variant', 'level'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 3 },
    kind: { type: 'string', enum: ['basic', 'premium'] },
    createdAt: { type: 'string', format: 'date-time' },
    tags: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } },
    owner: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        homepage: { type: 'string', format: 'uri' },
        nickname: { type: 'string' },
      },
    },
    size: { type: 'integer', minimum: 1 },
    ratio: { type: 'number', minimum: 0.5 },
    notes: { type: ['string', 'null'] },
    status: { const: 'active' },
    flags: {
      allOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'boolean' } } },
        { type: 'object', required: ['b'], properties: { b: { type: 'integer', default: 7 } } },
      ],
    },
    variant: { oneOf: [{ type: 'string', format: 'date' }, { type: 'integer' }] },
    level: { type: 'integer', example: 42 },
    nested: {
      type: 'object',
      properties: {
        deep: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      },
    },
  },
}

const errorSchema: OasSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', example: 'INVALID_INPUT' },
    message: { type: 'string' },
    details: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
          received: {},
          expected: { type: 'string' },
        },
      },
    },
  },
}

const strictErrorSchema: OasSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', example: 'STRICT_INVALID' },
    message: { type: 'string', minLength: 2 },
  },
}

const createBodySchema: OasSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'size'],
  properties: {
    name: { type: 'string', minLength: 1 },
    size: { type: 'integer', minimum: 1 },
    callbackUrl: { type: 'string', format: 'uri' },
  },
}

const createRequestBody = {
  required: true,
  content: { 'application/json': { schema: createBodySchema } },
}

const json = (schema: OasSchema) => ({ 'application/json': { schema } })

export function createResponseBytesSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Response bytes', version: '1.0.0' },
    servers: [{ url: 'https://api.example.test/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths: {
      '/examples/value': {
        get: {
          operationId: 'exampleValue',
          responses: {
            '200': {
              description: 'OK',
              headers: {
                'X-Rate-Limit': { schema: { type: 'integer', minimum: 10 } },
                'X-Trace': { example: 'trace-123', schema: { type: 'string' } },
              },
              content: {
                'application/json': {
                  examples: {
                    first: { value: { source: 'value', n: 1 } },
                    second: { value: { source: 'second', n: 2 } },
                  },
                },
              },
            },
          },
        },
      },
      '/examples/data-value': {
        get: {
          operationId: 'exampleDataValue',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  examples: { first: { dataValue: { source: 'dataValue' }, value: { source: 'value' } } },
                },
              },
            },
          },
        },
      },
      '/examples/inline': {
        get: {
          operationId: 'exampleInline',
          responses: {
            '200': { description: 'OK', content: { 'application/json': { example: [1, 2, 3] } } },
          },
        },
      },
      '/widgets': {
        post: {
          operationId: 'createWidget',
          requestBody: createRequestBody,
          callbacks: {
            created: {
              '{$request.body#/callbackUrl}': {
                post: {
                  operationId: 'widgetCreatedCallback',
                  requestBody: {
                    content: { 'application/json': { schema: { type: 'object', required: ['event'], properties: { event: { type: 'string', enum: ['widget.created'] } } } } },
                  },
                  responses: { '204': { description: 'Received' } },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              headers: { 'X-Request-Id': { schema: { type: 'string', format: 'uuid' } } },
              content: json(widgetSchema),
            },
            '422': { description: 'Invalid', content: json(errorSchema) },
          },
        },
      },
      '/widgets/{widgetId}': {
        parameters: [{ name: 'widgetId', in: 'path', required: true, schema: { type: 'string', minLength: 2 } }],
        get: {
          operationId: 'getWidget',
          responses: {
            '200': { description: 'OK', content: json(widgetSchema) },
            '404': { description: 'Missing', content: json(errorSchema) },
          },
        },
        delete: {
          operationId: 'deleteWidget',
          responses: { '204': { description: 'Deleted' } },
        },
      },
      '/gadgets': {
        post: {
          operationId: 'createGadget',
          requestBody: createRequestBody,
          responses: {
            '201': { description: 'Created', content: { 'application/json': { example: { id: 'gadget-1' } } } },
            '422': { description: 'Invalid', content: json(strictErrorSchema) },
          },
        },
      },
      '/plain': {
        post: {
          operationId: 'createPlain',
          requestBody: createRequestBody,
          responses: {
            '201': { description: 'Created', content: { 'application/json': { example: { id: 'plain-1' } } } },
          },
        },
      },
      '/search': {
        get: {
          operationId: 'searchWidgets',
          parameters: [
            { name: 'limit', in: 'query', required: true, schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
            { name: 'X-Tenant', in: 'header', schema: { type: 'string', pattern: '^[a-z]+$' } },
          ],
          responses: {
            '200': { description: 'OK', content: json({ type: 'array', minItems: 1, items: widgetSchema }) },
          },
        },
      },
      '/secure': {
        get: {
          operationId: 'getSecure',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { example: { secret: true } } } },
            '401': {
              description: 'Unauthorized',
              content: { 'application/json': { example: { code: 'UNAUTHORIZED', message: 'documented' } } },
            },
          },
        },
      },
      '/secure-default': {
        get: {
          operationId: 'getSecureDefault',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { example: { secret: true } } } },
          },
        },
      },
      '/broken': {
        get: {
          operationId: 'getBroken',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } },
                  example: { count: 'not-a-number' },
                },
              },
            },
          },
        },
      },
      '/range': {
        get: {
          operationId: 'getRange',
          responses: {
            '2XX': { description: 'OK', content: json({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, extra: { type: 'string' } } }) },
          },
        },
      },
      '/fallback': {
        get: {
          operationId: 'getFallback',
          responses: {
            default: { description: 'Any', content: { 'application/json': { example: { fallback: true } } } },
          },
        },
      },
      '/text': {
        get: {
          operationId: 'getText',
          responses: {
            '200': { description: 'OK', content: { 'text/plain': { schema: { type: 'string', minLength: 4 } } } },
          },
        },
      },
      '/xml': {
        get: {
          operationId: 'getXml',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/xml': {
                  schema: {
                    type: 'object',
                    xml: { name: 'widget' },
                    required: ['id', 'label'],
                    properties: {
                      id: { type: 'integer', minimum: 5, xml: { attribute: true } },
                      label: { type: 'string', minLength: 2 },
                      hint: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/events': {
        get: {
          operationId: 'streamEvents',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'text/event-stream': {
                  itemSchema: { type: 'object', required: ['seq'], properties: { seq: { type: 'integer', minimum: 1 }, note: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      '/lines': {
        get: {
          operationId: 'streamLines',
          responses: {
            '200': { description: 'OK', content: { 'application/x-ndjson': { example: { line: 1 } } } },
          },
        },
      },
    },
  }
}

const noteSchema: OasSchema = {
  type: 'object',
  required: ['id', 'text'],
  properties: { id: { type: 'string' }, text: { type: 'string', minLength: 1 } },
}

/**
 * Collection API for stateful mode: the in-memory store answers `/notes`
 * routes, while `/reports` (no 200 response) falls through to the spec's
 * generated response.
 */
export function createStatefulBytesSpec(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Stateful bytes', version: '1.0.0' },
    paths: {
      '/notes': {
        get: {
          operationId: 'listNotes',
          responses: { '200': { description: 'OK', content: json({ type: 'array', items: noteSchema }) } },
        },
        post: {
          operationId: 'createNote',
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 } } }),
          },
          responses: { '201': { description: 'Created', content: json(noteSchema) } },
        },
      },
      '/notes/{noteId}': {
        parameters: [{ name: 'noteId', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          operationId: 'getNote',
          responses: { '200': { description: 'OK', content: json(noteSchema) } },
        },
        patch: {
          operationId: 'updateNote',
          requestBody: { content: json({ type: 'object', properties: { text: { type: 'string', minLength: 1 } } }) },
          responses: { '200': { description: 'OK', content: json(noteSchema) } },
        },
        delete: {
          operationId: 'deleteNote',
          responses: { '204': { description: 'Deleted' } },
        },
      },
      '/reports': {
        get: {
          operationId: 'getReport',
          responses: {
            '203': {
              description: 'Generated report',
              content: json({ type: 'object', required: ['total', 'generatedAt'], properties: { total: { type: 'integer', minimum: 3 }, generatedAt: { type: 'string', format: 'date-time' }, label: { type: 'string' } } }),
            },
          },
        },
      },
    },
  }
}

/**
 * A spec whose response schemas violate the JSON Schema 2020-12 meta-schema:
 * each carries an OAS 3.0-style keyed `examples` map where an array is
 * required (as a 3.0 document upgraded without rewriting it would), so the
 * response validator cannot compile them. `/first` and `/second` share one
 * such schema through a component; `/guarded` documents such a 401 for
 * requests without credentials, and `/tags` such a 422 whose body is not a
 * JSON object, so request validation details are never added to it.
 *
 * Every call returns new schema objects: the validator remembers the schema
 * objects it has compiled, so each test needs its own.
 */
export function createUncompilableResponseSpec(): OasDocument {
  const keyedExamples = (value: unknown) => ({ sample: { value } }) as unknown as unknown[]
  const errorSchema: OasSchema = {
    type: 'object',
    required: ['code', 'message'],
    properties: { code: { type: 'string' }, message: { type: 'string' } },
    examples: keyedExamples({ code: 'UNAUTHORIZED', message: 'sign in' }),
  }
  return {
    openapi: '3.2.0',
    info: { title: 'Uncompilable response schemas', version: '1.0.0' },
    servers: [{ url: 'https://api.example.test/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Status: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['ok'] } },
          examples: keyedExamples({ status: 'ok' }),
        },
      },
    },
    paths: {
      '/first': {
        get: { operationId: 'getFirst', responses: { '200': { description: 'OK', content: json({ $ref: '#/components/schemas/Status' }) } } },
      },
      '/second': {
        get: { operationId: 'getSecond', responses: { '200': { description: 'OK', content: json({ $ref: '#/components/schemas/Status' }) } } },
      },
      '/guarded': {
        get: {
          operationId: 'getGuarded',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { example: { secret: true } } } },
            '401': { description: 'Unauthorized', content: json(errorSchema) },
          },
        },
      },
      '/tags': {
        post: {
          operationId: 'createTag',
          requestBody: {
            required: true,
            content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } }),
          },
          responses: {
            '201': { description: 'Created', content: { 'application/json': { example: { name: 'tag' } } } },
            '422': {
              description: 'Invalid tag',
              content: json({ type: 'array', minItems: 1, items: { type: 'string' }, examples: keyedExamples(['invalid']) }),
            },
          },
        },
      },
    },
  }
}

/**
 * A generated JSON body, a generated event stream and a generated `X-N`
 * header next to an example body, each made of one integer: a generator
 * handler that numbers its calls shows in every response how many values were
 * generated before it.
 */
export function createGeneratedIntegerSpec(): OasDocument {
  const numbered = (): OasSchema => ({ type: 'object', required: ['n'], properties: { n: { type: 'integer' } } })
  return {
    openapi: '3.2.0',
    info: { title: 'Generated integers', version: '1.0.0' },
    servers: [{ url: 'https://api.example.test/v1' }],
    paths: {
      '/n': {
        get: { operationId: 'getN', responses: { '200': { description: 'OK', content: json(numbered()) } } },
      },
      '/n-events': {
        get: {
          operationId: 'streamN',
          responses: { '200': { description: 'OK', content: { 'text/event-stream': { itemSchema: numbered() } } } },
        },
      },
      '/n-header': {
        get: {
          operationId: 'headerN',
          responses: {
            '200': {
              description: 'OK',
              headers: { 'X-N': { schema: { type: 'integer' } } },
              content: { 'application/json': { schema: { type: 'object' }, example: { fixed: true } } },
            },
          },
        },
      },
    },
  }
}

export type TranscriptRequest = {
  name: string
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

const jsonHeaders = { 'Content-Type': 'application/json' }

/** Requests replayed against both adapters. Paths are relative to the `/v1` server base. */
export const RESPONSE_BYTES_REQUESTS: readonly TranscriptRequest[] = [
  { name: 'example value with headers', method: 'GET', path: '/examples/value' },
  { name: 'example dataValue', method: 'GET', path: '/examples/data-value' },
  { name: 'inline example', method: 'GET', path: '/examples/inline' },
  { name: 'generated body on templated route', method: 'GET', path: '/widgets/w-1' },
  { name: 'generated body on another concrete URL', method: 'GET', path: '/widgets/w-2' },
  { name: 'invalid path parameter', method: 'GET', path: '/widgets/x' },
  { name: 'response without content', method: 'DELETE', path: '/widgets/w-1' },
  { name: 'method not allowed', method: 'PUT', path: '/widgets/w-1' },
  { name: 'valid create with generated body', method: 'POST', path: '/widgets', headers: jsonHeaders, body: '{"name":"a","size":1}' },
  { name: 'invalid body with documented 422', method: 'POST', path: '/widgets', headers: jsonHeaders, body: '{"name":"","size":0,"extra":true}' },
  { name: 'malformed JSON body', method: 'POST', path: '/widgets', headers: jsonHeaders, body: '{"name":' },
  { name: 'unsupported content type', method: 'POST', path: '/widgets', headers: { 'Content-Type': 'text/plain' }, body: 'name=a' },
  { name: 'invalid body with strict documented 422', method: 'POST', path: '/gadgets', headers: jsonHeaders, body: '{"name":"","size":0}' },
  { name: 'valid body with example 201', method: 'POST', path: '/gadgets', headers: jsonHeaders, body: '{"name":"g","size":3}' },
  { name: 'invalid body with default 422', method: 'POST', path: '/plain', headers: jsonHeaders, body: '{"size":"big"}' },
  { name: 'missing required body', method: 'POST', path: '/plain' },
  { name: 'valid query', method: 'GET', path: '/search?limit=10&sort=asc', headers: { 'X-Tenant': 'acme' } },
  { name: 'invalid query and header', method: 'GET', path: '/search?limit=0&sort=sideways', headers: { 'X-Tenant': 'ACME-1' } },
  { name: 'missing required query', method: 'GET', path: '/search' },
  { name: 'missing credentials with documented 401', method: 'GET', path: '/secure' },
  { name: 'valid credentials', method: 'GET', path: '/secure', headers: { Authorization: 'Bearer token-1' } },
  { name: 'missing credentials without documented 401', method: 'GET', path: '/secure-default' },
  { name: 'example violating response schema', method: 'GET', path: '/broken' },
  { name: 'range status response', method: 'GET', path: '/range' },
  { name: 'default response', method: 'GET', path: '/fallback' },
  { name: 'generated text body', method: 'GET', path: '/text' },
  { name: 'generated XML body', method: 'GET', path: '/xml' },
  { name: 'generated SSE stream', method: 'GET', path: '/events' },
  { name: 'example NDJSON stream', method: 'GET', path: '/lines' },
]

/** A CRUD session against the stateful store, ending with the store-independent fallback route. */
export const STATEFUL_REQUESTS: readonly TranscriptRequest[] = [
  { name: 'list seeded notes', method: 'GET', path: '/notes' },
  { name: 'create note', method: 'POST', path: '/notes', headers: jsonHeaders, body: '{"text":"hello"}' },
  { name: 'list after create', method: 'GET', path: '/notes' },
  { name: 'get created note', method: 'GET', path: '/notes/note-1' },
  { name: 'patch note', method: 'PATCH', path: '/notes/note-1', headers: jsonHeaders, body: '{"text":"edited"}' },
  { name: 'delete note', method: 'DELETE', path: '/notes/note-1' },
  { name: 'get deleted note', method: 'GET', path: '/notes/note-1' },
  { name: 'invalid create is rejected before the store', method: 'POST', path: '/notes', headers: jsonHeaders, body: '{"text":""}' },
  { name: 'generated fallback report', method: 'GET', path: '/reports' },
  { name: 'generated fallback report again', method: 'GET', path: '/reports' },
]

/**
 * Requests to `createUncompilableResponseSpec()`: the two routes that share a
 * schema in interleaved order, then the documented 401 and 422, twice each.
 */
export const UNCOMPILABLE_RESPONSE_REQUESTS: readonly TranscriptRequest[] = [
  { name: 'first 1', method: 'GET', path: '/first' },
  { name: 'first 2', method: 'GET', path: '/first' },
  { name: 'first 3', method: 'GET', path: '/first' },
  { name: 'second 1', method: 'GET', path: '/second' },
  { name: 'second 2', method: 'GET', path: '/second' },
  { name: 'first 4', method: 'GET', path: '/first' },
  { name: 'missing credentials 1', method: 'GET', path: '/guarded' },
  { name: 'missing credentials 2', method: 'GET', path: '/guarded' },
  { name: 'invalid tag 1', method: 'POST', path: '/tags', headers: jsonHeaders, body: '{"name":""}' },
  { name: 'invalid tag 2', method: 'POST', path: '/tags', headers: jsonHeaders, body: '{}' },
]
