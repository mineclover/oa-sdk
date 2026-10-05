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

export function isJsonPointerFragment(ref: string): boolean {
  return decodeJsonPointerFragment(ref) !== undefined
}

/** Normalize equivalent URI-fragment spellings for resolver cache/cycle identity. */
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
