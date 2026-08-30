import { describe, expect, it } from 'vitest'
import {
  redactValidationDetail,
  redactValidationDetails,
  summarizeValidationValue,
} from '../../errors/redaction.js'

describe('validation error redaction', () => {
  it('redacts both received and the legacy value alias without losing diagnostics', () => {
    const password = 'PASSWORD_SENTINEL_f38a'
    const refreshToken = 'REFRESH_TOKEN_SENTINEL_61de'
    const secret = 'SECRET_SENTINEL_c24b'

    const detail = redactValidationDetail({
      path: '/body/password',
      code: 'CONSTRAINT_VIOLATION',
      message: '제약 조건 위반',
      expected: 'minLength: 32',
      constraint: { limit: 32 },
      stage: 'validate',
      received: password,
      value: { refreshToken, secret, values: [password] },
    })

    expect(detail).toMatchObject({
      path: '/body/password',
      code: 'CONSTRAINT_VIOLATION',
      expected: 'minLength: 32',
      constraint: { limit: 32 },
      stage: 'validate',
      received: { type: 'string', length: password.length },
      value: { type: 'object', count: 3 },
    })

    const serialized = JSON.stringify(detail)
    for (const sensitiveValue of [password, refreshToken, secret]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
    expect(redactValidationDetails([detail])).toEqual([detail])
  })

  it('uses count-only summaries for arrays and objects', () => {
    expect(summarizeValidationValue(['SECRET_SENTINEL_1', 'SECRET_SENTINEL_2']))
      .toEqual({ type: 'array', count: 2 })
    expect(summarizeValidationValue({ secret: 'SECRET_SENTINEL_3' }))
      .toEqual({ type: 'object', count: 1 })
  })
})
