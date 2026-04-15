import { describe, it, expect } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeExternalSchemaRefs, generateTypes, generateTypesFromSpec } from '../../typegen/generate-types.js'

function doc(overrides: Partial<OasDocument> = {}): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

describe('generateTypes — schemas', () => {
  it('단일 스키마 → type alias', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type User =')
    expect(ts).toContain('id: string')
    expect(ts).toContain('name: string')
  })

  it('interface 스타일', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      },
    }))
    const ts = generateTypes(parsed, { style: 'interface' })
    expect(ts).toContain('export interface User {')
  })

  it('여러 스키마', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          Post: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type User =')
    expect(ts).toContain('export type Post =')
  })

  it('$ref sibling의 구조 정보가 타입 생성에 반영된다', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          Id: { type: 'string', format: 'uuid' },
          User: {
            type: 'object',
            required: ['id'],
            properties: {
              id: {
                $ref: '#/components/schemas/Id',
                readOnly: true,
                description: '사용자 ID',
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('* 사용자 ID')
    expect(ts).toContain('* @format uuid')
    expect(ts).toContain('readonly id: string')
  })

  it('nullable 필드', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          Item: {
            type: 'object',
            properties: { bio: { type: ['string', 'null'] } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('string | null')
  })

  it('enum 필드', () => {
    const parsed = parseDocument(doc({
      components: {
        schemas: {
          Status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain("'active' | 'inactive'")
  })
})

describe('analyzeExternalSchemaRefs', () => {
  it('외부 schema 이름 충돌을 조회한다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'a.yaml'), 'components:\n  schemas:\n    User:\n      type: string\n')
    writeFileSync(join(tmp, 'b.yaml'), 'components:\n  schemas:\n    User:\n      type: number\n')

    try {
      const input = doc({
        paths: {
          '/a': { get: { responses: { '200': { description: 'A', content: { 'application/json': { schema: { $ref: './a.yaml#/components/schemas/User' } } } } } } },
          '/b': { get: { responses: { '200': { description: 'B', content: { 'application/json': { schema: { $ref: './b.yaml#/components/schemas/User' } } } } } } },
        },
      })
      const result = analyzeExternalSchemaRefs(input, basePath)

      const warning = result.diagnostics.find(d => d.code === 'external-schema-name-collision')
      expect(warning?.message).toContain(`${join(tmp, 'a.yaml')}#/components/schemas/User -> AUser`)
      expect(warning?.message).toContain(`${join(tmp, 'b.yaml')}#/components/schemas/User -> BUser`)
      expect(result.refNameOverrides['./a.yaml#/components/schemas/User']).toBe('AUser')
      expect(result.refNameOverrides['./b.yaml#/components/schemas/User']).toBe('BUser')
      expect(result.typeAliases).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceFilePath: basePath,
          sourcePointer: '#/paths/~1a/get/responses/200/content/application~1json/schema/$ref',
          ref: './a.yaml#/components/schemas/User',
          aliasName: 'AUser',
          renamedFrom: 'User',
          filePath: join(tmp, 'a.yaml'),
          pointer: '#/components/schemas/User',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          sourceFilePath: basePath,
          sourcePointer: '#/paths/~1b/get/responses/200/content/application~1json/schema/$ref',
          ref: './b.yaml#/components/schemas/User',
          aliasName: 'BUser',
          renamedFrom: 'User',
          filePath: join(tmp, 'b.yaml'),
          pointer: '#/components/schemas/User',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]))

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(warnings).toEqual([warning?.message])
      expect(output).toContain('export type AUser = string')
      expect(output).toContain('export type BUser = number')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('typegen 외부 YAML/JSON 및 nested external schema alias 동작을 고정한다', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'shared.yaml'), [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      required: [role]',
      '      properties:',
      '        role:',
      '          $ref: "./role.json#/components/schemas/Role"',
      '',
    ].join('\n'))
    writeFileSync(join(tmp, 'role.json'), JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
    }))

    try {
      const warnings: string[] = []
      const output = generateTypesFromSpec(doc({
        paths: {
          '/user': {
            get: {
              operationId: 'getExternalUser',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './shared.yaml#/components/schemas/User' } } },
                },
              },
            },
          },
          '/role': {
            get: {
              operationId: 'getExternalRole',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './role.json#/components/schemas/Role' } } },
                },
              },
            },
          },
        },
      }), { basePath, warnings })

      expect(output).toContain('export type Role =')
      expect(output).toContain("'admin' | 'user'")
      expect(output).toContain('export type User =')
      expect(output).toContain('role: Role')
      expect(output).toContain('export type GetExternalUserResponse = User')
      expect(output).toContain('export type GetExternalRoleResponse = Role')
      expect(warnings).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('nested external refs resolve relative to the source external document', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    const nestedDir = join(tmp, 'nested')
    mkdirSync(nestedDir)
    writeFileSync(join(tmp, 'role.json'), JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['root'] },
        },
      },
    }))
    writeFileSync(join(nestedDir, 'shared.yaml'), [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      required: [role]',
      '      properties:',
      '        role:',
      '          $ref: "./role.json#/components/schemas/Role"',
      '',
    ].join('\n'))
    writeFileSync(join(nestedDir, 'role.json'), JSON.stringify({
      components: {
        schemas: {
          Role: { type: 'string', enum: ['nested'] },
        },
      },
    }))

    try {
      const input = doc({
        paths: {
          '/root-role': {
            get: {
              operationId: 'getRootRole',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './role.json#/components/schemas/Role' } } },
                },
              },
            },
          },
          '/user': {
            get: {
              operationId: 'getExternalUser',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './nested/shared.yaml#/components/schemas/User' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      const rootRoleName = analysis.refNameOverrides['./role.json#/components/schemas/Role']
      const userName = analysis.refNameOverrides['./nested/shared.yaml#/components/schemas/User']
      const nestedRoleEntry = Object.entries(analysis.refNameOverrides)
        .find(([ref]) => ref.endsWith('/nested/role.json#/components/schemas/Role'))
      if (!rootRoleName || !userName || !nestedRoleEntry) throw new Error('expected external alias names')

      const [nestedRoleRef, nestedRoleName] = nestedRoleEntry
      expect(nestedRoleName).not.toBe(rootRoleName)
      expect((analysis.schemas[userName] as any).properties.role.$ref).toBe(nestedRoleRef)

      const output = generateTypesFromSpec(input, { basePath })
      expect(output).toContain(`role: ${nestedRoleName}`)
      expect(output).toContain(`export type GetRootRoleResponse = ${rootRoleName}`)
      expect(output).toContain(`export type GetExternalUserResponse = ${userName}`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('external $defs schema refs generate aliases', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'defs.yaml'), [
      '$defs:',
      '  Role:',
      '    type: string',
      '    enum: [admin, user]',
      '  User:',
      '    type: object',
      '    required: [role]',
      '    properties:',
      '      role:',
      '        $ref: "#/$defs/Role"',
      '',
    ].join('\n'))

    try {
      const input = doc({
        paths: {
          '/user': {
            get: {
              operationId: 'getDefsUser',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './defs.yaml#/$defs/User' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      const userName = analysis.refNameOverrides['./defs.yaml#/$defs/User']
      const roleEntry = Object.entries(analysis.refNameOverrides)
        .find(([ref]) => ref.endsWith('/defs.yaml#/$defs/Role'))
      if (!userName || !roleEntry) throw new Error('expected $defs aliases')

      const [roleRef, roleName] = roleEntry
      expect(userName).toBe('User')
      expect(roleName).toBe('Role')
      expect((analysis.schemas.User as any).properties.role.$ref).toBe(roleRef)
      expect(analysis.typeAliases).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ref: './defs.yaml#/$defs/User',
          aliasName: 'User',
          pointer: '#/$defs/User',
        }),
        expect.objectContaining({
          aliasName: 'Role',
          pointer: '#/$defs/Role',
        }),
      ]))

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(output).toContain('export type Role =')
      expect(output).toContain("'admin' | 'user'")
      expect(output).toContain('export type User =')
      expect(output).toContain('role: Role')
      expect(output).toContain('export type GetDefsUserResponse = User')
      expect(warnings).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('external non-components schema roots generate aliases', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'roots.yaml'), [
      'models:',
      '  Item:',
      '    type: object',
      '    required: [id]',
      '    properties:',
      '      id:',
      '        type: string',
      'schemas:',
      '  Page:',
      '    type: object',
      '    required: [items]',
      '    properties:',
      '      items:',
      '        type: array',
      '        items:',
      '          $ref: "#/models/Item"',
      '',
    ].join('\n'))

    try {
      const input = doc({
        paths: {
          '/items': {
            get: {
              operationId: 'listRootItems',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './roots.yaml#/schemas/Page' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      const pageName = analysis.refNameOverrides['./roots.yaml#/schemas/Page']
      const itemEntry = Object.entries(analysis.refNameOverrides)
        .find(([ref]) => ref.endsWith('/roots.yaml#/models/Item'))
      if (!pageName || !itemEntry) throw new Error('expected non-components root aliases')

      const [itemRef, itemName] = itemEntry
      expect(pageName).toBe('Page')
      expect(itemName).toBe('Item')
      expect((analysis.schemas.Page as any).properties.items.items.$ref).toBe(itemRef)

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(output).toContain('export type Item =')
      expect(output).toContain('id: string')
      expect(output).toContain('export type Page =')
      expect(output).toContain('items: Item[]')
      expect(output).toContain('export type ListRootItemsResponse = Page')
      expect(warnings).toHaveLength(0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('external non-components aliases avoid operation bundle type names', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'roots.yaml'), [
      'schemas:',
      '  ListRootItemsOp:',
      '    type: object',
      '    required: [id]',
      '    properties:',
      '      id:',
      '        type: string',
      '',
    ].join('\n'))

    try {
      const input = doc({
        paths: {
          '/items': {
            get: {
              operationId: 'listRootItems',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './roots.yaml#/schemas/ListRootItemsOp' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      expect(analysis.refNameOverrides['./roots.yaml#/schemas/ListRootItemsOp']).toBe('RootsListRootItemsOp')
      expect(analysis.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'external-schema-shadows-operation',
          name: 'ListRootItemsOp',
          generatedName: 'RootsListRootItemsOp',
          pointer: '#/schemas/ListRootItemsOp',
        }),
      ]))

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(output).toContain('export type RootsListRootItemsOp =')
      expect(output).toContain('id: string')
      expect(output).toContain('export type ListRootItemsResponse = RootsListRootItemsOp')
      expect(output).toContain('export type ListRootItemsOp = {')
      expect(warnings).toHaveLength(1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('unsupported external pointer shapes are reported and emitted as unknown', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'responses.yaml'), [
      'components:',
      '  responses:',
      '    Ok:',
      '      description: OK',
      '      content:',
      '        application/json:',
      '          schema:',
      '            type: string',
      '',
    ].join('\n'))

    try {
      const input = doc({
        paths: {
          '/unsupported': {
            get: {
              operationId: 'getUnsupported',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './responses.yaml#/components/responses/Ok' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      expect(analysis.schemas).toEqual({})
      expect(analysis.refNameOverrides['./responses.yaml#/components/responses/Ok']).toBe('unknown')
      expect(analysis.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'external-schema-unsupported-pointer',
          name: 'Ok',
          pointer: '#/components/responses/Ok',
        }),
      ]))

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(output).toContain('export type GetUnsupportedResponse = unknown')
      expect(output).not.toContain('export type Ok =')
      expect(warnings).toHaveLength(1)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('typegen missing external schema refs are reported as unresolved analysis diagnostics', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'empty.yaml'), 'components:\n  schemas: {}\n')

    try {
      const result = analyzeExternalSchemaRefs(doc({
        paths: {
          '/missing-file': {
            get: {
              operationId: 'getMissingFile',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './missing.yaml#/components/schemas/User' } } },
                },
              },
            },
          },
          '/missing-pointer': {
            get: {
              operationId: 'getMissing',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { $ref: './empty.yaml#/components/schemas/User' } } },
                },
              },
            },
          },
        },
      }), basePath)

      expect(result.schemas).toEqual({})
      expect(result.refNameOverrides).toEqual({})
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'external-ref-read-failed',
          ref: './missing.yaml#/components/schemas/User',
          sourceFilePath: basePath,
          sourcePointer: '#/paths/~1missing-file/get/responses/200/content/application~1json/schema/$ref',
          pointer: '#/components/schemas/User',
        }),
        expect.objectContaining({
          code: 'external-ref-pointer-not-found',
          ref: './empty.yaml#/components/schemas/User',
          sourceFilePath: basePath,
          sourcePointer: '#/paths/~1missing-pointer/get/responses/200/content/application~1json/schema/$ref',
          pointer: '#/components/schemas/User',
        }),
      ]))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('generateTypes — operations', () => {
  it('경로 파라미터 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type GetUserPathParams =')
    expect(ts).toContain('id: string')
  })

  it('쿼리 파라미터 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersQueryParams =')
    expect(ts).toContain('page?: number')
    expect(ts).toContain('limit?: number')
  })

  it('요청 바디 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, email: { type: 'string' } },
                    required: ['name', 'email'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type CreateUserBody =')
    expect(ts).toContain('name: string')
    expect(ts).toContain('email: string')
  })

  it('응답 타입 (2xx)', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersResponse =')
    expect(ts).toContain('[]')
  })

  it('operationId 없으면 타입 생성 스킵', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).not.toContain('PathParams')
    expect(ts).not.toContain('Response')
  })

  it('banner 비활성화', () => {
    const parsed = parseDocument(doc({ components: { schemas: { X: { type: 'string' } } } }))
    const ts = generateTypes(parsed, { banner: false })
    expect(ts).not.toContain('Auto-generated')
  })
})

describe('generateTypes — Op 번들 타입', () => {
  it('Op 번들 타입 — GET with path params', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' }, name: { type: 'string' } },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type GetUserOp =')
    expect(ts).toContain("method: 'get'")
    expect(ts).toContain("path: '/users/{id}'")
    expect(ts).toContain('params: GetUserPathParams')
    expect(ts).toContain('response: GetUserResponse')
  })

  it('Op 번들 타입 — POST with body', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, email: { type: 'string' } },
                    required: ['name', 'email'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type CreateUserOp =')
    expect(ts).toContain("method: 'post'")
    expect(ts).toContain("path: '/users'")
    expect(ts).toContain('body: CreateUserBody')
    // no path params or query params in this op
    expect(ts).not.toContain('params: CreateUserPathParams')
    expect(ts).not.toContain('query: CreateUserQueryParams')
  })

  it('Op 번들 타입 — no body no params', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/health': {
          get: {
            operationId: 'healthCheck',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type HealthCheckOp =')
    expect(ts).toContain("method: 'get'")
    expect(ts).toContain("path: '/health'")
    // no body, no params, no response content
    expect(ts).not.toContain('body: HealthCheckBody')
    expect(ts).not.toContain('params: HealthCheckPathParams')
    expect(ts).not.toContain('response: HealthCheckResponse')
  })
})

describe('generateTypes — Error response types', () => {
  it('4xx 에러 응답 스키마 → Error 타입 생성', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } },
            responses: {
              '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } },
              '422': { description: 'Validation Error', content: { 'application/json': { schema: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } } } },
            },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).toContain('export type CreateUserError')
    expect(output).toContain('error: string')
  })

  it('Error 타입이 Op 번들에 포함', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
            responses: {
              '201': { description: 'Created' },
              '400': { description: 'Bad Request', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
            },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).toContain('error?: CreateUserError')
  })

  it('에러 응답 없으면 Error 타입 미생성', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/health': {
          get: {
            operationId: 'healthCheck',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).not.toContain('Error')
  })
})

describe('generateTypes — Response headers', () => {
  it('응답 헤더가 있으면 ResponseHeaders 타입 생성', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                headers: {
                  'X-Rate-Limit': { schema: { type: 'integer' } },
                  'X-Rate-Remaining': { schema: { type: 'integer' }, required: true },
                },
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
                  },
                },
              },
            },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersResponseHeaders =')
    expect(ts).toContain("'X-Rate-Limit'")
    expect(ts).toContain("'X-Rate-Remaining'")
    // ResponseHeaders should also appear in the Op bundle
    expect(ts).toContain('responseHeaders: ListUsersResponseHeaders')
  })
})

describe('generateTypes — Response links', () => {
  it('응답 링크가 있으면 ResponseLinks 타입과 Op 메타데이터를 생성한다', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/orders': {
          post: {
            operationId: 'createOrder',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { sku: { type: 'string' } },
                    required: ['sku'],
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                links: {
                  getOrder: {
                    operationId: 'getOrder',
                    parameters: {
                      orderId: '$response.body#/id',
                      tenantId: '$request.path.tenantId',
                    },
                    requestBody: '$request.body#/sku',
                    description: 'Fetch the created order',
                  },
                },
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))

    const ts = generateTypes(parsed)
    expect(ts).toContain('export type CreateOrderResponseLinks =')
    expect(ts).toContain('"getOrder": {')
    expect(ts).toContain('operationId: "getOrder"')
    expect(ts).toContain('"orderId": "$response.body#/id"')
    expect(ts).toContain('"tenantId": "$request.path.tenantId"')
    expect(ts).toContain('requestBody: "$request.body#/sku"')
    expect(ts).toContain('responseLinks: CreateOrderResponseLinks')
  })
})

describe('generateTypes — schema/operation 이름 충돌 방지', () => {
  it('스키마 이름이 Op Body 이름과 충돌하면 중복 생성 안 함', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreateUserBody' },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
      components: {
        schemas: {
          CreateUserBody: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    // CreateUserBody는 schema에서 1번만 정의
    const matches = ts.match(/export type CreateUserBody/g)
    expect(matches).toHaveLength(1)
    // 자기참조 없음
    expect(ts).not.toContain('export type CreateUserBody = CreateUserBody')
  })

  it('스키마 이름이 Op Response 이름과 충돌하면 중복 생성 안 함', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ListUsersResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ListUsersResponse: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    const matches = ts.match(/export type ListUsersResponse/g)
    expect(matches).toHaveLength(1)
  })

  it('충돌 없는 경우 정상 생성', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }))
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type CreateUserBody =')
    expect(ts).toContain('export type CreateUserOp =')
  })
})
