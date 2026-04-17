import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { generateClient } from '@oa-sdk/client'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { OasDocument } from '@oa-sdk/parser'

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Security contract', version: '1.0.0' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyHeader: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      apiKeyQuery: { type: 'apiKey', name: 'api_key', in: 'query' },
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.example.test/authorize',
            tokenUrl: 'https://auth.example.test/token',
            scopes: { read: 'Read access' },
          },
        },
      },
      mtls: { type: 'mutualTLS' },
    },
  },
  paths: {
    '/bearer': {
      get: secureOperation('getBearerResource', [{ bearerAuth: [] }], { ok: 'bearer' }),
    },
    '/api-key': {
      get: secureOperation('getApiKeyResource', [{ apiKeyHeader: [] }], { ok: 'api-key' }),
    },
    '/oauth': {
      get: secureOperation('getOauthResource', [{ oauth2: ['read'] }], { ok: 'oauth' }),
    },
    '/query-key': {
      get: {
        ...secureOperation('getQueryKeyResource', [{ apiKeyQuery: [] }], { ok: 'query-key' }),
        parameters: [
          { name: 'api_key', in: 'query', required: true, schema: { type: 'string' } },
        ],
      },
    },
    '/mtls': {
      get: secureOperation('getMtlsResource', [{ mtls: [] }], { ok: 'mtls' }),
    },
  },
}

let server: NodeMockServer
let generated: GeneratedSecurityClientModule

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 })
  await server.start()
  generated = await importGeneratedClient(generateClient(spec))
})

afterAll(async () => {
  await server.stop()
})

describe('security client + mock contract', () => {
  it('generated auth middleware satisfies bearer, apiKey, and OAuth2 mock security checks', async () => {
    const bearerClient = generated.createClient({
      baseUrl: server.url,
      middleware: [generated.bearerAuth('bearer-token')],
    })
    const apiKeyClient = generated.createClient({
      baseUrl: server.url,
      middleware: [generated.apiKeyHeaderAuth('key-123')],
    })
    const oauthClient = generated.createClient({
      baseUrl: server.url,
      middleware: [generated.oauth2Auth('oauth-token')],
    })

    await expect(bearerClient.getBearerResource()).resolves.toEqual({ ok: 'bearer' })
    await expect(apiKeyClient.getApiKeyResource()).resolves.toEqual({ ok: 'api-key' })
    await expect(oauthClient.getOauthResource()).resolves.toEqual({ ok: 'oauth' })
  })

  it('keeps query apiKey explicit and treats mTLS as mock-pass-through', async () => {
    const client = generated.createClient({ baseUrl: server.url })

    await expect(client.getQueryKeyResource({ api_key: 'query-key-123' })).resolves.toEqual({ ok: 'query-key' })
    await expect(client.getMtlsResource()).resolves.toEqual({ ok: 'mtls' })
  })

  it('returns validation errors when credentials are missing or in the wrong place', async () => {
    const anonymousClient = generated.createClient({ baseUrl: server.url })
    const wrongClient = generated.createClient({
      baseUrl: server.url,
      middleware: [generated.bearerAuth('not-an-api-key')],
    })

    await expect(anonymousClient.getBearerResource()).rejects.toThrow('422')
    await expect(anonymousClient.getApiKeyResource()).rejects.toThrow('422')
    await expect(anonymousClient.getOauthResource()).rejects.toThrow('422')
    await expect(anonymousClient.getQueryKeyResource()).rejects.toThrow('422')
    await expect(wrongClient.getApiKeyResource()).rejects.toThrow('422')
  })
})

type GeneratedSecurityClient = {
  getBearerResource(): Promise<unknown>
  getApiKeyResource(): Promise<unknown>
  getOauthResource(): Promise<unknown>
  getQueryKeyResource(query?: Record<string, unknown>): Promise<unknown>
  getMtlsResource(): Promise<unknown>
}

type GeneratedSecurityClientModule = {
  createClient(config?: {
    baseUrl?: string
    middleware?: unknown[]
  }): GeneratedSecurityClient
  bearerAuth(token: string): unknown
  apiKeyHeaderAuth(key: string): unknown
  oauth2Auth(token: string): unknown
}

async function importGeneratedClient(code: string): Promise<GeneratedSecurityClientModule> {
  const js = transpileModule(code, {
    compilerOptions: {
      module: ModuleKind.ES2022,
      target: ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  return await import(url) as GeneratedSecurityClientModule
}

function secureOperation(
  operationId: string,
  security: Array<Record<string, string[]>>,
  example: unknown,
) {
  return {
    operationId,
    security,
    responses: {
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            example,
          },
        },
      },
    },
  }
}
