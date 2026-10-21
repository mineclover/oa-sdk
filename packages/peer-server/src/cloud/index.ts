/**
 * @oa-sdk/peer-server/cloud — WebMCP Cloud Transit Proxy
 *
 * Runtime-neutral entry point (no Node-only imports), so Edge/Workers hosts can
 * build a CloudTransitProxy without the Node server in the root entry point.
 */

export * from './transit-proxy.js'
export { PeerRoomManager, type PeerRoomManagerOptions } from '../room.js'
