/**
 * core/pipeline.ts + core/folder.ts — Pass 파이프라인 단위 테스트
 */
import { describe, it, expect, vi } from 'vitest'
import { runPipeline, derefPass, DEFAULT_PASSES, type SpecPass } from '@oa-sdk/parser'
import { SchemaFolder } from '@oa-sdk/parser'
import { loadSchema } from '@oa-sdk/parser'
import type { OasDocument } from '@oa-sdk/parser'

function bare(): OasDocument {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {} }
}

// ─── runPipeline ──────────────────────────────────────────────────────────────

describe('runPipeline', () => {
  it('pass 없으면 입력 그대로 반환', () => {
    const spec = bare()
    expect(runPipeline(spec, [])).toBe(spec)
  })

  it('pass 순서대로 실행된다', () => {
    const order: number[] = []
    const p1: SpecPass = { name: 'p1', run: s => { order.push(1); return s } }
    const p2: SpecPass = { name: 'p2', run: s => { order.push(2); return s } }
    const p3: SpecPass = { name: 'p3', run: s => { order.push(3); return s } }
    runPipeline(bare(), [p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  it('앞 pass의 출력이 다음 pass의 입력', () => {
    const addA: SpecPass = {
      name: 'addA',
      run: s => ({ ...s, info: { ...(s as unknown as Record<string, unknown>)['info'] as unknown as Record<string, unknown>, title: 'A' } }),
    }
    const addB: SpecPass = {
      name: 'addB',
      run: s => {
        const info = (s as unknown as Record<string, unknown>)['info'] as Record<string, string>
        return { ...s, info: { ...info, title: info['title'] + 'B' } }
      },
    }
    const result = runPipeline(bare(), [addA, addB]) as unknown as Record<string, unknown>
    expect((result['info'] as unknown as Record<string, unknown>)['title']).toBe('AB')
  })

  it('단일 pass — pass 결과 그대로', () => {
    const mark: SpecPass = {
      name: 'mark',
      run: s => ({ ...s, info: { ...(s as unknown as Record<string, unknown>)['info'] as unknown as Record<string, unknown>, title: 'marked' } }),
    }
    const result = runPipeline(bare(), [mark]) as unknown as Record<string, unknown>
    expect((result['info'] as unknown as Record<string, unknown>)['title']).toBe('marked')
  })
})

// ─── derefPass ────────────────────────────────────────────────────────────────

describe('derefPass', () => {
  it('name이 "deref"', () => {
    expect(derefPass.name).toBe('deref')
  })

  it('$ref를 인라인 전개한다', () => {
    const spec: OasDocument = {
      ...bare(),
      components: { schemas: { Foo: { type: 'string' } } } as any,
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Foo' },
                  },
                },
              },
            },
          },
        },
      },
    }
    const result = derefPass.run(spec)
    const schema = (result.paths!['/test'] as any).get.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'string' })
  })
})

// ─── DEFAULT_PASSES ───────────────────────────────────────────────────────────

describe('DEFAULT_PASSES', () => {
  it('derefPass 포함', () => {
    expect(DEFAULT_PASSES.some(p => p.name === 'deref')).toBe(true)
  })
})

// ─── loadSchema + 커스텀 Pass ─────────────────────────────────────────────────

describe('loadSchema — 커스텀 passes', () => {
  it('빈 passes 배열 — deref 없이 로드 (정상 동작)', () => {
    const spec: OasDocument = {
      ...bare(),
      paths: {
        '/users': {
          get: { operationId: 'listUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const index = loadSchema(spec, [])
    expect(index.has('/users')).toBe(true)
  })

  it('커스텀 pass — 모든 경로에 접두사 추가', () => {
    const spy = vi.fn(<T>(s: T): T => s)
    const loggingPass: SpecPass = { name: 'logging', run: spy }

    const spec = bare()
    loadSchema(spec, [...DEFAULT_PASSES, loggingPass])
    expect(spy).toHaveBeenCalledOnce()
  })

  it('커스텀 pass — 명시적 순서 제어', () => {
    const results: string[] = []
    const p1: SpecPass = { name: 'first', run: s => { results.push('first'); return s } }
    const p2: SpecPass = { name: 'second', run: s => { results.push('second'); return s } }

    loadSchema(bare(), [p1, p2])
    expect(results).toEqual(['first', 'second'])
  })
})

// ─── SchemaFolder 확장 ────────────────────────────────────────────────────────

describe('SchemaFolder 확장', () => {
  it('foldRef 오버라이드 — $ref를 커스텀 처리', () => {
    const visited: string[] = []

    class TrackingFolder extends SchemaFolder {
      protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
        visited.push(ref)
        return node // 원본 유지
      }
    }

    const folder = new TrackingFolder()
    folder.fold({
      properties: {
        a: { $ref: '#/components/schemas/A' },
        b: { $ref: '#/components/schemas/B' },
      },
    })

    expect(visited).toContain('#/components/schemas/A')
    expect(visited).toContain('#/components/schemas/B')
  })

  it('foldObject 오버라이드 — 특정 키 필터링', () => {
    class NoXFolder extends SchemaFolder {
      protected override foldObject(obj: Record<string, unknown>): Record<string, unknown> {
        // x- 접두사 키 제거
        const filtered = Object.fromEntries(
          Object.entries(obj).filter(([k]) => !k.startsWith('x-'))
        )
        return this.foldChildren(filtered)
      }
    }

    const result = new NoXFolder().fold({
      type: 'string',
      'x-internal': 'should-be-removed',
      minLength: 1,
    }) as unknown as Record<string, unknown>

    expect(result).not.toHaveProperty('x-internal')
    expect(result.type).toBe('string')
    expect(result.minLength).toBe(1)
  })

  it('복합 Pass — SchemaFolder를 SpecPass로 래핑', () => {
    class UpperCaseDescFolder extends SchemaFolder {
      protected override foldObject(obj: Record<string, unknown>): Record<string, unknown> {
        const result = this.foldChildren(obj)
        if (typeof result.description === 'string') {
          result.description = result.description.toUpperCase()
        }
        return result
      }
    }

    const upperDescPass: SpecPass = {
      name: 'upper-desc',
      run: <T>(spec: T): T => new UpperCaseDescFolder().fold(spec) as T,
    }

    const spec: OasDocument = {
      ...bare(),
      paths: {
        '/test': {
          get: {
            description: 'hello world',
            responses: { '200': { description: 'ok result' } },
          },
        },
      },
    }

    const result = runPipeline(spec, [upperDescPass])
    const op = (result.paths!['/test'] as any).get
    expect(op.description).toBe('HELLO WORLD')
    expect(op.responses['200'].description).toBe('OK RESULT')
  })
})
