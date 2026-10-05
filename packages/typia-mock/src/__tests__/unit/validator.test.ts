import { describe, it, expect } from 'vitest'
import { validateRawArgs, validateParsedArgs } from '../../core/validator.js'
import { generateFromSchema } from '../../core/generate.js'
import { createMockApplication, createMinimalFunction } from '../fixtures/mock-application.js'
import type { ILlmApplication, ILlmFunction } from '../../types.js'

const app = createMockApplication()

// ─── validateRawArgs (parse → coerce → validate) ───────────────────────────

describe('validateRawArgs', () => {
  it('유효한 JSON → 성공', () => {
    const result = validateRawArgs(app, 'createUser', JSON.stringify({ email: 'a@b.com', name: 'Alice' }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ email: 'a@b.com', name: 'Alice' })
    }
  })

  it('잘못된 JSON → parse 단계 실패', () => {
    const result = validateRawArgs(app, 'createUser', '{invalid json}')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('parse')
      expect(result.raw).toBe('{invalid json}')
    }
  })

  it('유효한 JSON + 잘못된 데이터 → validate 단계 실패', () => {
    const result = validateRawArgs(app, 'createUser', JSON.stringify({ email: 'not-email', name: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('validate')
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.path.includes('email'))).toBe(true)
      expect(result.errors.some((e) => e.path.includes('name'))).toBe(true)
    }
  })

  it('존재하지 않는 함수 → 실패', () => {
    const result = validateRawArgs(app, 'nonExistent', '{}')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors[0]?.expected).toContain('nonExistent')
    }
  })

  it('optional 필드 누락 → 성공', () => {
    const result = validateRawArgs(app, 'createUser', JSON.stringify({ email: 'a@b.com', name: 'Bob' }))
    expect(result.success).toBe(true)
  })

  it('age 문자열 → coerce 후 성공', () => {
    const result = validateRawArgs(app, 'createUser', JSON.stringify({ email: 'a@b.com', name: 'Bob', age: '25' }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>)['age']).toBe(25)
    }
  })

  it('age 음수 → validate 단계 실패', () => {
    const result = validateRawArgs(app, 'createUser', JSON.stringify({ email: 'a@b.com', name: 'Bob', age: -1 }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('validate')
      expect(result.errors.some((e) => e.path.includes('age'))).toBe(true)
    }
  })
})

// ─── validateParsedArgs (coerce → validate) ─────────────────────────────────

describe('validateParsedArgs', () => {
  it('유효한 데이터 → 성공', () => {
    const result = validateParsedArgs(app, 'createUser', { email: 'a@b.com', name: 'Alice' })
    expect(result.success).toBe(true)
  })

  it('필수 필드 누락 → validate 단계 실패', () => {
    const result = validateParsedArgs(app, 'createUser', { name: 'Alice' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('validate')
      expect(result.errors.some((e) => e.path.includes('email'))).toBe(true)
    }
  })

  it('non-object 입력 → validate 단계 실패', () => {
    const result = validateParsedArgs(app, 'createUser', 'not an object')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('validate')
    }
  })

  it('존재하지 않는 함수 → 실패', () => {
    const result = validateParsedArgs(app, 'nonExistent', {})
    expect(result.success).toBe(false)
  })

  it('coerce: 문자열 숫자 → 정수 변환', () => {
    const result = validateParsedArgs(app, 'getUsers', { limit: '10', offset: '0' })
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as Record<string, unknown>
      expect(data['limit']).toBe(10)
      expect(data['offset']).toBe(0)
    }
  })

  it('getUsers: limit 범위 초과 → 실패', () => {
    const result = validateParsedArgs(app, 'getUsers', { limit: 200 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.path.includes('limit'))).toBe(true)
    }
  })

  it('getUsers: 빈 객체 → 성공 (모든 필드 optional)', () => {
    const result = validateParsedArgs(app, 'getUsers', {})
    expect(result.success).toBe(true)
  })
})

// ─── minimal function (no parse/coerce/validate) ───────────────────────────

describe('minimal function (no pipeline methods)', () => {
  const minApp: ILlmApplication = { functions: [createMinimalFunction()] }

  it('parse 없이 raw JSON → JSON.parse 폴백', () => {
    const result = validateRawArgs(minApp, 'minimal', '{"key":"value"}')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ key: 'value' })
    }
  })

  it('parse 없이 잘못된 JSON → parse 실패', () => {
    const result = validateRawArgs(minApp, 'minimal', 'invalid')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('parse')
    }
  })

  it('JSON.parse 폴백: validate의 SyntaxError는 parse 실패가 아니라 호출자에게 전달', () => {
    const save: ILlmFunction = {
      name: 'save',
      parameters: { type: 'object', properties: { payload: { type: 'string' } } },
      // A validator that parses a nested JSON string throws its own SyntaxError.
      validate: (input) => ({ success: true, data: JSON.parse(String((input as { payload: unknown }).payload)) }),
    }
    const saveApp: ILlmApplication = { functions: [save] }

    expect(() => validateRawArgs(saveApp, 'save', '{"payload":"{not json"}')).toThrow(SyntaxError)
    // Malformed JSON arguments are still a parse-stage failure.
    expect(validateRawArgs(saveApp, 'save', '{"payload":')).toMatchObject({ success: false, stage: 'parse' })
    expect(validateRawArgs(saveApp, 'save', '{"payload":"{\\"ok\\":true}"}')).toMatchObject({ success: true, data: { ok: true } })
  })

  it('validate 없이 parsed data → 통과', () => {
    const result = validateParsedArgs(minApp, 'minimal', { anything: true })
    expect(result.success).toBe(true)
  })
})

// ─── mock 응답 생성 ────────────────────────────────────────────────────────

describe('mock response generation', () => {
  it('성공 시 output 스키마 기반 mock 응답 포함', () => {
    const result = validateParsedArgs(app, 'createUser', { email: 'a@b.com', name: 'Alice' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.mock).toBeDefined()
      const mock = result.mock as Record<string, unknown>
      expect(mock).toHaveProperty('id')
      expect(mock).toHaveProperty('email')
      expect(mock).toHaveProperty('name')
    }
  })

  it('output 없는 함수 → mock은 undefined', () => {
    const result = validateParsedArgs(app, 'minimal', { anything: true })
    // minimal function has no output schema
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.mock).toBeUndefined()
    }
  })
})

// ─── generateFromSchema ────────────────────────────────────────────────────

describe('generateFromSchema', () => {
  it('string → 빈 문자열', () => {
    expect(generateFromSchema({ type: 'string' })).toBe('')
  })

  it('string + format email → example@example.com', () => {
    expect(generateFromSchema({ type: 'string', format: 'email' })).toBe('example@example.com')
  })

  it('string + format uuid → zero UUID', () => {
    expect(generateFromSchema({ type: 'string', format: 'uuid' })).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('string + minLength → padded', () => {
    expect(generateFromSchema({ type: 'string', minLength: 5 })).toBe('xxxxx')
  })

  it('integer → 0', () => {
    expect(generateFromSchema({ type: 'integer' })).toBe(0)
  })

  it('integer + minimum → minimum 값', () => {
    expect(generateFromSchema({ type: 'integer', minimum: 10 })).toBe(10)
  })

  it('boolean → false', () => {
    expect(generateFromSchema({ type: 'boolean' })).toBe(false)
  })

  it('null → null', () => {
    expect(generateFromSchema({ type: 'null' })).toBe(null)
  })

  it('object + required → required 필드만', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
      },
    }
    const result = generateFromSchema(schema) as Record<string, unknown>
    expect(result).toHaveProperty('id')
    expect(result).not.toHaveProperty('name')
  })

  it('array + minItems 0 → 빈 배열', () => {
    expect(generateFromSchema({ type: 'array', items: { type: 'string' } })).toEqual([])
  })

  it('array + minItems 2 → 2개 항목', () => {
    const result = generateFromSchema({ type: 'array', items: { type: 'integer' }, minItems: 2 })
    expect(result).toEqual([0, 0])
  })

  it('enum → 첫 번째 값', () => {
    expect(generateFromSchema({ type: 'string', enum: ['active', 'inactive'] })).toBe('active')
  })

  it('example → example 값 그대로', () => {
    expect(generateFromSchema({ type: 'string', example: 'hello' })).toBe('hello')
  })

  it('oneOf → 첫 번째 브랜치', () => {
    expect(generateFromSchema({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('')
  })

  it('undefined → undefined', () => {
    expect(generateFromSchema(undefined)).toBeUndefined()
  })
})

// ─── coerce 에러 처리 ──────────────────────────────────────────────────────

describe('coerce error handling', () => {
  it('coerce에서 throw → coerce 단계 실패', () => {
    const throwingApp: ILlmApplication = {
      functions: [
        {
          name: 'broken',
          parameters: {},
          coerce() {
            throw new Error('coerce failed')
          },
          validate(input: unknown) {
            return { success: true as const, data: input }
          },
        },
      ],
    }
    const result = validateParsedArgs(throwingApp, 'broken', { data: 1 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.stage).toBe('coerce')
    }
  })
})
