import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  extractWireSchemaFromOas,
  ProtobufCodecTargetAdapter,
  RpcContractTargetAdapter,
} from '../../wire-adapter/index.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const codecTypesModule = join(workspaceRoot, 'packages', 'client', 'src', 'codec', 'codec-types')
const tmpDirs: string[] = []

afterEach(() => {
  for (const directory of tmpDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const protobuf = (ref: string) => ({ content: { 'application/x-protobuf': { schema: { $ref: `#/components/schemas/${ref}` } } } })

const orderDocument = {
  openapi: '3.1.0',
  info: { title: 'Order Service', version: '1.0.0' },
  paths: {
    '/orders': {
      post: {
        operationId: 'createOrder',
        tags: ['orders'],
        'x-oa-sdk-rpc': { serviceName: 'OrderService', methodName: 'CreateOrder' },
        requestBody: { required: true, ...protobuf('Order') },
        responses: { '201': { description: 'created', ...protobuf('Order') } },
      },
    },
    '/orders/{orderId}': {
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getOrder',
        tags: ['orders'],
        'x-oa-sdk-rpc': { serviceName: 'OrderService', methodName: 'GetOrder' },
        parameters: [
          { name: 'expand', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/OrderStatus' } },
          { name: 'X-Trace', in: 'header', description: 'Trace id */ injected', schema: { type: 'string' } },
          { name: 'region', in: 'cookie', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'found', ...protobuf('Order') },
          '404': { description: 'missing', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
      delete: {
        operationId: 'deleteOrder',
        tags: ['orders'],
        'x-oa-sdk-rpc': { serviceName: 'OrderService', methodName: 'DeleteOrder' },
        responses: { '204': { description: 'deleted' } },
      },
    },
    '/orders/{orderId}/note': {
      put: {
        operationId: 'setNote',
        tags: ['orders'],
        'x-oa-sdk-rpc': { serviceName: 'OrderService', methodName: 'SetNote' },
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string' } } } } } },
        responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } } },
      },
    },
  },
  components: {
    schemas: {
      OrderStatus: { type: 'string', enum: ['open', 'closed'] },
      Order: {
        type: 'object',
        required: ['id', 'amount'],
        properties: {
          id: { type: 'string', 'x-oa-sdk-protobuf-field': { index: 1 } },
          amount: { type: 'integer', format: 'int32', 'x-oa-sdk-protobuf-field': { index: 2 } },
        },
      },
    },
  },
} as unknown as OasDocument

type Order = { id: string; amount: number }
type Codec = { encode(value: unknown): Uint8Array; decode(raw: Uint8Array): unknown; mediaTypes: readonly string[] }

function generate(): { codecs: string; rpc: string } {
  const model = extractWireSchemaFromOas(orderDocument)
  return {
    codecs: new ProtobufCodecTargetAdapter().transform(model, { typesImport: './types.js' }),
    rpc: new RpcContractTargetAdapter().transform(model, { typesImport: './types.js', clientImport: codecTypesModule }),
  }
}

/** Transpiles generated modules to ESM in a temp directory and imports them. */
async function load(): Promise<{ codecs: Record<string, any>; rpc: Record<string, any> }> {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-rpc-'))
  tmpDirs.push(directory)
  const sources = generate()
  const modules: Record<string, Record<string, any>> = {}
  for (const [name, source] of Object.entries(sources)) {
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
    }).outputText
    const file = join(directory, `${name}.mjs`)
    writeFileSync(file, output)
    modules[name] = await import(pathToFileURL(file).href)
  }
  return { codecs: modules.codecs!, rpc: modules.rpc! }
}

describe('RpcContractTargetAdapter', () => {
  it('generates a module that type-checks against the codec contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-wire-rpc-types-'))
    tmpDirs.push(directory)
    const { rpc } = generate()
    writeFileSync(join(directory, 'types.ts'), 'export interface Order { id: string; amount: number }\n')
    writeFileSync(join(directory, 'rpc.ts'), rpc)
    writeFileSync(join(directory, 'usage.ts'), `
import { OrderServiceRpcClient, type OrderServiceServerHandlers } from './rpc.js'
const client = new OrderServiceRpcClient({ baseUrl: 'https://orders.test' })
export const order = client.getOrder({ orderId: '1', expand: ['items'], status: 'open' })
// @ts-expect-error orderId is required
export const missing = client.getOrder({})
// @ts-expect-error status is an enum
export const wrongStatus = client.getOrder({ orderId: '1', status: 'unknown' })
export const handlers: OrderServiceServerHandlers<{ user: string }> = {
  createOrder: (request) => request,
  getOrder: (_request, _context, params) => ({ id: params.orderId, amount: 1 }),
  deleteOrder: () => undefined,
  setNote: (request, _context, params) => ({ id: params.orderId, amount: String(request).length }),
}
`)
    const program = ts.createProgram([join(directory, 'rpc.ts'), join(directory, 'usage.ts')], {
      strict: true,
      noEmit: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    })
    const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

    expect(diagnostics).toEqual([])
    expect(rpc).toContain('/** Trace id *\\/ injected */')
  })

  it('fills the route and parameters and round-trips protobuf messages through codecs', async () => {
    const { codecs, rpc } = await load()
    const protobufCodecs = codecs.getGeneratedProtobufCodecs() as Record<string, Codec>
    const orderCodec = protobufCodecs.Order!
    const requests: { method: string; url: string; headers: Headers; body: Uint8Array }[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init)
      const body = new Uint8Array(await request.arrayBuffer())
      requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      if (request.method === 'DELETE') return new Response(null, { status: 204 })
      if (request.method === 'POST') {
        const created = orderCodec.decode(body) as Order
        return new Response(orderCodec.encode({ ...created, id: 'o-2' }) as ConstructorParameters<typeof Response>[0], {
          status: 201,
          headers: { 'content-type': 'application/x-protobuf' },
        })
      }
      if (request.method === 'PUT') {
        return Response.json({ id: 'o-1', amount: (JSON.parse(new TextDecoder().decode(body)) as { note: string }).note.length })
      }
      return new Response(orderCodec.encode({ id: 'o-1', amount: 42 }) as ConstructorParameters<typeof Response>[0], {
        status: 200,
        headers: { 'content-type': 'application/x-protobuf' },
      })
    }
    const client = new rpc.OrderServiceRpcClient({ baseUrl: 'https://orders.test/', codecs: protobufCodecs, fetch })

    await expect(client.getOrder({ orderId: 'a/b', expand: ['items', 'notes'], status: 'open', 'X-Trace': 't-1', region: 'eu west' }))
      .resolves.toEqual({ id: 'o-1', amount: 42 })
    await expect(client.createOrder({ id: 'draft', amount: 7 })).resolves.toEqual({ id: 'o-2', amount: 7 })
    await expect(client.setNote({ note: 'hello' }, { orderId: 'o-1' })).resolves.toEqual({ id: 'o-1', amount: 5 })
    await expect(client.deleteOrder({ orderId: 'o-1' })).resolves.toBeUndefined()

    const [get, post, put, del] = requests
    expect(get?.url).toBe('https://orders.test/orders/a%2Fb?expand=items&expand=notes&status=open')
    expect(get?.headers.get('x-trace')).toBe('t-1')
    expect(get?.headers.get('cookie')).toBe('region=eu%20west')
    expect(get?.headers.get('accept')).toBe('application/x-protobuf')
    expect(post?.headers.get('content-type')).toBe('application/x-protobuf')
    expect(orderCodec.decode(post!.body)).toEqual({ id: 'draft', amount: 7 })
    expect(put?.url).toBe('https://orders.test/orders/o-1/note')
    expect(put?.headers.get('content-type')).toBe('application/json')
    expect(del?.method).toBe('DELETE')
  })

  it('rejects with WireRpcError carrying the status and decoded body', async () => {
    const { rpc } = await load()
    const fetch = async () => Response.json({ code: 'NOT_FOUND' }, { status: 404, statusText: 'Not Found' })
    const client = new rpc.OrderServiceRpcClient({ baseUrl: 'https://orders.test', fetch })

    const error = await client.getOrder({ orderId: 'missing' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(rpc.WireRpcError)
    expect(error).toMatchObject({
      method: 'OrderService.GetOrder',
      status: 404,
      body: { code: 'NOT_FOUND' },
      message: 'RPC call OrderService.GetOrder failed with status 404 Not Found',
    })
  })

  it('refuses binary bodies without a codec and path values that change the route', async () => {
    const { rpc } = await load()
    const calls: string[] = []
    const fetch = async (url: string) => {
      calls.push(url)
      return new Response(null, { status: 204 })
    }
    const client = new rpc.OrderServiceRpcClient({ baseUrl: 'https://orders.test', fetch })

    await expect(client.createOrder({ id: 'x', amount: 1 })).rejects.toThrow('needs a codec for Order (application/x-protobuf)')
    await expect(client.deleteOrder({ orderId: '..' })).rejects.toThrow('cannot use ".." as path parameter "orderId"')
    expect(calls).toEqual([])
  })

  it('infers the wire format from the declared media types', () => {
    const model = extractWireSchemaFromOas(orderDocument)
    const methods = Object.fromEntries(model.services.flatMap(service => service.methods).map(method => [method.name, method]))

    expect(methods.CreateOrder?.wireFormat).toBe('protobuf')
    expect(methods.SetNote?.wireFormat).toBe('json')
    expect(methods.DeleteOrder?.wireFormat).toBe('json')
    expect(methods.GetOrder?.parameters?.map(parameter => [parameter.in, parameter.name, parameter.required])).toEqual([
      ['path', 'orderId', true],
      ['query', 'expand', false],
      ['query', 'status', false],
      ['header', 'X-Trace', false],
      ['cookie', 'region', false],
    ])
  })
})
