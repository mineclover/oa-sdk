/**
 * JSON Pointer helpers for JSON Reference URI fragments.
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

  if (!fragment.startsWith('/')) return undefined
  const segments: string[] = []
  for (const token of fragment.slice(1).split('/')) {
    const decoded = unescapeJsonPointerToken(token)
    if (decoded === undefined) return undefined
    segments.push(decoded)
  }
  return segments
}

export function isJsonPointerFragment(ref: string): boolean {
  return decodeJsonPointerFragment(ref) !== undefined
}

/** Normalize equivalent URI-fragment spellings for resolver cache/cycle identity. */
export function canonicalJsonPointerFragment(ref: string): string | undefined {
  const segments = decodeJsonPointerFragment(ref)
  if (!segments) return undefined
  if (segments.length === 0) return '#'
  return '#/' + segments.map(escapeJsonPointerToken).join('/')
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

function unescapeJsonPointerToken(token: string): string | undefined {
  let decoded = ''
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index]!
    if (character !== '~') {
      decoded += character
      continue
    }
    const escaped = token[index + 1]
    if (escaped === '0') decoded += '~'
    else if (escaped === '1') decoded += '/'
    else return undefined
    index += 1
  }
  return decoded
}

function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}
