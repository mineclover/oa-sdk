import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { compileTypeSpecInMemory } from '../../plugin/compiler.js'
import { renderOpenApiTsClient } from '../../plugin/client-renderer/openapi-ts-client.js'
import { runTspPluginPipeline } from '../../plugin/runner.js'
import { pluginTypescript } from '../../plugin/plugins/typescript.js'
import { pluginClient } from '../../plugin/plugins/client.js'
import type { OasDocument } from '@oa-sdk/parser'
import { toFileRecord, typecheckGeneratedFiles } from './helpers/typecheck-generated.js'

describe('TypeSpec Builder Platform: Multi-Status Error Union & TSDoc Provenance', () => {
  const monorepoRoot = resolve(__dirname, '../../../../..')
  const petstoreFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/petstore/main.tsp')
  let petstoreDoc: OasDocument

  beforeAll(async () => {
    const res = await compileTypeSpecInMemory(petstoreFile)
    petstoreDoc = res.document
  })

  it('generates ErrorUnion helper type and isErrorStatus type guard function', () => {
    const { code, exports } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    expect(exports).toContain('ErrorUnion')
    expect(exports).toContain('isErrorStatus')

    expect(code).toContain('export type ErrorUnion<TStatusMap> =')
    expect(code).toContain('export function isErrorStatus<')
    expect(code).toContain('result is ErrorStatusResult<TResult, TStatus>')
    expect(code).toContain('result.error !== undefined && result.response.status === status')
  })

  it('generates {Operation}Errors and {Operation}ErrorUnion for operations', () => {
    const { code, exports } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    // Check exported symbols
    expect(exports).toContain('GetPetByIdErrors')
    expect(exports).toContain('GetPetByIdErrorUnion')
    expect(exports).toContain('ListPetsErrors')
    expect(exports).toContain('ListPetsErrorUnion')
    expect(exports).toContain('CreatePetErrors')
    expect(exports).toContain('CreatePetErrorUnion')

    // Check code structure
    expect(code).toMatch(/export type GetPetByIdErrors\s*=/)
    expect(code).toMatch(/export type GetPetByIdErrorUnion\s*=/)
  })

  it('generates rich TSDoc comments with @param and @see provenance', () => {
    const { code } = renderOpenApiTsClient({
      document: petstoreDoc,
      output: 'client.ts',
    })

    // Contains method and path
    expect(code).toContain('GET /pets/{petId} - Get pet by ID')
    // Contains parameter documentation
    expect(code).toContain('@param options.path Path parameters for /pets/{petId}')
    // Contains cross-reference provenance link
    expect(code).toContain('@see {@link ./types.js} Operation getPetById')
  })

  it('generates multi-status error map when operation has explicit error status codes', async () => {
    // Synthetic OAS document with multiple error responses
    const syntheticDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Multi-Error API', version: '1.0.0' },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            summary: 'Get item with typed errors',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Item' },
                  },
                },
              },
              '400': {
                description: 'Bad Request',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ValidationError' },
                  },
                },
              },
              '404': {
                description: 'Not Found',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotFoundError' },
                  },
                },
              },
              default: {
                description: 'Unexpected Error',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/GeneralError' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Item: { type: 'object', properties: { id: { type: 'string' } } },
          ValidationError: { type: 'object', properties: { field: { type: 'string' } } },
          NotFoundError: { type: 'object', properties: { message: { type: 'string' } } },
          GeneralError: { type: 'object', properties: { code: { type: 'number' } } },
        },
      },
    }

    // Through the plugin pipeline: pluginClient receives the dereferenced `context.parsed`, so the
    // per-status map must come from the typegen-emitted ErrorByStatus type, not from `$ref` names.
    const result = await runTspPluginPipeline(
      { input: 'main.tsp', dryRun: true, plugins: [pluginTypescript(), pluginClient()] },
      { document: syntheticDoc },
    )
    expect(result.success).toBe(true)
    const files = toFileRecord(result.files)
    const code = files['client.ts']!
    const clientFile = result.files.find(f => f.path === 'client.ts')!

    expect(clientFile.exports).toContain('GetItemErrors')
    expect(clientFile.exports).toContain('GetItemErrorUnion')

    expect(files['types.ts']).toContain('export type GetItemErrorByStatus = {')
    expect(files['types.ts']).toContain('400: ValidationError')
    expect(files['types.ts']).toContain('404: NotFoundError')
    expect(code).toContain('export type GetItemErrors = GetItemErrorByStatus;')
    expect(code).toContain('export type GetItemErrorUnion = ErrorUnion<GetItemErrors>;')
    expect(code).toContain('Promise<ClientResult<GetItemResponse, GetItemError, GetItemErrors>>')

    // A consumer narrows `error` per declared status; other statuses keep the full error union.
    const usage = [
      "import { getItem, isErrorStatus, type GetItemErrorUnion } from './client.js'",
      "import type { GeneralError, NotFoundError, ValidationError } from './types.js'",
      'export async function show(): Promise<string> {',
      "  const res = await getItem({ path: { id: 'i1' } })",
      '  if (isErrorStatus(res, 404)) { const err: NotFoundError = res.error; return err.message ?? "" }',
      '  if (isErrorStatus(res, 400)) { const err: ValidationError = res.error; return err.field ?? "" }',
      '  if (isErrorStatus(res, 500)) { const err: ValidationError | NotFoundError | GeneralError = res.error; return String(err) }',
      '  if (res.error === undefined) return res.data.id ?? ""',
      '  return String(res.response.status)',
      '}',
      // With a `default` response the union also has a `{ status: number }` member carrying every error model.
      'export function describe(union: GetItemErrorUnion): string {',
      '  if (union.status === 404) { const err: NotFoundError | GeneralError | ValidationError = union.error; return String(err) }',
      '  return String(union.status)',
      '}',
    ].join('\n')
    expect(typecheckGeneratedFiles({ files: { ...files, 'usage.ts': usage } })).toEqual([])
  })

  it('narrows res.error per status for a TypeSpec operation with several error models', async () => {
    const edgeFile = resolve(monorepoRoot, 'test/e2e/typespec-plugin/fixtures/edge-cases/main.tsp')
    const result = await runTspPluginPipeline({
      input: edgeFile,
      dryRun: true,
      plugins: [pluginTypescript(), pluginClient()],
    })
    expect(result.success).toBe(true)
    const files = toFileRecord(result.files)
    const usage = [
      "import { getItem, getThing, isErrorStatus, type GetItemErrorUnion } from './client.js'",
      "import type { GenericError, NotFound } from './types.js'",
      // Without a `default` response the union is discriminated by status alone.
      'export function describe(union: GetItemErrorUnion): string {',
      '  return union.status === 404 ? union.error.message : union.error.conflictKey',
      '}',
      'export async function run(): Promise<string> {',
      "  const res = await getItem({ path: { id: 'a' } })",
      '  if (isErrorStatus(res, 404)) return res.error.message',
      '  if (isErrorStatus(res, 409)) return res.error.conflictKey',
      "  const thing = await getThing({ path: { id: 'b' } })",
      '  if (isErrorStatus(thing, 404)) return thing.error.message',
      '  if (isErrorStatus(thing, 503)) { const err: NotFound | GenericError = thing.error; return JSON.stringify(err) }',
      "  return res.error === undefined ? res.data.name : ''",
      '}',
    ].join('\n')
    expect(typecheckGeneratedFiles({ files: { ...files, 'usage.ts': usage } })).toEqual([])
  })
})
