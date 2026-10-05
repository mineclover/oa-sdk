import { describe, it, expect } from 'vitest'
import { parseDocument, type OasDocument, type OasPathItem } from '@oa-sdk/parser'
import { generateClient } from '@oa-sdk/client'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeExternalSchemaRefs, generateTypes, generateTypesFromSpec } from '../../typegen/generate-types.js'
import { generateTypes as generateBrowserTypes, generateTypesFromSpec as generateBrowserTypesFromSpec } from '../../typegen/browser.js'
import { compareTypegenKeys } from '../../typegen/stable-order.js'

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

  it('동일한 계약은 source key 순서와 무관하게 같은 선언을 생성한다', () => {
    const first = doc({
      components: {
        schemas: {
          Zebra: {
            type: 'object',
            properties: { zebra: { type: 'string' }, ant: { type: 'string' } },
          },
          Ant: { type: 'string' },
        },
      },
      paths: {
        '/zebra': {
          get: {
            operationId: 'getZebra',
            parameters: [
              { name: 'z', in: 'query', schema: { type: 'string' } },
              { name: 'a', in: 'query', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'ok',
                headers: {
                  Zebra: { schema: { type: 'string' } },
                  Ant: { schema: { type: 'string' } },
                },
              },
            },
          },
        },
        '/ant': { get: { operationId: 'getAnt', responses: { '204': { description: 'ok' } } } },
      },
    })
    const reordered = doc({
      components: {
        schemas: {
          Ant: { type: 'string' },
          Zebra: {
            type: 'object',
            properties: { ant: { type: 'string' }, zebra: { type: 'string' } },
          },
        },
      },
      paths: {
        '/ant': { get: { operationId: 'getAnt', responses: { '204': { description: 'ok' } } } },
        '/zebra': {
          get: {
            operationId: 'getZebra',
            parameters: [
              { name: 'a', in: 'query', schema: { type: 'string' } },
              { name: 'z', in: 'query', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'ok',
                headers: {
                  Ant: { schema: { type: 'string' } },
                  Zebra: { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    })

    expect(generateTypesFromSpec(first)).toBe(generateTypesFromSpec(reordered))
    expect(generateBrowserTypesFromSpec(first)).toBe(generateBrowserTypesFromSpec(reordered))
  })

  it('생성 선언의 키 정렬은 호스트 로케일과 무관한 코드 포인트 순서를 쓴다', () => {
    expect(['å', 'z', 'ä'].sort(compareTypegenKeys)).toEqual(['z', 'ä', 'å'])

    const output = generateTypesFromSpec(doc({
      components: {
        schemas: {
          å: { type: 'string' },
          z: { type: 'string' },
          ä: { type: 'string' },
        },
      },
    }))

    expect(output.indexOf('export type z')).toBeLessThan(output.indexOf('export type Operation'))
    expect(output.indexOf('export type Operation')).toBeLessThan(output.indexOf('export type Operation2'))
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

  it('local nested component pointers receive collision-safe declarations in Node and browser output', () => {
    const spec = doc({
      components: {
        schemas: {
          Container: {
            type: 'object',
            properties: {
              embedded: {
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'string' } },
              },
              payload: { $ref: '#/components/schemas/Container/properties/embedded' },
            },
          },
          ContainerPropertiesEmbedded: { type: 'string' },
        },
      },
    })

    const unresolved = {
      schemas: spec.components!.schemas!,
      operations: [],
    }
    for (const output of [generateTypes(unresolved as any), generateBrowserTypes(unresolved as any)]) {
      expect(output).toContain('payload?: ContainerPropertiesEmbedded2')
      expect(output).toContain('export type ContainerPropertiesEmbedded2 = {')
      expect(output).not.toContain('payload?: Embedded')
    }
  })

  it('escapes generated JSDoc terminators from schema, property, operation, and parameter text', () => {
    const hostile = 'safe */\nexport const injected = true\n/* still documentation'
    const output = generateTypesFromSpec(doc({
      components: {
        schemas: {
          Payload: {
            type: 'object',
            description: hostile,
            properties: { value: { type: 'string', description: hostile } },
          },
        },
      },
      paths: {
        '/payload': {
          get: {
            operationId: 'getPayload',
            summary: hostile,
            parameters: [{ name: 'filter', in: 'query', description: hostile, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Payload' } } } } },
          },
        },
      },
    }))

    expect(output).toContain('*\\/')
    expect(output).not.toContain('*/\nexport const injected')
  })
})

describe('generateTypes — operation identifier safety', () => {
  it('문법상 안전하지 않거나 충돌하는 operationId를 고유한 타입 이름으로 정규화한다', () => {
    const output = generateTypesFromSpec(doc({
      paths: {
        '/a': { get: { operationId: 'get.user', responses: { '200': { description: 'OK' } } } },
        '/b': { get: { operationId: 'list-users', responses: { '200': { description: 'OK' } } } },
        '/c': { get: { operationId: 'list_users', responses: { '200': { description: 'OK' } } } },
      },
    }))
    expect(output).toContain('export type GetUserOp')
    expect(output).toContain('export type ListUsersOp')
    expect(output).toContain('export type ListUsers2Op')
    expect(output).not.toContain('Get.user')
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

  it('external aliases ignore response names that are not generated from the documented success response', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-'))
    const basePath = join(tmp, 'api.yaml')
    writeFileSync(join(tmp, 'models.yaml'), [
      'components:',
      '  schemas:',
      '    ListUsersResponse:',
      '      type: object',
      '      required: [id]',
      '      properties:',
      '        id:',
      '          type: string',
      '',
    ].join('\n'))

    try {
      const input = doc({
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              responses: {
                '200': {
                  description: 'OK',
                },
                '201': {
                  description: 'Created',
                  content: { 'application/json': { schema: { $ref: './models.yaml#/components/schemas/ListUsersResponse' } } },
                },
              },
            },
          },
        },
      })

      const analysis = analyzeExternalSchemaRefs(input, basePath)
      expect(analysis.refNameOverrides['./models.yaml#/components/schemas/ListUsersResponse']).toBe('ListUsersResponse')
      expect(analysis.schemas.ListUsersResponse).toBeDefined()
      expect(analysis.diagnostics).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'external-schema-shadows-operation',
          name: 'ListUsersResponse',
        }),
      ]))

      const warnings: string[] = []
      const output = generateTypesFromSpec(input, { basePath, warnings })
      expect(output).toContain('export type ListUsersResponse =')
      expect(output).not.toContain('export type ModelsListUsersResponse =')
      expect(output).not.toContain('response: ListUsersResponse')
      expect(warnings).toHaveLength(0)
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

  it('operation parameter $ref에서도 쿼리 파라미터 타입을 생성한다', () => {
    const parsed = parseDocument(doc({
      components: {
        parameters: {
          Page: { name: 'page', in: 'query', schema: { type: 'integer' } },
        },
      },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [{ $ref: '#/components/parameters/Page' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }), [])
    const ts = generateTypes(parsed)
    expect(ts).toContain('export type ListUsersQueryParams =')
    expect(ts).toContain('page?: number')
  })

  it('요청 바디 타입', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              required: true,
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
    expect(ts).toContain('/** @oaOperation GET /users/{id} */')
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
              required: true,
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
    expect(ts).toContain('/** @oaOperation POST /users */')
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
    expect(ts).toContain('/** @oaOperation GET /health */')
    expect(ts).toContain('export type HealthCheckOp =')
    expect(ts).toContain("method: 'get'")
    expect(ts).toContain("path: '/health'")
    // no body, no params, no response content
    expect(ts).not.toContain('body: HealthCheckBody')
    expect(ts).not.toContain('params: HealthCheckPathParams')
    expect(ts).not.toContain('response: HealthCheckResponse')
  })

  it('optional request body and header parameters retain their OpenAPI requiredness', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/exports': {
          post: {
            operationId: 'requestExport',
            parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
            requestBody: {
              required: false,
              content: { 'application/json': { schema: { type: 'object', properties: { format: { type: 'string' } } } } },
            },
            responses: { '202': { description: 'Accepted' } },
          },
        },
      },
    }))

    const ts = generateTypes(parsed)
    expect(ts).toContain('export type RequestExportHeaderParams =')
    expect(ts).toContain("'Idempotency-Key': string")
    expect(ts).toContain('body?: RequestExportBody')
    expect(ts).toContain('headers?: RequestExportHeaderParams')
  })

  it('querystring parameter is represented as an explicit raw query string type', () => {
    const parsed = parseDocument(doc({
      paths: {
        '/search': {
          get: {
            operationId: 'querystringSearch',
            parameters: [{
              name: 'query',
              in: 'querystring',
              required: true,
              content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
            }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }))

    const ts = generateTypes(parsed)
    expect(ts).toContain('export type QuerystringSearchQueryString = string')
    expect(ts).toContain('querystring: QuerystringSearchQueryString')
  })

  const ambiguousQuerystringCases: Array<{ parameters: unknown[] }> = [
    { parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'whole', in: 'querystring', content: { 'text/plain': {} } }] },
    { parameters: [{ name: 'one', in: 'querystring', content: { 'text/plain': {} } }, { name: 'two', in: 'querystring', content: { 'application/json': {} } }] },
  ]

  it.each(ambiguousQuerystringCases)('fails fast rather than selecting an ambiguous querystring parameter', ({ parameters }) => {
    const spec = doc({
      paths: {
        '/search': {
          get: {
            operationId: 'ambiguousSearch',
            parameters: parameters as any,
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    })
    expect(() => generateTypesFromSpec(spec)).toThrow(/Invalid OpenAPI querystring parameters/)
  })

  it('sanitizes colliding non-identifier component names and local refs', () => {
    const ts = generateTypesFromSpec(doc({
      components: {
        schemas: {
          'user profile': {
            type: 'object',
            properties: {
              next: { $ref: '#/components/schemas/user-profile' },
              encoded: { $ref: '#/components/schemas/user%20profile' },
            },
          },
          'user-profile': { type: 'object', properties: { id: { type: 'string' } } },
          'a/b': { type: 'object', properties: { id: { type: 'string' } } },
          'a~b': { type: 'object', properties: { id: { type: 'string' } } },
          Holder: {
            type: 'object',
            properties: {
              slash: { $ref: '#/components/schemas/a~1b' },
              tilde: { $ref: '#/components/schemas/a~0b' },
            },
          },
        },
      },
    }))

    expect(ts).toContain('export type UserProfile =')
    expect(ts).toContain('export type UserProfile2 =')
    expect(ts).toContain('next?: UserProfile2')
    expect(ts).toContain('encoded?: UserProfile')
    expect(ts).toContain('slash?: AB')
    expect(ts).toContain('tilde?: AB2')
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

  it('복수 에러 응답 body를 하나의 Error union으로 보존한다', () => {
    const spec = {
      openapi: '3.2.0', info: { title: 'Test', version: '0.0.0' },
      paths: {
        '/authorization/check': {
          post: {
            operationId: 'checkAuthorization',
            responses: {
              '200': { description: 'Allowed', content: { 'application/json': { schema: { type: 'object' } } } },
              '400': { description: 'Bad Request', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
              '403': { description: 'Denied', content: { 'application/json': { schema: { type: 'object', properties: { allowed: { type: 'boolean' } } } } } },
            },
          },
        },
      },
    }
    const output = generateTypes(parseDocument(spec as any))
    expect(output).toContain('export type CheckAuthorizationError = {')
    expect(output).toContain('} | {')
    expect(output).toContain('export type CheckAuthorizationErrorByStatus = {')
    expect(output).toContain('403: {')
    expect(output).toContain('error?: string')
    expect(output).toContain('allowed?: boolean')
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

describe('generateTypes — webhooks', () => {
  it('webhook request body 타입과 Op 메타데이터를 생성한다', () => {
    const ts = generateTypesFromSpec(doc({
      webhooks: {
        orderCreated: {
          post: {
            operationId: 'orderCreatedWebhook',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['orderId'],
                    properties: { orderId: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '200': { description: 'Acknowledged' },
            },
          },
        },
      },
    }))

    expect(ts).toContain('export type OrderCreatedWebhookBody =')
    expect(ts).toContain('orderId: string')
    expect(ts).toContain('export type OrderCreatedWebhookOp = {')
    expect(ts).toContain("method: 'post'")
    expect(ts).toContain("path: '/webhooks/orderCreated'")
    expect(ts).toContain('body: OrderCreatedWebhookBody')
  })
})

/** The body of `export type <name> = { ... }` up to its closing brace. */
function objectDeclaration(ts: string, name: string): string {
  const start = ts.indexOf(`export type ${name} = {`)
  expect(start, `${name} is declared`).toBeGreaterThanOrEqual(0)
  return ts.slice(start, ts.indexOf('\n}', start) + 2)
}

function exportedTypeNames(ts: string): Set<string> {
  return new Set([...ts.matchAll(/^export (?:type|interface) ([A-Za-z_$][\w$]*)/gm)].map(match => match[1]!))
}

/** The type names that a client generated with `typesImport: './types.js'` imports. */
function clientImportedTypeNames(spec: OasDocument): string[] {
  const client = generateClient(structuredClone(spec), { typesImport: './types.js' })
  const importLine = client.match(/^import type \{ ([^}]+) \} from '\.\/types\.js'$/m)
  expect(importLine, 'client imports operation types').not.toBeNull()
  return importLine![1]!.split(',').map(name => name.trim())
}

/**
 * `generateTypesFromSpec` parses without the deref pass so schema `$ref`s stay
 * name references. Reference Objects at operation positions (Path Item,
 * parameter, requestBody) are still resolved by the parser's route indexer, so
 * the operation types match what the deref-based client generator imports.
 */
describe('generateTypesFromSpec — referenced operation components', () => {
  const json = (schema: unknown) => ({ 'application/json': { schema } })
  const petRef = { $ref: '#/components/schemas/Pet' }

  function referencedComponentsSpec(): OasDocument {
    return doc({
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id', 'name'],
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
        parameters: {
          Limit: { name: 'limit', in: 'query', description: 'Component limit description', schema: { type: 'integer' } },
        },
        requestBodies: {
          PetBody: { required: true, content: json(petRef) },
        },
        responses: {
          PetCreated: { description: 'Created', content: json(petRef) },
        },
        pathItems: {
          PetById: {
            parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
            get: {
              operationId: 'getPet',
              responses: { '200': { description: 'OK', content: json(petRef) } },
            },
          },
          PetAdded: {
            post: {
              operationId: 'petAddedWebhook',
              requestBody: { $ref: '#/components/requestBodies/PetBody' },
              responses: { '204': { description: 'Acknowledged' } },
            },
          },
        },
      },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            parameters: [{ $ref: '#/components/parameters/Limit', description: 'Page size for this listing' }],
            responses: { '200': { description: 'OK', content: json({ type: 'array', items: petRef }) } },
          },
          post: {
            operationId: 'createPet',
            requestBody: { $ref: '#/components/requestBodies/PetBody' },
            responses: { '201': { $ref: '#/components/responses/PetCreated' } },
          },
        },
        '/pets/{petId}': { $ref: '#/components/pathItems/PetById' },
      },
      webhooks: {
        petAdded: { $ref: '#/components/pathItems/PetAdded' },
      },
    } as Partial<OasDocument>)
  }

  it('a $ref requestBody yields <Op>Body that keeps the schema name and a body field on <Op>Op', () => {
    const ts = generateTypesFromSpec(referencedComponentsSpec())

    expect(ts).toContain('export type CreatePetBody = Pet\n')
    const op = objectDeclaration(ts, 'CreatePetOp')
    expect(op).toContain('body: CreatePetBody')
    expect(op).toContain('response: CreatePetResponse')
  })

  it('a $ref response yields <Op>Response from the referenced response', () => {
    const ts = generateTypesFromSpec(referencedComponentsSpec())

    expect(ts).toContain('export type CreatePetResponse = Pet\n')
  })

  it('a Path Item $ref under paths yields the operation types of the referenced item', () => {
    const ts = generateTypesFromSpec(referencedComponentsSpec())

    expect(objectDeclaration(ts, 'GetPetPathParams')).toContain('petId: string')
    expect(ts).toContain('export type GetPetResponse = Pet\n')
    const op = objectDeclaration(ts, 'GetPetOp')
    expect(op).toContain("path: '/pets/{petId}'")
    expect(op).toContain('params: GetPetPathParams')
    expect(op).toContain('response: GetPetResponse')
  })

  it('a Path Item $ref under webhooks yields the webhook operation types', () => {
    const ts = generateTypesFromSpec(referencedComponentsSpec())

    expect(ts).toContain('export type PetAddedWebhookBody = Pet\n')
    const op = objectDeclaration(ts, 'PetAddedWebhookOp')
    expect(op).toContain("path: '/webhooks/petAdded'")
    expect(op).toContain('body: PetAddedWebhookBody')
  })

  it('a description beside a parameter $ref overrides the referenced description', () => {
    const ts = generateTypesFromSpec(referencedComponentsSpec())

    const params = objectDeclaration(ts, 'ListPetsQueryParams')
    expect(params).toContain('/** Page size for this listing */')
    expect(params).toContain('limit?: number')
    expect(params).not.toContain('Component limit description')
  })

  // OAS 3.2 §4.8.23: properties added to a Reference Object other than
  // `summary` and `description` SHALL be ignored.
  it('ignores Reference Object siblings other than summary and description', () => {
    const spec = referencedComponentsSpec()
    const pets = spec.paths!['/pets'] as OasPathItem
    pets.get!.parameters = [{
      $ref: '#/components/parameters/Limit',
      name: 'size',
      in: 'header',
      required: true,
      description: 'Page size for this listing',
    }]
    pets.post!.requestBody = { $ref: '#/components/requestBodies/PetBody', required: false, content: {} }
    pets.post!.responses = { '201': { $ref: '#/components/responses/PetCreated', content: {} } }

    const ts = generateTypesFromSpec(spec)

    const params = objectDeclaration(ts, 'ListPetsQueryParams')
    expect(params).toContain('/** Page size for this listing */')
    expect(params).toContain('limit?: number')
    expect(ts).not.toContain('ListPetsHeaderParams')
    expect(ts).toContain('export type CreatePetBody = Pet\n')
    expect(ts).toContain('export type CreatePetResponse = Pet\n')
    expect(objectDeclaration(ts, 'CreatePetOp')).toContain('body: CreatePetBody')
  })

  // Typegen emits no callback types, but it declares a local alias for every
  // nested component schema ref it finds in an operation, callbacks included.
  // A `$ref` callback therefore yields the aliases of the same callback written
  // inline, and aliases whose base names collide are numbered in sorted ref order.
  it('a $ref callback yields the nested schema aliases of the same inline callback', () => {
    const accountProperty = (name: string) => ({ $ref: `#/components/schemas/Account/properties/${name}` })
    const event = {
      '{$request.body#/callbackUrl}': {
        post: {
          requestBody: { content: json(accountProperty('Owner')) },
          responses: { '204': { description: 'Received' } },
        },
      },
    }
    function subscriptionSpec(callback: unknown): OasDocument {
      return doc({
        components: {
          schemas: {
            Account: {
              type: 'object',
              properties: {
                owner: { type: 'object', properties: { id: { type: 'string' } } },
                Owner: { type: 'object', properties: { name: { type: 'string' } } },
              },
            },
          },
          callbacks: { Event: event },
        },
        paths: {
          '/subscriptions': {
            post: {
              operationId: 'subscribe',
              callbacks: { onEvent: callback },
              responses: { '201': { description: 'Created', content: json(accountProperty('owner')) } },
            },
          },
        },
      } as Partial<OasDocument>)
    }

    const ts = generateTypesFromSpec(subscriptionSpec({ $ref: '#/components/callbacks/Event' }))

    expect(ts).toBe(generateTypesFromSpec(subscriptionSpec(structuredClone(event))))
    expect(objectDeclaration(ts, 'AccountPropertiesOwner')).toContain('name?: string')
    expect(objectDeclaration(ts, 'AccountPropertiesOwner2')).toContain('id?: string')
    expect(ts).toContain('export type SubscribeResponse = AccountPropertiesOwner2\n')
  })

  // Scope: Reference Objects at operation level only (Path Item, parameter,
  // requestBody, response) without siblings other than summary/description.
  // References nested inside those objects, such as a response header or OAS 3.2
  // media-type `$ref`, are a known typegen gap (docs/internal/spec.md, "typegen
  // operation refs") and are not covered here.
  it('declares the operation types the generated client imports for operation-level $refs', () => {
    const spec = referencedComponentsSpec()
    const ts = generateTypesFromSpec(structuredClone(spec))
    const imported = clientImportedTypeNames(spec)
    expect(imported).toEqual(expect.arrayContaining(['CreatePetBody', 'CreatePetResponse', 'GetPetPathParams', 'GetPetResponse']))

    const exported = exportedTypeNames(ts)
    expect(imported.filter(name => !exported.has(name))).toEqual([])
  })

  // Known gap (docs/internal/spec.md, "typegen operation refs", gap 3):
  // generateClient parses with the default deref pass, which still merges every
  // sibling of a Reference Object into its target, while typegen applies only
  // `summary`/`description`. A sibling that changes which operation types exist
  // makes the client import a type that types.ts does not declare. Once the deref
  // pass applies only `summary`/`description` at Reference Object positions, both
  // sides agree and this test must expect no missing names.
  it('known gap: the client imports types that types.ts lacks when other Reference Object siblings apply under deref', () => {
    const spec = referencedComponentsSpec()
    spec.components!.requestBodies!.PetUpload = {
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
    }
    const pets = spec.paths!['/pets'] as OasPathItem
    pets.get!.parameters = [{ $ref: '#/components/parameters/Limit', name: 'size', in: 'header' }]
    pets.post!.requestBody = {
      $ref: '#/components/requestBodies/PetUpload',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
    }

    const ts = generateTypesFromSpec(structuredClone(spec))
    const imported = clientImportedTypeNames(spec)

    expect(objectDeclaration(ts, 'ListPetsQueryParams')).toContain('limit?: number')
    expect(imported).toEqual(expect.arrayContaining(['CreatePetBody', 'ListPetsHeaderParams']))
    const exported = exportedTypeNames(ts)
    expect(imported.filter(name => !exported.has(name)).sort()).toEqual(['CreatePetBody', 'ListPetsHeaderParams'])
  })
})

describe('generateTypesFromSpec — additionalOperations', () => {
  const json = (schema: unknown) => ({ 'application/json': { schema } })

  // OAS 3.2 forbids an additionalOperations entry for a method that a fixed field
  // can define; the parser's route indexer ignores such an entry when the Path
  // Item defines that fixed field.
  it('emits entries under their verbatim method and skips one that repeats a fixed-field method', () => {
    const spec = doc({
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '200': { description: 'OK', content: json({ type: 'string' }) } } },
          additionalOperations: {
            POST: { operationId: 'create-item', responses: { '200': { description: 'OK', content: json({ type: 'number' }) } } },
            COPY: { operationId: 'copyItem', responses: { '200': { description: 'OK', content: json({ type: 'boolean' }) } } },
          },
        },
      },
    } as Partial<OasDocument>)

    for (const ts of [generateTypesFromSpec(structuredClone(spec)), generateBrowserTypesFromSpec(structuredClone(spec))]) {
      expect(ts).toContain('export type CopyItemResponse = boolean\n')
      expect(objectDeclaration(ts, 'CopyItemOp')).toContain("method: 'COPY'")
      // The ignored entry's operationId has the same type base name, so the fixed
      // operation keeps the unnumbered name.
      expect(ts).toContain('export type CreateItemResponse = string\n')
      expect(objectDeclaration(ts, 'CreateItemOp')).toContain("method: 'post'")
      expect(ts).not.toContain('CreateItem2')
      expect(ts).not.toContain("method: 'POST'")
    }
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
