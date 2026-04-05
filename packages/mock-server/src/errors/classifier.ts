import type { ErrorObject } from 'ajv'
import type { MockErrorCode, MockErrorDetail } from './types.js'

/**
 * AJV raw ErrorObject → MockErrorDetail 변환.
 * AJV keyword → 의미 있는 에러 코드로 분류.
 */
export function classifyAjvErrors(errors: ErrorObject[]): MockErrorDetail[] {
  return errors.map(classifyOne)
}

function classifyOne(err: ErrorObject): MockErrorDetail {
  const path = normalizePath(err.instancePath)

  switch (err.keyword) {
    case 'type':
      return {
        path,
        code: 'TYPE_ERROR',
        message: `타입 불일치: ${err.message ?? ''}`,
        received: describeType(err.data),
        expected: (err.params as { type: string }).type,
      }

    case 'required': {
      const missing = (err.params as { missingProperty: string }).missingProperty
      return {
        path: path ? `${path}/${missing}` : `/${missing}`,
        code: 'MISSING_REQUIRED_FIELD',
        message: `필수 필드 누락: '${missing}'`,
      }
    }

    case 'enum': {
      const allowed = (err.params as { allowedValues: unknown[] }).allowedValues
      return {
        path,
        code: 'INVALID_ENUM_VALUE',
        message: `허용되지 않는 값입니다`,
        received: err.data,
        expected: allowed.map(String).join(' | '),
      }
    }

    case 'format': {
      const fmt = (err.params as { format: string }).format
      return {
        path,
        code: 'FORMAT_MISMATCH',
        message: `형식 불일치: '${fmt}' 형식이어야 합니다`,
        received: err.data,
        expected: fmt,
      }
    }

    case 'pattern': {
      const pattern = (err.params as { pattern: string }).pattern
      return {
        path,
        code: 'PATTERN_MISMATCH',
        message: `패턴 불일치: /${pattern}/ 을 만족해야 합니다`,
        received: err.data,
        expected: `/${pattern}/`,
      }
    }

    // 수치/길이/개수 제약
    case 'minLength':
    case 'maxLength':
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
    case 'minItems':
    case 'maxItems':
    case 'minProperties':
    case 'maxProperties': {
      const params = err.params as Record<string, unknown>
      return {
        path,
        code: 'CONSTRAINT_VIOLATION',
        message: `제약 조건 위반: ${err.message ?? err.keyword}`,
        received: summarizeReceived(err.keyword, err.data),
        expected: describeConstraint(err.keyword, params),
        constraint: params,
      }
    }

    default:
      return {
        path,
        code: 'CONSTRAINT_VIOLATION',
        message: err.message ?? `검증 실패: ${err.keyword}`,
        received: err.data,
      }
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function normalizePath(instancePath: string): string {
  return instancePath || ''
}

function describeType(data: unknown): string {
  if (data === null) return 'null'
  if (Array.isArray(data)) return 'array'
  return typeof data
}

function summarizeReceived(keyword: string, data: unknown): unknown {
  if (['minLength', 'maxLength'].includes(keyword) && typeof data === 'string') {
    return `"${data}" (length: ${data.length})`
  }
  if (['minItems', 'maxItems'].includes(keyword) && Array.isArray(data)) {
    return `array (length: ${data.length})`
  }
  if (['minProperties', 'maxProperties'].includes(keyword) && typeof data === 'object' && data !== null) {
    return `object (${Object.keys(data).length} properties)`
  }
  return data
}

function describeConstraint(keyword: string, params: Record<string, unknown>): string {
  const map: Record<string, string> = {
    minLength: `minLength: ${params['limit']}`,
    maxLength: `maxLength: ${params['limit']}`,
    minimum: `minimum: ${params['limit']}`,
    maximum: `maximum: ${params['limit']}`,
    exclusiveMinimum: `exclusiveMinimum: ${params['limit']}`,
    exclusiveMaximum: `exclusiveMaximum: ${params['limit']}`,
    minItems: `minItems: ${params['limit']}`,
    maxItems: `maxItems: ${params['limit']}`,
    minProperties: `minProperties: ${params['limit']}`,
    maxProperties: `maxProperties: ${params['limit']}`,
  }
  return map[keyword] ?? keyword
}
