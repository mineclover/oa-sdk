/**
 * @oa-sdk/peer-server — Home MCP Implementation
 *
 * Exposes server metadata, route resolution, and signaling status over MCP 2026-07-28 / JSON-RPC.
 */
import type { PeerRoomManager } from './room.js'

export function createHomeMcpTools(roomManager: PeerRoomManager) {
  return [
    {
      name: 'home_service_status',
      description: 'Get server metadata, protocol version, and uptime',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        return {
          service: 'oa-sdk-peer-server',
          protocolVersion: '2026-07-28',
          status: 'ok',
          activeRoomsCount: roomManager.listRooms().length,
          timestamp: Date.now(),
        }
      },
    },
    {
      name: 'home_route_lookup',
      description: 'Lookup publication descriptor for a given peer alias',
      inputSchema: {
        type: 'object',
        properties: { alias: { type: 'string' } },
        required: ['alias'],
      },
      execute: async (input: { alias: string }) => {
        const room = roomManager.getRoom(input.alias)
        if (!room) {
          return { found: false, message: `Room "${input.alias}" not found` }
        }
        return {
          found: true,
          alias: room.alias,
          id: room.id,
          status: room.status,
          toolsCount: room.cachedTools.length,
        }
      },
    },
    {
      name: 'home_signaling_status',
      description: 'Get diagnostic signaling status for all rooms',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        return {
          rooms: roomManager.listRooms().map((r) => ({
            alias: r.alias,
            id: r.id,
            status: r.status,
            toolsCount: r.cachedTools.length,
            updatedAt: r.updatedAt,
          })),
        }
      },
    },
  ]
}
