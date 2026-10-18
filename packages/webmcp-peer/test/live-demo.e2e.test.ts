// Executable proof of the live demo's claims. Every test drives the demo's own DOM-free runtime
// modules (the exact code the browser page runs) against a real relay server started by
// `startLiveDemoServer`, and the interop tests drive the published `@oa-sdk/webmcp-peer/client`.
import { afterEach, describe, expect, it } from "vitest";
import { startLiveDemoServer, type LiveDemoServer } from "../examples/live-demo.js";
import { createHostRuntime } from "../examples/live-demo/host-tools.js";
import { createHostProvider } from "../examples/live-demo/host-provider.js";
import { createAgentClient } from "../examples/live-demo/agent-client.js";
import { computeCatalogHash, waitUntil } from "../examples/live-demo/peer-protocol.js";
import { SCENARIO_STEPS, runLiveScenario } from "../examples/live-demo/scenario.js";
import {
  PeerMcpCatalogChangedError,
  PeerMcpRpcError,
  PeerMcpSession,
  canonicalRpcErrorCode,
  hashTools,
  isCatalogChangedRpcError,
  joinPeerRoom,
  waitForPeerApproval,
} from "../src/client.js";
import { isCommitReceipt } from "../src/provider.js";

type WireEvent = { type: string; route?: string; title?: string; tone?: string };

interface DemoRig {
  demo: LiveDemoServer;
  host: ReturnType<typeof createHostRuntime>;
  provider: ReturnType<typeof createHostProvider>;
  agent: ReturnType<typeof createAgentClient>;
  events: WireEvent[];
  autoRefresh: { enabled: boolean };
}

const rigs: DemoRig[] = [];
const extraAgents: Array<ReturnType<typeof createAgentClient>> = [];
const sessions: PeerMcpSession[] = [];

async function createRig(): Promise<DemoRig> {
  const demo = await startLiveDemoServer({ port: 0 });
  const events: WireEvent[] = [];
  const autoRefresh = { enabled: true };
  const host = createHostRuntime();
  const provider = createHostProvider({ origin: demo.url, host, onEvent: (event: WireEvent) => events.push(event) });
  const agent = createAgentClient({ autoRefresh: () => autoRefresh.enabled, onEvent: (event: WireEvent) => events.push(event) });
  const rig = { demo, host, provider, agent, events, autoRefresh };
  rigs.push(rig);
  return rig;
}

/** Host opens a room, the agent redeems the invitation URL, the host approves. */
async function connectApproved(rig: DemoRig): Promise<void> {
  await rig.provider.createRoom();
  const joined = rig.agent.join(rig.provider.state.room.invitationUrl);
  await waitUntil(() => rig.provider.state.pendingApproval, { label: "approval.request" });
  expect(rig.provider.decideApproval("approved")).toBe(true);
  expect(await joined).toMatchObject({ ok: true });
}

async function roomCatalog(rig: DemoRig, roomId: string) {
  const response = await fetch(`${rig.demo.url}/p/${roomId}/mcp/tools`);
  return (await response.json()) as { tools: Array<{ name: string }>; catalogVersion: number; catalogHash: string };
}

/** Changes the host tool surface and waits until the relay announced the new catalog version. */
async function changeSurface(rig: DemoRig, mutate: () => void): Promise<number> {
  const before = rig.agent.state.serverCatalog.catalogVersion;
  mutate();
  expect(rig.provider.broadcastCatalog("test")).toBe(true);
  await waitUntil(() => rig.agent.state.serverCatalog.catalogVersion > before, { label: "list_changed" });
  return rig.agent.state.serverCatalog.catalogVersion;
}

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const agent of extraAgents.splice(0)) agent.close();
  for (const rig of rigs.splice(0)) {
    rig.agent.close();
    rig.provider.reset();
    await rig.demo.close();
  }
});

describe("live demo — autopilot scenario", () => {
  it("runs the exact page scenario end-to-end and leaves durable CommitReceipts", async () => {
    const rig = await createRig();
    const steps: string[] = [];
    await runLiveScenario({ ...rig, pace: 0, onStep: (id: string, state: string) => steps.push(`${id}:${state}`) });

    expect(steps).toEqual(SCENARIO_STEPS.flatMap((step) => [`${step.id}:active`, `${step.id}:done`]));
    expect(rig.host.state.theme).toBe("editorial");
    expect(rig.host.state.nodes.map((node: { title: string }) => node.title)).toEqual(
      expect.arrayContaining(["AI 실시간 생성: 장바구니 드로어", "[QA] 결제 버튼 터치 영역 44px 확장 필요"]),
    );
    expect(rig.host.state.ledger.map((entry: { toolName: string }) => entry.toolName)).toEqual([
      "scene_add_node",
      "qa_annotate_issue",
      "stage_switch_theme",
    ]);
    for (const entry of rig.host.state.ledger) expect(isCommitReceipt(entry.receipt)).toBe(true);

    const server = await roomCatalog(rig, rig.provider.state.room.id);
    expect(rig.agent.state.catalog).toMatchObject({
      catalogVersion: server.catalogVersion,
      catalogHash: server.catalogHash,
      verified: true,
    });
    expect(server.tools.map((tool) => tool.name)).toContain("qa_annotate_issue");
  });
});

describe("live demo — catalog integrity", () => {
  it("computes byte-identical catalog hashes in the agent, the client library and the relay", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    rig.host.setPack("deploy", true);
    rig.host.addCustomTool("custom_export_pdf", "PDF 스냅샷");
    await changeSurface(rig, () => rig.host.setPack("qa", true));
    await waitUntil(() => rig.agent.state.catalog.tools.length === rig.host.listTools().length, { label: "auto refresh" });

    const server = await roomCatalog(rig, rig.provider.state.room.id);
    const local = await computeCatalogHash(server.tools);
    expect(local).toBe(server.catalogHash);
    expect(hashTools(server.tools)).toBe(server.catalogHash);
    expect(await computeCatalogHash([...server.tools].reverse())).toBe(server.catalogHash);
    expect(rig.agent.state.catalog).toMatchObject({ catalogHash: server.catalogHash, localHash: local, verified: true });

    const tampered = server.tools.map((tool, index) => (index === 0 ? { ...tool, description: "tampered" } : tool));
    expect(await computeCatalogHash(tampered)).not.toBe(server.catalogHash);
  });

  it("blocks calls locally while the relay catalog hash is unverified", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    rig.agent.state.catalog = { ...rig.agent.state.catalog, verified: false };
    const sentBefore = rig.events.filter((event) => event.title?.includes("tools/call")).length;

    const result = await rig.agent.callTool("scene_add_node", { title: "should not run" });

    expect(result).toMatchObject({ ok: false, code: "CATALOG_INTEGRITY_UNVERIFIED" });
    expect(rig.events.filter((event) => event.title?.includes("tools/call")).length).toBe(sentBefore);
    expect(rig.host.state.ledger).toHaveLength(0);
  });
});

describe("live demo — fail-closed controls", () => {
  it("rejects stale writes with CATALOG_CHANGED without touching the host, then resyncs", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    rig.autoRefresh.enabled = false;
    const staleVersion = rig.agent.state.catalog.catalogVersion;
    const nextVersion = await changeSurface(rig, () => rig.host.setPack("qa", true));
    expect(nextVersion).toBeGreaterThan(staleVersion);
    expect(rig.agent.state.catalog.catalogVersion).toBe(staleVersion);

    const write = await rig.agent.callTool("scene_add_node", { title: "stale write" });

    expect(write).toMatchObject({ ok: false, code: "CATALOG_CHANGED", blocked: "CATALOG_CHANGED", readOnly: false });
    expect(rig.host.state.ledger).toHaveLength(0);
    expect(rig.agent.state.catalog.catalogVersion).toBe(nextVersion);
    expect(rig.agent.state.catalog.tools.map((tool: { name: string }) => tool.name)).toContain("qa_annotate_issue");
  });

  it("retries read-only tools once after a catalog refresh", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    rig.autoRefresh.enabled = false;
    await changeSurface(rig, () => rig.host.setPack("deploy", true));

    const read = await rig.agent.callTool("scene_list", {});

    expect(read.ok).toBe(true);
    expect(rig.events.filter((event) => event.title?.startsWith("Fail-Closed: CATALOG_CHANGED"))).toHaveLength(1);
  });

  it("enforces host write consent while reads keep working", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    rig.host.state.writeEnabled = false;

    expect(await rig.agent.callTool("scene_add_node", { title: "locked" })).toMatchObject({ ok: false, code: "WRITE_DISABLED" });
    expect(rig.host.state.ledger).toHaveLength(0);
    const read = await rig.agent.callTool("scene_list", {});
    expect(read).toMatchObject({ ok: true, data: { writeEnabled: false } });
  });

  it("rolls back AI commits in reverse order using the CommitReceipt ledger", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    const initial = structuredClone(rig.host.state.nodes);
    await rig.agent.callTool("scene_add_node", { title: "first" });
    await rig.agent.callTool("scene_add_node", { title: "second" });

    expect(rig.host.rollbackLast()?.summary).toContain("second");
    expect(rig.host.rollbackLast()?.summary).toContain("first");
    expect(rig.host.rollbackLast()).toBeNull();
    expect(rig.host.state.nodes).toEqual(initial);
    expect(rig.host.state.ledger.map((entry: { status: string }) => entry.status)).toEqual(["rolled-back", "rolled-back"]);
  });
});

describe("live demo — room lifecycle security", () => {
  it("rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite", async () => {
    const rig = await createRig();
    await connectApproved(rig);
    const previous = { ...rig.provider.state.room };

    const rotated = await rig.provider.rotateRoom();
    await waitUntil(() => rig.agent.state.status === "rotated", { label: "room.rotated push" });

    expect(rotated.roomEpoch).toBe(previous.roomEpoch + 1);
    expect(rotated.id).not.toBe(previous.id);
    expect(rotated.invalidatedSessionCount).toBe(1);
    expect(await rig.agent.callTool("scene_list", {})).toMatchObject({ ok: false, code: "ROOM_ROTATED", status: 410 });

    const late = createAgentClient();
    extraAgents.push(late);
    expect(await late.join(previous.invitationUrl)).toMatchObject({ ok: false, status: 410, error: "ROOM_ROTATED" });

    const rejoin = rig.agent.join(rig.provider.state.room.invitationUrl);
    await waitUntil(() => rig.provider.state.pendingApproval, { label: "approval.request" });
    rig.provider.decideApproval("approved");
    expect(await rejoin).toMatchObject({ ok: true });
    expect(rig.agent.state.session.roomEpoch).toBe(rotated.roomEpoch);

    const replay = createAgentClient();
    extraAgents.push(replay);
    expect(await replay.join(rig.provider.state.room.invitationUrl)).toMatchObject({
      ok: false,
      status: 409,
      error: "INVITE_TOKEN_CONSUMED",
    });
  });

  it("a host rejection denies the session", async () => {
    const rig = await createRig();
    await rig.provider.createRoom();
    const joined = rig.agent.join(rig.provider.state.room.invitationUrl);
    await waitUntil(() => rig.provider.state.pendingApproval, { label: "approval.request" });
    rig.provider.decideApproval("rejected");

    expect(await joined).toMatchObject({ ok: false, error: "REJECTED" });
    expect(await rig.agent.callTool("scene_list", {})).toMatchObject({ ok: false, code: "CLIENT_APPROVAL_DENIED", status: 403 });
  });

  it("revoke pushes session.revoked and purges the host credentials", async () => {
    const rig = await createRig();
    await connectApproved(rig);

    await rig.provider.revokeRoom();
    await waitUntil(() => rig.agent.state.status === "revoked", { label: "session.revoked push" });

    expect(rig.provider.state.room).toBeNull();
    expect(await rig.agent.callTool("scene_list", {})).toMatchObject({ ok: false, code: "SESSION_INVALID", status: 401 });
  });
});

describe("live demo — server surface", () => {
  it("evaluates Config & Security with the real config library and never echoes secrets", async () => {
    const rig = await createRig();
    const room = await rig.provider.createRoom();
    const response = await fetch(`${rig.demo.url}/demo/api/posture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: rig.demo.url,
        invitationUrl: room.invitationUrl,
        roomEpoch: room.roomEpoch,
        defaults: { approvalRequired: true, providerToken: room.providerToken, inviteToken: room.inviteToken },
      }),
    });
    const text = await response.text();
    const posture = JSON.parse(text);

    expect(text).not.toContain(room.providerToken);
    expect(text).not.toContain(room.inviteToken);
    expect(posture.strippedKeys).toEqual(["providerToken", "inviteToken"]);
    expect(posture.profile).toMatchObject({ roomId: room.id, roomEpoch: room.roomEpoch, defaults: { approvalRequired: true } });
    expect(posture.invitation.redactedUrl).toMatch(/#invite=\w{4}\.\.\.\w{2}$/);
    expect(posture.transports).toEqual([
      { url: rig.demo.url, local: true, secure: true },
      { url: "https://peer.example.com", local: false, secure: true },
      { url: "http://peer.example.com", local: false, secure: false },
    ]);
  });

  it("serves every module the page imports and nothing outside the asset directory", async () => {
    const rig = await createRig();
    const html = await (await fetch(`${rig.demo.url}/demo`)).text();
    const queue = [...html.matchAll(/(?:src|href)="(\/demo\/[^"]+)"/g)].map((match) => match[1]);
    const seen = new Set<string>();
    while (queue.length) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const response = await fetch(`${rig.demo.url}${path}`);
      expect(response.status, path).toBe(200);
      if (path.endsWith(".js")) {
        const source = await response.text();
        for (const match of source.matchAll(/from "\.\/([^"]+)"/g)) queue.push(`/demo/${match[1]}`);
      }
    }
    expect(seen).toEqual(
      new Set(["app.css", "app.js", "ui.js", "host-tools.js", "host-provider.js", "agent-client.js", "scenario.js", "peer-protocol.js"].map((file) => `/demo/${file}`)),
    );

    for (const probe of ["/demo/%2e%2e/live-demo.ts", "/demo/..%2flive-demo.ts", "/demo/live-demo.ts"]) {
      expect((await fetch(`${rig.demo.url}${probe}`)).status, probe).toBe(404);
    }
  });
});

describe("@oa-sdk/webmcp-peer/client interop with the demo host", () => {
  async function connectLibrarySession(rig: DemoRig): Promise<PeerMcpSession> {
    const room = await rig.provider.createRoom();
    const joined = await joinPeerRoom({ invitationUrl: room.invitationUrl, clientLabel: "library agent" });
    await waitUntil(() => rig.provider.state.pendingApproval, { label: "approval.request" });
    rig.provider.decideApproval("approved");
    await waitForPeerApproval({
      serverUrl: rig.demo.url,
      roomId: joined.roomId,
      sessionId: joined.sessionId,
      clientToken: joined.clientToken,
      pollIntervalMs: 25,
      timeoutMs: 3000,
    });
    const session = new PeerMcpSession({
      serverUrl: rig.demo.url,
      roomId: joined.roomId,
      roomEpoch: joined.roomEpoch,
      sessionId: joined.sessionId,
      clientToken: joined.clientToken,
      mcpEndpoint: `${rig.demo.url}/p/${joined.roomId}/mcp`,
    });
    sessions.push(session);
    return session;
  }

  async function bumpCatalog(rig: DemoRig, mutate: () => void): Promise<void> {
    const roomId = rig.provider.state.room.id;
    const before = (await roomCatalog(rig, roomId)).catalogVersion;
    mutate();
    rig.provider.broadcastCatalog("library drift");
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await roomCatalog(rig, roomId)).catalogVersion > before) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("relay catalog did not change");
  }

  it("lists and calls demo host tools through the library PeerMcpSession", async () => {
    const rig = await createRig();
    const session = await connectLibrarySession(rig);

    const tools = await session.listTools();
    const server = await roomCatalog(rig, rig.provider.state.room.id);
    expect(tools.map((tool) => tool.name)).toEqual(rig.host.listTools().map((tool: { name: string }) => tool.name));
    expect(session.catalogHash).toBe(server.catalogHash);
    expect(session.catalogVersion).toBe(server.catalogVersion);

    const result = await session.callTool("scene_add_node", { title: "library write" });
    expect(isCommitReceipt(result.structuredContent.receipt)).toBe(true);
    expect(rig.host.state.ledger).toHaveLength(1);
  });

  it("surfaces relay catalog drift over HTTP as PeerMcpCatalogChangedError (no host write)", async () => {
    const rig = await createRig();
    const session = await connectLibrarySession(rig);
    await session.listTools();
    await bumpCatalog(rig, () => rig.host.setPack("qa", true));

    await expect(session.callTool("scene_add_node", { title: "stale" })).rejects.toBeInstanceOf(PeerMcpCatalogChangedError);
    expect(rig.host.state.ledger).toHaveLength(0);
    expect(session.cachedTools.map((tool) => tool.name)).toContain("qa_annotate_issue");

    await bumpCatalog(rig, () => rig.host.setPack("deploy", true));
    const read = await session.callTool("scene_list", {}, { readOnly: true, retryOnCatalogChanged: true });
    expect(read.structuredContent.ok).toBe(true);
  });

  it("reports a revoked session as SESSION_INVALID instead of catalog drift", async () => {
    const rig = await createRig();
    const session = await connectLibrarySession(rig);
    await session.listTools();
    await rig.provider.revokeRoom();

    const failure = await session.callTool("scene_list", {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PeerMcpRpcError);
    expect(failure).not.toBeInstanceOf(PeerMcpCatalogChangedError);
    expect(failure).toMatchObject({ code: "SESSION_INVALID", rpcError: { code: -32001, httpStatus: 401 } });
  });
});

describe("catalog drift error classification", () => {
  it("only treats registry drift codes as catalog changes", () => {
    expect(isCatalogChangedRpcError({ code: -32010, message: "CATALOG_CHANGED" })).toBe(true);
    expect(isCatalogChangedRpcError({ code: -32027, message: "SOURCE_CHANGED" })).toBe(true);
    expect(isCatalogChangedRpcError({ code: "CATALOG_STALE" })).toBe(true);
    expect(isCatalogChangedRpcError({ code: -32001, message: "SESSION_INVALID" })).toBe(false);
    expect(isCatalogChangedRpcError({ code: -32001, message: "PROVIDER_UNAVAILABLE" })).toBe(false);
    expect(isCatalogChangedRpcError({ code: -32001, message: "MCP_REQUEST_TIMEOUT" })).toBe(false);
    expect(isCatalogChangedRpcError({ code: -32057, message: "ROOM_ROTATED" })).toBe(false);
    expect(isCatalogChangedRpcError(undefined)).toBe(false);
  });

  it("resolves canonical error names from numeric JSON-RPC errors", () => {
    expect(canonicalRpcErrorCode({ code: -32001, message: "SESSION_INVALID" })).toBe("SESSION_INVALID");
    expect(canonicalRpcErrorCode({ code: -32000, message: "free text", data: { code: "WRITE_DISABLED" } })).toBe("WRITE_DISABLED");
    expect(canonicalRpcErrorCode({ code: "HTTP_502", message: "Bad Gateway" })).toBe("HTTP_502");
    expect(canonicalRpcErrorCode({ code: -32603, message: "Internal error" })).toBeUndefined();
  });
});
