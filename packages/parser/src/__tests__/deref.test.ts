import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { derefSpec, derefSpecWithDiagnostics } from '../deref.js'
import { derefInternalSpec } from '../deref-internal.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function spec(overrides?: Record<string, unknown>) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('derefSpec', () => {
  it('basic $ref resolution (#/components/schemas/Foo)', () => {
    const input = spec({
      components: { schemas: { Foo: { type: 'string' } } },
      paths: { '/x': { $ref: '#/components/schemas/Foo' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/x']).toEqual({ type: 'string' })
  })

  it('nested $ref in object properties', () => {
    const input = spec({
      components: {
        schemas: {
          Name: { type: 'string' },
          User: {
            type: 'object',
            properties: {
              name: { $ref: '#/components/schemas/Name' },
            },
          },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    const user = schemas.User as Record<string, unknown>
    const props = user.properties as Record<string, unknown>
    expect(props.name).toEqual({ type: 'string' })
  })

  it('$ref sibling 필드를 보존한다', () => {
    const input = spec({
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
                annotations: { owner: 'identity' },
              },
            },
          },
        },
      },
    })

    const result = derefSpec(input) as any
    expect(result.components.schemas.User.properties.id).toEqual({
      type: 'string',
      format: 'uuid',
      readOnly: true,
      description: '사용자 ID',
      annotations: { owner: 'identity' },
    })
  })

  it('$ref sibling의 properties와 required를 구조적으로 병합한다', () => {
    const input = spec({
      components: {
        schemas: {
          Base: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
          Extended: {
            $ref: '#/components/schemas/Base',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
    })

    const result = derefSpec(input) as any
    expect(result.components.schemas.Extended).toEqual({
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    })
  })

  it('chain ref (A→B→C)', () => {
    const input = spec({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/C' },
          C: { type: 'integer' },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    expect(schemas.A).toEqual({ type: 'integer' })
    expect(schemas.B).toEqual({ type: 'integer' })
  })

  it('circular ref (A→B→A) returns {} at cycle point', () => {
    const input = spec({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    const schemas = (result.components as Record<string, unknown>).schemas as Record<string, unknown>
    // A resolves B, B tries to resolve A but hits cycle → {}
    expect(schemas.A).toEqual({})
    expect(schemas.B).toEqual({})
  })

  it('cycleStrategy preserve-ref preserves cycle ref', () => {
    const input = spec({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: {
                $ref: '#/components/schemas/Node',
                description: 'recursive child',
              },
            },
          },
        },
      },
    })

    const result = derefSpec(input, { cycleStrategy: 'preserve-ref' }) as any
    expect(result.components.schemas.Node.properties.child.properties.child).toEqual({
      $ref: '#/components/schemas/Node',
      description: 'recursive child',
    })
  })

  it('external ref (./file.yaml) is preserved unchanged', () => {
    const input = spec({
      paths: { '/ext': { $ref: './file.yaml#/Foo' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({ $ref: './file.yaml#/Foo' })
  })

  it('non-existent ref preserves original node', () => {
    const input = spec({
      paths: { '/miss': { $ref: '#/components/schemas/Missing' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/miss']).toEqual({
      $ref: '#/components/schemas/Missing',
    })
  })

  it('dereferences the fields beside an unresolved $ref in Node and browser deref paths', () => {
    const input = spec({
      paths: {
        '/miss': {
          $ref: '#/components/pathItems/Missing',
          get: {
            parameters: [{ $ref: '#/components/parameters/Limit' }],
            responses: { '200': { $ref: '#/components/responses/Ok' } },
          },
        },
        '/external': {
          $ref: './paths.yaml#/Item',
          parameters: [{ $ref: '#/components/parameters/Limit' }],
        },
      },
      components: {
        parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } } },
        responses: { Ok: { description: 'OK' } },
      },
    })
    const limit = { name: 'limit', in: 'query', schema: { type: 'integer' } }

    for (const result of [derefSpec(structuredClone(input)), derefInternalSpec(structuredClone(input))]) {
      const paths = result.paths as Record<string, unknown>
      expect(paths['/miss']).toEqual({
        $ref: '#/components/pathItems/Missing',
        get: { parameters: [limit], responses: { '200': { description: 'OK' } } },
      })
      expect(paths['/external']).toEqual({ $ref: './paths.yaml#/Item', parameters: [limit] })
    }
  })

  it('해석 실패 diagnostic을 수집한다', () => {
    const input = spec({
      paths: { '/miss': { $ref: '#/components/schemas/Missing' } },
    })

    const { diagnostics } = derefSpecWithDiagnostics(input)
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'ref-not-found',
        ref: '#/components/schemas/Missing',
      }),
    ])
  })

  it('RFC 6901 escape (~1 → /)', () => {
    const input = spec({
      components: { 'a/b': { value: 42 } },
      paths: { '/esc': { $ref: '#/components/a~1b' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/esc']).toEqual({ value: 42 })
  })

  it('URI fragment percent decoding happens before RFC 6901 token decoding', () => {
    const input = spec({
      paths: {
        '/2.0/repositories/{username}': {
          get: { operationId: 'getRepository', responses: { '200': { description: 'OK' } } },
        },
        '/alias': { $ref: '#/paths/~12.0~1repositories~1%7Busername%7D' },
      },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/alias']).toEqual({
      get: { operationId: 'getRepository', responses: { '200': { description: 'OK' } } },
    })
  })

  it('malformed URI percent escapes remain unresolved rather than resolving a literal key', () => {
    const input = spec({
      components: { schemas: { 'Bad%ZZ': { type: 'string' } } },
      paths: { '/bad': { $ref: '#/components/schemas/Bad%ZZ' } },
    })

    const { document, diagnostics } = derefSpecWithDiagnostics(input)
    expect((document.paths as Record<string, unknown>)['/bad']).toEqual({ $ref: '#/components/schemas/Bad%ZZ' })
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-ref', ref: '#/components/schemas/Bad%ZZ' }),
    ]))
  })

  it('malformed RFC 6901 ~ escapes remain unresolved rather than matching literal keys', () => {
    const input = spec({
      components: { schemas: { 'Bad~2': { type: 'string' } } },
      paths: { '/bad': { $ref: '#/components/schemas/Bad~2' } },
    })

    const { document, diagnostics } = derefSpecWithDiagnostics(input)
    expect((document.paths as Record<string, unknown>)['/bad']).toEqual({ $ref: '#/components/schemas/Bad~2' })
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-ref', ref: '#/components/schemas/Bad~2' }),
    ]))
  })

  it('preserves own __proto__ component and property keys in Node and browser deref paths', () => {
    const input = JSON.parse([
      '{"openapi":"3.2.0","info":{"title":"T","version":"0"},"paths":{},',
      '"components":{"schemas":{"__proto__":{"type":"object","properties":{"__proto__":{"type":"string"}}}}}}',
    ].join('')) as Record<string, unknown>

    for (const result of [derefSpec(input), derefInternalSpec(input)]) {
      const schemas = ((result as Record<string, unknown>).components as Record<string, unknown>).schemas as Record<string, unknown>
      expect(Object.hasOwn(schemas, '__proto__')).toBe(true)
      const schema = schemas['__proto__'] as Record<string, unknown>
      const properties = schema.properties as Record<string, unknown>
      expect(Object.hasOwn(properties, '__proto__')).toBe(true)
      expect(properties['__proto__']).toEqual({ type: 'string' })
    }
  })

  it('ignores inherited $ref properties in Node and browser deref paths', () => {
    const inherited = Object.create({ $ref: '#/components/pathItems/Users' })
    const input = spec({
      paths: { '/users': inherited },
      components: { pathItems: { Users: { get: { responses: { '200': { description: 'OK' } } } } } },
    })

    for (const result of [derefSpec(input), derefInternalSpec(input)]) {
      expect((result.paths as Record<string, unknown>)['/users']).toEqual({})
    }
  })
})

describe('derefSpec — external file $ref', () => {
  const tmpDir = join(tmpdir(), `oa-sdk-deref-test-${Date.now()}`)
  const mainFile = join(tmpDir, 'main.json')
  const commonFile = join(tmpDir, 'common.json')
  const yamlFile = join(tmpDir, 'shared.yaml')

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(commonFile, JSON.stringify({
      schemas: {
        Shared: { type: 'string', description: 'shared type' },
      },
    }))
    writeFileSync(yamlFile, [
      'components:',
      '  schemas:',
      '    SharedYaml:',
      '      type: object',
      '      required: [id]',
      '      properties:',
      '        id:',
      '          type: string',
      '          format: uuid',
      '    Wrapper:',
      '      type: object',
      '      properties:',
      '        id:',
      '          $ref: "#/components/schemas/SharedYaml/properties/id"',
      '',
    ].join('\n'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('외부 파일 $ref 해결 (상대 경로)', () => {
    const input = spec({
      paths: {
        '/ext': { $ref: './common.json#/schemas/Shared' },
      },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({
      type: 'string',
      description: 'shared type',
    })
  })

  it('bare relative external ref를 base 문서 기준으로 해소한다', () => {
    const input = spec({
      paths: {
        '/bare-relative': { $ref: 'common.json#/schemas/Shared' },
      },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/bare-relative']).toEqual({
      type: 'string',
      description: 'shared type',
    })
  })

  it('외부 YAML 파일 $ref 해결', () => {
    const input = spec({
      paths: {
        '/ext-yaml': { $ref: './shared.yaml#/components/schemas/SharedYaml' },
      },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext-yaml']).toEqual({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    })
  })

  it('외부 YAML 내부의 문서 로컬 $ref를 해당 파일 root 기준으로 해소', () => {
    const input = spec({
      paths: {
        '/ext-yaml-local': { $ref: './shared.yaml#/components/schemas/Wrapper' },
      },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext-yaml-local']).toEqual({
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
    })
  })

  it('외부 YAML 내부의 상대 $ref를 해당 파일 기준으로 해소', () => {
    writeFileSync(join(tmpDir, 'nested.yaml'), [
      'components:',
      '  schemas:',
      '    User:',
      '      type: object',
      '      properties:',
      '        role:',
      '          $ref: "./roles.yaml#/components/schemas/Role"',
      '',
    ].join('\n'))
    writeFileSync(join(tmpDir, 'roles.yaml'), [
      'components:',
      '  schemas:',
      '    Role:',
      '      type: string',
      '      enum: [admin, user]',
      '',
    ].join('\n'))

    const input = spec({
      paths: {
        '/nested': { $ref: './nested.yaml#/components/schemas/User' },
      },
    })

    const result = derefSpec(input, { basePath: mainFile }) as any
    expect(result.paths['/nested'].properties.role).toEqual({
      type: 'string',
      enum: ['admin', 'user'],
    })
  })

  it('root pointer # 해소', () => {
    const input = { $ref: '#', title: 'Root' }
    const result = derefSpec(input) as Record<string, unknown>
    expect(result.title).toBe('Root')
  })

  it('basePath 미지정 시 외부 ref 원본 유지', () => {
    const input = spec({
      paths: { '/ext': { $ref: './common.json#/schemas/Shared' } },
    })

    const result = derefSpec(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({
      $ref: './common.json#/schemas/Shared',
    })
  })

  it('존재하지 않는 외부 파일 → 원본 유지', () => {
    const input = spec({
      paths: { '/ext': { $ref: './nonexistent.json#/schemas/Foo' } },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({
      $ref: './nonexistent.json#/schemas/Foo',
    })
  })

  it('an unresolved $ref inside an external file dereferences its siblings against that file', () => {
    writeFileSync(join(tmpDir, 'partial.json'), JSON.stringify({
      Item: {
        $ref: '#/components/pathItems/Missing',
        get: { parameters: [{ $ref: '#/components/parameters/Local' }] },
      },
      components: { parameters: { Local: { name: 'fromPartial', in: 'query' } } },
    }))
    const input = spec({
      paths: { '/ext': { $ref: './partial.json#/Item' } },
      // Same pointers in the entry document must not be used for partial.json refs.
      components: {
        pathItems: { Missing: { delete: { operationId: 'entryDelete' } } },
        parameters: { Local: { name: 'fromEntry', in: 'query' } },
      },
    })

    const { document, diagnostics } = derefSpecWithDiagnostics(input, { basePath: mainFile })
    expect((document.paths as Record<string, unknown>)['/ext']).toEqual({
      $ref: '#/components/pathItems/Missing',
      get: { parameters: [{ name: 'fromPartial', in: 'query' }] },
    })
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'ref-not-found', ref: '#/components/pathItems/Missing' }),
    ])
  })

  it('외부 파일 내 존재하지 않는 포인터 → 원본 유지', () => {
    const input = spec({
      paths: { '/ext': { $ref: './common.json#/schemas/Missing' } },
    })

    const result = derefSpec(input, { basePath: mainFile }) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/ext']).toEqual({
      $ref: './common.json#/schemas/Missing',
    })
  })
})
