/**
 * RFC 6901 JSON Pointer helpers.
 *
 * This module is the shared implementation of reference-token escaping for the
 * packages that depend on `@oa-sdk/parser`: parser, codegen, mock-server,
 * spec-lens and surface-ir import these helpers instead of re-implementing
 * `~0` / `~1` handling. Code that does not depend on parser (tools, apps,
 * personas, dpm, root scripts) or cannot load it at runtime (the schemas
 * scripts run as CommonJS) still has its own copies.
 *
 * Representations used below:
 * - reference token: one unescaped object key or array index (`a/b`)
 * - JSON Pointer: `''` (the whole document) or `/`-separated escaped tokens
 *   (`/a~1b/0`)
 * - JSON Reference URI fragment: `#` followed by a JSON Pointer. A `$ref` may
 *   also percent-encode the fragment; {@link decodeJsonPointerFragment} handles
 *   that, the token and pointer helpers do not.
 */

/** A `~` that does not start one of the two RFC 6901 escapes (`~0`, `~1`). */
const MALFORMED_ESCAPE = /~(?![01])/

/**
 * Escape one reference token (RFC 6901 §3): `~` becomes `~0`, then `/` becomes
 * `~1`. Escaping `~` first keeps a `/` from ending up as `~01`.
 */
export function escapeJsonPointerToken(token: string): string {
  if (!token.includes('~') && !token.includes('/')) return token
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * Unescape one reference token (RFC 6901 §4) in a single left-to-right pass, so
 * `~01` decodes to `~1` and never to `/`.
 *
 * The decoder is total: a `~` that is not followed by `0` or `1` is kept as-is.
 * This matches `token.replace(/~1/g, '/').replace(/~0/g, '~')` for every input.
 * Use {@link parseJsonPointer} when malformed escapes must be rejected.
 */
export function unescapeJsonPointerToken(token: string): string {
  if (!token.includes('~')) return token
  return token.replace(/~[01]/g, sequence => (sequence === '~0' ? '~' : '/'))
}

/**
 * Append one reference token to a JSON Pointer or to a `#`-prefixed URI
 * fragment: `appendJsonPointer('', 'a/b')` is `/a~1b` and
 * `appendJsonPointer('#', 'a')` is `#/a`. Numbers are array indices.
 */
export function appendJsonPointer(pointer: string, token: string | number): string {
  return `${pointer}/${escapeJsonPointerToken(String(token))}`
}

/**
 * Format reference tokens as a JSON Pointer. No tokens format to the root
 * pointer `''`. Prefix the result with `#` for a (not percent-encoded) URI
 * fragment.
 */
export function formatJsonPointer(tokens: Iterable<string | number>): string {
  let pointer = ''
  for (const token of tokens) pointer = appendJsonPointer(pointer, token)
  return pointer
}

/**
 * Parse a JSON Pointer into unescaped reference tokens, the inverse of
 * {@link formatJsonPointer}. `''` parses to `[]`. Returns `undefined` for a
 * non-empty pointer that does not start with `/` and for a token with a `~`
 * that is not `~0` or `~1`.
 */
export function parseJsonPointer(pointer: string): string[] | undefined {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) return undefined
  const tokens = pointer.slice(1).split('/')
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (MALFORMED_ESCAPE.test(token)) return undefined
    tokens[index] = unescapeJsonPointerToken(token)
  }
  return tokens
}

/**
 * Decode a JSON Reference URI fragment (`#`, `#/a~1b`, `#/a%20b`) into
 * reference tokens.
 *
 * A `$ref` is a URI reference, so percent-decoding happens before the
 * RFC 6901 `~1` / `~0` token decoding. Invalid percent escapes deliberately
 * return `undefined` rather than being treated as a literal successful key.
 */
export function decodeJsonPointerFragment(ref: string): string[] | undefined {
  if (ref === '#') return []
  if (!ref.startsWith('#')) return undefined

  let fragment: string
  try {
    fragment = decodeURIComponent(ref.slice(1))
  } catch {
    return undefined
  }
  return parseJsonPointer(fragment)
}

/** An entry found by {@link findNearestJsonPointerEntry}. */
export type JsonPointerEntryMatch<T> = {
  /** The key that matched: the queried pointer itself or one of its ancestors. */
  pointer: string
  value: T
}

/**
 * Find the entry stored under a JSON Pointer or, failing that, under its
 * nearest ancestor.
 *
 * `pointer` is a JSON Pointer (`/a/b`) or a `#`-prefixed URI fragment
 * (`#/a/b`) in the unencoded spelling that {@link formatJsonPointer} produces,
 * and the keys of `entries` use the same spelling. The candidates are the
 * pointer itself, then each parent up to and including the document root
 * (`''` or `#`). Parents are formed from the parsed tokens, so an escaped `/`
 * (`~1`) inside a token is never taken for a boundary.
 *
 * Returns `undefined` when no candidate is a key, and for a malformed pointer
 * (see {@link parseJsonPointer}). Normalize a percent-encoded `$ref` fragment
 * with {@link canonicalJsonPointerFragment} before looking it up.
 */
export function findNearestJsonPointerEntry<T>(
  pointer: string,
  entries: ReadonlyMap<string, T>,
): JsonPointerEntryMatch<T> | undefined {
  const root = pointer.startsWith('#') ? '#' : ''
  const tokens = parseJsonPointer(pointer.slice(root.length))
  if (!tokens) return undefined

  const candidates = [root]
  for (const token of tokens) candidates.push(appendJsonPointer(candidates[candidates.length - 1]!, token))
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!
    if (entries.has(candidate)) return { pointer: candidate, value: entries.get(candidate) as T }
  }
  return undefined
}

export function isJsonPointerFragment(ref: string): boolean {
  return decodeJsonPointerFragment(ref) !== undefined
}

/**
 * Spell a JSON Reference URI fragment canonically: percent-decoded, with each
 * reference token escaped as {@link formatJsonPointer} writes it, behind `#`
 * (`#/a%20b` becomes `#/a b`, `#/%7E1` becomes `#/~1`). Equivalent spellings
 * of one location therefore compare equal; the resolver keys its cache and
 * cycle checks this way, and the pointers of `projectRefGraph` use this
 * spelling.
 *
 * Percent-decoding runs first, so an encoded `/` (`%2F`) separates tokens.
 * Returns `undefined` for a string that is not a `#` fragment, an invalid
 * percent escape, and a `~` that is not `~0` or `~1`.
 */
export function canonicalJsonPointerFragment(ref: string): string | undefined {
  const segments = decodeJsonPointerFragment(ref)
  if (!segments) return undefined
  return `#${formatJsonPointer(segments)}`
}

export function resolveJsonPointer(root: unknown, ref: string): unknown | undefined {
  const segments = decodeJsonPointerFragment(ref)
  if (!segments) return undefined

  let current: unknown = root
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
