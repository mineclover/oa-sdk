/**
 * The WebSocket close codes of the relay protocol and what each tells the peer, shared by the relay,
 * the provider and the agent client.
 *
 * - `NORMAL` (1000): a final close. The relay sends it right after the frame that says why the
 *   session ended (`room.rotated`, `session.revoked`, `room.expired`, `approval.rejected`,
 *   `approval.expired`), so the peer does not reconnect.
 * - `GOING_AWAY` (1001): the relay is going away (it is shutting down), or it stopped hearing from
 *   the peer for `WEBSOCKET_IDLE_TIMEOUT_MS`. The peer may reconnect.
 * - `TRY_AGAIN_LATER` (1013): the relay shed a peer that stopped reading a full outbound queue. The
 *   peer may reconnect.
 * - `SUPERSEDED` (4001): another socket took this one's place, a new provider socket of the room or
 *   a newer socket of the same client ticket. The peer must not reconnect, or it would displace the
 *   socket that replaced it.
 * - `ROOM_EXPIRED` (4002): the room expired; the provider socket gets no frame before it. The peer
 *   must not reconnect, since the room takes no one any more.
 *
 * The relay sends no other code of its own; 1002, 1003, 1007, 1009 and 1011 refuse a frame the peer
 * sent (RFC 6455 §7.4.1), and a peer's close frame is answered with its own code.
 */
export const WEBMCP_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  TRY_AGAIN_LATER: 1013,
  SUPERSEDED: 4001,
  ROOM_EXPIRED: 4002,
} as const;

/**
 * The code an endpoint reports for a connection that ended without a close frame (RFC 6455 §7.1.5):
 * the network failed, or the relay went away without closing. It never appears on the wire.
 */
export const WEBSOCKET_CLOSE_ABNORMAL = 1006;

/**
 * True for a close after which a peer may connect again: the relay went away or stopped hearing
 * from it (1001), the connection was lost (1006), or the relay shed it for a condition that passes
 * (1013). Every other close is final: 1000 after the frame that ended the session, 4001 for a socket
 * another one replaced, 4002 for an expired room, and the codes that refuse a frame the peer sent,
 * which a reconnect would send again. Internal to the package: the provider's auto-reconnect and
 * the agent client's requests (`PeerMcpSession`) read it.
 */
export function isReconnectableCloseCode(code: number): boolean {
  return code === WEBMCP_CLOSE_CODES.GOING_AWAY
    || code === WEBSOCKET_CLOSE_ABNORMAL
    || code === WEBMCP_CLOSE_CODES.TRY_AGAIN_LATER;
}
