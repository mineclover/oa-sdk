export type RpcErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'UNPROCESSABLE_CONTENT'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL'
  | 'NOT_IMPLEMENTED'
  | 'SERVICE_UNAVAILABLE'
  /** The call input does not match the procedure input schema. */
  | 'INVALID_INPUT'
  /** The handler result does not match the procedure output schema. */
  | 'INVALID_OUTPUT'
  | 'PROCEDURE_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'INVALID_REQUEST'
  /** The transport could not deliver the call or read its result. */
  | 'TRANSPORT'
  | (string & {})

export type RpcErrorOptions = {
  /** HTTP status the error maps to; defaults to the status of `code`. */
  status?: number
  /** Error payload; sent as the REST error body and as JSON-RPC `error.data.data`. */
  data?: unknown
  cause?: unknown
}

export class RpcError extends Error {
  readonly code: RpcErrorCode
  readonly status: number
  readonly data: unknown

  constructor(code: RpcErrorCode, message: string, options: RpcErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RpcError'
    this.code = code
    this.status = options.status ?? statusForCode(code)
    this.data = options.data
  }

  toJSON(): { code: RpcErrorCode; message: string; status: number; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      ...(this.data === undefined ? {} : { data: this.data }),
    }
  }
}

export function isRpcError(value: unknown): value is RpcError {
  return value instanceof RpcError
}

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  INVALID_INPUT: 400,
  INVALID_OUTPUT: 500,
  PROCEDURE_NOT_FOUND: 404,
  PARSE_ERROR: 400,
  INVALID_REQUEST: 400,
  TRANSPORT: 502,
}

const CODE_BY_STATUS: Readonly<Record<number, RpcErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL',
  501: 'NOT_IMPLEMENTED',
  503: 'SERVICE_UNAVAILABLE',
}

/** HTTP status for an error code; unknown codes map to 500. */
export function statusForCode(code: RpcErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500
}

/** Error code for an HTTP status; statuses without a named code map to `HTTP_<status>`. */
export function codeForStatus(status: number): RpcErrorCode {
  return CODE_BY_STATUS[status] ?? `HTTP_${status}`
}

/** Normalizes anything a handler or transport threw; non-`RpcError` values become `INTERNAL`. */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) return error
  return new RpcError('INTERNAL', 'Internal server error', { cause: error })
}
