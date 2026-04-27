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
})
