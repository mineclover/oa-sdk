import { createHash } from 'node:crypto'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 * Ensures deterministic serialization across platforms, languages, and environments.
 *
 * Input must be I-JSON-compatible plain data (RFC 7493): `null`, booleans,
 * finite numbers, well-formed strings, arrays, and plain objects (prototype
 * `Object.prototype` or `null`). Values that have a `toJSON()` method (e.g.
 * `Date`) are replaced by its result, and boxed primitives are unboxed, exactly
 * as `JSON.stringify` does, so a value hashes the same before and after a JSON
 * round trip.
 *
 * - Objects: keys sorted lexicographically by UTF-16 code units.
 * - Arrays: elements preserved in order; `undefined`, function, and symbol
 *   elements serialize as `null` (as in `JSON.stringify`).
 * - Object members whose value is `undefined`, a function, or a symbol are omitted.
 * - Primitives: ECMAScript JSON serialization without insignificant whitespace.
 *
 * Anything else has no RFC 8785 representation and throws a `TypeError` instead
 * of silently colliding with another value: non-finite numbers (`NaN`,
 * `Infinity`), `bigint`, strings or keys with lone surrogates, non-plain objects
 * without `toJSON` (`Map`, `Set`, class instances), and a top-level value that is
 * `undefined`, a function, or a symbol.
 */
export function canonicalJsonStringify(value: unknown): string {
  const text = serializeCanonical(value, '')
  if (text === undefined) {
    throw new TypeError(
      `canonicalJsonStringify: a top-level ${describeType(value)} has no JSON representation (RFC 8785)`,
    )
  }
  return text
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/**
 * Serializes one value, or returns `undefined` for values JSON omits
 * (`undefined`, functions, symbols) so the caller can drop or null them.
 */
function serializeCanonical(input: unknown, key: string): string | undefined {
  const value = unboxPrimitive(resolveToJson(input, key))

  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `canonicalJsonStringify: non-finite number ${String(value)} is not valid JSON (RFC 8785)`,
        )
      }
      return JSON.stringify(value)
    case 'string':
      return serializeString(value)
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
    case 'bigint':
      throw new TypeError('canonicalJsonStringify: bigint has no JSON representation (RFC 8785)')
    case 'object':
      break
  }

  if (Array.isArray(value)) {
    const items: unknown[] = value
    return '[' + items.map((item, index) => serializeCanonical(item, String(index)) ?? 'null').join(',') + ']'
  }

  if (!isPlainObject(value)) {
    throw new TypeError(
      `canonicalJsonStringify: ${describeType(value)} is not plain JSON data; convert it or give it a toJSON() method (RFC 8785)`,
    )
  }

  const entries: string[] = []
  for (const memberKey of Object.keys(value).sort()) {
    const member = serializeCanonical(value[memberKey], memberKey)
    if (member !== undefined) {
      entries.push(`${serializeString(memberKey)}:${member}`)
    }
  }
  return '{' + entries.join(',') + '}'
}

function serializeString(value: string): string {
  if (LONE_SURROGATE.test(value)) {
    throw new TypeError('canonicalJsonStringify: string contains a lone surrogate, which is not valid I-JSON (RFC 8785)')
  }
  return JSON.stringify(value)
}

/** Applies `toJSON(key)` the way `JSON.stringify` does. */
function resolveToJson(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null && 'toJSON' in value) {
    const toJSON: unknown = value.toJSON
    if (typeof toJSON === 'function') {
      return toJSON.call(value, key)
    }
  }
  return value
}

/** Unwraps `new Number()`, `new String()` and `new Boolean()` like `JSON.stringify`. */
function unboxPrimitive(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  switch (Object.prototype.toString.call(value)) {
    case '[object Number]':
      return Number(value)
    case '[object String]':
      return String(value)
    case '[object Boolean]':
      return Boolean.prototype.valueOf.call(value)
    default:
      return value
  }
}

/**
 * A plain object has `null` or a root prototype. Checking for a root prototype
 * (rather than this realm's `Object.prototype`) keeps cross-realm plain objects valid.
 */
function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || (typeof proto === 'object' && Object.getPrototypeOf(proto) === null)
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  const ctor: unknown = Object.getPrototypeOf(value)?.constructor
  return typeof ctor === 'function' && ctor.name ? ctor.name : 'object'
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
