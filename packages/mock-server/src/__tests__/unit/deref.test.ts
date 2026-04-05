/**
 * core/deref.ts — internal $ref 인라인 전개 단위 테스트
 */
import { describe, it, expect } from 'vitest'
import { derefSpec } from '@oa-sdk/parser'
import type { OasDocument } from '@oa-sdk/parser'

function spec(overrides: Partial<OasDocument> & { components?: unknown }): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'T', version: '0' },
    paths: {},
    ...overrides,
  } as OasDocument
}

// ─── 기본 ref 해석 ────────────────────────────────────────────────────────────

describe('기본 $ref 해석', () => {
  it('#/components/schemas/Foo → 인라인 전개', () => {
    const s = spec({
      components: { schemas: { Foo: { type: 'string' } } },
      paths: {
        '/test': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } },
            },
            responses: {},
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).post.requestBody.content['application/json'].schema
    expect(schema).toEqual({ type: 'string' })
    expect('$ref' in schema).toBe(false)
  })

  it('중첩 object 내 $ref도 전개', () => {
    const s = spec({
      components: { schemas: { Name: { type: 'string', minLength: 1 } } },
      paths: {
        '/test': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { $ref: '#/components/schemas/Name' } },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const props = (resolved.paths!['/test'] as any).post.requestBody.content['application/json'].schema.properties
    expect(props.name).toEqual({ type: 'string', minLength: 1 })
  })

  it('배열 내 $ref도 전개 (allOf 등)', () => {
    const s = spec({
      components: {
        schemas: {
          A: { type: 'object', properties: { x: { type: 'integer' } } },
        },
      },
      paths: {
        '/test': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/A' }] } },
              },
            },
            responses: {},
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const allOf = (resolved.paths!['/test'] as any).post.requestBody.content['application/json'].schema.allOf
    expect(allOf[0]).toEqual({ type: 'object', properties: { x: { type: 'integer' } } })
  })
})

// ─── 연쇄 ref ────────────────────────────────────────────────────────────────

describe('연쇄 $ref 해석', () => {
  it('A → B → C 체인 전개', () => {
    const s = spec({
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/C' },
          C: { type: 'integer', minimum: 0 },
        },
      },
      paths: {
        '/test': {
          get: {
            parameters: [{ name: 'x', in: 'query', schema: { $ref: '#/components/schemas/A' } }],
            responses: {},
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.parameters[0].schema
    expect(schema).toEqual({ type: 'integer', minimum: 0 })
  })
})

// ─── 순환 참조 ────────────────────────────────────────────────────────────────

describe('순환 참조 처리', () => {
  it('직접 순환 → 빈 스키마로 대체 (크래시 없음)', () => {
    const s = spec({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { child: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Node' } },
                },
              },
            },
          },
        },
      },
    })
    expect(() => derefSpec(s)).not.toThrow()
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // 루트 Node는 전개됨, child는 순환이므로 {}
    expect(schema.type).toBe('object')
    expect(schema.properties.child).toEqual({})
  })
})

// ─── 외부 참조 ────────────────────────────────────────────────────────────────

describe('외부 $ref — 원본 유지', () => {
  it('./external.yaml ref → 원본 $ref 객체 유지', () => {
    const s = spec({
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: './external.yaml#/schemas/Foo' } },
                },
              },
            },
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ $ref: './external.yaml#/schemas/Foo' })
  })
})

// ─── null 값 포함 스키마 ──────────────────────────────────────────────────────

describe('null 값 포함 $ref 해석', () => {
  it('nullable: null 필드가 있는 스키마도 정상 전개', () => {
    // resolvePointer가 null 값을 "not found" 센티널로 오인하면 전개 실패
    const s = spec({
      components: {
        schemas: {
          Nullable: {
            type: 'object',
            properties: {
              val: { type: 'string' },
              nothing: null as any, // 실제 null 값
            },
          },
        },
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Nullable' } } },
              },
            },
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // $ref가 유효하게 전개되어야 함
    expect(schema.type).toBe('object')
    expect('$ref' in schema).toBe(false)
    // null인 필드도 그대로 유지
    expect(schema.properties.nothing).toBeNull()
  })
})

// ─── JSON Pointer 이스케이프 ──────────────────────────────────────────────────

describe('RFC 6901 JSON Pointer 이스케이프', () => {
  it('~1 → / 디코딩', () => {
    const s = spec({
      components: { schemas: { 'my/schema': { type: 'boolean' } } },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/my~1schema' } },
                },
              },
            },
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'boolean' })
  })
})

// ─── 간접 순환 참조 ──────────────────────────────────────────────────────────

describe('간접 순환 참조 처리', () => {
  it('A→B→A 간접 순환 → 순환 지점은 {}로 대체', () => {
    const s = spec({
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { b: { $ref: '#/components/schemas/B' } },
          },
          B: {
            type: 'object',
            properties: { a: { $ref: '#/components/schemas/A' } },
          },
        },
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/A' } },
                },
              },
            },
          },
        },
      },
    })
    expect(() => derefSpec(s)).not.toThrow()
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // A는 전개됨
    expect(schema.type).toBe('object')
    // A.b → B가 전개됨
    expect(schema.properties.b.type).toBe('object')
    // B.a → A 순환이므로 {}
    expect(schema.properties.b.properties.a).toEqual({})
  })

  it('A→B→C→A 3단 순환 → 순환 지점은 {}로 대체', () => {
    const s = spec({
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { b: { $ref: '#/components/schemas/B' } },
          },
          B: {
            type: 'object',
            properties: { c: { $ref: '#/components/schemas/C' } },
          },
          C: {
            type: 'object',
            properties: { a: { $ref: '#/components/schemas/A' } },
          },
        },
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/A' } },
                },
              },
            },
          },
        },
      },
    })
    expect(() => derefSpec(s)).not.toThrow()
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // A 전개
    expect(schema.type).toBe('object')
    // A.b → B 전개
    expect(schema.properties.b.type).toBe('object')
    // B.c → C 전개
    expect(schema.properties.b.properties.c.type).toBe('object')
    // C.a → A 순환이므로 {}
    expect(schema.properties.b.properties.c.properties.a).toEqual({})
  })
})

// ─── 존재하지 않는 ref 경로 ──────────────────────────────────────────────────

describe('존재하지 않는 $ref 경로', () => {
  it('$ref가 가리키는 경로가 없으면 원본 노드 유지 (크래시 없음)', () => {
    const s = spec({
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/DoesNotExist' },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(() => derefSpec(s)).not.toThrow()
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // 해석 불가능하면 원본 $ref 객체가 남아있어야 함
    expect(schema).toHaveProperty('$ref', '#/components/schemas/DoesNotExist')
  })
})

// ─── $ref와 형제 속성 ────────────────────────────────────────────────────────

describe('$ref와 형제 속성', () => {
  it('$ref가 있으면 형제 속성(description)은 무시되고 $ref만 해석됨', () => {
    const s = spec({
      components: {
        schemas: {
          Foo: { type: 'string', minLength: 1 },
        },
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Foo',
                      description: 'override',
                    } as any,
                  },
                },
              },
            },
          },
        },
      },
    })
    const resolved = derefSpec(s)
    const schema = (resolved.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    // $ref 대상이 해석됨
    expect(schema.type).toBe('string')
    expect(schema.minLength).toBe(1)
    // OAS 표준에 따라 형제 description은 보존되지 않아야 함
    expect(schema).not.toHaveProperty('description')
  })
})
