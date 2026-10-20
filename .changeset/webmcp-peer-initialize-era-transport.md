---
"@oa-sdk/webmcp-peer": minor
---

The relay's Streamable HTTP endpoint (`/p/:id/mcp`) now follows the initialize-era MCP transport rules (2025-11-25), which is what stock MCP hosts speak. MCP 2026-07-28 removed `initialize`; the official SDK 1.x supports up to 2025-11-25, and SDK 2.x opens with `initialize` (or, in `auto` mode, probes `server/discover` first and falls back to it). Several replies change, so review the items marked **behavior change**.

- **Behavior change:** `initialize` negotiates within the new `MCP_INITIALIZE_PROTOCOL_VERSIONS` (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`). A request for `2026-07-28`, an unknown version, or no version now gets `2025-11-25` instead of `2026-07-28`, which the official SDK rejected as unknown. `server/discover` on this endpoint reports the same negotiated version. `PROTOCOL_VERSION` (`./client`), which `PeerMcpSession` sends in `initialize`, is now `2025-11-25`. `MCP_PROTOCOL_VERSION` and `MCP_PROTOCOL_VERSIONS` keep `2026-07-28` for the provider's own stateless dialect.
- **Behavior change:** a request other than `initialize` whose `MCP-Protocol-Version` header names an unsupported version gets HTTP 400 with JSON-RPC error `-32600` `UNSUPPORTED_PROTOCOL_VERSION` and `data: { supported, requested }`. A missing header is still accepted. A 2026-07-28 client probing `server/discover` gets this 400 and falls back to `initialize`.
- **Behavior change:** notifications (no `id`), including `notifications/initialized`, get 202 with an empty body instead of a JSON body.
- **Behavior change:** a request with `id: null` gets 400 with `-32600` `INVALID_REQUEST`; before, it was forwarded as a notification.
- **Behavior change:** a body over `PEER_RELAY_MAX_REQUEST_BYTES` (256 KiB - 1 KiB, the relay's request limit on every transport) gets 413 `REQUEST_TOO_LARGE` instead of being truncated at 150,000 bytes and answered `PARSE_ERROR`. The rest of the body is read and discarded (up to 16 times the limit, past which the request is destroyed), so the connection stays usable for the next request.
- **Behavior change:** `DELETE /p/:id/mcp` gets 405 with `Allow: GET, POST`, because the relay issues no `Mcp-Session-Id`.
- **Behavior change:** the HTTP `initialize` reply advertises `capabilities.tools.listChanged: false`. This endpoint has no server-to-client stream; catalog changes reach WebSocket clients and surface here as `CATALOG_CHANGED`. The WebSocket provider still advertises `true`.
- CORS `Access-Control-Allow-Headers` (preflight, JSON responses and 304 replies) now lists `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, so browser-hosted MCP clients pass the preflight after `initialize`.
