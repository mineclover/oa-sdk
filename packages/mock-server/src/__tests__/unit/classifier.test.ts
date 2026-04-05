/**
 * classifier.ts 단위 테스트
 *
 * AJV ErrorObject → MockErrorDetail 변환 각 keyword를 독립 검증.
 * AJV verbose: true 모드에서 err.data가 채워짐을 전제로 함.
 */
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { classifyAjvErrors } from '../../errors/classifier.js'
import type { MockErrorDetail } from '../../errors/types.js'

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
addFormats(ajv)

function classify(schema: object, data: unknown, basePath = ''): MockErrorDetail[] {
  const validate = ajv.compile(schema)
  validate(data)
  const raw = classifyAjvErrors(validate.errors ?? [])
  // basePath prefix 적용 (request-validator 방식 재현)
  return raw.map(e => ({
    ...e,
    path: e.path === '/' ? basePath : basePath + e.path,
  }))
}

// ─── type ────────────────────────────────────────────────────────────────────

describe('type keyword → TYPE_ERROR', () => {
  it('string 스키마에 number → TYPE_ERROR, received=타입명', () => {
    const errors = classify({ type: 'string' }, 42)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('TYPE_ERROR')
    expect(errors[0]?.received).toBe('number')
    expect(errors[0]?.expected).toBe('string')
  })

  it('integer 스키마에 string → TYPE_ERROR', () => {
    const errors = classify({ type: 'integer' }, 'hello')
    expect(errors[0]?.code).toBe('TYPE_ERROR')
    expect(errors[0]?.received).toBe('string')
  })

  it('object 스키마에 array → TYPE_ERROR, received=array', () => {
    const errors = classify({ type: 'object' }, [1, 2, 3])
    expect(errors[0]?.code).toBe('TYPE_ERROR')
    expect(errors[0]?.received).toBe('array')
  })

  it('null 입력 → TYPE_ERROR, received=null', () => {
    const errors = classify({ type: 'string' }, null)
    expect(errors[0]?.code).toBe('TYPE_ERROR')
    expect(errors[0]?.received).toBe('null')
  })
})

// ─── required ────────────────────────────────────────────────────────────────

describe('required keyword → MISSING_REQUIRED_FIELD', () => {
  it('누락된 필드명을 path에 포함', () => {
    const errors = classify(
      { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      {},
      '/body',
    )
    expect(errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    expect(errors[0]?.path).toBe('/body/name')
  })

  it('여러 필드 누락 → 각각 독립 에러', () => {
    const errors = classify(
      { type: 'object', required: ['a', 'b', 'c'], properties: { a: {}, b: {}, c: {} } },
      {},
    )
    expect(errors).toHaveLength(3)
    expect(errors.every(e => e.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
    const paths = errors.map(e => e.path)
    expect(paths).toContain('/a')
    expect(paths).toContain('/b')
    expect(paths).toContain('/c')
  })

  it('중첩 객체 path가 올바르게 구성됨', () => {
    const errors = classify(
      {
        type: 'object',
        required: ['address'],
        properties: {
          address: {
            type: 'object',
            required: ['city'],
            properties: { city: { type: 'string' } },
          },
        },
      },
      { address: {} },
      '/body',
    )
    const cityErr = errors.find(e => e.path.endsWith('/city'))
    expect(cityErr?.code).toBe('MISSING_REQUIRED_FIELD')
    expect(cityErr?.path).toBe('/body/address/city')
  })
})

// ─── enum ─────────────────────────────────────────────────────────────────────

describe('enum keyword → INVALID_ENUM_VALUE', () => {
  it('허용되지 않는 값 → INVALID_ENUM_VALUE, received=입력값', () => {
    const errors = classify({ type: 'string', enum: ['a', 'b', 'c'] }, 'x')
    expect(errors[0]?.code).toBe('INVALID_ENUM_VALUE')
    expect(errors[0]?.received).toBe('x')
    expect(errors[0]?.expected).toBe('a | b | c')
  })

  it('숫자 enum → expected에 숫자 목록 포함', () => {
    const errors = classify({ type: 'integer', enum: [1, 2, 3] }, 99)
    expect(errors[0]?.code).toBe('INVALID_ENUM_VALUE')
    expect(errors[0]?.expected).toContain('1')
  })
})

// ─── format ───────────────────────────────────────────────────────────────────

describe('format keyword → FORMAT_MISMATCH', () => {
  it('email format 불일치 → FORMAT_MISMATCH', () => {
    const errors = classify({ type: 'string', format: 'email' }, 'not-an-email')
    expect(errors[0]?.code).toBe('FORMAT_MISMATCH')
    expect(errors[0]?.received).toBe('not-an-email')
    expect(errors[0]?.expected).toBe('email')
  })

  it('uuid format 불일치 → FORMAT_MISMATCH', () => {
    const errors = classify({ type: 'string', format: 'uuid' }, 'not-a-uuid')
    expect(errors[0]?.code).toBe('FORMAT_MISMATCH')
    expect(errors[0]?.expected).toBe('uuid')
  })

  it('date-time format 불일치 → FORMAT_MISMATCH', () => {
    const errors = classify({ type: 'string', format: 'date-time' }, '2024-99-99')
    expect(errors[0]?.code).toBe('FORMAT_MISMATCH')
  })
})

// ─── pattern ──────────────────────────────────────────────────────────────────

describe('pattern keyword → PATTERN_MISMATCH', () => {
  it('패턴 불일치 → PATTERN_MISMATCH, expected에 패턴 포함', () => {
    const errors = classify({ type: 'string', pattern: '^[a-z]+$' }, 'ABC123')
    expect(errors[0]?.code).toBe('PATTERN_MISMATCH')
    expect(errors[0]?.received).toBe('ABC123')
    expect(errors[0]?.expected).toBe('/^[a-z]+$/')
  })
})

// ─── minLength / maxLength ────────────────────────────────────────────────────

describe('minLength / maxLength → CONSTRAINT_VIOLATION', () => {
  it('minLength 위반 → received에 길이 정보 포함', () => {
    const errors = classify({ type: 'string', minLength: 8 }, 'abc')
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(String(errors[0]?.received)).toContain('abc')
    expect(String(errors[0]?.received)).toContain('3')
    expect(errors[0]?.constraint).toMatchObject({ limit: 8 })
  })

  it('maxLength 위반 → CONSTRAINT_VIOLATION', () => {
    const errors = classify({ type: 'string', maxLength: 3 }, 'toolongstring')
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(errors[0]?.constraint).toMatchObject({ limit: 3 })
  })
})

// ─── minimum / maximum ────────────────────────────────────────────────────────

describe('minimum / maximum → CONSTRAINT_VIOLATION', () => {
  it('minimum 위반 → CONSTRAINT_VIOLATION + constraint 포함', () => {
    const errors = classify({ type: 'integer', minimum: 1 }, 0)
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(errors[0]?.received).toBe(0)
    expect(errors[0]?.constraint).toMatchObject({ limit: 1 })
  })

  it('maximum 위반 → CONSTRAINT_VIOLATION', () => {
    const errors = classify({ type: 'integer', maximum: 100 }, 200)
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(errors[0]?.constraint).toMatchObject({ limit: 100 })
  })
})

// ─── minItems / maxItems ──────────────────────────────────────────────────────

describe('minItems / maxItems → CONSTRAINT_VIOLATION', () => {
  it('minItems 위반 → received에 배열 길이 정보', () => {
    const errors = classify({ type: 'array', minItems: 3, items: { type: 'integer' } }, [1])
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(String(errors[0]?.received)).toContain('1')
    expect(errors[0]?.constraint).toMatchObject({ limit: 3 })
  })
})

// ─── path normalization ───────────────────────────────────────────────────────

describe('path 정규화', () => {
  it('루트 경로는 빈 문자열', () => {
    const errors = classify({ type: 'string' }, 42)
    expect(errors[0]?.path).toBe('')
  })

  it('중첩 필드는 /field 형식', () => {
    const errors = classify(
      { type: 'object', required: ['x'], properties: { x: { type: 'string' } } },
      { x: 123 },
    )
    const typeErr = errors.find(e => e.code === 'TYPE_ERROR')
    expect(typeErr?.path).toBe('/x')
  })

  it('basePath prefix가 에러 path에 붙는다', () => {
    const errors = classify({ type: 'string' }, 42, '/body/name')
    expect(errors[0]?.path).toBe('/body/name')
  })
})

// ─── multipleOf ──────────────────────────────────────────────────────────────

describe('multipleOf keyword → CONSTRAINT_VIOLATION', () => {
  it('multipleOf 위반 → CONSTRAINT_VIOLATION', () => {
    const errors = classify({ type: 'number', multipleOf: 5 }, 7)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
    expect(errors[0]?.received).toBe(7)
  })
})

// ─── oneOf ───────────────────────────────────────────────────────────────────

describe('oneOf failure', () => {
  it('oneOf 어떤 스키마도 만족하지 않으면 에러 발생', () => {
    const errors = classify(
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
      true,
    )
    expect(errors.length).toBeGreaterThanOrEqual(1)
    // oneOf 실패는 TYPE_ERROR 또는 combiner 관련 에러
    const codes = errors.map(e => e.code)
    expect(
      codes.some(c => c === 'TYPE_ERROR' || c === 'CONSTRAINT_VIOLATION'),
    ).toBe(true)
  })
})

// ─── anyOf ───────────────────────────────────────────────────────────────────

describe('anyOf failure', () => {
  it('anyOf 어떤 스키마도 만족하지 않으면 에러 발생', () => {
    const errors = classify(
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      [],
    )
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const codes = errors.map(e => e.code)
    expect(
      codes.some(c => c === 'TYPE_ERROR' || c === 'CONSTRAINT_VIOLATION'),
    ).toBe(true)
  })
})

// ─── allOf partial failure ───────────────────────────────────────────────────

describe('allOf partial failure → MISSING_REQUIRED_FIELD', () => {
  it('allOf 중 일부 required 누락 → MISSING_REQUIRED_FIELD', () => {
    const errors = classify(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      },
      { a: 'x' },
    )
    const missingB = errors.find(e => e.code === 'MISSING_REQUIRED_FIELD' && e.path.endsWith('/b'))
    expect(missingB).toBeDefined()
    expect(missingB?.code).toBe('MISSING_REQUIRED_FIELD')
  })
})

// ─── 정상 데이터 → 빈 에러 배열 ─────────────────────────────────────────────

describe('정상 데이터 → 에러 없음', () => {
  it('스키마를 만족하는 데이터는 빈 배열 반환', () => {
    const errors = classify(
      {
        type: 'object',
        required: ['name', 'age'],
        properties: {
          name: { type: 'string', minLength: 1 },
          age: { type: 'integer', minimum: 0 },
        },
      },
      { name: 'Alice', age: 30 },
    )
    expect(errors).toHaveLength(0)
  })
})

// ─── 특수 문자 필드명 ────────────────────────────────────────────────────────

describe('특수 문자 필드명 path', () => {
  it('점(.)이 포함된 필드명 → path에 해당 필드명 포함', () => {
    const errors = classify(
      {
        type: 'object',
        required: ['foo.bar'],
        properties: { 'foo.bar': { type: 'string' } },
      },
      {},
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    expect(errors[0]?.path).toContain('foo.bar')
  })

  it('슬래시(/)가 포함된 필드명 → path에 해당 필드명 포함', () => {
    const errors = classify(
      {
        type: 'object',
        required: ['foo/bar'],
        properties: { 'foo/bar': { type: 'string' } },
      },
      {},
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    expect(errors[0]?.path).toContain('foo/bar')
  })
})
