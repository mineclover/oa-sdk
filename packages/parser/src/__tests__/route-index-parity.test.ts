/**
 * loadSchema ↔ parseDocument route parity.
 *
 * Both entry points index the pipeline output through the shared route-index
 * builder. Every fixture is checked under the default deref pipeline and under
 * a custom pipeline without deref, where the builder itself has to resolve the
 * Reference Objects left at operation-level positions.
 */
import { describe, it, expect } from 'vitest'
import { loadSchema } from '../schema-loader.js'
import { parseDocument } from '../parse.js'
import { parseDocument as parseBrowserDocument } from '../parse-browser.js'
import { loadSchema as loadBrowserSchema } from '../schema-loader-browser.js'
import type { SpecPass } from '../pipeline.js'
import type { OasDocument } from '../oas32-types.js'
import type { HttpMethod, OperationEntry, RouteIndex } from '../types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Route parity', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

const ok = { '200': { description: 'OK' } }

const PIPELINES: Array<[label: string, passes: SpecPass[] | undefined]> = [
  ['default deref pipeline', undefined],
  ['custom pipeline without deref', []],
]

function flatten(routes: RouteIndex): OperationEntry[] {
  return [...routes.values()].flatMap(methods => [...methods.values()])
}

function entry(routes: RouteIndex, path: string, method: string): OperationEntry {
  const found = routes.get(path)?.get(method as HttpMethod)
  if (!found) throw new Error(`missing route ${method} ${path}`)
  return found
}

/** Assert parity and return the loadSchema routes for behavior assertions. */
function expectParity(spec: OasDocument, passes: SpecPass[] | undefined): RouteIndex {
  const routes = loadSchema(structuredClone(spec), passes)
  const parsed = parseDocument(structuredClone(spec), passes)
  expect(routes).toStrictEqual(parsed.routes)
  expect(flatten(routes)).toStrictEqual(parsed.operations)
  return routes
}

const fixtures = {
  parameterOverride: doc({
    paths: {
      '/users/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'header', schema: { type: 'string' } },
        ],
        get: {
          operationId: 'getUser',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: ok,
        },
      },
    },
  }),
  refParameters: doc({
    paths: {
      '/items/{id}': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        get: {
          operationId: 'getItem',
          parameters: [
            { $ref: '#/components/parameters/LimitAlias', description: 'Page size for this call' },
            { $ref: '#/components/parameters/Trace' },
          ],
          requestBody: { $ref: '#/components/requestBodies/Item' },
          responses: { '200': { $ref: '#/components/responses/Item' } },
        },
      },
    },
    components: {
      parameters: {
        Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        LimitAlias: { $ref: '#/components/parameters/Limit' },
        Limit: { name: 'limit', in: 'query', description: 'Page size', schema: { type: 'integer' } },
        Trace: { name: 'x-trace', in: 'header', schema: { type: 'string' } },
      },
      requestBodies: {
        Item: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      },
      responses: {
        Item: { description: 'Item', content: { 'application/json': { schema: { type: 'object' } } } },
      },
    },
  }),
  inheritance: doc({
    servers: [{ url: 'https://global.example.com' }],
    security: [{ bearer: [] }],
    paths: {
      '/inherit': { get: { operationId: 'inheritAll', responses: ok } },
      '/path-servers': {
        servers: [{ url: 'https://path.example.com' }],
        get: { operationId: 'pathServers', responses: ok },
        post: {
          operationId: 'operationOverrides',
          servers: [{ url: 'https://operation.example.com' }],
          security: [],
          responses: ok,
        },
      },
    },
  }),
  callbacks: doc({
    paths: {
      '/subscriptions': {
        post: {
          operationId: 'subscribe',
          responses: ok,
          callbacks: {
            inline: {
              '{$request.body#/callbackUrl}': { post: { operationId: 'inlineEvent', responses: ok } },
            },
            shared: { $ref: '#/components/callbacks/Shared' },
          },
        },
      },
    },
    components: {
      callbacks: {
        Shared: {
          '{$request.body#/sharedUrl}': { post: { operationId: 'sharedEvent', responses: ok } },
        },
      },
    },
  }),
  webhooks: doc({
    paths: { '/ping': { get: { operationId: 'ping', responses: ok } } },
    webhooks: {
      userCreated: { post: { operationId: 'onUserCreated', responses: ok } },
      shared: { $ref: '#/components/pathItems/SharedHook' },
    },
    components: {
      pathItems: { SharedHook: { post: { operationId: 'onShared', responses: ok } } },
    },
  }),
  additionalOperations: doc({
    paths: {
      '/files/{id}': {
        get: { operationId: 'getFile', responses: ok },
        post: { operationId: 'postFile', responses: ok },
        additionalOperations: {
          COPY: { operationId: 'copyFile', responses: ok },
          search: { operationId: 'searchFile', responses: ok },
          // Forbidden by OAS 3.2: duplicates the fixed `post` field.
          POST: { operationId: 'shadowPost', responses: ok },
        },
      },
    },
  }),
  extensions: doc({
    paths: {
      '/flags': {
        'x-path-level': 'not an operation field',
        get: {
          operationId: 'getFlags',
          'x-oa-sdk-retryable': true,
          'x-rate-limit': { perMinute: 10 },
          responses: ok,
        },
      },
    },
  }),
  pathItemRef: doc({
    paths: { '/shared': { $ref: '#/components/pathItems/Shared' } },
    components: {
      pathItems: { Shared: { get: { operationId: 'getShared', responses: ok } } },
    },
  }),
  unresolvedExternal: doc({
    paths: {
      '/external': {
        get: {
          operationId: 'getExternal',
          parameters: [
            { $ref: './parameters.yaml#/A' },
            { $ref: './parameters.yaml#/B' },
            { name: 'local', in: 'query', schema: { type: 'string' } },
          ],
          requestBody: { $ref: './bodies.yaml#/Body' },
          responses: { '200': { $ref: './responses.yaml#/Ok' }, '404': { description: 'Missing' } },
        },
      },
      '/external-item': {
        $ref: './paths.yaml#/Item',
        get: { operationId: 'declaredBesideRef', responses: ok },
      },
    },
  }),
}

describe.each(PIPELINES)('loadSchema ↔ parseDocument parity (%s)', (_label, passes) => {
  it('path + operation parameters merge by in:name with operation override', () => {
    const routes = expectParity(fixtures.parameterOverride, passes)
    const parameters = entry(routes, '/users/{id}', 'get').parameters
    expect(parameters.map(p => `${p.in}:${p.name}`)).toEqual(['path:id', 'query:q', 'header:q'])
    expect(parameters.find(p => p.in === 'query')).toMatchObject({ required: true, schema: { type: 'integer' } })
  })

  it('$ref parameters, requestBody and responses resolve to their targets', () => {
    const routes = expectParity(fixtures.refParameters, passes)
    const get = entry(routes, '/items/{id}', 'get')
    expect(get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', description: 'Page size for this call', schema: { type: 'integer' } },
      { name: 'x-trace', in: 'header', schema: { type: 'string' } },
    ])
    expect(get.requestBody).toMatchObject({ required: true })
    expect(get.responses['200']).toMatchObject({ description: 'Item' })
  })

  it('servers and security inherit document → path item → operation', () => {
    const routes = expectParity(fixtures.inheritance, passes)
    expect(entry(routes, '/inherit', 'get')).toMatchObject({
      servers: [{ url: 'https://global.example.com' }],
      security: [{ bearer: [] }],
    })
    expect(entry(routes, '/path-servers', 'get')).toMatchObject({
      servers: [{ url: 'https://path.example.com' }],
      security: [{ bearer: [] }],
    })
    expect(entry(routes, '/path-servers', 'post')).toMatchObject({
      servers: [{ url: 'https://operation.example.com' }],
      security: [],
    })
  })

  it('callbacks keep inline definitions and resolve referenced ones', () => {
    const routes = expectParity(fixtures.callbacks, passes)
    const callbacks = entry(routes, '/subscriptions', 'post').callbacks
    expect(Object.keys(callbacks)).toEqual(['inline', 'shared'])
    expect(callbacks.shared).toEqual({
      '{$request.body#/sharedUrl}': { post: { operationId: 'sharedEvent', responses: ok } },
    })
  })

  it('webhooks stay out of routes and are extracted separately', () => {
    const routes = expectParity(fixtures.webhooks, passes)
    expect([...routes.keys()]).toEqual(['/ping'])

    const parsed = parseDocument(structuredClone(fixtures.webhooks), passes)
    expect(parsed.webhooks.map(op => [op.openApiPath, op.method, op.operationId])).toEqual([
      ['/webhooks/userCreated', 'post', 'onUserCreated'],
      ['/webhooks/shared', 'post', 'onShared'],
    ])
  })

  it('additionalOperations are indexed verbatim and never shadow fixed fields', () => {
    const routes = expectParity(fixtures.additionalOperations, passes)
    const methods = routes.get('/files/{id}')
    expect([...methods!.keys()]).toEqual(['get', 'post', 'COPY', 'search'])
    expect(entry(routes, '/files/{id}', 'post').operationId).toBe('postFile')
    expect(entry(routes, '/files/{id}', 'COPY').operationId).toBe('copyFile')
  })

  it('operation x-* extensions are retained on the entry', () => {
    const routes = expectParity(fixtures.extensions, passes)
    const get = entry(routes, '/flags', 'get')
    expect(get['x-oa-sdk-retryable']).toBe(true)
    expect(get['x-rate-limit']).toEqual({ perMinute: 10 })
    expect(get).not.toHaveProperty('x-path-level')
  })

  it('a Path Item $ref resolves to the referenced operations', () => {
    const routes = expectParity(fixtures.pathItemRef, passes)
    expect(entry(routes, '/shared', 'get').operationId).toBe('getShared')
  })

  it('unresolvable references are omitted instead of leaking Reference Objects', () => {
    const routes = expectParity(fixtures.unresolvedExternal, passes)
    const get = entry(routes, '/external', 'get')
    expect(get.parameters).toEqual([{ name: 'local', in: 'query', schema: { type: 'string' } }])
    expect(get).not.toHaveProperty('requestBody')
    expect(Object.keys(get.responses)).toEqual(['404'])
    // Operations declared beside an unresolvable Path Item $ref stay routable.
    expect(entry(routes, '/external-item', 'get').operationId).toBe('declaredBesideRef')
    expect(parseDocument(structuredClone(fixtures.unresolvedExternal), passes).resolution?.status).toBe('partial')
  })
})

describe('route-index fallback resolution', () => {
  it('matches the deref pipeline when the targets carry no nested refs', () => {
    for (const spec of [fixtures.refParameters, fixtures.callbacks, fixtures.pathItemRef]) {
      expect(loadSchema(structuredClone(spec), [])).toEqual(loadSchema(structuredClone(spec)))
    }
  })

  it('omits cyclic reference chains without looping', () => {
    const routes = loadSchema(doc({
      paths: {
        '/loop': {
          get: {
            operationId: 'loop',
            parameters: [{ $ref: '#/components/parameters/A' }],
            responses: { '200': { $ref: '#/components/responses/Self' } },
          },
        },
      },
      components: {
        parameters: {
          A: { $ref: '#/components/parameters/B' },
          B: { $ref: '#/components/parameters/A' },
        },
        responses: { Self: { $ref: '#/components/responses/Self' } },
      },
    }), [])

    const get = entry(routes, '/loop', 'get')
    expect(get.parameters).toEqual([])
    expect(Object.keys(get.responses)).toEqual([])
  })

  it('does not mutate the indexed document', () => {
    const spec = structuredClone(fixtures.refParameters)
    const snapshot = structuredClone(spec)
    loadSchema(spec, [])
    parseDocument(spec, [])
    expect(spec).toEqual(snapshot)
  })
})

describe('browser loadSchema shares the builder', () => {
  it('produces the same routes as the Node loadSchema for complete internal documents', () => {
    for (const spec of [
      fixtures.parameterOverride,
      fixtures.refParameters,
      fixtures.inheritance,
      fixtures.callbacks,
      fixtures.webhooks,
      fixtures.additionalOperations,
      fixtures.extensions,
      fixtures.pathItemRef,
    ]) {
      const browserRoutes = loadBrowserSchema(structuredClone(spec))
      expect(browserRoutes).toStrictEqual(parseBrowserDocument(structuredClone(spec)).routes)
      expect(browserRoutes).toEqual(loadSchema(structuredClone(spec)))
    }
  })
})
