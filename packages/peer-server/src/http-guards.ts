/**
 * @oa-sdk/peer-server — HTTP access guards shared by the Node server and the
 * Cloud Transit handlers (Node and Workers).
 *
 * The guards read headers through a getter, so they work on a Node
 * IncomingMessage and on a fetch Request alike, and they use no Node-only API.
 */

/** Reads one request header (case-insensitive name); undefined when absent. */
export type HeaderReader = (name: string) => string | undefined

/** A HeaderReader over Node's `IncomingMessage.headers` (lower-case keys; repeated headers use the first value). */
export function headerReader(headers: Readonly<Record<string, string | string[] | undefined>>): HeaderReader {
  return (name) => {
    const value = headers[name.toLowerCase()]
    return Array.isArray(value) ? value[0] : value
  }
}

export const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS'
/** Every request header a browser client of this server sends (CloudTransitClient sends X-Target-Peer). */
export const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, X-Peer-Publish-Key, X-Target-Peer, MCP-Protocol-Version, Mcp-Method, Mcp-Name'

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']
const encoder = new TextEncoder()

/** Compare two secrets in time that depends only on their lengths. */
export function constantTimeEqual(expected: string, actual: string): boolean {
  const a = encoder.encode(expected)
  const b = encoder.encode(actual)
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return difference === 0
}

/**
 * True when no publishKey is configured, or the request carries it in
 * `X-Peer-Publish-Key` or as `Authorization: Bearer <key>`.
 */
export function publishKeyAuthorized(header: HeaderReader, publishKey: string | undefined): boolean {
  if (!publishKey) return true
  const supplied = header('x-peer-publish-key') ?? header('authorization')
  if (!supplied) return false
  const key = supplied.startsWith('Bearer ') ? supplied.slice(7) : supplied
  return constantTimeEqual(publishKey, key)
}

/**
 * The Origin to echo in Access-Control-Allow-Origin, or undefined when the
 * request has no Origin or it is not allowed. Without a configured list only
 * exact loopback http(s) origins are allowed.
 */
export function resolveAllowedOrigin(origin: string | undefined, configured: readonly string[] | undefined): string | undefined {
  if (!origin) return undefined
  if (configured !== undefined) return configured.includes(origin) ? origin : undefined
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && LOOPBACK_HOSTNAMES.includes(url.hostname) && url.origin === origin
      ? origin
      : undefined
  } catch {
    return undefined
  }
}

/** The access decision for one request. */
export type HttpAccess =
  | { allowed: true; origin: string | undefined }
  | { allowed: false; status: 401 | 403; error: string }

/**
 * Decide whether a request may proceed: a disallowed Origin is 403; outside a
 * CORS preflight (which never carries credentials), a missing or wrong
 * publishKey is 401.
 */
export function checkHttpAccess(
  header: HeaderReader,
  method: string | undefined,
  policy: { publishKey?: string | undefined; allowedOrigins?: readonly string[] | undefined },
): HttpAccess {
  const requestOrigin = header('origin')
  const origin = resolveAllowedOrigin(requestOrigin, policy.allowedOrigins)
  if (requestOrigin && !origin) return { allowed: false, status: 403, error: 'Origin not allowed' }
  if (method !== 'OPTIONS' && !publishKeyAuthorized(header, policy.publishKey)) {
    return { allowed: false, status: 401, error: 'Unauthorized' }
  }
  return { allowed: true, origin }
}

/** CORS response headers for an allowed origin (none when the request had no Origin). */
export function corsHeaders(origin: string | undefined): Record<string, string> {
  return origin
    ? {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    }
    : {}
}
