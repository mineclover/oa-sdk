/**
 * request-validator.ts — 파라미터(path/query/header/cookie) 검증 단위 테스트
 * OAS 3.2.0 §4.8.12 Parameter Object
 */
import { describe, it, expect } from 'vitest'
import { validateRequest } from '../../core/request-validator.js'
import type { OasParameter } from '@oa-sdk/parser'

function parts(overrides: Partial<Parameters<typeof validateRequest>[0]> = {}) {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

// ─── path parameters ──────────────────────────────────────────────────────────

describe('path params (OAS 3.2.0 §4.8.12 — in: path는 required: true 필수)', () => {
  const uuidParam: OasParameter = {
    name: 'id', in: 'path', required: true,
    schema: { type: 'string', format: 'uuid' },
  }

  it('required path param 누락 → MISSING_REQUIRED_FIELD, path=/path/id', () => {
    const r = validateRequest(parts(), [uuidParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/path/id')
    }
  })

  it('유효한 uuid path param → valid', () => {
    const r = validateRequest(
      parts({ pathParams: { id: '123e4567-e89b-12d3-a456-426614174000' } }),
      [uuidParam], undefined,
    )
    expect(r.valid).toBe(true)
  })

  it('uuid format 불일치 → FORMAT_MISMATCH', () => {
    const r = validateRequest(
      parts({ pathParams: { id: 'not-a-uuid' } }),
      [uuidParam], undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('FORMAT_MISMATCH')
  })
})

// ─── query parameters ─────────────────────────────────────────────────────────

describe('query params — 타입 coerce 및 스키마 검증', () => {
  const pageParam: OasParameter = {
    name: 'page', in: 'query',
    schema: { type: 'integer', minimum: 1 },
  }
  const roleParam: OasParameter = {
    name: 'role', in: 'query',
    schema: { type: 'string', enum: ['admin', 'user', 'guest'] },
  }

  it('"1" → integer로 coerce 후 통과', () => {
    expect(validateRequest(parts({ queryParams: { page: '1' } }), [pageParam], undefined).valid).toBe(true)
  })

  it('"100" → integer로 coerce 후 통과', () => {
    expect(validateRequest(parts({ queryParams: { page: '100' } }), [pageParam], undefined).valid).toBe(true)
  })

  it('"0" → minimum:1 위반 → CONSTRAINT_VIOLATION', () => {
    const r = validateRequest(parts({ queryParams: { page: '0' } }), [pageParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('CONSTRAINT_VIOLATION')
      expect(r.errors[0]?.path).toBe('/query/page')
    }
  })

  it('"1.7" → 정수가 아니므로 검증 실패', () => {
    expect(validateRequest(parts({ queryParams: { page: '1.7' } }), [pageParam], undefined).valid).toBe(false)
  })

  it('"NaN" → 검증 실패', () => {
    expect(validateRequest(parts({ queryParams: { page: 'NaN' } }), [pageParam], undefined).valid).toBe(false)
  })

  it('enum 외 값 → INVALID_ENUM_VALUE', () => {
    const r = validateRequest(parts({ queryParams: { role: 'superadmin' } }), [roleParam], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('INVALID_ENUM_VALUE')
  })

  it('유효한 enum 값 → valid', () => {
    expect(validateRequest(parts({ queryParams: { role: 'admin' } }), [roleParam], undefined).valid).toBe(true)
  })

  it('optional query param 누락 → valid', () => {
    expect(validateRequest(parts(), [roleParam], undefined).valid).toBe(true)
  })

  it('boolean coerce: "true"/"false" → boolean', () => {
    const boolParam: OasParameter = { name: 'active', in: 'query', schema: { type: 'boolean' } }
    expect(validateRequest(parts({ queryParams: { active: 'true' } }), [boolParam], undefined).valid).toBe(true)
    expect(validateRequest(parts({ queryParams: { active: 'false' } }), [boolParam], undefined).valid).toBe(true)
    expect(validateRequest(parts({ queryParams: { active: 'yes' } }), [boolParam], undefined).valid).toBe(false)
  })

  it('number coerce: "3.14" → float 통과', () => {
    const numParam: OasParameter = { name: 'score', in: 'query', schema: { type: 'number' } }
    expect(validateRequest(parts({ queryParams: { score: '3.14' } }), [numParam], undefined).valid).toBe(true)
  })
})

describe('query params — deepObject 역직렬화', () => {
  const nameFilterParam: OasParameter = {
    name: 'filter', in: 'query', required: true, style: 'deepObject', explode: true,
    schema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    },
  }

  it('filter[name]=alice를 object 값으로 조립해 검증한다', () => {
    const result = validateRequest(
      parts({ queryParams: { 'filter[name]': 'alice' } }),
      [nameFilterParam],
      undefined,
    )

    expect(result.valid).toBe(true)
  })

  it('반복된 deepObject 값은 배열로 보존하고 관련 없는 query key는 제외한다', () => {
    const tagsFilterParam: OasParameter = {
      name: 'filter', in: 'query', required: true, style: 'deepObject', explode: true,
      schema: {
        type: 'object',
        required: ['name', 'tags'],
        properties: {
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    }

    const result = validateRequest(
      parts({
        queryParams: {
          'filter[name]': 'alice',
          'filter[tags]': ['alpha', 'beta'],
          page: '2',
          'other[value]': 'ignored',
        },
      }),
      [tagsFilterParam],
      undefined,
    )

    expect(result.valid).toBe(true)
  })
})

describe('querystring params — declared content decoding', () => {
  const formQuerystring: OasParameter = {
    name: 'query', in: 'querystring', required: true,
    content: {
      'application/x-www-form-urlencoded': {
        schema: {
          type: 'object',
          required: ['q', 'tags'],
          properties: {
            q: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }

  it('raw form query string을 content schema에 맞게 검증한다', () => {
    const result = validateRequest(
      parts({ rawQueryString: 'q=alice&tags=alpha&tags=beta' }),
      [formQuerystring],
      undefined,
    )
    expect(result.valid).toBe(true)
  })

  it('URI-encoded JSON query string을 declared JSON content schema로 검증한다', () => {
    const result = validateRequest(
      parts({ rawQueryString: '%7B%22q%22%3A%22alice%22%7D' }),
      [{
        name: 'query', in: 'querystring', required: true,
        content: {
          'application/json': {
            schema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
          },
        },
      }],
      undefined,
    )
    expect(result.valid).toBe(true)
  })

  it('required querystring이 없으면 missing error를 반환한다', () => {
    const result = validateRequest(parts(), [formQuerystring], undefined)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors[0]).toMatchObject({
        path: '/querystring/query',
        code: 'MISSING_REQUIRED_FIELD',
      })
    }
  })

  it('custom querystring media type은 opaque로 보존하고 string schema만 직접 검증한다', () => {
    const result = validateRequest(
      parts({ rawQueryString: 'plain-value' }),
      [{
        name: 'query', in: 'querystring', required: true,
        content: { 'application/jsonpath': { schema: { type: 'string', minLength: 1 } } },
      }],
      undefined,
    )
    expect(result.valid).toBe(true)
  })

  it('custom object media type은 decoding을 추측하지 않고 opaque로 허용한다', () => {
    const result = validateRequest(
      parts({ rawQueryString: '%24.a.b%5B1%3A1%5D' }),
      [{
        name: 'query', in: 'querystring', required: true,
        content: { 'application/jsonpath': { schema: { type: 'object', required: ['unsupported'] } } },
      }],
      undefined,
    )
    expect(result.valid).toBe(true)
  })

  it('empty raw query component remains present for an optional opaque querystring parameter', () => {
    const result = validateRequest(
      parts({ rawQueryString: '' }),
      [{ name: 'query', in: 'querystring', content: { 'text/plain': { schema: { type: 'string' } } } }],
      undefined,
    )
    expect(result.valid).toBe(true)
  })
})

// ─── header parameters ────────────────────────────────────────────────────────

describe('header params — 대소문자 무감지 (OAS 3.2.0 §4.8.12)', () => {
  const xApiKey: OasParameter = {
    name: 'X-API-Key', in: 'header', required: true,
    schema: { type: 'string' },
  }

  it('헤더 이름이 소문자로 와도 매칭된다', () => {
    const r = validateRequest(
      parts({ headers: { 'x-api-key': 'my-key' } }),
      [xApiKey], undefined,
    )
    expect(r.valid).toBe(true)
  })

  it('required header 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), [xApiKey], undefined)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('optional header 누락 → valid', () => {
    const optHeader: OasParameter = { name: 'X-Trace-Id', in: 'header', schema: { type: 'string' } }
    expect(validateRequest(parts(), [optHeader], undefined).valid).toBe(true)
  })
})

// ─── cookie parameters ────────────────────────────────────────────────────────

describe('cookie params — Cookie 헤더 파싱', () => {
  const sessionParam: OasParameter = {
    name: 'session', in: 'cookie', required: true,
    schema: { type: 'string' },
  }

  it('Cookie 헤더에서 값 추출', () => {
    const r = validateRequest(
      parts({ headers: { cookie: 'session=abc123; theme=dark' } }),
      [sessionParam], undefined,
    )
    expect(r.valid).toBe(true)
  })

  it('required cookie 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(
      parts({ headers: { cookie: 'theme=dark' } }),
      [sessionParam], undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/cookie/session')
    }
  })

  it('Cookie 헤더 없음 → MISSING_REQUIRED_FIELD', () => {
    expect(validateRequest(parts(), [sessionParam], undefined).valid).toBe(false)
  })

  it('쿠키 값에 = 포함 시 올바르게 파싱', () => {
    const tokenParam: OasParameter = { name: 'token', in: 'cookie', required: true, schema: { type: 'string' } }
    const r = validateRequest(
      parts({ headers: { cookie: 'token=abc=def=ghi' } }),
      [tokenParam], undefined,
    )
    expect(r.valid).toBe(true)
  })
})

// ─── coerce 엣지 케이스 ───────────────────────────────────────────────────────

describe('coerce — 타입 변환 엣지 케이스', () => {
  function queryParam(name: string, schema: object): OasParameter {
    return { name, in: 'query', schema } as OasParameter
  }

  it('boolean: "true" → true', () => {
    expect(
      validateRequest(parts({ queryParams: { flag: 'true' } }), [queryParam('flag', { type: 'boolean' })], undefined).valid,
    ).toBe(true)
  })

  it('boolean: "false" → false (valid)', () => {
    expect(
      validateRequest(parts({ queryParams: { flag: 'false' } }), [queryParam('flag', { type: 'boolean' })], undefined).valid,
    ).toBe(true)
  })

  it('boolean: "" (빈 문자열) → TYPE_ERROR', () => {
    const r = validateRequest(
      parts({ queryParams: { flag: '' } }),
      [queryParam('flag', { type: 'boolean' })],
      undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('boolean: "yes" → TYPE_ERROR (true/false만 허용)', () => {
    const r = validateRequest(
      parts({ queryParams: { flag: 'yes' } }),
      [queryParam('flag', { type: 'boolean' })],
      undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('integer: "1.7" → float이므로 TYPE_ERROR (정수 아님)', () => {
    const r = validateRequest(
      parts({ queryParams: { n: '1.7' } }),
      [queryParam('n', { type: 'integer' })],
      undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('number: "3.14" → 유효한 float', () => {
    expect(
      validateRequest(parts({ queryParams: { n: '3.14' } }), [queryParam('n', { type: 'number' })], undefined).valid,
    ).toBe(true)
  })

  it('integer: "abc" → TYPE_ERROR', () => {
    const r = validateRequest(
      parts({ queryParams: { n: 'abc' } }),
      [queryParam('n', { type: 'integer' })],
      undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })

  it('배열 query param (같은 키 다중값) — 타입이 배열이 아니면 TYPE_ERROR', () => {
    // queryParams: { tags: ['a', 'b'] } → coerce에서 typeof !== 'string'이므로 그대로 전달
    // AJV가 string 스키마에 배열 → TYPE_ERROR
    const r = validateRequest(
      parts({ queryParams: { tags: ['a', 'b'] } }),
      [queryParam('tags', { type: 'string' })],
      undefined,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('TYPE_ERROR')
  })
})
