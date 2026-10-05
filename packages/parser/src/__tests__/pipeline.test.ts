import { describe, it, expect } from 'vitest'
import { runPipeline, derefPass, createDerefPass, DEFAULT_PASSES } from '../pipeline.js'
import type { SpecPass } from '../pipeline.js'

function bare() {
  return { openapi: '3.2.0', info: { title: 'T', version: '0' }, paths: {} }
}

describe('runPipeline', () => {
  it('empty passes → input unchanged', () => {
    const input = bare()
    const result = runPipeline(input, [])
    expect(result).toEqual(input)
  })

  it('pass execution order (track with array)', () => {
    const order: string[] = []

    const passA: SpecPass = {
      name: 'a',
      run: <T>(s: T): T => { order.push('a'); return s },
    }
    const passB: SpecPass = {
      name: 'b',
      run: <T>(s: T): T => { order.push('b'); return s },
    }
    const passC: SpecPass = {
      name: 'c',
      run: <T>(s: T): T => { order.push('c'); return s },
    }

    runPipeline(bare(), [passA, passB, passC])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('derefPass resolves $ref', () => {
    const input = {
      ...bare(),
      components: { schemas: { Foo: { type: 'string' } } },
      paths: { '/x': { $ref: '#/components/schemas/Foo' } },
    }

    const result = derefPass.run(input) as Record<string, unknown>
    expect((result.paths as Record<string, unknown>)['/x']).toEqual({ type: 'string' })
  })

  it('DEFAULT_PASSES includes deref', () => {
    expect(DEFAULT_PASSES).toContainEqual(derefPass)
    expect(DEFAULT_PASSES.some(p => p.name === 'deref')).toBe(true)
  })

  it('deref passes declare that they resolve $refs', () => {
    expect(derefPass.resolvesRefs).toBe(true)
    expect(createDerefPass({ basePath: '/specs/openapi.json' }).resolvesRefs).toBe(true)
  })

  it('custom pass composition', () => {
    const addMeta: SpecPass = {
      name: 'addMeta',
      run: <T>(s: T): T => ({ ...(s as object), _meta: 'tagged' }) as T,
    }

    const upperTitle: SpecPass = {
      name: 'upperTitle',
      run: <T>(s: T): T => {
        const obj = s as Record<string, unknown>
        const info = obj.info as Record<string, unknown>
        return {
          ...obj,
          info: { ...info, title: (info.title as string).toUpperCase() },
        } as T
      },
    }

    const result = runPipeline(bare(), [addMeta, upperTitle]) as Record<string, unknown>
    expect(result._meta).toBe('tagged')
    expect((result.info as Record<string, unknown>).title).toBe('T')
  })
})
