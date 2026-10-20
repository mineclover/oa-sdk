/**
 * The JSON-RPC codes of the relay protocol's canonical error names, shared by the relay and the
 * provider so that one name always travels with one code.
 *
 * An error is identified by its canonical name: the JSON-RPC `message` (or `data.code`) of an MCP
 * error, the `error` member of a relay lifecycle body. The code is only the error's class, which
 * several names share: JSON-RPC 2.0 defines −32700, −32600, −32602 and −32603 as classes, and the
 * package classes are −32000 (an optional transport feature the relay does not offer), −32001 (the
 * session, or the provider behind it, cannot serve the request), −32002 (a request names another
 * room or epoch than the one it reaches), −32003 (no valid client token), −32008 (an answer from a
 * superseded provider session) and −32056 (an expired session or room). Whether a request may be
 * sent again is told by `data.retryable`, never by the code.
 *
 * This table holds every name sent to an agent with a code, as a JSON-RPC error or in a lifecycle
 * body's `code` member; a lifecycle name absent from it is sent without a code. The `error` frames
 * the relay sends a provider are another family with codes of their own (a refused `register` is
 * −32602 there, while a refused catalog listing answers an agent −32603).
 */
export const PEER_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  REQUEST_ID_TOO_LARGE: -32600,
  REQUEST_TOO_LARGE: -32600,
  DUPLICATE_REQUEST_ID: -32600,
  UNSUPPORTED_PROTOCOL_VERSION: -32600,
  TOOL_NOT_FOUND: -32602,
  RESULT_TOO_LARGE: -32603,
  CATALOG_INVALID: -32603,
  CATALOG_TOO_LARGE: -32603,
  BODY_CONSUMED: -32603,
  SSE_STREAM_NOT_SUPPORTED: -32000,
  SESSION_TERMINATION_NOT_SUPPORTED: -32000,
  SESSION_INVALID: -32001,
  PROVIDER_UNAVAILABLE: -32001,
  PROVIDER_BUSY: -32001,
  PROVIDER_DISCONNECTED: -32001,
  MCP_REQUEST_TIMEOUT: -32001,
  CLIENT_DISCONNECTED: -32001,
  ROOM_BINDING_INVALID: -32002,
  ROOM_LEASE_BINDING_INVALID: -32002,
  SESSION_BINDING_INVALID: -32002,
  CLIENT_TOKEN_REQUIRED: -32003,
  CLIENT_TOKEN_INVALID: -32003,
  ROOM_NOT_FOUND: -32004,
  PEER_SESSION_SUPERSEDED: -32008,
  OUTCOME_UNKNOWN: -32008,
  CATALOG_CHANGED: -32010,
  CLIENT_APPROVAL_REQUIRED: -32053,
  CLIENT_APPROVAL_DENIED: -32054,
  SESSION_EXPIRED: -32056,
  ROOM_EXPIRED: -32056,
  ROOM_ROTATED: -32057,
  INVALID_APPROVAL: -32081,
  TOO_MANY_PENDING_REQUESTS: -32087,
  PUBLISH_RATE_LIMITED: -32088,
  PUBLISH_RATE_LIMIT_UNAVAILABLE: -32089,
  CATALOG_UNAVAILABLE: -32090,
} as const;

/** A canonical error name that has a JSON-RPC code (see {@link PEER_ERROR_CODES}). */
export type PeerErrorName = keyof typeof PEER_ERROR_CODES;

/** A JSON-RPC error object of the relay protocol: the name's code, the name as `message`, and data. */
export interface PeerRpcError {
  readonly code: number;
  readonly message: PeerErrorName;
  readonly data?: unknown;
}

/** True for a name of {@link PEER_ERROR_CODES}. */
export function isPeerErrorName(name: string): name is PeerErrorName {
  return Object.hasOwn(PEER_ERROR_CODES, name);
}

/** The JSON-RPC error named `name`, with its code and, when given, `data`. */
export function peerRpcError(name: PeerErrorName, data?: unknown): PeerRpcError {
  return data === undefined
    ? { code: PEER_ERROR_CODES[name], message: name }
    : { code: PEER_ERROR_CODES[name], message: name, data };
}
