import { describe, expect, it } from 'vitest'
import { stringifyOpenApiYaml, normalizeOpenApiDocument, upgradeOpenApiDocumentTo32 } from '../cli/lib/openapi-collect.js'

describe('openapi collect scaffold', () => {
  it('normalizes NestJS Swagger noise without changing the source version', () => {
    const normalized = normalizeOpenApiDocument({
      paths: {
        '/users/{id}': {
          get: {
            security: [{ bearer: [] }],
            tags: ['users'],
            responses: { '200': { description: '' } },
          },
        },
      },
      tags: [],
      info: { version: '1.0', contact: {}, title: 'NestJS Reference API' },
      openapi: '3.0.0',
      servers: [],
      components: {},
    }, { profile: 'nestjs-swagger' })

    expect(normalized).toEqual({
      openapi: '3.0.0',
      info: { title: 'NestJS Reference API', version: '1.0' },
      paths: {
        '/users/{id}': {
          get: {
            tags: ['users'],
            responses: { '200': { description: '' } },
            security: [{ bearer: [] }],
          },
        },
      },
      components: {},
    })
    expect(stringifyOpenApiYaml(normalized)).not.toContain('&ref_')
  })

  it('creates a derived 3.2 artifact and converts nullable schemas', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          MaybeName: { type: 'string', nullable: true },
          MaybeUser: { $ref: '#/components/schemas/User', nullable: true },
        },
      },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.components).toMatchObject({
      schemas: {
        MaybeName: { type: ['string', 'null'] },
        MaybeUser: { anyOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] },
      },
    })
    expect(result.report.conversions.map(item => item.code)).toContain('openapi/version-upgraded')
    expect(result.report.conversions.map(item => item.code)).toContain('schema/nullable-upgraded')
  })

  it('fastapi profile drops empty info.contact / root servers / root tags', () => {
    const normalized = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'F', version: '1.0', contact: {} },
      servers: [],
      tags: [],
      paths: { '/items': { get: { responses: { '200': { description: 'ok' } } } } },
      components: {
        schemas: {
          HTTPValidationError: { type: 'object', properties: { detail: { type: 'array', items: { type: 'string' } } } },
        },
      },
    }, { profile: 'fastapi' })

    expect(Object.keys(normalized)).toEqual(['openapi', 'info', 'paths', 'components'])
    expect(normalized.info).toEqual({ title: 'F', version: '1.0' })
  })

  it('upgrades a 3.1 input by setting the version with no nullable conversions', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          Tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
          NullableUnion: { type: ['string', 'null'] },
        },
      },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.document.components).toMatchObject({
      schemas: {
        Tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] },
        NullableUnion: { type: ['string', 'null'] },
      },
    })
    expect(result.report.sourceOpenapi).toBe('3.1.0')
    expect(result.report.conversions.map(item => item.code)).toEqual(['openapi/version-upgraded'])
    expect(result.report.warnings).toEqual([])
  })

  it('is a no-op for an already 3.2 input', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.2.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: { schemas: { Name: { type: 'string' } } },
    })

    expect(result.document.openapi).toBe('3.2.0')
    expect(result.report.sourceOpenapi).toBe('3.2.0')
    expect(result.report.conversions).toEqual([])
    expect(result.report.warnings).toEqual([])
  })

  it('records a warning when a nullable $ref also has sibling keywords', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {},
      components: {
        schemas: {
          Decorated: {
            $ref: '#/components/schemas/Inner',
            nullable: true,
            description: 'inherited but nullable',
          },
        },
      },
    })

    const warningCodes = result.report.warnings.map(w => w.code)
    expect(warningCodes).toContain('schema/ref-nullable-siblings')
    expect(result.document.components).toMatchObject({
      schemas: {
        Decorated: {
          description: 'inherited but nullable',
          anyOf: [{ $ref: '#/components/schemas/Inner' }, { type: 'null' }],
        },
      },
    })
  })

  it('upgrades inline nullable schemas inside paths/responses/parameters/headers', () => {
    const result = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/items': {
          parameters: [
            { name: 'tag', in: 'query', schema: { type: 'string', nullable: true } },
          ],
          get: {
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', nullable: true } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { note: { type: 'string', nullable: true } } },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string', nullable: true } },
                  },
                },
                headers: {
                  'X-Trace': { schema: { type: 'string', nullable: true } },
                },
              },
            },
            callbacks: {
              onChange: {
                '{$request.body#/url}': {
                  post: {
                    requestBody: {
                      content: {
                        'application/json': {
                          schema: { type: 'string', nullable: true },
                        },
                      },
                    },
                    responses: { '200': { description: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        responses: {
          NotFound: {
            content: { 'application/json': { schema: { type: 'string', nullable: true } } },
          },
        },
        parameters: {
          MaybeId: { name: 'id', in: 'query', schema: { type: 'integer', nullable: true } },
        },
        requestBodies: {
          MaybeBody: {
            content: { 'application/json': { schema: { type: 'string', nullable: true } } },
          },
        },
        headers: {
          MaybeTrace: { schema: { type: 'string', nullable: true } },
        },
      },
    })

    const conversionPointers = result.report.conversions
      .filter(c => c.code === 'schema/nullable-upgraded')
      .map(c => c.pointer)
      .sort()

    expect(conversionPointers).toEqual([
      '#/components/headers/MaybeTrace/schema',
      '#/components/parameters/MaybeId/schema',
      '#/components/requestBodies/MaybeBody/content/application~1json/schema',
      '#/components/responses/NotFound/content/application~1json/schema',
      '#/paths/~1items/get/callbacks/onChange/{$request.body#~1url}/post/requestBody/content/application~1json/schema',
      '#/paths/~1items/get/parameters/0/schema',
      '#/paths/~1items/get/requestBody/content/application~1json/schema/properties/note',
      '#/paths/~1items/get/responses/200/content/application~1json/schema/items',
      '#/paths/~1items/get/responses/200/headers/X-Trace/schema',
      '#/paths/~1items/parameters/0/schema',
    ])

    const itemsParam = (result.document.paths as Record<string, { parameters: Array<{ schema: { type: string[] } }> }>)['/items']!.parameters[0]!
    expect(itemsParam.schema.type).toEqual(['string', 'null'])
  })

  it('survives documents that omit components and paths', () => {
    const upgrade = upgradeOpenApiDocumentTo32({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
    })
    expect(upgrade.document.openapi).toBe('3.2.0')
    expect(upgrade.report.warnings).toEqual([])

    const normalized = normalizeOpenApiDocument({
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
    }, { profile: 'nestjs-swagger' })
    expect(Object.keys(normalized)).toEqual(['openapi', 'info'])
  })
})
