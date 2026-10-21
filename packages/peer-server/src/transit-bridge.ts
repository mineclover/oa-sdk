/**
 * @oa-sdk/peer-server — Cloud Transit ↔ WebSocket relay bridge
 *
 * Lets Cloud Transit (`/transit/:peer/mcp`, `/call`) reach a provider that is
 * attached to the WebSocket relay. A provider asks for it by connecting with
 * `alias=<peer-alias>` (for example `/p/:roomId/provider?alias=wireframe-local`).
 * The bridge then takes the client side of that relay room as a virtual
 * client: Cloud Transit tool calls go to the provider as `mcp-jsonrpc` relay
 * packets, and the provider's JSON-RPC replies settle them.
 *
 * One relay room serves an alias at a time; binding the alias from a new room
 * (a reloaded page, say) ends the previous room. The binding ends with the
 * provider's socket; calls in flight then wait for a new binding like any
 * provider reconnect.
 */
import { parseSignalMessage, type DataChannelPacket } from '@oa-sdk/peer-transport'
import { isSafeAlias } from './peer-record.js'
import type { PeerRoomManager } from './room.js'
import type { PeerRelayManager, RelaySocket, RelayTransitBinder } from './relay/index.js'
import type { SignalingPeerSocket } from './types.js'

const WS_OPEN = 1
const WS_CLOSED = 3

interface TransitBinding {
  roomId: string
  providerSocket: SignalingPeerSocket
}

export class RelayTransitBridge implements RelayTransitBinder {
  private readonly bindings = new Map<string, TransitBinding>()

  constructor(
    private readonly relayManager: PeerRelayManager,
    private readonly roomManager: PeerRoomManager,
  ) {}

  acceptsAlias(alias: string): boolean {
    return isSafeAlias(alias)
  }

  bind(roomId: string, alias: string): void {
    if (!isSafeAlias(alias)) throw new Error('INVALID_ALIAS')

    const previous = this.bindings.get(alias)
    if (previous && previous.roomId !== roomId) {
      this.relayManager.endRoom(previous.roomId, 'TRANSIT_ALIAS_REBOUND')
    }

    const relayManager = this.relayManager
    const roomManager = this.roomManager

    /**
     * What the room manager sends calls to: each call becomes a relay packet to
     * the provider. A call the relay cannot carry (PAYLOAD_TOO_LARGE, say)
     * throws from relayToProvider and fails only that call; the room stays.
     */
    const providerSocket: SignalingPeerSocket = {
      send(message) {
        const packet: DataChannelPacket = { channel: 'mcp-jsonrpc', payload: message.message, timestamp: Date.now() }
        if (!relayManager.relayToProvider(roomId, packet)) {
          throw new Error(`PEER_UNAVAILABLE: Peer "${alias}" left its relay room`)
        }
      },
      close() {
        relayManager.endRoom(roomId, 'TRANSIT_UNBOUND')
      },
    }

    let readyState = WS_OPEN
    /** The room's client side: receives what the provider relays and the room's lifecycle signals. */
    const virtualClient: RelaySocket = {
      get readyState() {
        return readyState
      },
      send(data) {
        let signal
        try {
          signal = parseSignalMessage(data)
        } catch {
          return
        }
        if (signal.type === 'relay' && signal.packet.channel === 'mcp-jsonrpc') {
          roomManager.handleProviderMessage(alias, { type: 'mcp', message: signal.packet.payload }, providerSocket)
        }
      },
      close: () => {
        if (readyState === WS_CLOSED) return
        readyState = WS_CLOSED
        if (this.bindings.get(alias)?.providerSocket === providerSocket) this.bindings.delete(alias)
        if (roomManager.getRoom(alias)?.providerSocket === providerSocket) roomManager.setProviderSocket(alias, undefined)
      },
    }

    this.relayManager.attachVirtualClient(roomId, 'cloud-transit', virtualClient)
    if (!this.roomManager.getRoom(alias)) {
      // The provider has not announced its catalog yet; POST /announce fills it in.
      this.roomManager.registerRoom({ id: roomId, alias, status: 'refreshing', cachedTools: [], updatedAt: Date.now() })
    }
    this.bindings.set(alias, { roomId, providerSocket })
    this.roomManager.setProviderSocket(alias, providerSocket)
  }
}
