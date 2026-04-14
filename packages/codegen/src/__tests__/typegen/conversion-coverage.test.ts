/**
 * OAS → TypeScript 변환 커버리지 테스트 (typia 매핑 기준)
 *
 * samchon/typia의 TypeScript↔JSON Schema 매핑을 벤치마크로 사용.
 * OAS 3.2의 모든 스키마 패턴이 TypeScript로 변환될 때 기대하는 결과를 검증.
 *
 * 구분:
 *   - 타입 수준: TS 타입에 반영 (string, number, union 등)
 *   - JSDoc 수준: 주석으로 반영 (description, format 등)
 *   - 무시: 현재 미지원 (타입에 영향 없는 런타임 제약)
 */
import { describe, it, expect } from 'vitest'
import { schemaToTs } from '../../typegen/schema-to-ts.js'

// ═══════════════════════════════════════════════════════════
// 1. 기본 타입 매핑 (typia 기준 전체)
// ═══════════════════════════════════════════════════════════

describe('기본 타입 매핑', () => {
  it('string → string', () => expect(schemaToTs({ type: 'string' })).toBe('string'))
  it('number → number', () => expect(schemaToTs({ type: 'number' })).toBe('number'))
  it('integer → number', () => expect(schemaToTs({ type: 'integer' })).toBe('number'))
  it('boolean → boolean', () => expect(schemaToTs({ type: 'boolean' })).toBe('boolean'))
  it('null → null', () => expect(schemaToTs({ type: 'null' })).toBe('null'))
})

// ═══════════════════════════════════════════════════════════
// 2. integer 서브타입 (typia: int32, uint32, int64, float, double)
// ═══════════════════════════════════════════════════════════

describe('integer/number format', () => {
  it('integer + int32 → number', () => expect(schemaToTs({ type: 'integer', format: 'int32' })).toBe('number'))
  it('integer + int64 → number', () => expect(schemaToTs({ type: 'integer', format: 'int64' })).toBe('number'))
  it('number + float → number', () => expect(schemaToTs({ type: 'number', format: 'float' })).toBe('number'))
  it('number + double → number', () => expect(schemaToTs({ type: 'number', format: 'double' })).toBe('number'))
})

// ═══════════════════════════════════════════════════════════
// 3. string format (typia: uuid, email, uri, date-time, date, ipv4, ipv6, ...)
// ═══════════════════════════════════════════════════════════

describe('string format → 타입은 string', () => {
  const formats = ['uuid', 'email', 'uri', 'url', 'date-time', 'date', 'time', 'ipv4', 'ipv6', 'hostname', 'byte', 'binary', 'password']

  for (const fmt of formats) {
    it(`format: ${fmt} → string`, () => {
      expect(schemaToTs({ type: 'string', format: fmt })).toBe('string')
    })
  }
})

// ═══════════════════════════════════════════════════════════
// 4. nullable 패턴 (typia: oneOf + null, type array)
// ═══════════════════════════════════════════════════════════

describe('nullable 패턴', () => {
  it('type: ["string", "null"] → string | null', () => {
    expect(schemaToTs({ type: ['string', 'null'] })).toBe('string | null')
  })
  it('type: ["integer", "null"] → number | null', () => {
    expect(schemaToTs({ type: ['integer', 'null'] })).toBe('number | null')
  })
  it('type: ["boolean", "null"] → boolean | null', () => {
    expect(schemaToTs({ type: ['boolean', 'null'] })).toBe('boolean | null')
  })
  it('type: ["object", "null"] → object | null', () => {
    const result = schemaToTs({ type: ['object', 'null'], properties: { x: { type: 'string' } } })
    expect(result).toContain('| null')
    expect(result).toContain('x')
  })
  it('type: ["array", "null"] → array | null', () => {
    const result = schemaToTs({ type: ['array', 'null'], items: { type: 'string' } })
    expect(result).toContain('string[]')
    expect(result).toContain('| null')
  })
})

// ═══════════════════════════════════════════════════════════
// 5. enum / const (typia: enum → union, const → literal)
// ═══════════════════════════════════════════════════════════

describe('enum / const', () => {
  // string enum
  it('string enum → literal union', () => {
    expect(schemaToTs({ type: 'string', enum: ['a', 'b'] })).toBe("'a' | 'b'")
  })
  it('integer enum → numeric literal union', () => {
    expect(schemaToTs({ type: 'integer', enum: [1, 2, 3] })).toBe('1 | 2 | 3')
  })
  it('number enum → numeric literal union', () => {
    expect(schemaToTs({ type: 'number', enum: [1.5, 2.5] })).toBe('1.5 | 2.5')
  })
  it('mixed enum → mixed literal union', () => {
    expect(schemaToTs({ enum: ['a', 1, true] })).toBe("'a' | 1 | true")
  })

  // const
  it('string const → string literal', () => {
    expect(schemaToTs({ const: 'fixed' })).toBe("'fixed'")
  })
  it('number const → number literal', () => {
    expect(schemaToTs({ const: 42 })).toBe('42')
  })
  it('boolean const: true', () => {
    expect(schemaToTs({ const: true })).toBe('true')
  })
  it('boolean const: false', () => {
    expect(schemaToTs({ const: false })).toBe('false')
  })
  it('null const', () => {
    expect(schemaToTs({ const: null })).toBe('null')
  })
  it('0 const (falsy)', () => {
    expect(schemaToTs({ const: 0 })).toBe('0')
  })
})

// ═══════════════════════════════════════════════════════════
// 6. 배열 변형
// ═══════════════════════════════════════════════════════════

describe('배열 변형', () => {
  it('string[] ', () => expect(schemaToTs({ type: 'array', items: { type: 'string' } })).toBe('string[]'))
  it('number[]', () => expect(schemaToTs({ type: 'array', items: { type: 'number' } })).toBe('number[]'))
  it('items 없음 → unknown[]', () => expect(schemaToTs({ type: 'array' })).toBe('unknown[]'))
  it('nested array → number[][]', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'array', items: { type: 'number' } } })).toBe('number[][]')
  })
  it('union items → (string | number)[]', () => {
    expect(schemaToTs({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } })).toBe('(string | number)[]')
  })
})

// ═══════════════════════════════════════════════════════════
// 7. 튜플 (typia: prefixItems)
// ═══════════════════════════════════════════════════════════

describe('튜플', () => {
  it('[string, number]', () => {
    expect(schemaToTs({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
    })).toBe('[string, number]')
  })
  it('[boolean, string, number]', () => {
    expect(schemaToTs({
      type: 'array',
      prefixItems: [{ type: 'boolean' }, { type: 'string' }, { type: 'number' }],
    })).toBe('[boolean, string, number]')
  })
  it('rest element: [string, ...number[]]', () => {
    expect(schemaToTs({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      items: { type: 'number' },
    })).toBe('[string, ...number[]]')
  })
})

// ═══════════════════════════════════════════════════════════
// 8. 객체 변형
// ═══════════════════════════════════════════════════════════

describe('객체 변형', () => {
  it('빈 객체 → Record<string, unknown>', () => {
    expect(schemaToTs({ type: 'object' })).toBe('Record<string, unknown>')
  })
  it('전부 required', () => {
    const result = schemaToTs({
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    })
    expect(result).toContain('a: string')
    expect(result).toContain('b: number')
    expect(result).not.toContain('?')
  })
  it('전부 optional', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    })
    expect(result).toContain('a?: string')
    expect(result).toContain('b?: number')
  })
  it('description → JSDoc 주석', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { name: { type: 'string', description: '사용자 이름' } },
    })
    expect(result).toContain('/** 사용자 이름 */')
  })
  it('additionalProperties: true → Record<string, unknown>', () => {
    expect(schemaToTs({ type: 'object', additionalProperties: true })).toBe('Record<string, unknown>')
  })
  it('additionalProperties schema → Record<string, T>', () => {
    expect(schemaToTs({ type: 'object', additionalProperties: { type: 'number' } })).toBe('Record<string, number>')
  })
  it('고정 필드 + additionalProperties → index signature', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(result).toContain('id')
    expect(result).toContain('[key: string]: number')
  })
})

// ═══════════════════════════════════════════════════════════
// 9. 조합 (allOf / oneOf / anyOf)
// ═══════════════════════════════════════════════════════════

describe('조합', () => {
  it('allOf 2개 → intersection', () => {
    const result = schemaToTs({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    })
    expect(result).toContain('&')
  })
  it('oneOf 2개 → union', () => {
    expect(schemaToTs({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number')
  })
  it('anyOf 2개 → union', () => {
    expect(schemaToTs({ anyOf: [{ type: 'string' }, { type: 'boolean' }] })).toBe('string | boolean')
  })
  it('allOf 1개 → 단일 타입', () => {
    expect(schemaToTs({ allOf: [{ type: 'string' }] })).toBe('string')
  })
  it('oneOf 1개 → 단일 타입', () => {
    expect(schemaToTs({ oneOf: [{ type: 'number' }] })).toBe('number')
  })
  it('allOf with $ref → 이름 참조 intersection', () => {
    const result = schemaToTs({
      allOf: [
        { $ref: '#/components/schemas/Base' },
        { type: 'object', properties: { extra: { type: 'string' } } },
      ],
    })
    expect(result).toContain('Base')
    expect(result).toContain('&')
  })
})

// ═══════════════════════════════════════════════════════════
// 10. $ref
// ═══════════════════════════════════════════════════════════

describe('$ref', () => {
  it('#/components/schemas/User → User', () => {
    expect(schemaToTs({ $ref: '#/components/schemas/User' })).toBe('User')
  })
  it('깊은 경로 → 마지막 세그먼트', () => {
    expect(schemaToTs({ $ref: '#/components/schemas/deep/Nested' })).toBe('Nested')
  })
})

// ═══════════════════════════════════════════════════════════
// 11. if / then / else
// ═══════════════════════════════════════════════════════════

describe('if/then/else', () => {
  it('then + else → union', () => {
    const result = schemaToTs({
      if: { properties: { kind: { const: 'a' } } },
      then: { type: 'string' },
      else: { type: 'number' },
    })
    expect(result).toContain('|')
  })
  it('then만 → 단일 타입', () => {
    expect(schemaToTs({ if: {}, then: { type: 'string' } })).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════
// 12. 런타임 제약 — 타입에 영향 없음을 명시적 검증
//     (typia는 이를 @tags로 처리, 우리는 타입 생성에서 무시)
// ═══════════════════════════════════════════════════════════

describe('런타임 제약 — 타입에 영향 없음', () => {
  it('minLength/maxLength → string 유지', () => {
    expect(schemaToTs({ type: 'string', minLength: 1, maxLength: 100 })).toBe('string')
  })
  it('minimum/maximum → number 유지', () => {
    expect(schemaToTs({ type: 'number', minimum: 0, maximum: 100 })).toBe('number')
  })
  it('exclusiveMinimum/exclusiveMaximum → number 유지', () => {
    expect(schemaToTs({ type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 100 })).toBe('number')
  })
  it('multipleOf → number 유지', () => {
    expect(schemaToTs({ type: 'number', multipleOf: 0.01 })).toBe('number')
  })
  it('pattern → string 유지', () => {
    expect(schemaToTs({ type: 'string', pattern: '^[a-z]+$' })).toBe('string')
  })
  it('minItems/maxItems → 배열 타입 유지', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 })).toBe('string[]')
  })
  it('uniqueItems → 배열 타입 유지', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'number' }, uniqueItems: true })).toBe('number[]')
  })
})

// ═══════════════════════════════════════════════════════════
// 13. 특수 속성 — 현재 동작 문서화
// ═══════════════════════════════════════════════════════════

describe('특수 속성', () => {
  it('readOnly → readonly 수식어', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string', readOnly: true } },
      required: ['id'],
    })
    expect(result).toContain('readonly id: string')
  })

  it('readOnly 없으면 readonly 없음', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    expect(result).not.toContain('readonly')
  })

  it('writeOnly → 타입에 영향 없음', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { password: { type: 'string', writeOnly: true } },
    })
    expect(result).toContain('password')
  })

  it('deprecated 프로퍼티 → @deprecated JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { old: { type: 'string', deprecated: true } },
    })
    expect(result).toContain('@deprecated')
  })

  it('deprecated 없으면 @deprecated 없음', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { current: { type: 'string' } },
    })
    expect(result).not.toContain('@deprecated')
  })

  it('format → @format JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
    })
    expect(result).toContain('@format email')
  })

  it('minimum/maximum → @minimum/@maximum JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { age: { type: 'integer', minimum: 0, maximum: 150 } },
    })
    expect(result).toContain('@minimum 0')
    expect(result).toContain('@maximum 150')
  })

  it('minLength/maxLength → @minLength/@maxLength JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 50 } },
    })
    expect(result).toContain('@minLength 1')
    expect(result).toContain('@maxLength 50')
  })

  it('pattern → @pattern JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { code: { type: 'string', pattern: '^[A-Z]{3}$' } },
    })
    expect(result).toContain('@pattern ^[A-Z]{3}$')
  })

  it('description + constraints → 멀티라인 JSDoc', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { score: { type: 'integer', description: '점수', minimum: 0, maximum: 100 } },
    })
    expect(result).toContain('점수')
    expect(result).toContain('@minimum 0')
    expect(result).toContain('@maximum 100')
  })

  it('제약 없으면 JSDoc 없음', () => {
    const result = schemaToTs({
      type: 'object',
      properties: { plain: { type: 'string' } },
    })
    expect(result).not.toContain('/**')
  })

  it('example → 무시됨 (stripExamples)', () => {
    expect(schemaToTs({ type: 'string', example: 'hello' })).toBe('string')
  })

  it('default → 무시됨 (stripExamples)', () => {
    expect(schemaToTs({ type: 'integer', default: 42 })).toBe('number')
  })
})

// ═══════════════════════════════════════════════════════════
// 14. 복합 패턴 (typia 실사용 시나리오)
// ═══════════════════════════════════════════════════════════

describe('복합 패턴 — 실사용 시나리오', () => {
  it('User 모델: required + optional + enum + format', () => {
    const result = schemaToTs({
      type: 'object',
      required: ['id', 'email', 'role'],
      properties: {
        id:    { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        role:  { type: 'string', enum: ['admin', 'user'] },
        bio:   { type: 'string' },
        age:   { type: 'integer', minimum: 0, maximum: 150 },
      },
    })
    expect(result).toContain('id: string')
    expect(result).toContain('email: string')
    expect(result).toContain("role: 'admin' | 'user'")
    expect(result).toContain('bio?: string')
    expect(result).toContain('age?: number')
  })

  it('Pagination: query params with defaults', () => {
    const result = schemaToTs({
      type: 'object',
      properties: {
        page:  { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        sort:  { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
    })
    expect(result).toContain('page?: number')
    expect(result).toContain('limit?: number')
    expect(result).toContain("sort?: 'asc' | 'desc'")
  })

  it('Error 응답: discriminated error codes', () => {
    const result = schemaToTs({
      oneOf: [
        { type: 'object', required: ['code', 'message'], properties: { code: { const: 'NOT_FOUND' }, message: { type: 'string' } } },
        { type: 'object', required: ['code', 'message', 'fields'], properties: { code: { const: 'VALIDATION' }, message: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } } },
      ],
    })
    expect(result).toContain("'NOT_FOUND'")
    expect(result).toContain("'VALIDATION'")
    expect(result).toContain('|')
  })

  it('Webhook payload: nested object with nullable + array', () => {
    const result = schemaToTs({
      type: 'object',
      required: ['event', 'data'],
      properties: {
        event: { type: 'string', enum: ['created', 'updated', 'deleted'] },
        data:  { type: 'object', properties: { id: { type: 'string' }, changes: { type: ['array', 'null'], items: { type: 'string' } } } },
        meta:  { type: 'object', additionalProperties: { type: 'string' } },
      },
    })
    expect(result).toContain("event: 'created' | 'updated' | 'deleted'")
    expect(result).toContain('data: {')
    expect(result).toContain('meta?: Record<string, string>')
  })
})
