/**
 * Zod → OAS 변환 엣지케이스 — 기존 zod-to-schema.test.ts 보강
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodToSchema } from '../zod-to-schema.js'

describe('z.literal', () => {
  it('string literal → const', () => {
    expect(zodToSchema(z.literal('hello'))).toMatchObject({ const: 'hello' })
  })
  it('number literal → const', () => {
    expect(zodToSchema(z.literal(42))).toMatchObject({ const: 42 })
  })
  it('boolean literal → const', () => {
    expect(zodToSchema(z.literal(true))).toMatchObject({ const: true })
  })
})

describe('z.nativeEnum', () => {
  it('numeric nativeEnum → enum', () => {
    enum Status { Active = 0, Inactive = 1 }
    const result = zodToSchema(z.nativeEnum(Status))
    expect(result.enum).toBeDefined()
    expect(result.enum).toContain(0)
    expect(result.enum).toContain(1)
  })

  it('string nativeEnum → enum', () => {
    enum Color { Red = 'red', Blue = 'blue' }
    const result = zodToSchema(z.nativeEnum(Color))
    expect(result.enum).toBeDefined()
    expect(result.enum).toContain('red')
    expect(result.enum).toContain('blue')
  })
})

describe('z.coerce', () => {
  it('coerce.string → string', () => {
    expect(zodToSchema(z.coerce.string())).toMatchObject({ type: 'string' })
  })
  it('coerce.number → number', () => {
    expect(zodToSchema(z.coerce.number())).toMatchObject({ type: 'number' })
  })
  it('coerce.boolean → boolean', () => {
    expect(zodToSchema(z.coerce.boolean())).toMatchObject({ type: 'boolean' })
  })
})

describe('z.union 다양한 패턴', () => {
  it('3+ 타입 union', () => {
    const result = zodToSchema(z.union([z.string(), z.number(), z.boolean()]))
    expect(result.oneOf).toHaveLength(3)
  })

  it('object union', () => {
    const result = zodToSchema(z.union([
      z.object({ type: z.literal('a'), x: z.string() }),
      z.object({ type: z.literal('b'), y: z.number() }),
    ]))
    expect(result.oneOf).toHaveLength(2)
  })

  it('nullable union (string | null)', () => {
    const result = zodToSchema(z.string().nullable())
    // nullable은 anyOf: [string, null] 또는 type: ['string', 'null']
    const hasNull = JSON.stringify(result).includes('null')
    expect(hasNull).toBe(true)
  })
})

describe('z.discriminatedUnion 엣지케이스', () => {
  it('3개 variant discriminated union', () => {
    const result = zodToSchema(z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), x: z.string() }),
      z.object({ type: z.literal('b'), y: z.number() }),
      z.object({ type: z.literal('c'), z: z.boolean() }),
    ]))
    expect(result.oneOf).toHaveLength(3)
    expect(result.discriminator?.propertyName).toBe('type')
  })
})

describe('z.intersection', () => {
  it('두 객체 intersection', () => {
    const result = zodToSchema(z.intersection(
      z.object({ a: z.string() }),
      z.object({ b: z.number() }),
    ))
    expect(result.allOf).toHaveLength(2)
  })
})

describe('z.tuple', () => {
  it('[string, number] → prefixItems', () => {
    const result = zodToSchema(z.tuple([z.string(), z.number()]))
    expect(result.type).toBe('array')
    expect(result.prefixItems).toHaveLength(2)
    expect(result.prefixItems![0]).toMatchObject({ type: 'string' })
    expect(result.prefixItems![1]).toMatchObject({ type: 'number' })
  })
})

describe('z.record', () => {
  it('record(string, string) → additionalProperties', () => {
    const result = zodToSchema(z.record(z.string(), z.string()))
    expect(result.type).toBe('object')
    expect(result.additionalProperties).toMatchObject({ type: 'string' })
  })

  it('record(string, number) → additionalProperties', () => {
    const result = zodToSchema(z.record(z.string(), z.number()))
    expect(result.additionalProperties).toMatchObject({ type: 'number' })
  })
})

describe('제약 조건 전파', () => {
  it('string.min/max → minLength/maxLength', () => {
    const result = zodToSchema(z.string().min(3).max(50))
    expect(result.minLength).toBe(3)
    expect(result.maxLength).toBe(50)
  })

  it('number.min/max → minimum/maximum', () => {
    const result = zodToSchema(z.number().min(0).max(100))
    expect(result.minimum).toBe(0)
    expect(result.maximum).toBe(100)
  })

  it('number.int → type: integer', () => {
    const result = zodToSchema(z.number().int())
    expect(result.type).toBe('integer')
  })

  it('number.positive → exclusiveMinimum: 0', () => {
    const result = zodToSchema(z.number().positive())
    expect(result.exclusiveMinimum).toBe(0)
  })

  it('array.min/max → minItems/maxItems', () => {
    const result = zodToSchema(z.array(z.string()).min(1).max(10))
    expect(result.minItems).toBe(1)
    expect(result.maxItems).toBe(10)
  })

  it('string.email → format: email', () => {
    const result = zodToSchema(z.string().email())
    expect(result.format).toBe('email')
  })

  it('string.uuid → format: uuid', () => {
    const result = zodToSchema(z.string().uuid())
    expect(result.format).toBe('uuid')
  })

  it('string.url → format: uri', () => {
    const result = zodToSchema(z.string().url())
    expect(result.format).toBe('uri')
  })

  it('string.datetime → format: date-time', () => {
    const result = zodToSchema(z.string().datetime())
    expect(result.format).toBe('date-time')
  })

  it('string.regex → pattern', () => {
    const result = zodToSchema(z.string().regex(/^[a-z]+$/))
    expect(result.pattern).toBe('^[a-z]+$')
  })
})

describe('description 전파', () => {
  it('describe() → description', () => {
    const result = zodToSchema(z.string().describe('이름'))
    expect(result.description).toBe('이름')
  })

  it('object 프로퍼티 describe', () => {
    const result = zodToSchema(z.object({
      name: z.string().describe('사용자 이름'),
      age: z.number().describe('나이'),
    }))
    expect((result.properties as any).name.description).toBe('사용자 이름')
    expect((result.properties as any).age.description).toBe('나이')
  })
})

describe('복합 실사용 시나리오', () => {
  it('회원가입 폼', () => {
    const SignupForm = z.object({
      email: z.string().email().describe('이메일'),
      password: z.string().min(8).max(100).describe('비밀번호'),
      name: z.string().min(1).max(50),
      age: z.number().int().min(0).max(150).optional(),
      role: z.enum(['user', 'admin']).default('user'),
    })
    const result = zodToSchema(SignupForm)
    expect(result.type).toBe('object')
    expect(result.required).toContain('email')
    expect(result.required).toContain('password')
    expect(result.required).toContain('name')
    expect(result.required).not.toContain('age')
    expect((result.properties as any).email.format).toBe('email')
    expect((result.properties as any).password.minLength).toBe(8)
    expect((result.properties as any).role.enum).toEqual(['user', 'admin'])
  })

  it('API 응답 wrapper', () => {
    const ApiResponse = z.object({
      success: z.boolean(),
      data: z.union([z.object({ id: z.string() }), z.null()]),
      error: z.string().nullable().optional(),
    })
    const result = zodToSchema(ApiResponse)
    expect(result.type).toBe('object')
    expect(result.required).toContain('success')
    expect(result.required).toContain('data')
  })
})
