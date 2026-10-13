import { createHash } from 'node:crypto'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 * Ensures deterministic serialization across platforms, languages, and environments.
 * - Objects: keys sorted lexicographically by UTF-16 code units.
 * - Arrays: elements preserved in order.
 * - Primitives: numbers, booleans, strings formatted standard without insignificant whitespace.
 * - undefined, functions, and symbols are excluded from object serialization.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJsonStringify(item ?? null)).join(',') + ']'
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries: string[] = []

  for (const key of keys) {
    const val = obj[key]
    if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`)
    }
  }

  return '{' + entries.join(',') + '}'
}

/**
 * Compute SHA-256 hash formatted as `sha256:<hex>` over RFC 8785 canonical JSON.
 */
export function computeCanonicalHash(value: unknown): string {
  const canonical = canonicalJsonStringify(value)
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex')
  return `sha256:${hex}`
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
