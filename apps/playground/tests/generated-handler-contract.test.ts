import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateClient } from '@oa-sdk/client'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { generateRouter } from '@oa-sdk/router'
import type { OasDocument } from '@oa-sdk/parser'
import { runTsc } from './run-tsc.js'

const tmpDir = resolve(__dirname, '../.tmp-generated-handler-contract-test')

const spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Generated handler contract', version: '1.0.0' },
  components: {
    schemas: {
      Invoice: {
        type: 'object',
        required: ['id', 'amount', 'status'],
        properties: {
          id: { type: 'string' },
          amount: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['draft', 'paid'] },
        },
      },
      CreateInvoice: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
  paths: {
    '/invoices': {
      post: {
        operationId: 'createInvoice',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateInvoice' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Invoice' },
              },
            },
          },
        },
      },
    },
    '/invoices/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      get: {
        operationId: 'getInvoice',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Invoice' },
              },
            },
          },
        },
      },
    },
  },
}

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('generated router/client compile with real handlers', () => {
  it('typechecks generated code and concrete handler implementations together', () => {
    writeFileSync(join(tmpDir, 'types.ts'), generateTypesFromSpec(spec), 'utf8')
    writeFileSync(join(tmpDir, 'router.ts'), generateRouter(spec, { typesImport: './types' }), 'utf8')
    writeFileSync(join(tmpDir, 'client.ts'), generateClient(spec, { typesImport: './types' }), 'utf8')
    writeFileSync(join(tmpDir, 'handlers.ts'), handlersSource(), 'utf8')
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        skipLibCheck: true,
        lib: ['ES2022', 'DOM'],
      },
      include: ['types.ts', 'router.ts', 'client.ts', 'handlers.ts'],
    }), 'utf8')

    expect(() => runTsc(tmpDir)).not.toThrow()
  })
})

function handlersSource(): string {
  return [
    "import type { CreateInvoiceBody, CreateInvoiceResponse, GetInvoicePathParams, GetInvoiceResponse } from './types'",
    "import clientApp from './router'",
    "import { createClient } from './client'",
    '',
    'type Handler<TInput, TOutput> = (input: TInput) => Promise<TOutput>',
    '',
    'export const createInvoiceHandler: Handler<CreateInvoiceBody, CreateInvoiceResponse> = async (body) => ({',
    "  id: 'inv_1',",
    '  amount: body.amount,',
    "  status: 'draft',",
    '})',
    '',
    'export const getInvoiceHandler: Handler<GetInvoicePathParams, GetInvoiceResponse> = async (params) => ({',
    '  id: params.id,',
    '  amount: 100,',
    "  status: 'paid',",
    '})',
    '',
    "const client = createClient({ baseUrl: 'https://api.example.test' })",
    'void clientApp',
    'void client.createInvoice({ amount: 100 })',
    "void client.getInvoice({ id: 'inv_1' })",
    '',
  ].join('\n')
}
