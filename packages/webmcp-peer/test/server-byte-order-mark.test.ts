// Regression tests for a byte order mark in front of the JSON the relay parses (relay protocol spec
// R-HTTP-008, R-MCP-009, R-SIG-001): a sender must not add one, but a receiver may ignore it (RFC 8259
// §8.1), and the relay ignores one leading U+FEFF on every transport alike: an MCP POST body, a JSON
// body route and a provider or client socket's text message. Before, a WebSocket frame with one was
// silently dropped (an agent's request never got an answer) and an MCP POST was 400 PARSE_ERROR,
// while the JSON body routes took it. A second mark is not JSON whitespace and still fails to parse.
import { afterEach, describe, expect, it } from "vitest";
import type { WebMcpPeerServer } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  startRelay,
  tool,
} from "./server-test-helpers.js";

const BOM = "﻿";

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

function postText(url: string, text: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: text });
}

describe("a leading byte order mark", () => {
  it("is ignored in an MCP POST body", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);
    const joined = await joinRoom(relay.base, room);
    const ping = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" });

    const response = await postText(`${relay.base}/p/${room.id}/mcp`, `${BOM}${ping}`, { authorization: `Bearer ${joined.clientToken}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });

    // Only one: a second is not JSON whitespace.
    const twice = await postText(`${relay.base}/p/${room.id}/mcp`, `${BOM}${BOM}${ping}`, { authorization: `Bearer ${joined.clientToken}` });
    expect(twice.status).toBe(400);
    expect(await twice.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "PARSE_ERROR" } });
  });

  it("is ignored in an agent's socket frame, whose request is answered", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    await agent.waitFor((frame) => frame.type === "ready", "agent ready");

    agent.send(`${BOM}${JSON.stringify({ type: "ping" })}`);
    await agent.waitFor((frame) => frame.type === "pong", "pong to a frame with a byte order mark");
    agent.send(`${BOM}${JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id: 3, method: "ping" } })}`);
    const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 3, "answer to a request with a byte order mark");
    expect(reply.message).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("is ignored in a provider's socket frame, whose catalog the relay takes", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");

    provider.send(`${BOM}${JSON.stringify({ type: "register", tools: [tool("read")] })}`);
    await flush(provider, "register read");
    const catalog = await fetch(`${relay.base}/p/${room.id}/mcp/tools`);
    expect(catalog.status).toBe(200);
    expect(((await catalog.json()) as { tools: unknown[] }).tools).toEqual([tool("read")]);
  });

  it("is ignored in a JSON body route's body, as it was", async () => {
    const relay = await startRelay(servers);
    const room = await createRoom(relay.base);

    const joined = await postText(`${relay.base}/p/${room.id}/join`, `${BOM}${JSON.stringify({ inviteToken: room.inviteToken })}`);
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({ roomId: room.id, clientToken: expect.any(String) });
  });
});
