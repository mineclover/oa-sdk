import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodToSchema } from '../zod-to-schema.js'

describe('zodToSchema — primitives', () => {
  it('string', () => expect(zodToSchema(z.string())).toEqual({ type: 'string' }))
  it('string.uuid', () => expect(zodToSchema(z.string().uuid())).toEqual({ type: 'string', format: 'uuid' }))
  it('string.email', () => expect(zodToSchema(z.string().email())).toEqual({ type: 'string', format: 'email' }))
  it('string.url', () => expect(zodToSchema(z.string().url())).toEqual({ type: 'string', format: 'uri' }))
  it('string.datetime', () => expect(zodToSchema(z.string().datetime())).toEqual({ type: 'string', format: 'date-time' }))
  it('string.date', () => expect(zodToSchema(z.string().date())).toEqual({ type: 'string', format: 'date' }))
  it('string.time', () => expect(zodToSchema(z.string().time())).toEqual({ type: 'string', format: 'time' }))

  it('string.min/max', () => expect(zodToSchema(z.string().min(1).max(100))).toMatchObject({
    type: 'string', minLength: 1, maxLength: 100,
  }))

  it('string.length', () => expect(zodToSchema(z.string().length(10))).toMatchObject({
    type: 'string', minLength: 10, maxLength: 10,
  }))

  it('string.regex', () => expect(zodToSchema(z.string().regex(/^[a-z]+$/))).toMatchObject({
    type: 'string', pattern: '^[a-z]+$',
  }))

  it('string.startsWith', () => expect(zodToSchema(z.string().startsWith('foo'))).toMatchObject({
    type: 'string', pattern: '^foo',
  }))

  it('string.endsWith', () => expect(zodToSchema(z.string().endsWith('bar'))).toMatchObject({
    type: 'string', pattern: 'bar$',
  }))

  it('number', () => expect(zodToSchema(z.number())).toEqual({ type: 'number' }))
  it('number.int', () => expect(zodToSchema(z.number().int())).toMatchObject({ type: 'integer' }))

  it('number.min (inclusive)', () => expect(zodToSchema(z.number().min(0))).toMatchObject({ minimum: 0 }))
  it('number.max (inclusive)', () => expect(zodToSchema(z.number().max(100))).toMatchObject({ maximum: 100 }))
  it('number.gt (exclusive)', () => expect(zodToSchema(z.number().gt(0))).toMatchObject({ exclusiveMinimum: 0 }))
  it('number.lt (exclusive)', () => expect(zodToSchema(z.number().lt(100))).toMatchObject({ exclusiveMaximum: 100 }))
  it('number.multipleOf', () => expect(zodToSchema(z.number().multipleOf(5))).toMatchObject({ multipleOf: 5 }))

  it('boolean', () => expect(zodToSchema(z.boolean())).toEqual({ type: 'boolean' }))
  it('date', () => expect(zodToSchema(z.date())).toEqual({ type: 'string', format: 'date-time' }))
  it('null', () => expect(zodToSchema(z.null())).toEqual({ type: 'null' }))
  it('bigint', () => expect(zodToSchema(z.bigint())).toEqual({ type: 'integer', format: 'int64' }))
  it('any', () => expect(zodToSchema(z.any())).toEqual({}))
  it('unknown', () => expect(zodToSchema(z.unknown())).toEqual({}))
  it('never', () => expect(zodToSchema(z.never())).toEqual({ not: {} }))
})

describe('zodToSchema — literal', () => {
  it('string literal', () => expect(zodToSchema(z.literal('foo'))).toEqual({ type: 'string', const: 'foo' }))
  it('number literal', () => expect(zodToSchema(z.literal(42))).toEqual({ type: 'number', const: 42 }))
  it('boolean literal', () => expect(zodToSchema(z.literal(true))).toEqual({ type: 'boolean', const: true }))
})

describe('zodToSchema — enum', () => {
  it('z.enum', () => expect(zodToSchema(z.enum(['a', 'b', 'c']))).toEqual({
    type: 'string', enum: ['a', 'b', 'c'],
  }))

  it('string native enum', () => {
    enum Color { Red = 'red', Blue = 'blue' }
    expect(zodToSchema(z.nativeEnum(Color))).toEqual({ type: 'string', enum: ['red', 'blue'] })
  })

  it('numeric native enum', () => {
    enum Dir { Up = 0, Down = 1 }
    const result = zodToSchema(z.nativeEnum(Dir))
    expect(result.type).toBe('integer')
    expect(result.enum).toEqual(expect.arrayContaining([0, 1]))
    expect(result.enum).not.toContain('Up')
    expect(result.enum).not.toContain('Down')
  })
})

describe('zodToSchema — object', () => {
  it('simple object', () => {
    const result = zodToSchema(z.object({ name: z.string(), age: z.number() }))
    expect(result).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name', 'age'],
    })
  })

  it('optional field not in required', () => {
    const result = zodToSchema(z.object({ name: z.string(), bio: z.string().optional() }))
    expect(result.required).toEqual(['name'])
    expect(result.properties?.bio).toEqual({ type: 'string' })
  })

  it('default field not in required', () => {
    const result = zodToSchema(z.object({ role: z.string().default('user') }))
    expect(result.required).toBeUndefined()
  })

  it('strict → additionalProperties: false', () => {
    const result = zodToSchema(z.strictObject({ name: z.string() }))
    expect(result.additionalProperties).toBe(false)
  })

  it('catchall → additionalProperties schema', () => {
    const result = zodToSchema(z.object({ name: z.string() }).catchall(z.number()))
    expect(result.additionalProperties).toEqual({ type: 'number' })
  })

  it('empty object', () => {
    const result = zodToSchema(z.object({}))
    expect(result.type).toBe('object')
    expect(result.properties).toBeUndefined()
    expect(result.required).toBeUndefined()
  })

  it('nested object', () => {
    const result = zodToSchema(z.object({ address: z.object({ city: z.string() }) }))
    expect(result.properties?.address).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    })
  })
})

describe('zodToSchema — array', () => {
  it('string array', () => expect(zodToSchema(z.array(z.string()))).toEqual({
    type: 'array', items: { type: 'string' },
  }))

  it('min/max items', () => expect(zodToSchema(z.array(z.string()).min(1).max(10))).toMatchObject({
    type: 'array', minItems: 1, maxItems: 10,
  }))

  it('exact length', () => expect(zodToSchema(z.array(z.string()).length(3))).toMatchObject({
    type: 'array', minItems: 3, maxItems: 3,
  }))

  it('set → uniqueItems', () => expect(zodToSchema(z.set(z.string()))).toEqual({
    type: 'array', items: { type: 'string' }, uniqueItems: true,
  }))
})

describe('zodToSchema — tuple', () => {
  it('fixed tuple', () => {
    const result = zodToSchema(z.tuple([z.string(), z.number()]))
    expect(result).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      maxItems: 2,
    })
  })

  it('tuple with rest', () => {
    const result = zodToSchema(z.tuple([z.string()]).rest(z.number()))
    expect(result).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'number' },
    })
  })

  it('empty tuple', () => {
    expect(zodToSchema(z.tuple([]))).toEqual({ type: 'array', maxItems: 0 })
  })
})

describe('zodToSchema — wrappers', () => {
  it('optional unwraps inner type', () => {
    expect(zodToSchema(z.string().optional())).toEqual({ type: 'string' })
  })

  it('nullable → anyOf with null', () => {
    expect(zodToSchema(z.string().nullable())).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    })
  })

  it('default adds default value', () => {
    expect(zodToSchema(z.string().default('hello'))).toEqual({ type: 'string', default: 'hello' })
  })

  it('default number', () => {
    expect(zodToSchema(z.number().default(0))).toEqual({ type: 'number', default: 0 })
  })

  it('describe adds description', () => {
    expect(zodToSchema(z.string().describe('사용자 이름'))).toEqual({
      type: 'string', description: '사용자 이름',
    })
  })

  it('transform uses input type', () => {
    const schema = z.string().transform(s => parseInt(s))
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('refine preserves type', () => {
    const schema = z.string().refine(s => s.length > 0, 'Required')
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })
})

describe('zodToSchema — union & intersection', () => {
  it('union → oneOf', () => {
    expect(zodToSchema(z.union([z.string(), z.number()]))).toEqual({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    })
  })

  it('discriminated union → oneOf + discriminator', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), count: z.number() }),
    ])
    const result = zodToSchema(schema)
    expect(result.oneOf).toHaveLength(2)
    expect(result.discriminator).toEqual({ propertyName: 'type' })
  })

  it('plain union → oneOf (discriminator 없음)', () => {
    const result = zodToSchema(z.union([z.string(), z.number()]))
    expect(result.oneOf).toHaveLength(2)
    expect(result.discriminator).toBeUndefined()
  })

  it('intersection → allOf', () => {
    const a = z.object({ name: z.string() })
    const b = z.object({ age: z.number() })
    expect(zodToSchema(z.intersection(a, b))).toEqual({
      allOf: [
        { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] },
      ],
    })
  })
})

describe('zodToSchema — record & map', () => {
  it('record → additionalProperties', () => {
    expect(zodToSchema(z.record(z.string(), z.string()))).toEqual({
      type: 'object', additionalProperties: { type: 'string' },
    })
  })

  it('map → additionalProperties', () => {
    expect(zodToSchema(z.map(z.string(), z.number()))).toEqual({
      type: 'object', additionalProperties: { type: 'number' },
    })
  })
})

// ---------------------------------------------------------------------------
// Zod v4 신규 타입
// ---------------------------------------------------------------------------

describe('zodToSchema — Zod v4 types', () => {
  it('pipe (transform) → 입력 스키마 기준', () => {
    const schema = z.string().transform(s => s.length)
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('pipe (transform) with constraints → 입력 스키마 제약 유지', () => {
    const schema = z.string().min(1).max(100).transform(s => s.toUpperCase())
    expect(zodToSchema(schema)).toMatchObject({
      type: 'string', minLength: 1, maxLength: 100,
    })
  })

  it('pipe (z.pipe) → 입력 스키마 기준', () => {
    // @ts-expect-error — Zod v4 pipe의 output 타입 제약. 런타임에는 정상 동작.
    const schema = z.string().pipe(z.number())
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('readonly → 내부 스키마 unwrap', () => {
    const schema = z.string().readonly()
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('readonly object → object 스키마', () => {
    const schema = z.object({ name: z.string() }).readonly()
    expect(zodToSchema(schema)).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
  })

  it('catch → 내부 스키마 unwrap', () => {
    const schema = z.string().catch('fallback')
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('multi-value literal → enum', () => {
    const schema = z.literal(['admin', 'user', 'guest'])
    expect(zodToSchema(schema)).toEqual({
      enum: ['admin', 'user', 'guest'],
    })
  })

  it('single-value literal → const (v4도 호환)', () => {
    const schema = z.literal('active')
    expect(zodToSchema(schema)).toEqual({ type: 'string', const: 'active' })
  })

  it('lazy → 빈 스키마 (수동 $ref 필요)', () => {
    const schema: z.ZodTypeAny = z.lazy(() => z.string())
    expect(zodToSchema(schema)).toEqual({})
  })

  it('ZodLazy → $ref (재귀 스키마)', () => {
    const Category: z.ZodType<any> = z.object({
      name: z.string(),
      children: z.lazy(() => z.array(Category)),
    })
    const refs = new Map<z.ZodTypeAny, string>([[Category, 'Category']])
    const result = zodToSchema(Category, { refs })
    // children should be { type: 'array', items: { $ref: '#/components/schemas/Category' } }
    expect(result.properties!.children!.items).toEqual({ $ref: '#/components/schemas/Category' })
  })

  it('default → 내부 스키마 + default 값', () => {
    const schema = z.string().default('hello')
    expect(zodToSchema(schema)).toEqual({ type: 'string', default: 'hello' })
  })

  it('default number → 내부 스키마 + default 값', () => {
    const schema = z.number().default(42)
    expect(zodToSchema(schema)).toEqual({ type: 'number', default: 42 })
  })

  it('optional → 내부 스키마 그대로', () => {
    const schema = z.string().optional()
    expect(zodToSchema(schema)).toEqual({ type: 'string' })
  })

  it('nullable → anyOf [inner, null]', () => {
    const schema = z.string().nullable()
    expect(zodToSchema(schema)).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    })
  })

  it('set → array + uniqueItems', () => {
    const schema = z.set(z.string())
    expect(zodToSchema(schema)).toEqual({
      type: 'array', items: { type: 'string' }, uniqueItems: true,
    })
  })

  it('nativeEnum (string) → string enum', () => {
    const Status = { Active: 'active', Inactive: 'inactive' } as const
    const schema = z.nativeEnum(Status)
    expect(zodToSchema(schema)).toEqual({
      type: 'string', enum: ['active', 'inactive'],
    })
  })

  it('nativeEnum (numeric with reverse mapping) → integer enum', () => {
    // TypeScript numeric enum은 역방향 매핑 포함
    const Direction = { Up: 0, Down: 1, 0: 'Up', 1: 'Down' } as const
    const schema = z.nativeEnum(Direction)
    const result = zodToSchema(schema)
    expect(result.type).toBe('integer')
    expect(result.enum).toEqual(expect.arrayContaining([0, 1]))
    // 역방향 매핑 문자열 제외
    expect(result.enum).not.toContain('Up')
    expect(result.enum).not.toContain('Down')
  })

  it('string.length(5) → minLength + maxLength 동일', () => {
    const schema = z.string().length(5)
    expect(zodToSchema(schema)).toEqual({
      type: 'string', minLength: 5, maxLength: 5,
    })
  })

  it('array.length(3) → minItems + maxItems 동일', () => {
    const schema = z.array(z.string()).length(3)
    expect(zodToSchema(schema)).toEqual({
      type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3,
    })
  })

  it('strict object → additionalProperties: false', () => {
    const schema = z.strictObject({ name: z.string() })
    expect(zodToSchema(schema)).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    })
  })

  it('describe → description 전파', () => {
    const schema = z.string().describe('사용자 이름')
    expect(zodToSchema(schema)).toEqual({ type: 'string', description: '사용자 이름' })
  })

  it('복합 래퍼 중첩: optional + nullable + default', () => {
    const schema = z.string().nullable().default(null)
    const result = zodToSchema(schema)
    // default(null) → unwrap, nullable → anyOf
    expect(result).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
      default: null,
    })
  })
})
