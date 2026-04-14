/**
 * deref 엣지케이스 테스트 — 기존 deref.test.ts를 보강
 */
import { describe, it, expect } from 'vitest'
import { derefSpec } from '../deref.js'

function spec(overrides?: Record<string, unknown>) {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {}, ...overrides }
}

describe('자기 참조 (recursive schema)', () => {
  it('TreeNode: children → TreeNode[] → 순환 지점에서 중첩 멈춤', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          TreeNode: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } },
            },
          },
        },
      },
    })) as any
    const node = result.components.schemas.TreeNode
    expect(node.properties.name).toEqual({ type: 'string' })
    expect(node.properties.children.type).toBe('array')
    // 순환 지점에서 무한 재귀 없이 유한 깊이로 해소됨
    expect(node.properties.children.items).toBeDefined()
    // 최종적으로 어딘가에서 {} (빈 객체)로 끝남 — 무한이 아님
    const depth1 = node.properties.children.items
    expect(depth1.type).toBe('object') // TreeNode 자체는 펼쳐짐
    const depth2 = depth1.properties?.children?.items
    expect(depth2).toEqual({}) // 2단계에서 순환 끊김
  })
})

describe('allOf 내부 $ref', () => {
  it('allOf 브랜치의 $ref가 해소됨', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          Base: { type: 'object', properties: { id: { type: 'string' } } },
          Extended: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              { type: 'object', properties: { name: { type: 'string' } } },
            ],
          },
        },
      },
    })) as any
    const extended = result.components.schemas.Extended
    expect(extended.allOf[0].properties.id).toEqual({ type: 'string' })
    expect(extended.allOf[1].properties.name).toEqual({ type: 'string' })
  })
})

describe('oneOf 내부 $ref', () => {
  it('oneOf 브랜치의 $ref가 해소됨', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          Dog: { type: 'object', properties: { bark: { type: 'boolean' } } },
          Cat: { type: 'object', properties: { purr: { type: 'boolean' } } },
          Pet: { oneOf: [{ $ref: '#/components/schemas/Dog' }, { $ref: '#/components/schemas/Cat' }] },
        },
      },
    })) as any
    const pet = result.components.schemas.Pet
    expect(pet.oneOf[0].properties.bark).toEqual({ type: 'boolean' })
    expect(pet.oneOf[1].properties.purr).toEqual({ type: 'boolean' })
  })
})

describe('깊은 중첩 $ref', () => {
  it('3단계 중첩 properties 안 $ref', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          Inner: { type: 'string' },
          Middle: { type: 'object', properties: { inner: { $ref: '#/components/schemas/Inner' } } },
          Outer: { type: 'object', properties: { middle: { $ref: '#/components/schemas/Middle' } } },
        },
      },
    })) as any
    expect(result.components.schemas.Outer.properties.middle.properties.inner).toEqual({ type: 'string' })
  })
})

describe('배열 items $ref', () => {
  it('array items의 $ref 해소', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          Item: { type: 'object', properties: { id: { type: 'integer' } } },
          ItemList: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
        },
      },
    })) as any
    expect(result.components.schemas.ItemList.items.properties.id).toEqual({ type: 'integer' })
  })
})

describe('response/requestBody 내부 $ref', () => {
  it('response content schema $ref 해소', () => {
    const result = derefSpec(spec({
      components: { schemas: { User: { type: 'object', properties: { name: { type: 'string' } } } } },
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
        },
      },
    })) as any
    const schema = result.paths['/users'].get.responses['200'].content['application/json'].schema
    expect(schema.properties.name).toEqual({ type: 'string' })
  })
})

describe('$ref 대상이 또 다른 $ref (chain through composition)', () => {
  it('A → allOf[B] → C', () => {
    const result = derefSpec(spec({
      components: {
        schemas: {
          C: { type: 'string' },
          B: { $ref: '#/components/schemas/C' },
          A: { allOf: [{ $ref: '#/components/schemas/B' }] },
        },
      },
    })) as any
    expect(result.components.schemas.A.allOf[0]).toEqual({ type: 'string' })
  })
})
