// Streamable HTTP interoperability of the relay's `/p/:id/mcp` endpoint with stock MCP hosts
// (Claude, Cursor, ...) built on the official SDK. Both behaviours were found by a staging deploy
// test where the SDK client could not connect, and later polled the relay once per second.
import { afterEach, describe, expect, it } from "vitest";
import { MCP_PROTOCOL_VERSION } from "../src/provider.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";

const servers: WebMcpPeerServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function startRoom(): Promise<{ base: string; roomId: string }> {
  const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
  servers.push(server);
  const base = `http://127.0.0.1:${await server.listen()}`;
  const created = await fetch(`${base}/p`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvalRequired: false }),
  });
  const room = (await created.json()) as { id: string };
  return { base, roomId: room.id };
}

async function initialize(base: string, roomId: string, protocolVersion?: string) {
  const response = await fetch(`${base}/p/${roomId}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { ...(protocolVersion ? { protocolVersion } : {}), capabilities: {}, clientInfo: { name: "stock-mcp-host", version: "1" } },
    }),
  });
  return ((await response.json()) as { result: { protocolVersion: string } }).result.protocolVersion;
}

describe("MCP Streamable HTTP interoperability", () => {
  it("negotiates the protocol version instead of always answering the latest", async () => {
    const { base, roomId } = await startRoom();

    expect(await initialize(base, roomId, "2025-11-25")).toBe("2025-11-25");
    expect(await initialize(base, roomId, "2025-06-18")).toBe("2025-06-18");
    expect(await initialize(base, roomId, MCP_PROTOCOL_VERSION)).toBe(MCP_PROTOCOL_VERSION);
    expect(await initialize(base, roomId, "1999-01-01")).toBe(MCP_PROTOCOL_VERSION);
    expect(await initialize(base, roomId)).toBe(MCP_PROTOCOL_VERSION);
  });

  it("refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor", async () => {
    const { base, roomId } = await startRoom();

    const sse = await fetch(`${base}/p/${roomId}/mcp`, { headers: { accept: "text/event-stream" } });
    expect(sse.status).toBe(405);
    expect(sse.headers.get("allow")).toBe("POST");

    const descriptor = await fetch(`${base}/p/${roomId}/mcp`, { headers: { accept: "application/json" } });
    expect(descriptor.status).toBe(200);
    const mixed = await fetch(`${base}/p/${roomId}/mcp`, { headers: { accept: "application/json, text/event-stream" } });
    expect(mixed.status).toBe(200);
  });
});
