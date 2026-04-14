import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { derefSpec, derefSpecWithDiagnostics } from '../deref.js'
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
