import { createHash } from 'node:crypto'

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

/**
 * Compute semantic content hash for an entity source envelope.
 * Excludes volatile provenance time/paths and derived metadata, as dictated by EWIC v0.1.
 */
export function computeEnvelopeContentHash(envelope: { content: unknown }): string {
  return computeCanonicalHash(envelope.content)
}

/**
 * Compute semantic entity hash across identity stable fields + content + refs.
 */
export function computeSemanticEntityHash(envelope: {
  identity: {
    id: string
    kind: string
    namespace: string
    slug: string
    revision: number
  }
  content: unknown
  refs?: unknown[]
}): string {
  return computeCanonicalHash({
    id: envelope.identity.id,
    kind: envelope.identity.kind,
    namespace: envelope.identity.namespace,
    slug: envelope.identity.slug,
    revision: envelope.identity.revision,
    content: envelope.content,
    refs: envelope.refs ?? [],
  })
}
