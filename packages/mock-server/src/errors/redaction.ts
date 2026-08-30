import type { MockErrorDetail, MockReceivedValueSummary } from './types.js'

/**
 * Input accepted by the public-error redactor before received/value have been
 * converted into safe summaries. Keep this type local to the error boundary:
 * callers should expose only MockErrorDetail.
 */
export type MockErrorDetailInput = Omit<MockErrorDetail, 'received' | 'value'> & {
  received?: unknown
  value?: unknown
}

/**
 * Convert an arbitrary submitted value to a JSON-safe, content-free summary.
 *
 * This deliberately avoids value previews. Error payloads are commonly logged
 * and must not expose passwords, tokens, XML bodies, multipart parts, or an
 * entire request object.
 */
export function summarizeValidationValue(value: unknown): MockReceivedValueSummary {
  const normalizedSummary = normalizeReceivedValueSummary(value)
  if (normalizedSummary) return normalizedSummary

  if (value === null) return { type: 'null' }
  if (isArray(value)) return { type: 'array', count: safeArrayCount(value) }

  switch (typeof value) {
    case 'string': return { type: 'string', length: value.length }
    case 'object': return { type: 'object', count: safeObjectCount(value) }
    case 'number': return { type: 'number' }
    case 'boolean': return { type: 'boolean' }
    case 'bigint': return { type: 'bigint' }
    case 'symbol': return { type: 'symbol' }
    case 'function': return { type: 'function' }
    case 'undefined': return { type: 'undefined' }
  }

  // `typeof` is exhaustive at runtime; retain a fail-closed fallback if a
  // future JavaScript value category is introduced.
  return { type: 'undefined' }
}

/** Redact both modern `received` and legacy `value` fields before publication. */
export function redactValidationDetail(detail: MockErrorDetailInput): MockErrorDetail {
  const { received, value, ...safeDetail } = detail
  const redacted: MockErrorDetail = { ...safeDetail }

  if (received !== undefined) redacted.received = summarizeValidationValue(received)
  if (value !== undefined) redacted.value = summarizeValidationValue(value)

  return redacted
}

/** Redact an accumulated validation-error list at its public return boundary. */
export function redactValidationDetails(details: readonly MockErrorDetailInput[]): MockErrorDetail[] {
  return details.map(redactValidationDetail)
}

function normalizeReceivedValueSummary(value: unknown): MockReceivedValueSummary | undefined {
  if (!isRecord(value)) return undefined

  try {
    const type = value['type']
    const keys = Object.keys(value)

    if (type === 'string' && hasOnlyKeys(keys, ['type', 'length'])) {
      const length = value['length']
      if (isCount(length)) return { type, length }
    }

    if ((type === 'array' || type === 'object') && hasOnlyKeys(keys, ['type', 'count'])) {
      const count = value['count']
      if (isCount(count)) return { type, count }
    }

    if (
      (type === 'number' || type === 'boolean' || type === 'bigint' || type === 'symbol' || type === 'function' || type === 'null' || type === 'undefined') &&
      hasOnlyKeys(keys, ['type'])
    ) {
      return { type }
    }
  } catch {
    // A hostile Proxy must not make error handling fail or expose its value.
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function isArray(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value)
  } catch {
    return false
  }
}

function hasOnlyKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every(key => expected.includes(key))
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeArrayCount(value: unknown[]): number {
  try {
    const count = value.length
    return isCount(count) ? count : 0
  } catch {
    return 0
  }
}

function safeObjectCount(value: object): number {
  try {
    return Object.keys(value).length
  } catch {
    return 0
  }
}
