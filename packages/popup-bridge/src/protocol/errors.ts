/**
 * Error model shared by both sides of the bridge.
 *
 * Every failure has a stable string `code` (the contract) and travels on the wire as a JSON-RPC
 * error object: a numeric `code` for generic JSON-RPC tooling plus the string code in `data.code`.
 */

const WIRE_CODES = {
  // JSON-RPC 2.0 reserved range.
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  // Bridge application range (-32000 .. -32099).
  POPUP_BLOCKED: -32001,
  HANDSHAKE_TIMEOUT: -32002,
  ORIGIN_MISMATCH: -32003,
  PROTOCOL_INCOMPATIBLE: -32004,
  INIT_INVALID: -32005,
  CAPABILITY_UNAVAILABLE: -32006,
  PERMISSION_DENIED: -32007,
  RPC_TIMEOUT: -32008,
  SESSION_CLOSED: -32009,
  SESSION_NOT_READY: -32010,
  CANCELLED: -32011,
  INVALID_RESULT: -32012,
  IDEMPOTENCY_CONFLICT: -32013,
  HOST_UNAVAILABLE: -32014,
  NOT_CLONEABLE: -32015,
  PEER_UNRESPONSIVE: -32016,
  OVERLOADED: -32017,
  STATE_CONFLICT: -32018,
} as const

export type BridgeErrorCode = keyof typeof WIRE_CODES | (string & {})

/** Application failures that cross the wire carry this numeric code unless the table names one. */
const APPLICATION_ERROR_CODE = -32000

/** The error object of a failed JSON-RPC response. */
export type WireError = {
  code: number
  message: string
  data?: { code: BridgeErrorCode; data?: unknown }
}

export type BridgeErrorOptions = {
  /** Machine-readable payload; sent to the peer as `error.data.data`. */
  data?: unknown
  cause?: unknown
}

export class BridgeError extends Error {
  readonly code: BridgeErrorCode
  readonly data: unknown

  constructor(code: BridgeErrorCode, message: string, options: BridgeErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BridgeError'
    this.code = code
    this.data = options.data
  }

  toWire(): WireError {
    return {
      code: WIRE_CODES[this.code as keyof typeof WIRE_CODES] ?? APPLICATION_ERROR_CODE,
      message: this.message,
      data: { code: this.code, ...(this.data === undefined ? {} : { data: this.data }) },
    }
  }
}

export function isBridgeError(value: unknown): value is BridgeError {
  return value instanceof BridgeError
}

/**
 * Restores a `BridgeError` from a peer's error object. The peer is untrusted: only a string
 * `data.code` is honoured, otherwise the code is derived from the numeric JSON-RPC code.
 */
export function fromWireError(value: unknown): BridgeError {
  if (typeof value !== 'object' || value === null) {
    return new BridgeError('INTERNAL', 'The peer sent a malformed error')
  }
  const { code, message, data } = value as { code?: unknown; message?: unknown; data?: unknown }
  const text = typeof message === 'string' ? message : 'Unknown error'
  if (typeof data === 'object' && data !== null && typeof (data as { code?: unknown }).code === 'string') {
    const details = data as { code: string; data?: unknown }
    return new BridgeError(details.code, text, details.data === undefined ? {} : { data: details.data })
  }
  const derived = Object.entries(WIRE_CODES).find(([, wire]) => wire === code)?.[0]
  return new BridgeError(derived ?? 'INTERNAL', text, data === undefined ? {} : { data })
}

/**
 * Normalizes anything a handler threw. `BridgeError`s keep their code; everything else becomes
 * `INTERNAL` with a generic message so internals never leak to the peer (the cause stays local).
 */
export function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error
  return new BridgeError('INTERNAL', 'Internal error', { cause: error })
}
