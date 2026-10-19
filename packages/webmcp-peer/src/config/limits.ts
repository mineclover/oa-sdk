/**
 * Message size limits of the WebMCP relay protocol, shared by every tier of the package.
 *
 * One relay message (a signaling frame, a `register` catalog or an `mcp` JSON-RPC envelope) may be
 * up to {@link PEER_RELAY_MAX_MESSAGE_BYTES} of UTF-8 JSON in either direction, whether it travels
 * as one WebSocket frame or fragmented. Browser and Node WebSocket clients send each message as a
 * single frame, so the relay accepts single frames up to the same size.
 *
 * The relay enforces the limit on what it receives by closing the sending socket with close code
 * 1009 (Message Too Big). It never closes or detaches the provider for a message it cannot forward,
 * whether the message is too large or the provider's outbound queue is full; it answers the sender
 * instead (REQUEST_TOO_LARGE, or the retryable PROVIDER_BUSY). Endpoints check their own messages
 * before sending them (the provider answers RESULT_TOO_LARGE or withholds a catalog with
 * CATALOG_TOO_LARGE; the agent client refuses a request over {@link PEER_RELAY_MAX_REQUEST_BYTES}
 * with REQUEST_TOO_LARGE), so a well-behaved peer never reaches the close.
 */
export const PEER_RELAY_MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * The largest JSON-RPC request an agent may send, in UTF-8 bytes of the message it puts on the
 * wire (the `mcp` envelope over WebSocket, the body over HTTP) and of that message as JSON.stringify
 * writes it (the two are equal for a client that serializes with JSON.stringify; JSON written
 * otherwise, e.g. `1e20`, can grow when the relay re-serializes it). The relay forwards a request to the
 * provider after stamping it with `from`/`sessionId` and, for a duplicate id, a rewritten wire id;
 * the 1 KiB below the message limit always covers both, so every request within this limit is
 * forwarded and a larger one is refused with REQUEST_TOO_LARGE on every transport.
 */
export const PEER_RELAY_MAX_REQUEST_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES - 1024;

/**
 * The largest `register` frame a provider sends. The 4 KiB left below the message limit is room for
 * what the relay adds to a catalog it passes on: its `catalogVersion`/`catalogHash` stamp on the
 * announcement, and the JSON-RPC envelope, request id and catalog metadata of a `tools/list` reply.
 * A catalog that fits this budget can therefore be announced and listed over every transport.
 */
export const PEER_RELAY_MAX_CATALOG_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES - 4 * 1024;

/**
 * The largest catalog announcement the relay accepts (the provider's `register` frame stamped with
 * `catalogVersion`/`catalogHash`). The 2 KiB below the message limit keeps a `tools/list` reply for
 * the same catalog within the limit: the relay refuses JSON-RPC request ids over 1 KiB of JSON
 * (REQUEST_ID_TOO_LARGE), so the reply envelope always fits. Every catalog within
 * {@link PEER_RELAY_MAX_CATALOG_BYTES} passes; a larger announcement is refused with
 * CATALOG_TOO_LARGE.
 */
export const PEER_RELAY_MAX_ANNOUNCEMENT_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES - 2 * 1024;

const utf8 = new TextEncoder();

/** The UTF-8 byte length of a string, as the relay measures a message. */
export function utf8ByteLength(text: string): number {
  return utf8.encode(text).byteLength;
}
