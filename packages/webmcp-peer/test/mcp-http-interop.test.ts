// Streamable HTTP interoperability of the relay's `/p/:id/mcp` endpoint with stock MCP hosts
// (Claude, Cursor, ...) built on the official SDK. Both behaviours were found by a staging deploy
// test where the SDK client could not connect, and later polled the relay once per second.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { joinPeerRoom, waitForPeerApproval } from "../src/client.js";
import { PEER_RELAY_MAX_REQUEST_BYTES } from "../src/config.js";
import { MCP_INITIALIZE_PROTOCOL_VERSIONS, MCP_PROTOCOL_VERSION, WebMcpPeerClient } from "../src/provider.js";
import { createWebMcpPeerServer, type WebMcpPeerServer } from "../src/server.js";

const servers: WebMcpPeerServer[] = [];
const providers: WebMcpPeerClient[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

const echoTool = {
  name: "service_echo",
  description: "Echoes a message from the host service",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

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

/** A room with a connected provider that serves `echoTool`, and an approved client token. */
async function startProvidedRoom(): Promise<{ base: string; roomId: string; clientToken: string }> {
  const server = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, deploymentCatalog: { tools: [echoTool] } });
  servers.push(server);
  const base = `http://127.0.0.1:${await server.listen()}`;
  const provider = new WebMcpPeerClient({
    hostAdapter: {
      listTools: () => [echoTool],
      getStatus: () => ({ writeEnabled: true }),
      invoke: async (name, args) => {
        if (name !== echoTool.name) throw new Error(`Unknown tool: ${name}`);
        return { echoed: `echo:${String(args?.text ?? "")}` };
      },
    },
  });
  providers.push(provider);
  const invitationUrl = await provider.connect({ serverUrl: base, alias: "interop-host", enableWrite: true });
  const roomId = provider.getSession().roomId!;
  const joined = await joinPeerRoom({ invitationUrl, clientLabel: "interop-client" });
  await new Promise<void>((resolveApproved, rejectApproved) => {
    const timeout = setTimeout(() => rejectApproved(new Error("Approval request not received")), 5000);
    // subscribe() replays the current status synchronously, so the request may already be pending.
    let approved = false;
    let unsubscribe: (() => void) | undefined;
    unsubscribe = provider.subscribe((status) => {
      if (approved || status.approvalState !== "pending" || status.approvalRequestId !== joined.approvalRequestId) return;
      approved = true;
      clearTimeout(timeout);
      unsubscribe?.();
      provider.approveClient(status.approvalRequestId);
      resolveApproved();
    });
    if (approved) unsubscribe();
  });
  await waitForPeerApproval({ serverUrl: base, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 2000 });
  return { base, roomId, clientToken: joined.clientToken };
}

function post(endpoint: string, message: unknown, headers: Record<string, string> = {}) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof message === "string" ? message : JSON.stringify(message),
  });
}

describe("MCP Streamable HTTP interoperability", () => {
  it.each([...MCP_INITIALIZE_PROTOCOL_VERSIONS])("negotiates initialize-era version %s as requested", async (version) => {
    const { base, roomId } = await startRoom();
    expect(await initialize(base, roomId, version)).toBe(version);
  });

  it("answers 2026-07-28, unknown, and missing initialize versions with 2025-11-25", async () => {
    const { base, roomId } = await startRoom();

    // 2026-07-28 has no initialize; the official SDK aborts on a version it does not know.
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(await initialize(base, roomId, MCP_PROTOCOL_VERSION)).toBe("2025-11-25");
    expect(await initialize(base, roomId, "1999-01-01")).toBe("2025-11-25");
    expect(await initialize(base, roomId)).toBe("2025-11-25");
  });

  it("advertises tools.listChanged false because the HTTP endpoint has no server-to-client stream", async () => {
    const { base, roomId } = await startRoom();
    const response = await post(`${base}/p/${roomId}/mcp`, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    const body = (await response.json()) as { result: { capabilities: { tools: { listChanged: boolean } } } };
    expect(body.result.capabilities.tools.listChanged).toBe(false);
  });

  it("lets a browser send the MCP request headers through the CORS preflight", async () => {
    const { base, roomId } = await startRoom();
    const preflight = await fetch(`${base}/p/${roomId}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type, mcp-protocol-version, mcp-method, mcp-name" },
    });
    expect(preflight.status).toBe(204);
    const allowed = preflight.headers.get("access-control-allow-headers") ?? "";
    for (const header of ["MCP-Protocol-Version", "Mcp-Method", "Mcp-Name"]) expect(allowed).toContain(header);

    const response = await post(`${base}/p/${roomId}/mcp`, { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "http://localhost:5173" });
    expect(response.headers.get("access-control-allow-headers")).toBe(allowed);
  });

  it("answers a notification with 202 and an empty body", async () => {
    const { base, roomId } = await startRoom();
    const response = await post(`${base}/p/${roomId}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("forwards a provider notification and answers 202 with an empty body", async () => {
    const { base, roomId, clientToken } = await startProvidedRoom();
    const response = await post(`${base}/p/${roomId}/mcp`,
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "r-1" } },
      { authorization: `Bearer ${clientToken}` });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("rejects a request with id null as an invalid request", async () => {
    const { base, roomId } = await startRoom();
    const response = await post(`${base}/p/${roomId}/mcp`, { jsonrpc: "2.0", id: null, method: "tools/list" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("rejects an unsupported MCP-Protocol-Version header and accepts a supported or missing one", async () => {
    const { base, roomId } = await startProvidedRoom();
    const listWith = (version?: string) => post(`${base}/p/${roomId}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/list" },
      version === undefined ? {} : { "mcp-protocol-version": version });

    expect((await listWith("2025-11-25")).status).toBe(200);
    expect((await listWith("2024-11-05")).status).toBe(200);
    expect((await listWith()).status).toBe(200);

    const unsupported = await listWith("2026-07-28");
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32600, message: "UNSUPPORTED_PROTOCOL_VERSION", data: { supported: [...MCP_INITIALIZE_PROTOCOL_VERSIONS], requested: "2026-07-28" } },
    });

    // initialize negotiates in its body, so the header does not gate it.
    const initializeResponse = await post(`${base}/p/${roomId}/mcp`, {
      jsonrpc: "2.0", id: 3, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    }, { "mcp-protocol-version": "2026-07-28" });
    expect(initializeResponse.status).toBe(200);
  });

  it("answers a body over the limit with 413 instead of a truncated parse", async () => {
    const { base, roomId } = await startRoom();
    const response = await post(`${base}/p/${roomId}/mcp`,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { padding: "x".repeat(PEER_RELAY_MAX_REQUEST_BYTES) } }));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("REQUEST_TOO_LARGE");
  });

  it("answers DELETE with 405 because the relay issues no session", async () => {
    const { base, roomId } = await startRoom();
    const response = await fetch(`${base}/p/${roomId}/mcp`, { method: "DELETE" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  // The official v2 SDK either opens with initialize ('legacy') or, in 'auto' mode, probes
  // server/discover with 2026-07-28 first; the relay's 400 makes it fall back to initialize.
  it.each(["legacy", "auto"] as const)("serves the official MCP v2 client in %s negotiation mode", async (mode) => {
    const { base, roomId, clientToken } = await startProvidedRoom();
    const exchanges: Array<{ method: string; status: number }> = [];
    const recordingFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (init?.method === "POST" && typeof init.body === "string") {
        exchanges.push({ method: (JSON.parse(init.body) as { method: string }).method, status: response.status });
      }
      return response;
    };
    const client = new Client({ name: `v2-${mode}`, version: "1.0.0" }, { versionNegotiation: { mode } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/p/${roomId}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${clientToken}` } },
        fetch: recordingFetch,
      }));
      expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
      const handshake = exchanges.map(({ method, status }) => `${method} ${status}`);
      expect(handshake.slice(-2)).toEqual(["initialize 200", "notifications/initialized 202"]);
      if (mode === "auto") expect(handshake[0]).toBe("server/discover 400");
      else expect(handshake).not.toContain("server/discover 400");
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([echoTool.name]);
      const result = await client.callTool({ name: echoTool.name, arguments: { text: "hello" } });
      expect(JSON.stringify(result)).toContain("echo:hello");
    } finally {
      await client.close().catch(() => {});
    }
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
