import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Library, ModelType } from '@apitomy/data-models'
import { parse as parseYaml } from 'yaml'
import type { ApitomyReferenceLibrary } from './index.js'
import {
  APITOMY_DATA_MODELS_PACKAGE,
  ApitomyReferenceError,
  createApitomyReferenceAdapter,
  createApitomyReferenceAdapterFromModule,
  loadApitomyDataModels,
} from './index.js'

type FakeDocument = { raw: Record<string, unknown> }

const openApiDocument = {
  openapi: '3.2.0',
  info: { title: 'Reference API', version: '1.0.0' },
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

function createFakeLibrary(
  overrides: Partial<ApitomyReferenceLibrary> = {},
): ApitomyReferenceLibrary {
  return {
    readDocument: input => ({ raw: input as Record<string, unknown> }),
    readDocumentFromJSONString: input => ({ raw: JSON.parse(input) as Record<string, unknown> }),
    writeNode: document => (document as FakeDocument).raw,
    validate: () => [],
    transformDocument: (document, targetModelType) => ({
      ...(document as FakeDocument),
      targetModelType,
    }),
    ...overrides,
  }
}

describe('Apitomy reference adapter', () => {
  it('reads JSON/YAML and writes through Apitomy without adding a hard dependency', () => {
    const readObjects: unknown[] = []
    const library = createFakeLibrary({
      readDocument: input => {
        readObjects.push(input)
        return { raw: input as Record<string, unknown> }
      },
    })
    delete library.readDocumentFromJSONString
    const adapter = createApitomyReferenceAdapter(library)

    const fromJson = adapter.read('{"openapi":"3.2.0"}')
    const fromYaml = adapter.read('openapi: 3.2.0\ninfo:\n  title: API\n  version: 1.0.0\n')

    expect((adapter.write(fromJson) as Record<string, unknown>).openapi).toBe('3.2.0')
    expect((adapter.write(fromYaml) as Record<string, unknown>).info).toEqual({
      title: 'API',
      version: '1.0.0',
    })
    expect(readObjects).toHaveLength(2)
  })

  it('probes an Apitomy document through the existing oa-sdk ParsedDocument IR', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary())
    const parsed = adapter.readAndParse(openApiDocument)

    expect(parsed.operations).toHaveLength(1)
    expect(parsed.operations[0]).toMatchObject({
      openApiPath: '/health',
      method: 'get',
      operationId: 'getHealth',
    })
  })

  it('maps Apitomy validation problems into oa-sdk lint diagnostics', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary({
      validate: () => [{
        errorCode: 'OP-001',
        nodePath: '/paths[/health]/get',
        message: 'operation needs a response',
        severity: 'warning',
      }],
    }))
    const document = adapter.read(openApiDocument)

    expect(adapter.mapValidationProblems(adapter.validateNative(document))).toEqual([{
      path: '/paths[/health]/get',
      severity: 'warning',
      rule: 'apitomy/OP-001',
      message: 'operation needs a response',
    }])
  })

  it('preserves an explicit NodePath conversion hook', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary({
      validate: () => [{
        errorCode: 'SCH-001',
        nodePath: { pointer: '#/components/schemas/User' },
        message: 'invalid schema',
        severity: 'error',
      }],
    }), {
      nodePathToString: value => {
        const pointer = (value as { pointer?: unknown }).pointer
        return typeof pointer === 'string' ? pointer : undefined
      },
    })

    expect(adapter.mapValidationProblems(adapter.validateNative(adapter.read(openApiDocument)))[0]?.path)
      .toBe('#/components/schemas/User')
  })

  it('normalizes Apitomy numeric severity and segmented NodePath values', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary({
      validate: () => [{
        errorCode: 'UNKNOWN-001',
        nodePath: {
          segments: [
            { value: 'components' },
            { value: 'schemas' },
            { value: 'User' },
          ],
        },
        property: 'examples',
        message: 'unknown property',
        severity: 2,
      }],
    }))

    expect(adapter.mapValidationProblems(adapter.validateNative(adapter.read(openApiDocument)))).toEqual([{
      path: '/components/schemas/User/examples',
      severity: 'warning',
      rule: 'apitomy/UNKNOWN-001',
      message: 'unknown property',
    }])
  })

  it('fails closed for non-OpenAPI documents and unsupported capabilities', () => {
    const library = createFakeLibrary()
    delete library.transformDocument
    delete library.validate
    const adapter = createApitomyReferenceAdapter(library)

    expect(() => adapter.toOpenApiDocument({ raw: { swagger: '2.0' } }))
      .toThrowError(new ApitomyReferenceError('unsupported-document', 'The oa-sdk reference bridge currently accepts OpenAPI 3.x documents only.'))
    expect(() => adapter.validateNative({ raw: openApiDocument }))
      .toThrowError(/does not expose validate/)
    expect(() => adapter.transformReference({ raw: openApiDocument }, 'OPENAPI31'))
      .toThrowError(/does not expose transformDocument/)
  })

  it('supports injected module loading and unwraps default exports', async () => {
    const library = createFakeLibrary()
    let importedSpecifier = ''
    const module = await loadApitomyDataModels(async specifier => {
      importedSpecifier = specifier
      return { default: { Library: library } }
    })

    expect(importedSpecifier).toBe(APITOMY_DATA_MODELS_PACKAGE)
    expect(module.Library).toBe(library)
    expect(createApitomyReferenceAdapterFromModule({ Library: library }))
      .toBeTruthy()
  })

  it('reports a missing optional dependency with an actionable error', async () => {
    await expect(loadApitomyDataModels(async () => {
      const error = new Error('Cannot find package') as Error & { code?: string }
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })).rejects.toMatchObject({
      name: 'ApitomyReferenceError',
      code: 'dependency-not-installed',
    })
  })

  it('does not mislabel an installed reference module initialization failure', async () => {
    await expect(loadApitomyDataModels(async () => {
      throw new Error('reference module initialization failed')
    })).rejects.toMatchObject({
      name: 'ApitomyReferenceError',
      code: 'dependency-load-failed',
    })
  })

  it('can require OpenAPI 3.2 at the reference boundary', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary(), {
      requireOpenApi32: true,
    })

    expect(() => adapter.toOpenApiDocument({
      raw: { ...openApiDocument, openapi: '3.1.0' },
    })).toThrowError(/requires OpenAPI 3.2.x/)
  })

  it('keeps oa-sdk validation authoritative while reporting reference divergence', () => {
    const adapter = createApitomyReferenceAdapter(createFakeLibrary({
      validate: () => [{
        errorCode: 'REF-ONLY',
        nodePath: '/paths',
        message: 'reference-only observation',
        severity: 'warning',
      }],
    }))

    const comparison = adapter.compareValidation(adapter.read(openApiDocument))

    expect(comparison.primary.valid).toBe(true)
    expect(comparison.status).toBe('divergent')
    expect(comparison.referenceOnly).toMatchObject([{
      path: '/paths',
      rule: 'apitomy/REF-ONLY',
    }])
    expect(comparison.differences).toContainEqual(expect.objectContaining({
      kind: 'apitomy-only',
    }))
  })

  it('classifies path drift, unsupported reference fields, and serialization loss', () => {
    const sourceDocument = {
      openapi: '3.2.0',
      info: { title: 'Taxonomy API', version: '1.0.0' },
      paths: {
        '/users': {
          get: { responses: {} },
        },
      },
    }
    const adapter = createApitomyReferenceAdapter(createFakeLibrary({
      writeNode: document => ({
        ...(document as FakeDocument).raw,
        'x-reference-normalization': true,
      }),
      validate: () => [
        {
          errorCode: 'UNKNOWN-001',
          nodePath: '/components/schemas/User',
          property: 'examples',
          message: 'unknown property',
          severity: 'warning',
        },
        {
          errorCode: 'REF-PATH',
          nodePath: '/different-path',
          message: 'responses가 비어있습니다',
          severity: 'warning',
        },
      ],
    }))

    const comparison = adapter.compareValidation(adapter.read(sourceDocument), {
      inputHash: 'sha256:fixture',
      providerVersion: '3.1.3',
      sourceDocument,
    })

    expect(comparison.metadata).toMatchObject({
      adapterVersion: 'oa-sdk.apitomy-reference.v1',
      provider: 'apitomy',
      providerPackage: '@apitomy/data-models',
      providerVersion: '3.1.3',
      inputHash: 'sha256:fixture',
      documentVersion: '3.2.0',
    })
    expect(comparison.serialization).toEqual({ checked: true, equal: false })
    expect(comparison.differences.map(difference => difference.kind)).toEqual(expect.arrayContaining([
      'path-mapping-failed',
      'unsupported-by-reference',
      'serialization-loss',
    ]))
  })

  it('exercises the installed Apitomy package as a reference fixture only', () => {
    const adapter = createApitomyReferenceAdapter(Library)
    const document = adapter.read({
      ...openApiDocument,
      'x-reference-fixture': true,
    })
    const comparison = adapter.compareValidation(document)
    const roundTripped = adapter.write(document)
    const transformed = adapter.transformReference(document, ModelType.OPENAPI32)

    expect(comparison.primary.valid).toBe(true)
    expect(comparison.reference.problems).toEqual([])
    expect(roundTripped).toMatchObject({
      openapi: '3.2.0',
      'x-reference-fixture': true,
    })
    expect(adapter.write(transformed).openapi).toBe('3.2.0')
  })

  it('keeps a versioned OAS 3.2 fixture as an external reference corpus', () => {
    const raw = readFileSync(new URL('./fixtures/oas32/reference-unknown-fields.yaml', import.meta.url), 'utf8')
    const sourceDocument = parseYaml(raw) as Record<string, unknown>
    const adapter = createApitomyReferenceAdapter(Library)
    const comparison = adapter.compareValidation(adapter.read(raw), {
      inputHash: 'sha256:oas32-reference-fixture',
      providerVersion: '3.1.3',
      sourceDocument,
    })

    expect(comparison.primary.valid).toBe(true)
    expect(comparison.metadata.documentVersion).toBe('3.2.0')
    expect(comparison.metadata.capabilities).toEqual(expect.arrayContaining(['read', 'write', 'validate', 'transform']))
    expect(comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unsupported-by-reference' }),
    ]))
  })
})
