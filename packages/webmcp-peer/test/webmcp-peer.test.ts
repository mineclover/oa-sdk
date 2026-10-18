import { afterEach, describe, expect, it } from "vitest";
import {
  buildInvitationUrl,
  createPeerConfigProfile,
  normalizePeerConfigUrl,
  parseInvitationUrl,
  parsePeerConfig,
  probePeerHealth,
} from "../src/config.js";
import {
  PeerMcpSession,
  discoverPeerCatalog,
  hashTools,
  joinPeerRoom,
  rotatePeerRoom,
  waitForPeerApproval,
} from "../src/client.js";
import {
  AiRunController,
  AiRunLedger,
  InMemoryAiRunLedgerStore,
  WebMcpPeerClient,
  type WebMcpHostAdapter,
} from "../src/provider.js";
import {
  WebMcpPeerServer,
  createWebMcpPeerServer,
} from "../src/server.js";

describe("@oa-sdk/webmcp-peer unified package", () => {
  const servers: WebMcpPeerServer[] = [];
  const providers: WebMcpPeerClient[] = [];

  afterEach(async () => {
    for (const provider of providers.splice(0)) {
      provider.disconnect();
    }
    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  it("normalizes peer config profiles and invitation URLs", () => {
    expect(normalizePeerConfigUrl("127.0.0.1:8787///")).toBe("http://127.0.0.1:8787");

    const invite = buildInvitationUrl({
      serverUrl: "http://127.0.0.1:8787",
      roomId: "room-abc",
      inviteToken: "token-xyz",
    });
    expect(invite).toBe("http://127.0.0.1:8787/p/room-abc#invite=token-xyz");

    const parsed = parseInvitationUrl(invite);
    expect(parsed).toEqual({
      serverUrl: "http://127.0.0.1:8787",
      roomId: "room-abc",
      descriptorUrl: "http://127.0.0.1:8787/p/room-abc",
      inviteToken: "token-xyz",
    });

    const profile = createPeerConfigProfile({
      serverUrl: "http://127.0.0.1:8787",
      roomId: "room-abc",
      roomEpoch: 1,
      invitationUrl: invite,
    });
    const reparsed = parsePeerConfig(JSON.stringify(profile));
    expect(reparsed?.roomId).toBe("room-abc");
    expect(reparsed?.invitationUrl).toBe(invite);
  });

  it("runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client)", async () => {
    const tools = [
      {
        name: "service_echo",
        description: "Echoes a message from the host service",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ];

    const server = createWebMcpPeerServer({
      port: 0,
      host: "127.0.0.1",
      roomSweepIntervalMs: 0,
      deploymentCatalog: { tools },
      serverName: "generic-webmcp-service",
      serverVersion: "1.0.0",
    });
    servers.push(server);
    const port = await server.listen();
    const serverUrl = `http://127.0.0.1:${port}`;

    // 1. Health & Bootstrap Catalog discovery
    const health = await probePeerHealth(serverUrl);
    expect(health.ok).toBe(true);
    expect(health.state).toBe("healthy");

    const catalog = await discoverPeerCatalog({ serverUrl });
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.catalogHash).toBe(hashTools(tools));

    // 2. Host Provider creates room and connects signaling WebSocket
    const hostAdapter: WebMcpHostAdapter = {
      listTools: () => tools,
      getStatus: () => ({ writeEnabled: true }),
      invoke: async (name, args) => {
        if (name === "service_echo") {
          return {
            ok: true,
            echoed: `echo:${String(args?.text ?? "")}`,
          };
        }
        throw new Error(`Unknown tool: ${name}`);
      },
    };

    const provider = new WebMcpPeerClient({ hostAdapter });
    providers.push(provider);

    const invitationUrl = await provider.connect({
      serverUrl,
      alias: "my-service-host",
      enableWrite: true,
    });
    const roomId = provider.getSession().roomId!;
    expect(roomId).toMatch(/^[a-f0-9]+$/);
    expect(invitationUrl).toContain(`/p/${roomId}#invite=`);

    // 3. External Agent Client redeems invitation and requests approval
    const joined = await joinPeerRoom({
      invitationUrl,
      clientLabel: "Test Agent CLI",
    });
    expect(joined.roomId).toBe(roomId);
    expect(joined.state).toBe("pending-approval");
    expect(joined.approvalRequestId).toBeTruthy();

    // Wait for provider to receive approval request and approve it
    await new Promise<void>((resolveApproved, rejectApproved) => {
      const timeout = setTimeout(() => rejectApproved(new Error("Approval request not received")), 5000);
      const unsub = provider.subscribe((status) => {
        if (status.approvalState === "pending" && status.approvalRequestId === joined.approvalRequestId) {
          clearTimeout(timeout);
          unsub();
          expect(provider.approveClient(status.approvalRequestId)).toBe(true);
          resolveApproved();
        }
      });
    });

    const approvedStatus = await waitForPeerApproval({
      serverUrl,
      roomId,
      sessionId: joined.sessionId,
      clientToken: joined.clientToken,
      pollIntervalMs: 25,
      timeoutMs: 2000,
    });
    expect(approvedStatus.state).toBe("approved");

    // 4. External Agent Client invokes tools over HTTP MCP endpoint (`POST /p/:id/mcp`)
    const session = new PeerMcpSession({
      serverUrl,
      roomId,
      roomEpoch: joined.roomEpoch,
      clientToken: joined.clientToken,
      mcpEndpoint: `${serverUrl}/p/${roomId}/mcp`,
    });

    await session.initialize();
    const listedTools = await session.listTools();
    expect(listedTools).toHaveLength(1);

    const callResult = (await session.callTool("service_echo", { text: "hello-peer" })) as {
      content: Array<{ type: string; text: string }>;
      structuredContent?: { echoed?: string };
    };
    expect(JSON.stringify(callResult)).toContain("echo:hello-peer");

    await session.disconnect();
  });

  it("supports customHttpHandler plugin hook and headless HTTP approval + room rotation", async () => {
    const server = createWebMcpPeerServer({
      port: 0,
      host: "127.0.0.1",
      roomSweepIntervalMs: 0,
      customHttpHandler: async (req, res, url, origin, srv) => {
        if (req.method === "GET" && url.pathname === "/custom/service-info") {
          srv.sendJson(res, 200, { customService: true }, origin);
          return true;
        }
        return false;
      },
    });
    servers.push(server);
    const port = await server.listen();
    const serverUrl = `http://127.0.0.1:${port}`;

    const customRes = await fetch(`${serverUrl}/custom/service-info`);
    expect(customRes.status).toBe(200);
    expect(await customRes.json()).toEqual({ customService: true });

    // Create room via POST /p
    const createRes = await fetch(`${serverUrl}/p`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: "headless-host", approvalRequired: true }),
    });
    expect(createRes.status).toBe(201);
    const room = (await createRes.json()) as {
      roomId: string;
      roomEpoch: number;
      providerToken: string;
      inviteToken: string;
    };

    const joined = await joinPeerRoom({
      serverUrl,
      roomId: room.roomId,
      inviteToken: room.inviteToken,
    });
    expect(joined.approvalRequestId).toBeTruthy();

    const approvalRes = await fetch(
      `${serverUrl}/p/${room.roomId}/approval/${encodeURIComponent(joined.approvalRequestId!)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${room.providerToken}`,
        },
        body: JSON.stringify({
          roomId: room.roomId,
          roomEpoch: room.roomEpoch,
          sessionId: joined.sessionId,
          decision: "approved",
        }),
      },
    );
    expect(approvalRes.status).toBe(200);
    const decision = (await approvalRes.json()) as { state: string; clientTokenActive: boolean };
    expect(decision.state).toBe("approved");
    expect(decision.clientTokenActive).toBe(true);

    const rotated = await rotatePeerRoom({
      serverUrl,
      roomId: room.roomId,
      roomEpoch: room.roomEpoch,
      providerToken: room.providerToken,
      alias: "rotated-host",
    });
    expect(rotated.previousRoomId).toBe(room.roomId);
    expect(rotated.replacementRoomId).not.toBe(room.roomId);
  });

  it("tracks AI Run Controller and AI Run Ledger operations idempotently", async () => {
    const controller = new AiRunController();
    const started = controller.enqueue("run-1", "act-1");
    expect(started.phase).toBe("queued");

    const ledger = new AiRunLedger(new InMemoryAiRunLedgerStore());
    const recordResult = await ledger.recordReceipt({
      runId: "run-1",
      actionId: "act-1",
      stepIndex: 0,
      receipt: {
        status: "durable",
        requestId: "req-1",
        documentId: "doc-1",
        operationId: "op-1",
        transactionId: "tx-1",
        replicaId: "rep-1",
        committedAt: "2026-10-18T00:00:00.000Z",
      },
    });
    expect(recordResult.status).toBe("appended");
    expect(await ledger.list("run-1")).toHaveLength(1);
  });
});
