/**
 * request-validator.ts — Security 검증 단위 테스트
 * OAS 3.2.0 §4.8.27 Security Scheme Object
 */
import { describe, it, expect } from 'vitest'
import { validateRequest } from '../../core/request-validator.js'
import type { OasParameter, OasSecurityScheme, OasSecurityRequirement } from '@oa-sdk/parser'

type RequestParts = Parameters<typeof validateRequest>[0]

function parts(overrides: Partial<RequestParts> = {}): RequestParts {
  return { pathParams: {}, queryParams: {}, headers: {}, body: undefined, contentType: undefined, ...overrides }
}

// ─── scheme definitions ──────────────────────────────────────────────────────

const bearerScheme: OasSecurityScheme = { type: 'http', scheme: 'bearer' }
const apiKeyHeaderScheme: OasSecurityScheme = { type: 'apiKey', name: 'X-API-Key', in: 'header' }
const apiKeyQueryScheme: OasSecurityScheme = { type: 'apiKey', name: 'api_key', in: 'query' }
const apiKeyCookieScheme: OasSecurityScheme = { type: 'apiKey', name: 'session', in: 'cookie' }
const oauth2Scheme: OasSecurityScheme = {
  type: 'oauth2',
  flows: {
    authorizationCode: {
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: { read: 'Read access' },
    },
  },
}

const noParams: OasParameter[] = []

// ─── bearer auth ─────────────────────────────────────────────────────────────

describe('bearer auth (http/bearer)', () => {
  const security = {
    requirements: [{ bearerAuth: [] }] as OasSecurityRequirement[],
    schemes: { bearerAuth: bearerScheme },
  }

  it('Authorization 헤더 없음 → MISSING_REQUIRED_FIELD at /security', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/security')
    }
  })

  it('Authorization: Bearer token123 → valid', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer token123' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('Authorization: Basic xxx → MISSING_REQUIRED_FIELD (잘못된 scheme)', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Basic xxx' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it.each(['Bearer ', 'Bearer    ', 'Bearer\t'])('빈 bearer credential %j → MISSING_REQUIRED_FIELD', authorization => {
    const r = validateRequest(
      parts({ headers: { authorization } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })
})

// ─── apiKey (header) ─────────────────────────────────────────────────────────

describe('apiKey (header)', () => {
  const security = {
    requirements: [{ apiKeyHeader: [] }] as OasSecurityRequirement[],
    schemes: { apiKeyHeader: apiKeyHeaderScheme },
  }

  it('X-API-Key 헤더 존재 → valid', () => {
    const r = validateRequest(
      parts({ headers: { 'x-api-key': 'my-secret-key' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('X-API-Key 헤더 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })
})

// ─── apiKey (query) ──────────────────────────────────────────────────────────

describe('apiKey (query)', () => {
  const security = {
    requirements: [{ apiKeyQuery: [] }] as OasSecurityRequirement[],
    schemes: { apiKeyQuery: apiKeyQueryScheme },
  }

  it('api_key 쿼리 파라미터 존재 → valid', () => {
    const r = validateRequest(
      parts({ queryParams: { api_key: 'secret123' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('api_key 쿼리 파라미터 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it.each(['', '   '])('빈 api_key query credential %j → MISSING_REQUIRED_FIELD', apiKey => {
    const r = validateRequest(parts({ queryParams: { api_key: apiKey } }), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('반복 query 중 하나라도 non-empty이면 valid', () => {
    const r = validateRequest(parts({ queryParams: { api_key: ['', 'secret123'] } }), noParams, undefined, security)
    expect(r.valid).toBe(true)
  })
})

// ─── apiKey (cookie) ─────────────────────────────────────────────────────────

describe('apiKey (cookie)', () => {
  const security = {
    requirements: [{ apiKeyCookie: [] }] as OasSecurityRequirement[],
    schemes: { apiKeyCookie: apiKeyCookieScheme },
  }

  it('Cookie 헤더에 session=abc 존재 → valid', () => {
    const r = validateRequest(
      parts({ headers: { cookie: 'session=abc' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('Cookie 헤더 누락 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it.each(['session=', 'session=   '])('빈 session cookie credential %j → MISSING_REQUIRED_FIELD', cookie => {
    const r = validateRequest(parts({ headers: { cookie } }), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })
})

// ─── OR semantics ────────────────────────────────────────────────────────────

describe('OR semantics — requirements 배열 중 하나만 만족하면 통과', () => {
  const security = {
    requirements: [
      { bearerAuth: [] },
      { apiKeyHeader: [] },
    ] as OasSecurityRequirement[],
    schemes: {
      bearerAuth: bearerScheme,
      apiKeyHeader: apiKeyHeaderScheme,
    },
  }

  it('첫 번째 scheme(bearer) 만족 → valid', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer token123' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('두 번째 scheme(apiKey header) 만족 → valid', () => {
    const r = validateRequest(
      parts({ headers: { 'x-api-key': 'my-key' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('어떤 scheme도 만족하지 않음 → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it('빈 query API key alternative는 bearer requirement를 우회하지 못한다', () => {
    const alternativeSecurity = {
      requirements: [{ bearerAuth: [] }, { apiKeyQuery: [] }] as OasSecurityRequirement[],
      schemes: { bearerAuth: bearerScheme, apiKeyQuery: apiKeyQueryScheme },
    }
    const r = validateRequest(parts({ queryParams: { api_key: '' } }), noParams, undefined, alternativeSecurity)
    expect(r.valid).toBe(false)
  })
})

// ─── empty security [] ──────────────────────────────────────────────────────

describe('empty security [] — 인증 불필요', () => {
  const security = {
    requirements: [] as OasSecurityRequirement[],
    schemes: { bearerAuth: bearerScheme },
  }

  it('security: [] → 자격 증명 없어도 valid', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(true)
  })
})

// ─── no security param ──────────────────────────────────────────────────────

describe('no security param — security undefined', () => {
  it('security 파라미터 미전달 → 보안 검사 없이 항상 valid', () => {
    const r = validateRequest(parts(), noParams, undefined, undefined)
    expect(r.valid).toBe(true)
  })

  it('security 파라미터 미전달 (인자 생략) → valid', () => {
    const r = validateRequest(parts(), noParams, undefined)
    expect(r.valid).toBe(true)
  })
})

// ─── OAuth2 (bearer token check) ───────────────────────────────────────────

describe('OAuth2 (bearer token check)', () => {
  const oauth2SchemeWithScopes: OasSecurityScheme = {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: { read: 'Read', write: 'Write', admin: 'Admin' },
      },
    },
  }

  const security = {
    requirements: [{ oauth2: [] }] as OasSecurityRequirement[],
    schemes: { oauth2: oauth2SchemeWithScopes },
  }

  it('Bearer token present → valid', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer access-token-xyz' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('No Authorization header → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/security')
    }
  })

  it('Basic auth instead of Bearer → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it.each(['Bearer ', 'Bearer    ', 'Bearer\t'])('빈 OAuth2 bearer credential %j → MISSING_REQUIRED_FIELD', authorization => {
    const r = validateRequest(
      parts({ headers: { authorization } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })
})

// ─── openIdConnect ──────────────────────────────────────────────────────────

describe('openIdConnect', () => {
  const oidcScheme: OasSecurityScheme = {
    type: 'openIdConnect',
    openIdConnectUrl: 'https://auth.example.com/.well-known',
  }

  const security = {
    requirements: [{ oidc: [] }] as OasSecurityRequirement[],
    schemes: { oidc: oidcScheme },
  }

  it('Bearer token → valid', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer id-token-abc' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('Missing Authorization header → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
      expect(r.errors[0]?.path).toBe('/security')
    }
  })

  it.each(['Bearer ', 'Bearer    ', 'Bearer\t'])('빈 OIDC bearer credential %j → MISSING_REQUIRED_FIELD', authorization => {
    const r = validateRequest(
      parts({ headers: { authorization } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
  })
})

// ─── mutualTLS ──────────────────────────────────────────────────────────────

describe('mutualTLS', () => {
  const mtlsScheme: OasSecurityScheme = { type: 'mutualTLS' }

  const security = {
    requirements: [{ mtls: [] }] as OasSecurityRequirement[],
    schemes: { mtls: mtlsScheme },
  }

  it('Always passes — mock cannot verify TLS', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(true)
  })
})

// ─── Multiple schemes (AND semantics) ───────────────────────────────────────

describe('Multiple schemes — AND semantics within one requirement', () => {
  const security = {
    requirements: [{ bearer: [], apiKey: [] }] as OasSecurityRequirement[],
    schemes: {
      bearer: bearerScheme,
      apiKey: apiKeyHeaderScheme,
    },
  }

  it('Both bearer and apiKey present → valid', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer tok', 'x-api-key': 'key123' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('Only bearer present → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer tok' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it('Only apiKey present → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(
      parts({ headers: { 'x-api-key': 'key123' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })
})

// ─── Operation-level override ───────────────────────────────────────────────

describe('Operation-level security override', () => {
  const globalSecurity = {
    requirements: [{ bearerAuth: [] }] as OasSecurityRequirement[],
    schemes: { bearerAuth: bearerScheme, apiKeyHeader: apiKeyHeaderScheme },
  }

  const operationSecurity = {
    requirements: [{ apiKeyHeader: [] }] as OasSecurityRequirement[],
    schemes: { bearerAuth: bearerScheme, apiKeyHeader: apiKeyHeaderScheme },
  }

  it('Global requires bearer — no bearer → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, globalSecurity)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it('Operation overrides to apiKey — apiKey present without bearer → valid', () => {
    const r = validateRequest(
      parts({ headers: { 'x-api-key': 'my-key' } }),
      noParams, undefined, operationSecurity,
    )
    expect(r.valid).toBe(true)
  })

  it('Operation overrides to apiKey — bearer without apiKey → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer tok' } }),
      noParams, undefined, operationSecurity,
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })

  it('Operation overrides to empty [] → no auth required', () => {
    const noAuthSecurity = {
      requirements: [] as OasSecurityRequirement[],
      schemes: { bearerAuth: bearerScheme },
    }
    const r = validateRequest(parts(), noParams, undefined, noAuthSecurity)
    expect(r.valid).toBe(true)
  })
})

// ─── Scoped OAuth2 (informational) ─────────────────────────────────────────

describe('Scoped OAuth2 — scopes in requirement (informational)', () => {
  const scopedOAuth2Scheme: OasSecurityScheme = {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: { read: 'Read', write: 'Write', admin: 'Admin' },
      },
    },
  }

  const security = {
    requirements: [{ oauth2: ['read', 'write'] }] as OasSecurityRequirement[],
    schemes: { oauth2: scopedOAuth2Scheme },
  }

  it('Bearer token present with scopes declared → valid (scopes not enforced at mock level)', () => {
    const r = validateRequest(
      parts({ headers: { authorization: 'Bearer scoped-token' } }),
      noParams, undefined, security,
    )
    expect(r.valid).toBe(true)
  })

  it('No token with scopes declared → MISSING_REQUIRED_FIELD', () => {
    const r = validateRequest(parts(), noParams, undefined, security)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    }
  })
})
