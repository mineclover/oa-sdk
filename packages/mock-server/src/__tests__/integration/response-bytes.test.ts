/**
 * Pins the exact response bytes (status, headers, body) both adapters serve for
 * a representative spec, including request-validation failures, documented
 * error responses, response-schema violations, streams and stateful mode.
 *
 * Every transcript is replayed twice against the same adapter instance: the
 * second pass is served by whatever the first pass left behind (precomputed
 * or cached responses), so it must be byte-identical to the first.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { parseDocument, type OasDocument, type OasPathItem } from '@oa-sdk/parser'
import { createNodeMockServer, type NodeMockServer } from '../../adapters/node-http.js'
import { createMswHandlers, createMswMockServer } from '../../adapters/msw.js'
import { handleRequest } from '../../core/handler.js'
import type { CallbackPostAttempt } from '../../core/callbacks.js'
import type { MockPlugin } from '../../core/plugin.js'
import {
  createResponseBytesSpec,
  createStatefulBytesSpec,
  RESPONSE_BYTES_REQUESTS,
  STATEFUL_REQUESTS,
} from '../fixtures/response-bytes.js'
import { replayOnMsw, replayOnNode, type Exchange } from '../support/transcript.js'

const MSW_ORIGIN = 'http://api.example.test/v1'

const servers: NodeMockServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

async function startNode(spec: OasDocument, options: Parameters<typeof createNodeMockServer>[1] = {}): Promise<NodeMockServer> {
  const server = createNodeMockServer(spec, { port: 0, ...options })
  servers.push(server)
  await server.start()
  return server
}

function jsonExchange(status: number, body: unknown, headers: Record<string, string> = {}): Exchange {
  const text = JSON.stringify(body)
  return {
    status,
    headers: sortHeaders({
      'content-length': String(Buffer.byteLength(text)),
      'content-type': 'application/json',
      ...headers,
    }),
    body: text,
  }
}

function textExchange(status: number, contentType: string, body: string): Exchange {
  return {
    status,
    headers: { 'content-length': String(Buffer.byteLength(body)), 'content-type': contentType },
    body,
  }
}

function streamExchange(contentType: string, body: string): Exchange {
  return {
    status: 200,
    headers: { 'cache-control': 'no-cache', 'content-type': contentType, 'transfer-encoding': 'chunked' },
    body,
  }
}

function pathItem(spec: OasDocument, path: string): OasPathItem {
  const item = spec.paths?.[path]
  if (!item || '$ref' in item) throw new Error(`expected an inline path item for ${path}`)
  return item
}

function sortHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * The MSW adapter returns the same status, headers and body as the Node one,
 * framed as a Fetch Response: never chunked, and with a Content-Length only on
 * the mock's own error envelopes (request-validation and response-schema
 * failures), which it builds with `HttpResponse.json`.
 */
function asMswTranscript(
  transcript: Record<string, Exchange>,
  envelopeNames: readonly string[] = [],
): Record<string, Exchange> {
  return Object.fromEntries(Object.entries(transcript).map(([name, exchange]) => {
    const { 'content-length': length, 'transfer-encoding': _encoding, ...headers } = exchange.headers
    const framed = envelopeNames.includes(name) && length !== undefined
      ? sortHeaders({ ...headers, 'content-length': length })
      : headers
    return [name, { ...exchange, headers: framed }]
  }))
}

const GENERATED_WIDGET = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'xxx',
  kind: 'basic',
  createdAt: '1970-01-01T00:00:00.000Z',
  tags: ['x', 'x'],
  owner: { email: 'example@example.com' },
  size: 1,
  status: 'active',
  flags: { a: false, b: 7 },
  variant: '1970-01-01',
  level: 42,
}

const validationEnvelope = (operationId: string, method: string, path: string, details: unknown[]) => ({
  error: {
    code: 'CONSTRAINT_VIOLATION',
    message: '요청 검증 실패',
    details,
    _meta: { operationId, method, path },
  },
})

const EXPECTED_NODE_TRANSCRIPT: Record<string, Exchange> = {
  'example value with headers': jsonExchange(200, { source: 'value', n: 1 }, { 'x-rate-limit': '10', 'x-trace': 'trace-123' }),
  'example dataValue': jsonExchange(200, { source: 'dataValue' }),
  'inline example': jsonExchange(200, [1, 2, 3]),
  'generated body on templated route': jsonExchange(200, GENERATED_WIDGET),
  'generated body on another concrete URL': jsonExchange(200, GENERATED_WIDGET),
  'invalid path parameter': jsonExchange(422, validationEnvelope('getWidget', 'get', '/widgets/{widgetId}', [{
    path: '/path/widgetId',
    code: 'CONSTRAINT_VIOLATION',
    message: '제약 조건 위반: must NOT have fewer than 2 characters',
    expected: 'minLength: 2',
    constraint: { limit: 2 },
    stage: 'validate',
    received: { type: 'string', length: 1 },
  }])),
  // A body-less 204 keeps the Content-Length of the serialized `null` body.
  'response without content': {
    status: 204,
    headers: { 'content-length': '4', 'content-type': 'application/json' },
    body: '',
  },
  'method not allowed': { status: 405, headers: { allow: 'GET, DELETE', 'content-length': '0' }, body: '' },
  'valid create with generated body': jsonExchange(201, GENERATED_WIDGET, { 'x-request-id': '00000000-0000-0000-0000-000000000000' }),
  'invalid body with documented 422': jsonExchange(422, {
    code: 'INVALID_INPUT',
    message: '',
    details: [
      { path: '/body', message: 'must NOT have additional properties', received: { type: 'object', count: 3 } },
      { path: '/body/name', message: '제약 조건 위반: must NOT have fewer than 1 characters', received: { type: 'string', length: 0 }, expected: 'minLength: 1' },
      { path: '/body/size', message: '제약 조건 위반: must be >= 1', received: { type: 'number' }, expected: 'minimum: 1' },
    ],
  }),
  'malformed JSON body': jsonExchange(422, {
    code: 'INVALID_INPUT',
    message: '',
    details: [
      { path: '/body', message: 'JSON 요청 본문을 파싱할 수 없습니다', expected: 'valid JSON' },
      { path: '/body', message: '요청 바디가 필요합니다' },
    ],
  }),
  'unsupported content type': jsonExchange(422, {
    code: 'INVALID_INPUT',
    message: '',
    details: [
      { path: '/headers/content-type', message: 'Content-Type 불일치', received: { type: 'string', length: 10 }, expected: 'application/json' },
    ],
  }),
  // The strict documented schema rejects validation details, so its own body is served.
  'invalid body with strict documented 422': jsonExchange(422, { code: 'STRICT_INVALID', message: 'xx' }),
  'valid body with example 201': jsonExchange(201, { id: 'gadget-1' }),
  'invalid body with default 422': jsonExchange(422, validationEnvelope('createPlain', 'post', '/plain', [
    { path: '/body/name', code: 'MISSING_REQUIRED_FIELD', message: "필수 필드 누락: 'name'", stage: 'validate' },
    { path: '/body/size', code: 'TYPE_ERROR', message: '타입 불일치: must be integer', expected: 'integer', stage: 'validate', received: { type: 'string', length: 3 } },
  ])),
  'missing required body': jsonExchange(422, validationEnvelope('createPlain', 'post', '/plain', [
    { path: '/body', code: 'MISSING_REQUIRED_FIELD', message: '요청 바디가 필요합니다', stage: 'parse' },
  ])),
  'valid query': jsonExchange(200, [GENERATED_WIDGET]),
  'invalid query and header': jsonExchange(422, validationEnvelope('searchWidgets', 'get', '/search', [
    { path: '/query/limit', code: 'CONSTRAINT_VIOLATION', message: '제약 조건 위반: must be >= 1', expected: 'minimum: 1', constraint: { comparison: '>=', limit: 1 }, stage: 'validate', received: { type: 'number' } },
    { path: '/query/sort', code: 'INVALID_ENUM_VALUE', message: '허용되지 않는 값입니다', expected: 'asc | desc', stage: 'validate', received: { type: 'string', length: 8 } },
    { path: '/header/X-Tenant', code: 'PATTERN_MISMATCH', message: '패턴 불일치: /^[a-z]+$/ 을 만족해야 합니다', expected: '/^[a-z]+$/', stage: 'validate', received: { type: 'string', length: 6 } },
  ])),
  'missing required query': jsonExchange(422, validationEnvelope('searchWidgets', 'get', '/search', [
    { path: '/query/limit', code: 'MISSING_REQUIRED_FIELD', message: "필수 파라미터 누락: 'limit'", stage: 'validate' },
  ])),
  'missing credentials with documented 401': jsonExchange(401, { code: 'UNAUTHORIZED', message: 'documented' }),
  'valid credentials': jsonExchange(200, { secret: true }),
  'missing credentials without documented 401': jsonExchange(401, { code: 'UNAUTHORIZED', message: '인증이 필요합니다' }),
  'example violating response schema': jsonExchange(500, {
    error: {
      code: 'CONSTRAINT_VIOLATION',
      message: '생성된 응답이 응답 스키마를 만족하지 않습니다',
      details: [{ path: '/response/body/count', code: 'TYPE_ERROR', message: '타입 불일치: must be integer', expected: 'integer', stage: 'validate', received: { type: 'string', length: 12 } }],
      _meta: { operationId: 'getBroken', method: 'get', path: '/broken' },
    },
  }),
  'range status response': jsonExchange(200, { ok: false }),
  'default response': jsonExchange(200, { fallback: true }),
  'generated text body': textExchange(200, 'text/plain', 'xxxx'),
  'generated XML body': textExchange(200, 'application/xml', '<widget><id>5</id><label>xx</label></widget>'),
  'generated SSE stream': streamExchange('text/event-stream', 'data: {"seq":1}\n\ndata: {"seq":1}\n\ndata: {"seq":1}\n\n'),
  'example NDJSON stream': streamExchange('application/x-ndjson', '{"line":1}\n'),
}

describe('adapter response bytes', () => {
  it('Node HTTP adapter serves the pinned bytes on first and repeated requests', async () => {
    const server = await startNode(createResponseBytesSpec())

    expect(await replayOnNode(server, RESPONSE_BYTES_REQUESTS)).toEqual(EXPECTED_NODE_TRANSCRIPT)
    expect(await replayOnNode(server, RESPONSE_BYTES_REQUESTS)).toEqual(EXPECTED_NODE_TRANSCRIPT)
  })

  it('MSW adapter serves the same bytes on first and repeated requests', async () => {
    const handlers = createMswHandlers(createResponseBytesSpec())
    const expected = asMswTranscript(EXPECTED_NODE_TRANSCRIPT, [
      'invalid path parameter',
      'invalid body with default 422',
      'missing required body',
      'invalid query and header',
      'missing required query',
      'example violating response schema',
    ])

    expect(await replayOnMsw(handlers, MSW_ORIGIN, RESPONSE_BYTES_REQUESTS)).toEqual(expected)
    expect(await replayOnMsw(handlers, MSW_ORIGIN, RESPONSE_BYTES_REQUESTS)).toEqual(expected)
  })

  it('Node HTTP adapter answers undeclared paths with 404 while MSW leaves them unhandled', async () => {
    const server = await startNode(createResponseBytesSpec())
    const missing = [{ name: 'missing', method: 'GET', path: '/missing' }]

    expect(await replayOnNode(server, missing)).toEqual({
      missing: jsonExchange(404, { error: { code: 'NOT_FOUND', message: 'GET /missing 는 정의되지 않은 경로입니다', details: [] } }),
    })
    expect(await replayOnMsw(createMswHandlers(createResponseBytesSpec()), MSW_ORIGIN, missing)).toEqual({ missing: undefined })
  })

  it('answers 405 for any concrete URL of a route with that route\'s methods', async () => {
    const server = await startNode(createResponseBytesSpec())
    const requests = Array.from({ length: 25 }, (_, index) => ({ name: `put ${index}`, method: 'PUT', path: `/widgets/w-${index}` }))

    const transcript = await replayOnNode(server, requests)

    for (const exchange of Object.values(transcript)) {
      expect(exchange).toEqual({ status: 405, headers: { allow: 'GET, DELETE', 'content-length': '0' }, body: '' })
    }
  })
})

describe('stateful mode response bytes', () => {
  const seed = { '/notes': [{ id: 'seed-1', text: 'seeded' }] }
  const sequentialIds = () => {
    let next = 0
    return () => `note-${++next}`
  }

  const EXPECTED_STATEFUL_TRANSCRIPT: Record<string, Exchange> = {
    'list seeded notes': jsonExchange(200, [{ id: 'seed-1', text: 'seeded' }]),
    'create note': jsonExchange(201, { text: 'hello', id: 'note-1' }),
    'list after create': jsonExchange(200, [{ id: 'seed-1', text: 'seeded' }, { text: 'hello', id: 'note-1' }]),
    'get created note': jsonExchange(200, { text: 'hello', id: 'note-1' }),
    'patch note': jsonExchange(200, { text: 'edited', id: 'note-1' }),
    'delete note': { status: 204, headers: { 'content-length': '0', 'content-type': 'application/json' }, body: '' },
    'get deleted note': jsonExchange(404, { error: { code: 'NOT_FOUND', message: "Item with id 'note-1' not found" } }),
    'invalid create is rejected before the store': jsonExchange(422, validationEnvelope('createNote', 'post', '/notes', [
      { path: '/body/text', code: 'CONSTRAINT_VIOLATION', message: '제약 조건 위반: must NOT have fewer than 1 characters', expected: 'minLength: 1', constraint: { limit: 1 }, stage: 'validate', received: { type: 'string', length: 0 } },
    ])),
    'generated fallback report': jsonExchange(203, { total: 3, generatedAt: '1970-01-01T00:00:00.000Z' }),
    'generated fallback report again': jsonExchange(203, { total: 3, generatedAt: '1970-01-01T00:00:00.000Z' }),
  }

  it('Node HTTP adapter serves store state per request and restores the seed on reset', async () => {
    const server = await startNode(createStatefulBytesSpec(), { stateful: { seed, generateId: sequentialIds() } })

    expect(await replayOnNode(server, STATEFUL_REQUESTS)).toEqual(EXPECTED_STATEFUL_TRANSCRIPT)

    server.reset()
    expect(await replayOnNode(server, [STATEFUL_REQUESTS[0]!])).toEqual({
      'list seeded notes': EXPECTED_STATEFUL_TRANSCRIPT['list seeded notes'],
    })
  })

  it('MSW adapter serves store state per request and restores the seed on reset', async () => {
    const mock = createMswMockServer(createStatefulBytesSpec(), { stateful: { seed, generateId: sequentialIds() } })
    const origin = 'http://api.example.test'

    expect(await replayOnMsw(mock.handlers, origin, STATEFUL_REQUESTS)).toEqual(
      asMswTranscript(EXPECTED_STATEFUL_TRANSCRIPT, ['invalid create is rejected before the store']),
    )

    mock.reset()
    expect(await replayOnMsw(mock.handlers, origin, [STATEFUL_REQUESTS[0]!])).toEqual(
      asMswTranscript({ 'list seeded notes': EXPECTED_STATEFUL_TRANSCRIPT['list seeded notes']! }),
    )
  })
})

describe('request-dependent response stages', () => {
  it('serves the replacement spec after a hot swap and the original after swapping back', async () => {
    const original = createResponseBytesSpec()
    const replacement = createResponseBytesSpec()
    const widgetPath = pathItem(replacement, '/widgets/{widgetId}')
    widgetPath.get!.responses!['200'] = {
      description: 'OK',
      content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 5 } } } } },
    }
    widgetPath.put = { operationId: 'replaceWidget', responses: { '200': { description: 'OK', content: { 'application/json': { example: { replaced: true } } } } } }
    pathItem(replacement, '/examples/inline').get!.responses!['200'] = {
      description: 'OK',
      content: { 'application/json': { example: [9] } },
    }
    const requests = [
      { name: 'generated', method: 'GET', path: '/widgets/w-1' },
      { name: 'example', method: 'GET', path: '/examples/inline' },
      { name: 'put', method: 'PUT', path: '/widgets/w-1' },
    ]
    const server = await startNode(original)
    const before = await replayOnNode(server, requests)

    expect(server.updateSpec(replacement)).toEqual({ routesCount: 19 })
    expect(await replayOnNode(server, requests)).toEqual({
      generated: jsonExchange(200, { name: 'xxxxx' }),
      example: jsonExchange(200, [9]),
      put: jsonExchange(200, { replaced: true }),
    })

    server.updateSpec(original)
    expect(await replayOnNode(server, requests)).toEqual(before)
    expect(before).toEqual({
      generated: EXPECTED_NODE_TRANSCRIPT['generated body on templated route'],
      example: EXPECTED_NODE_TRANSCRIPT['inline example'],
      put: EXPECTED_NODE_TRANSCRIPT['method not allowed'],
    })
  })

  it('runs plugin response hooks on a fresh generated body for every request', async () => {
    // Mutates the body it receives: a body shared across requests would show the
    // earlier requests' marks.
    const marker: MockPlugin = {
      name: 'marker',
      onResponse(response) {
        const body = response.body as Record<string, unknown>
        body.extra = `${String(body.extra ?? '')}*`
        return response
      },
    }
    const requests = [1, 2, 3].map(index => ({ name: `range ${index}`, method: 'GET', path: '/range' }))
    const expected = Object.fromEntries(requests.map(request => [request.name, jsonExchange(200, { ok: false, extra: '*' })]))

    const server = await startNode(createResponseBytesSpec(), { plugins: [marker] })
    expect(await replayOnNode(server, requests)).toEqual(expected)

    const handlers = createMswHandlers(createResponseBytesSpec(), { plugins: [marker] })
    expect(await replayOnMsw(handlers, MSW_ORIGIN, requests)).toEqual(asMswTranscript(expected))
  })

  it('validates plugin-supplied responses against their schema on every request', async () => {
    let calls = 0
    const counter: MockPlugin = {
      name: 'counter',
      onMatch(context) {
        if (context.entry.operationId !== 'getRange') return undefined
        calls += 1
        return {
          status: 200,
          contentType: 'application/json',
          body: calls % 2 === 0 ? { ok: true } : { ok: 'yes' },
          headers: {},
          links: {},
          schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
        }
      },
    }
    const server = await startNode(createResponseBytesSpec(), { plugins: [counter] })
    const requests = [1, 2].map(index => ({ name: `range ${index}`, method: 'GET', path: '/range' }))

    expect(await replayOnNode(server, requests)).toEqual({
      'range 1': jsonExchange(500, {
        error: {
          code: 'CONSTRAINT_VIOLATION',
          message: '생성된 응답이 응답 스키마를 만족하지 않습니다',
          details: [{ path: '/response/body/ok', code: 'TYPE_ERROR', message: '타입 불일치: must be boolean', expected: 'boolean', stage: 'validate', received: { type: 'string', length: 3 } }],
          _meta: { operationId: 'getRange', method: 'get', path: '/range' },
        },
      }),
      'range 2': jsonExchange(200, { ok: true }),
    })
  })

  it('evaluates callback URLs from each request', async () => {
    const nodeAttempts: CallbackPostAttempt[] = []
    const mswAttempts: CallbackPostAttempt[] = []
    const requests = ['a', 'b'].map(name => ({
      name,
      method: 'POST',
      path: '/widgets',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'w', size: 2, callbackUrl: `https://hooks.example.test/${name}` }),
    }))
    const expectedAttempt = (name: string): CallbackPostAttempt => ({
      callbackName: 'created',
      expression: '{$request.body#/callbackUrl}',
      method: 'post',
      contentType: 'application/json',
      headers: { 'Content-Type': 'application/json' },
      body: { event: 'widget.created' },
      sourceOperationId: 'createWidget',
      callbackOperationId: 'widgetCreatedCallback',
      resolved: true,
      url: `https://hooks.example.test/${name}`,
    })

    const server = await startNode(createResponseBytesSpec(), { onCallback: attempt => { nodeAttempts.push(attempt) } })
    await replayOnNode(server, requests)
    await replayOnMsw(
      createMswHandlers(createResponseBytesSpec(), { onCallback: attempt => { mswAttempts.push(attempt) } }),
      MSW_ORIGIN,
      requests,
    )

    expect(nodeAttempts).toEqual([expectedAttempt('a'), expectedAttempt('b')])
    expect(mswAttempts).toEqual([expectedAttempt('a'), expectedAttempt('b')])
  })

  it('handleRequest returns a response body the caller may change without affecting later calls', async () => {
    const entry = parseDocument(createResponseBytesSpec()).routes.get('/widgets/{widgetId}')!.get('get')!
    const parts = { pathParams: { widgetId: 'w-1' }, queryParams: {}, headers: {}, body: undefined, contentType: undefined }

    const first = handleRequest(parts, entry, {})
    if (first.type !== 'success') throw new Error(`expected success, received ${first.type}`)
    ;(first.picked.body as Record<string, unknown>).name = 'changed by caller'
    const second = handleRequest(parts, entry, {})

    expect(second.type === 'success' && second.picked.body).toEqual(GENERATED_WIDGET)
  })
})

