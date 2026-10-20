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
 * forwarded and a larger one is refused with REQUEST_TOO_LARGE on every transport. Each transport
 * measures what it carries, so an `mcp` envelope is measured over WebSocket (whatever fields the
 * agent put beside `message`, which the relay forwards too) and the bare body over HTTP. An HTTP
 * body over the limit is refused before it is parsed, so its 413 has id null (JSON-RPC: the id
 * could not be read); a request refused once parsed is answered under its own id.
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
 * the same catalog within the limit. Besides the tools, that reply carries the JSON-RPC envelope,
 * the request id (the relay refuses ids over 1 KiB of JSON, REQUEST_ID_TOO_LARGE) and the catalog
 * metadata the relay adds: its `catalogVersion`/`catalogHash` in `result._meta` and, for an agent
 * that sent `_meta`, at the top of `result`; in a listing the relay answers itself, `result._meta`
 * also holds the room's listing metadata (room id, epoch, state and auth). With an id of the full
 * 1 KiB that is at most about 1.6 KiB more than the announcement, so the reply always fits. Every
 * catalog within {@link PEER_RELAY_MAX_CATALOG_BYTES} passes; a larger announcement is refused with
 * CATALOG_TOO_LARGE.
 */
export const PEER_RELAY_MAX_ANNOUNCEMENT_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES - 2 * 1024;

/**
 * The longest identifier an agent may give the relay that its answer repeats, in UTF-8 bytes of
 * the identifier's JSON text: a JSON-RPC request id, and an `offer`'s `requestId`. The relay refuses
 * a longer one with REQUEST_ID_TOO_LARGE, without echoing it (a request is answered with id null),
 * and `PeerMcpSession` refuses one before sending it over a relay socket. Internal to the package:
 * the server and client tiers share it.
 */
export const PEER_RELAY_MAX_REQUEST_ID_BYTES = 1024;

/**
 * The most JSON-RPC requests one agent WebSocket may have in flight through the relay: waiting for
 * the provider, or answered and waiting for the agent to read the answer. The relay refuses one more
 * with TOO_MANY_PENDING_REQUESTS (-32087), so `PeerMcpSession` never sends one more: past this many
 * unanswered requests on a relay socket, a request waits for an earlier one to be answered. A
 * request the agent counts as in flight (sent and not yet answered) always includes every one the
 * relay counts, so the agent's count reaching the limit is the earliest the relay's can: the relay
 * counts only requests, never the other frames it holds for a slow agent (its approval state,
 * `ready`, `offer.refused`), which answer nothing the agent counts. HTTP requests are not counted:
 * each one is answered on its own response, and one whose id is already pending is forwarded under
 * a rewritten wire id.
 */
export const PEER_RELAY_MAX_PENDING_REQUESTS = 64;

const utf8 = new TextEncoder();

/** The UTF-8 byte length of a string, as the relay measures a message. */
export function utf8ByteLength(text: string): number {
  return utf8.encode(text).byteLength;
}
