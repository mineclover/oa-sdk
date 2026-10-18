# `@oa-sdk/webmcp-peer`

Unified 3-tier WebMCP Peer Server Routing, Browser Provider, and External Agent Client library for connecting web applications and external AI agents over Streamable HTTP MCP (`/p/:id/mcp`), WebSocket signaling/relay (`/p/:id/provider`, `/p/:id/client`), and WebRTC DataChannels.

## Subpath Entrypoints

- `@oa-sdk/webmcp-peer` — Full barrel export across config, client, provider, and server.
- `@oa-sdk/webmcp-peer/config` — URL normalization, invitation link parsing/building, profile creation, and `/health` / `/config` probing.
- `@oa-sdk/webmcp-peer/client` — External AI Agent / CLI client (`PeerMcpSession`, `PeerMcpService`, `JsonPeerMcpStore`, `joinPeerRoom`, `waitForPeerApproval`, `discoverPeerCatalog`, `rotatePeerRoom`).
- `@oa-sdk/webmcp-peer/provider` — Browser / Host Provider (`WebMcpPeerClient`, `WebMcpHostAdapter`, F5 session lease reclaim, approval gate, WebRTC & HTTP MCP bridge).
- `@oa-sdk/webmcp-peer/server` — Room-based HTTP MCP router & WebSocket signaling server (`WebMcpPeerServer`, `createWebMcpPeerServer`, `upgradeWebSocket`, `loadDeploymentCatalog`, `createPublishRateLimiter`) with extensible HTTP/WebSocket hooks for host-specific routes.
