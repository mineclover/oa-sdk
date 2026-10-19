// Regression tests for the provider's side of the relay message limit:
//   - a `register` catalog is bounded by PEER_RELAY_MAX_CATALOG_BYTES (the message limit less room
//     for the relay's catalog metadata), not by the message limit itself;
//   - every change of the session error that a catalog sync or a relay rejection makes reaches
//     subscribers, on connect(), after an auto-reconnect and on syncTools();
//   - each `register` carries an increasing `registerSeq`, and a relay rejection that echoes an older
//     one is ignored, so a late rejection of a superseded catalog cannot mask an accepted one;
//   - no frame the provider sends on the relay socket (answers echoing an agent's `requestId`,
//     approval decisions) is ever over the message limit, which would make the relay close it;
//   - a tools/list or server/discover the relay forwards from a WebSocket agent is answered with
//     the catalog last sent to the room, never with a live catalog withheld as too large: the relay
//     takes that reply as a catalog announcement, so a withheld catalog must not reach it that way;
//   - a CRDT carrier send that fails is reported, not left as an unhandled rejection.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PEER_RELAY_MAX_ANNOUNCEMENT_BYTES,
  PEER_RELAY_MAX_CATALOG_BYTES,
  PEER_RELAY_MAX_MESSAGE_BYTES,
} from "../src/config.js";
import * as packageRoot from "../src/index.js";
import {
  PeerMcpRpcError,
  PeerMcpSession,
  joinPeerRoom,
  waitForPeerApproval,
  type JoinedPeerRoom,
} from "../src/client.js";
import {
  WebMcpPeerClient,
  toWireToolDescriptor,
  type WebMcpHostAdapter,
  type WebMcpToolSummary,
} from "../src/provider.js";
import type { WebMcpPeerServer } from "../src/server.js";
import {
  FakeRelay,
  FakeRelaySocket,
  approve,
  flushMicrotasks,
  installRelay,
  replyTo,
  type Frame,
  type RpcReply,
} from "./provider-fakes.js";
import { startRelay, until, type Relay } from "./server-test-helpers.js";

/** The relay message limit and the provider's catalog budget, spelled out. */
const LIMIT = 256 * 1024;
const CATALOG_LIMIT = LIMIT - 4 * 1024;
const ALIAS = "register-limit";

const servers: WebMcpPeerServer[] = [];
const providers: WebMcpPeerClient[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const server of servers.splice(0)) await server.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

const descriptorTool = (name: string, description: string): WebMcpToolSummary => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
});

/** The `register` frame the provider sends for `tools` as its `registerSeq`-th catalog. */
const registerFrame = (tools: readonly WebMcpToolSummary[], registerSeq: number) => ({
  type: "register",
  alias: ALIAS,
  registerSeq,
  tools: tools.map(toWireToolDescriptor),
});

/**
 * `base` and one more tool, "big", sized so that the catalog's register frame, sent as the
 * `registerSeq`-th catalog, is exactly `size` bytes.
 */
function catalogWithFrameSize(base: readonly WebMcpToolSummary[], size: number, registerSeq: number): WebMcpToolSummary[] {
  const make = (pad: string) => [...base, descriptorTool("big", pad)];
  const tools = make("d".repeat(size - bytes(registerFrame(make(""), registerSeq))));
  expect(bytes(registerFrame(tools, registerSeq))).toBe(size);
  return tools;
}

/** One tool whose register frame, sent as the `registerSeq`-th catalog, is exactly `size` bytes. */
const catalogOfFrameSize = (size: number, registerSeq: number) => catalogWithFrameSize([], size, registerSeq);

const wire = (tools: readonly WebMcpToolSummary[]) => tools.map(toWireToolDescriptor);

/** A catalog whose register frame is far over the relay message limit. */
const oversizedCatalog = () => [descriptorTool("huge", "h".repeat(LIMIT))];
const smallCatalog = () => [descriptorTool("small", "fits")];

function provider(tools: WebMcpToolSummary[], invoke: WebMcpHostAdapter["invoke"] = async () => ({ ok: true })): WebMcpPeerClient {
  const client = new WebMcpPeerClient({ hostAdapter: { listTools: () => tools, invoke }, shouldSuppressAutoReconnect: () => false });
  providers.push(client);
  return client;
}

const registerFrames = (socket: FakeRelaySocket) => socket.sent.filter((frame) => frame.type === "register");

/** Replaces the host catalog in place (the adapter reads the same array). */
function setTools(tools: WebMcpToolSummary[], next: WebMcpToolSummary[]): void {
  tools.splice(0, tools.length, ...next);
}

function catalogRejection(message: "CATALOG_INVALID" | "CATALOG_TOO_LARGE", reason: string, registerSeq?: number): Frame {
  return { type: "error", code: -32602, message, reason, ...(registerSeq !== undefined ? { registerSeq } : {}) };
}

// ---------------------------------------------------------------------------------------------
// A real relay with a WebMcpPeerClient provider and one approved agent ticket.
// ---------------------------------------------------------------------------------------------

/** A WebSocket that records every text message it receives, before the page's own handler runs. */
const NativeWebSocket = globalThis.WebSocket;
class ReceivingWebSocket extends NativeWebSocket {
  static readonly instances: ReceivingWebSocket[] = [];
  readonly received: Frame[] = [];
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    ReceivingWebSocket.instances.push(this);
    this.addEventListener("message", (event) => {
      if (typeof event.data === "string") this.received.push(JSON.parse(event.data) as Frame);
    });
  }
}

async function approveAgent(host: WebMcpPeerClient, joined: JoinedPeerRoom): Promise<void> {
  let unsubscribe: (() => void) | undefined;
  await new Promise<void>((resolve) => {
    let approved = false;
    unsubscribe = host.subscribe((session) => {
      if (approved || session.approvalState !== "pending" || session.approvalRequestId !== joined.approvalRequestId) return;
      approved = true;
      host.approveClient(session.approvalRequestId);
      resolve();
    });
  });
  unsubscribe?.();
}

interface RelayRig {
  relay: Relay;
  host: WebMcpPeerClient;
  roomId: string;
  joined: JoinedPeerRoom;
  providerSocket(): ReceivingWebSocket;
  catalog(): Promise<{ status: number; body: Record<string, unknown> }>;
  callTool(id: number, name: string): Promise<Record<string, unknown>>;
}

async function relayRig(tools: WebMcpToolSummary[]): Promise<RelayRig> {
  ReceivingWebSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", ReceivingWebSocket);
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const host = provider(tools, async (name) => ({ ok: true, tool: name }));
  const invitationUrl = await host.connect({ serverUrl: relay.base, alias: ALIAS });
  const roomId = host.getSession().roomId!;
  const joined = await joinPeerRoom({ invitationUrl });
  await approveAgent(host, joined);
  await waitForPeerApproval({ serverUrl: relay.base, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 5000 });
  return {
    relay,
    host,
    roomId,
    joined,
    providerSocket: () => {
      const socket = ReceivingWebSocket.instances.filter((ws) => ws.url.includes("/provider")).at(-1);
      if (!socket) throw new Error("no provider socket");
      return socket;
    },
    catalog: async () => {
      const response = await fetch(`${relay.base}/p/${roomId}/mcp/tools`);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    callTool: async (id, name) => {
      const response = await fetch(`${relay.base}/p/${roomId}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${joined.clientToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }),
      });
      return (await response.json()) as Record<string, unknown>;
    },
  };
}

// =============================================================================================

describe("the provider's register frame budget", { timeout: 20_000 }, () => {
  it("is the message limit less 4 KiB, exported from the config tier and the package root", () => {
    expect(PEER_RELAY_MAX_MESSAGE_BYTES).toBe(LIMIT);
    expect(PEER_RELAY_MAX_CATALOG_BYTES).toBe(CATALOG_LIMIT);
    expect(packageRoot.PEER_RELAY_MAX_CATALOG_BYTES).toBe(CATALOG_LIMIT);
  });

  it("sends a register frame of exactly the catalog limit and withholds one a byte larger", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = catalogOfFrameSize(CATALOG_LIMIT, 1);
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });

    expect(registerFrames(relay.latest)).toEqual([registerFrame(tools, 1)]);
    expect(bytes(registerFrames(relay.latest)[0])).toBe(CATALOG_LIMIT);
    expect(host.getSession().error).toBeNull();

    // One byte more is still well under the relay's message limit, but over the catalog budget.
    setTools(tools, [descriptorTool("big", `${tools[0]!.description}d`)]);
    expect(bytes(registerFrame(tools, 2))).toBe(CATALOG_LIMIT + 1);
    expect(CATALOG_LIMIT + 1).toBeLessThan(LIMIT);
    expect(host.syncTools()).toBe(false);
    expect(registerFrames(relay.latest)).toHaveLength(1);
    expect(host.getSession().error).toBe(
      `CATALOG_TOO_LARGE: the register frame for 1 tool is ${CATALOG_LIMIT + 1} bytes, ` +
        `over the relay protocol's ${CATALOG_LIMIT}-byte catalog limit`,
    );
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[WebMCP\] CATALOG_TOO_LARGE: .*; the catalog was not sent\.$/));
    expect(relay.latest.readyState).toBe(FakeRelaySocket.OPEN);
    expect(host.getSession().state).toBe("waiting");
  });

  it("gets a catalog of exactly the budget announced, and listed by a WebSocket agent that connects later", async () => {
    const tools = catalogOfFrameSize(CATALOG_LIMIT, 1);
    const rig = await relayRig(tools);
    const catalog = await until(rig.catalog, (value) => value.status === 200, "accepted catalog", 5000);
    expect(catalog.body).toMatchObject({ catalogVersion: 1, tools: tools.map(toWireToolDescriptor) });
    expect(rig.host.getSession().error).toBeNull();

    // A WebSocket agent's tools/list goes to the provider, and the relay adds its catalog metadata to
    // the reply: the budget leaves room for both.
    const session = new PeerMcpSession({
      serverUrl: rig.relay.base,
      roomId: rig.roomId,
      sessionId: rig.joined.sessionId,
      clientToken: rig.joined.clientToken,
      requestTimeoutMs: 5000,
    });
    sessions.push(session);
    await session.connect();
    const listed = await session.listTools();
    expect(listed.map((entry) => [entry.name, entry.description?.length])).toEqual([["big", tools[0]!.description.length]]);
    expect(session.catalogHash).toBe(catalog.body.catalogHash);
    expect(await session.callTool("big")).toMatchObject({ isError: false, structuredContent: { ok: true, tool: "big" } });
  });
});

describe("subscribers hear every catalog error", { timeout: 20_000 }, () => {
  it("notifies a CATALOG_TOO_LARGE set during connect() to a listener subscribed before it, and the cleared error later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = oversizedCatalog();
    const host = provider(tools);
    const seen: Array<string | null> = [];
    host.subscribe((session) => seen.push(session.error));

    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    const error = host.getSession().error;
    expect(error).toMatch(/^CATALOG_TOO_LARGE: the register frame for 1 tool is \d+ bytes/);
    expect(seen.at(-1)).toBe(error);
    expect(registerFrames(relay.latest)).toEqual([]);

    setTools(tools, smallCatalog());
    expect(host.syncTools()).toBe(true);
    expect(host.getSession().error).toBeNull();
    expect(seen.at(-1)).toBeNull();
    expect(registerFrames(relay.latest)).toEqual([registerFrame(tools, 2)]);
  });

  it("notifies the withheld catalog again after an auto-reconnect, instead of a cleared error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS, autoReconnect: true });
    const roomId = relay.roomId;
    expect(registerFrames(relay.latest)).toHaveLength(1);

    // The catalog grows past the budget on the live socket, then the connection drops.
    setTools(tools, oversizedCatalog());
    expect(host.syncTools()).toBe(false);
    const seen: Array<{ state: string; error: string | null }> = [];
    host.subscribe((session) => seen.push({ state: session.state, error: session.error }));
    expect(seen.at(-1)?.error).toMatch(/^CATALOG_TOO_LARGE/);

    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();
    expect(relay.sockets).toHaveLength(2);
    expect(relay.fetchCalls.some((call) => call.url.endsWith(`/p/${roomId}/reclaim`))).toBe(true);
    expect(registerFrames(relay.latest)).toEqual([]);
    const error = host.getSession().error;
    expect(error).toMatch(/^CATALOG_TOO_LARGE: the register frame for 1 tool is \d+ bytes/);
    // The reconnect cleared the error while it ran; the listener's last word is the withheld catalog.
    expect(seen.map((entry) => entry.error)).toContain(null);
    expect(seen.at(-1)).toEqual({ state: "waiting", error });

    setTools(tools, smallCatalog());
    expect(host.syncTools()).toBe(true);
    expect(seen.at(-1)).toEqual({ state: "waiting", error: null });
    expect(registerFrames(relay.latest)).toHaveLength(1);
  });

  it("notifies a relay rejection and the cleared error once a catalog is sent again", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider(smallCatalog());
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    const seen: Array<string | null> = [];
    host.subscribe((session) => seen.push(session.error));

    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "duplicate tool name", 1));
    await flushMicrotasks();
    expect(seen.at(-1)).toBe("CATALOG_INVALID: duplicate tool name");
    expect(host.syncTools()).toBe(true);
    expect(seen.at(-1)).toBeNull();
  });
});

describe("relay catalog rejections are matched to the register they answer", { timeout: 20_000 }, () => {
  it("stamps every register frame with a registerSeq that keeps increasing, across connections too", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    expect(host.syncTools()).toBe(true);
    const first = relay.latest;

    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    expect(relay.latest).not.toBe(first);
    expect(registerFrames(first)).toEqual([registerFrame(tools, 1), registerFrame(tools, 2)]);
    expect(registerFrames(relay.latest)).toEqual([registerFrame(tools, 3)]);
  });

  it("ignores the late rejection of an earlier register once a newer one was sent", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    const seen: Array<string | null> = [];
    host.subscribe((session) => seen.push(session.error));

    // Catalog A (registerSeq 2) is followed at once by catalog B (registerSeq 3); the relay's
    // rejection of A arrives only after B was sent, and the relay accepted B (it never says so).
    setTools(tools, [descriptorTool("a", "catalog A")]);
    expect(host.syncTools()).toBe(true);
    setTools(tools, [descriptorTool("b", "catalog B")]);
    expect(host.syncTools()).toBe(true);
    expect(registerFrames(relay.latest).map((frame) => frame.registerSeq)).toEqual([1, 2, 3]);

    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "catalog A is invalid", 2));
    relay.latest.deliver(catalogRejection("CATALOG_TOO_LARGE", "catalog A is too large", 1));
    await flushMicrotasks();
    expect(host.getSession().error).toBeNull();
    expect(seen.every((error) => error === null)).toBe(true);

    // A rejection of B itself is still reported.
    relay.latest.deliver(catalogRejection("CATALOG_TOO_LARGE", "catalog B is too large", 3));
    await flushMicrotasks();
    expect(host.getSession().error).toBe("CATALOG_TOO_LARGE: catalog B is too large");
    expect(seen.at(-1)).toBe("CATALOG_TOO_LARGE: catalog B is too large");
  });

  it("keeps the withheld catalog's error when the rejection of the register before it arrives", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });

    setTools(tools, oversizedCatalog());
    expect(host.syncTools()).toBe(false);
    const withheld = host.getSession().error;
    expect(withheld).toMatch(/^CATALOG_TOO_LARGE: the register frame/);

    // The rejection answers registerSeq 1, which the withheld catalog (registerSeq 2) superseded.
    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "the earlier catalog is invalid", 1));
    await flushMicrotasks();
    expect(host.getSession().error).toBe(withheld);
  });

  it("takes a rejection without registerSeq, from a relay that predates it, to answer the latest register", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    expect(host.syncTools()).toBe(true);

    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "duplicate tool name"));
    await flushMicrotasks();
    expect(host.getSession().error).toBe("CATALOG_INVALID: duplicate tool name");
  });

  it("does not report a real relay's rejection of a superseded catalog while the relay serves the newer one", async () => {
    const tools = smallCatalog();
    const rig = await relayRig(tools);
    await until(rig.catalog, (value) => value.status === 200, "first catalog", 5000);

    // Catalog A names one tool twice, which the relay refuses as CATALOG_INVALID; catalog B is
    // synced right after it, so A's rejection reaches the provider after B was sent.
    setTools(tools, [descriptorTool("dup", "first"), descriptorTool("dup", "second")]);
    expect(rig.host.syncTools()).toBe(true);
    setTools(tools, [descriptorTool("fixed", "catalog B")]);
    expect(rig.host.syncTools()).toBe(true);

    const rejection = await until(
      () => rig.providerSocket().received.find((frame) => frame.type === "error" && frame.message === "CATALOG_INVALID"),
      (frame) => frame !== undefined,
      "the relay's rejection of catalog A",
      5000,
    );
    expect(rejection).toMatchObject({ registerSeq: 2 });
    const catalog = await until(rig.catalog, (value) => value.body.catalogVersion === 2, "catalog B", 5000);
    expect(catalog.body.tools).toEqual([toWireToolDescriptor(descriptorTool("fixed", "catalog B"))]);
    expect(rig.host.getSession().error).toBeNull();
    expect((await rig.callTool(1, "fixed")).result).toMatchObject({ isError: false, structuredContent: { ok: true, tool: "fixed" } });
  });
});

describe("every frame the provider sends on the relay socket fits the message limit", { timeout: 20_000 }, () => {
  it("does not send an approval decision over the limit, and leaves the request pending", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider(smallCatalog());
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    const roomId = relay.roomId;
    const approvalRequest = (requestId: string): Frame => ({
      protocol: "webmcp-peer/1",
      type: "approval.request",
      roomId,
      roomEpoch: 1,
      sessionId: "peer-session-agent",
      requestId,
      payload: { requestId, sessionId: "peer-session-agent", roomId, roomEpoch: 1, clientLabel: "Agent" },
    });

    // The decision repeats the request id three times, which takes it over the limit.
    const longId = `approval-${"x".repeat(100_000)}`;
    relay.latest.deliver(approvalRequest(longId));
    await flushMicrotasks();
    expect(host.getSession()).toMatchObject({ approvalState: "pending", approvalRequestId: longId });
    expect(host.approveClient()).toBe(false);
    expect(host.rejectClient()).toBe(false);
    expect(host.getSession()).toMatchObject({ approvalState: "pending", approvalRequestId: longId });
    expect(relay.latest.sent.filter((frame) => frame.type === "approval.decision")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^\\[WebMCP\\] The \\d+-byte approval\\.decision frame exceeds the relay's ${LIMIT}-byte message limit; it was not sent\\.$`)),
    );
    expect(relay.latest.readyState).toBe(FakeRelaySocket.OPEN);

    // A request whose decision fits is decided as usual.
    relay.latest.deliver(approvalRequest("approval-short"));
    await flushMicrotasks();
    expect(host.approveClient()).toBe(true);
    expect(relay.latest.sent.filter((frame) => frame.type === "approval.decision")).toMatchObject([{ requestId: "approval-short" }]);
    expect(relay.latest.sent.every((frame) => bytes(frame) <= LIMIT)).toBe(true);
  });

  it("drops the answer to an offer whose requestId takes it over the limit, and keeps the provider socket", async () => {
    const answerSdp = `v=0 answer ${"a".repeat(4096)}`;
    class FakePeerConnection {
      static readonly instances: FakePeerConnection[] = [];
      iceGatheringState = "complete";
      remoteDescription: { type: string; sdp?: string } | null = null;
      localDescription: { type: string; sdp?: string } | null = null;
      ondatachannel: ((event: unknown) => void) | null = null;
      closed = false;
      constructor(readonly configuration: unknown) {
        FakePeerConnection.instances.push(this);
      }
      async setRemoteDescription(description: { type: string; sdp?: string }): Promise<void> {
        this.remoteDescription = description;
      }
      async createAnswer(): Promise<{ type: string; sdp: string }> {
        return { type: "answer", sdp: answerSdp };
      }
      async setLocalDescription(description: { type: string; sdp?: string }): Promise<void> {
        this.localDescription = description;
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {
        this.closed = true;
      }
    }
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // This package's relay refuses an offer whose requestId is over 1 KiB of JSON, so the offer is
    // delivered as a relay without that bound would forward it.
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider(smallCatalog());
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    await approve(host, relay.latest, relay.roomId);
    const socket = relay.latest;
    const stamp = { from: "client", sessionId: "peer-session-agent" };

    // The offer itself fits, and so does the copy the relay forwards with its stamps; the answer
    // repeats the requestId next to the provider's SDP and does not.
    const requestId = "r".repeat(LIMIT - 2048);
    const offer = { type: "offer", sdp: "v=0 big-offer", requestId, ...stamp };
    expect(bytes(offer)).toBeLessThan(LIMIT - 1024);
    expect(bytes({ type: "answer", requestId, sdp: answerSdp })).toBeGreaterThan(LIMIT);
    socket.deliver(offer);

    await until(
      () => warn.mock.calls.some(([message]) => typeof message === "string" && /-byte answer frame exceeds the relay's/.test(message)),
      (found) => found,
      "the provider drops the answer",
      5000,
    );
    const offered = FakePeerConnection.instances.find((pc) => pc.remoteDescription?.sdp === "v=0 big-offer");
    expect(offered?.closed).toBe(true);

    // The provider socket survived, still approved, and sent nothing over the limit.
    expect(socket.readyState).toBe(FakeRelaySocket.OPEN);
    expect(host.getSession()).toMatchObject({ state: "waiting", approvalState: "approved" });
    expect(socket.sent.filter((frame) => frame.type === "answer")).toEqual([]);
    expect(socket.sent.every((frame) => bytes(frame) <= LIMIT)).toBe(true);

    // An offer that can be answered starts a fresh peer connection and gets its answer.
    socket.deliver({ type: "offer", sdp: "v=0 ok-offer", requestId: "r-ok", ...stamp });
    const answer = await until(() => socket.sent.find((frame) => frame.type === "answer"), (frame) => frame !== undefined, "answer to the second offer", 5000);
    expect(answer).toMatchObject({ type: "answer", requestId: "r-ok", sdp: answerSdp });
    const answered = FakePeerConnection.instances.find((pc) => pc.remoteDescription?.sdp === "v=0 ok-offer");
    expect(answered).toBeDefined();
    expect(answered).not.toBe(offered);
    expect(answered?.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Catalog requests the relay forwards, and the DataChannel
// ---------------------------------------------------------------------------------------------

/** Delivers a request the relay forwards from a WebSocket agent and returns the provider's reply. */
function relayRequest(socket: FakeRelaySocket, id: number, method: "tools/list" | "server/discover"): Promise<RpcReply> {
  socket.deliver({ type: "mcp", message: { jsonrpc: "2.0", id, method, params: { _meta: {} } } });
  return replyTo(socket, id);
}

/** The JSON-RPC error a catalog request gets when the relay holds no catalog the provider sent. */
const catalogUnavailable = (id: number, reason: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code: -32090, message: "CATALOG_UNAVAILABLE", data: { reason } },
});

/** An agent's end of the provider's `mcp` DataChannel. */
class FakeDataChannel {
  readonly label = "mcp";
  readyState: "open" | "closed" = "open";
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  /** The chunks the provider sent. */
  readonly sent: string[] = [];
  /** send() throws, as a channel that is closing does, once this many chunks were sent. */
  failAfter = Number.POSITIVE_INFINITY;
  private chunkId = 0;

  send(data: string): void {
    if (this.sent.length >= this.failAfter) throw new DOMException("The DataChannel is closing", "InvalidStateError");
    this.sent.push(data);
  }

  close(): void {
    this.readyState = "closed";
  }

  /** The agent sends one frame, as a single chunk. */
  deliver(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify({ v: 1, id: ++this.chunkId, index: 0, total: 1, data: JSON.stringify(frame) }) });
  }

  /** The frames the provider sent, reassembled from their chunks. */
  frames(): Frame[] {
    const parts = new Map<number, string[]>();
    const frames: Frame[] = [];
    for (const text of this.sent) {
      const chunk = JSON.parse(text) as { id: number; index: number; total: number; data: string };
      const received = parts.get(chunk.id) ?? [];
      received[chunk.index] = chunk.data;
      parts.set(chunk.id, received);
      if (received.filter((part) => part !== undefined).length === chunk.total) frames.push(JSON.parse(received.join("")) as Frame);
    }
    return frames;
  }

  /** The provider's reply to request `id`, once it was sent. */
  replyTo(id: number): Promise<RpcReply> {
    return until(
      () => this.frames().find((frame) => frame.type === "mcp" && (frame.message as RpcReply | undefined)?.id === id),
      (frame) => frame !== undefined,
      `DataChannel reply to ${id}`,
      5000,
    ).then((frame) => frame!.message as RpcReply);
  }
}

/**
 * A provider on a FakeRelay whose agent is approved and connected over a DataChannel. With
 * `enableCrdt`, the room is created with the `mcp-crdt` capability.
 */
async function dataChannelRig(tools: WebMcpToolSummary[], options: { enableCrdt?: boolean } = {}) {
  const peerConnections: Array<{ ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null }> = [];
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
      constructor() {
        peerConnections.push(this);
      }
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    },
  );
  const relay = new FakeRelay();
  installRelay(relay);
  if (options.enableCrdt) {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const response = await relay.fetch(input, init);
      if (String(input) !== `${relay.base}/p`) return response;
      const descriptor = (await response.json()) as Frame;
      return Response.json({ ...descriptor, capabilities: ["mcp-control", "mcp-crdt"] }, { status: response.status });
    });
  }
  const host = provider(tools);
  await host.connect({ serverUrl: relay.base, alias: ALIAS, ...(options.enableCrdt ? { enableCrdt: true } : {}) });
  await approve(host, relay.latest, relay.roomId);
  relay.latest.deliver({ type: "approval.approved", requestId: "approval-peer-session-agent" });
  await flushMicrotasks();
  const peerConnection = peerConnections.at(-1);
  if (!peerConnection?.ondatachannel) throw new Error("the provider opened no peer connection");
  const channel = new FakeDataChannel();
  peerConnection.ondatachannel({ channel });
  return { relay, host, channel };
}

/** Runs `body` with Node's unhandled-rejection reports recorded (and kept from the runner's handler). */
async function recordUnhandledRejections(body: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  const runnerListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", record);
  try {
    await body();
  } finally {
    process.off("unhandledRejection", record);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener as (...args: unknown[]) => void);
  }
  return unhandled;
}

describe("relay-forwarded catalog requests list the catalog the relay holds", { timeout: 20_000 }, () => {
  it("answers tools/list and server/discover with the last registered catalog while a larger one is withheld", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    await approve(host, relay.latest, relay.roomId);
    const registered = wire(smallCatalog());
    expect((await relayRequest(relay.latest, 1, "tools/list")).result).toEqual({ tools: registered });

    // The host catalog grows just past the budget, well within the message limit: withheld.
    setTools(tools, catalogWithFrameSize(smallCatalog(), CATALOG_LIMIT + 1, 2));
    expect(host.syncTools()).toBe(false);
    expect(host.getSession().error).toMatch(/^CATALOG_TOO_LARGE: the register frame for 2 tools/);
    expect((await relayRequest(relay.latest, 2, "tools/list")).result).toEqual({ tools: registered });
    expect((await relayRequest(relay.latest, 3, "server/discover")).result).toMatchObject({ tools: registered });
    expect(registerFrames(relay.latest)).toHaveLength(1);
    expect(host.getSession().error).toMatch(/^CATALOG_TOO_LARGE/);

    // A catalog that fits is registered, and from then on it is the one listed.
    setTools(tools, [descriptorTool("small", "fits"), descriptorTool("other", "fits too")]);
    expect(host.syncTools()).toBe(true);
    expect((await relayRequest(relay.latest, 4, "tools/list")).result).toEqual({ tools: wire(tools) });
    expect((await relayRequest(relay.latest, 5, "server/discover")).result).toMatchObject({ tools: wire(tools) });
  });

  it("lists the catalog as it was sent, not host descriptors changed in place since", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    await approve(host, relay.latest, relay.roomId);

    tools[0]!.description = "changed without a sync";
    tools[0]!.inputSchema!.properties = { added: { type: "string" } };
    expect((await relayRequest(relay.latest, 1, "tools/list")).result).toEqual({ tools: wire(smallCatalog()) });
  });

  it("answers CATALOG_UNAVAILABLE, with the withheld catalog's error, when no catalog was sent to the room", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider(oversizedCatalog());
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    await approve(host, relay.latest, relay.roomId);
    const error = host.getSession().error!;
    expect(error).toMatch(/^CATALOG_TOO_LARGE/);

    expect(await relayRequest(relay.latest, 1, "tools/list")).toEqual(catalogUnavailable(1, error));
    expect(await relayRequest(relay.latest, 2, "server/discover")).toEqual(catalogUnavailable(2, error));
    expect(relay.latest.readyState).toBe(FakeRelaySocket.OPEN);
  });

  it("answers CATALOG_UNAVAILABLE when the relay refused the last catalog sent, also after a newer one was withheld", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS });
    await approve(host, relay.latest, relay.roomId);

    // Catalog A (registerSeq 2) is sent; a late rejection of the catalog before it changes nothing.
    setTools(tools, [descriptorTool("a", "catalog A")]);
    expect(host.syncTools()).toBe(true);
    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "the first catalog is invalid", 1));
    await flushMicrotasks();
    expect((await relayRequest(relay.latest, 1, "tools/list")).result).toEqual({ tools: wire([descriptorTool("a", "catalog A")]) });

    // Catalog B (registerSeq 3) is withheld, then the relay's rejection of A arrives: the session
    // error stays B's, but the relay holds neither A nor B, so neither may be listed.
    setTools(tools, oversizedCatalog());
    expect(host.syncTools()).toBe(false);
    const withheld = host.getSession().error;
    relay.latest.deliver(catalogRejection("CATALOG_INVALID", "catalog A is invalid", 2));
    await flushMicrotasks();
    expect(host.getSession().error).toBe(withheld);
    expect(await relayRequest(relay.latest, 2, "tools/list")).toEqual(catalogUnavailable(2, "CATALOG_INVALID: catalog A is invalid"));
    expect(await relayRequest(relay.latest, 3, "server/discover")).toEqual(catalogUnavailable(3, "CATALOG_INVALID: catalog A is invalid"));

    setTools(tools, smallCatalog());
    expect(host.syncTools()).toBe(true);
    expect((await relayRequest(relay.latest, 4, "tools/list")).result).toEqual({ tools: wire(smallCatalog()) });
  });

  it("keeps listing the catalog registered with a reclaimed room when the catalog is withheld after an auto-reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const tools = smallCatalog();
    const host = provider(tools);
    await host.connect({ serverUrl: relay.base, alias: ALIAS, autoReconnect: true });
    const roomId = relay.roomId;
    expect(registerFrames(relay.latest)).toHaveLength(1);

    setTools(tools, oversizedCatalog());
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();
    vi.useRealTimers();
    expect(relay.sockets).toHaveLength(2);
    expect(relay.fetchCalls.some((call) => call.url.endsWith(`/p/${roomId}/reclaim`))).toBe(true);
    expect(registerFrames(relay.latest)).toEqual([]);
    expect(host.getSession().error).toMatch(/^CATALOG_TOO_LARGE/);

    await approve(host, relay.latest, roomId);
    expect((await relayRequest(relay.latest, 1, "tools/list")).result).toEqual({ tools: wire(smallCatalog()) });
  });

  it("lists the live host catalog to a DataChannel agent, which talks to the provider directly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = smallCatalog();
    const { relay, host, channel } = await dataChannelRig(tools);
    setTools(tools, oversizedCatalog());
    expect(host.syncTools()).toBe(false);

    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect((await channel.replyTo(1)).result).toEqual({ tools: wire(oversizedCatalog()) });
    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 2, method: "server/discover" } });
    expect((await channel.replyTo(2)).result).toMatchObject({ tools: wire(oversizedCatalog()) });
    // The relay socket, meanwhile, lists what the relay was sent.
    expect((await relayRequest(relay.latest, 3, "tools/list")).result).toEqual({ tools: wire(smallCatalog()) });
  });

  // The bands the relay treated differently before: a register frame over the catalog budget whose
  // tools/list reply the relay still accepts as an announcement (it adopted the withheld catalog),
  // and one whose announcement it refuses but whose reply it still forwarded, unstamped (the agent
  // then held a catalog the relay did not, and every tools/call failed with CATALOG_CHANGED).
  for (const [band, frameBytes, overAnnouncementLimit] of [
    ["within the relay's announcement limit", CATALOG_LIMIT + 1_000, false],
    ["over the relay's announcement limit", PEER_RELAY_MAX_ANNOUNCEMENT_BYTES + 1_400, true],
  ] as const) {
    it(`gets a WebSocket agent the relay's catalog while a ${frameBytes}-byte register frame (${band}) is withheld`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const grown = catalogWithFrameSize(smallCatalog(), frameBytes, 2);
      expect(frameBytes).toBeGreaterThan(CATALOG_LIMIT);
      // The relay judges the catalog of a tools/list reply by this announcement; the reply itself,
      // with a long request id, fits the message limit, so the relay would get it.
      const announcementBytes = bytes({ type: "register", tools: wire(grown), catalogVersion: 2, catalogHash: "0".repeat(64) });
      expect(announcementBytes > PEER_RELAY_MAX_ANNOUNCEMENT_BYTES).toBe(overAnnouncementLimit);
      expect(bytes({ type: "mcp", message: { jsonrpc: "2.0", id: "i".repeat(80), result: { tools: wire(grown) } } })).toBeLessThan(LIMIT);

      const tools = smallCatalog();
      const rig = await relayRig(tools);
      const accepted = await until(rig.catalog, (value) => value.status === 200, "accepted catalog", 5000);
      expect(accepted.body).toMatchObject({ catalogVersion: 1, tools: wire(smallCatalog()) });

      setTools(tools, grown);
      expect(rig.host.syncTools()).toBe(false);
      const withheld = rig.host.getSession().error;
      expect(withheld).toContain(`the register frame for 2 tools is ${frameBytes} bytes`);

      const session = new PeerMcpSession({
        serverUrl: rig.relay.base,
        roomId: rig.roomId,
        sessionId: rig.joined.sessionId,
        clientToken: rig.joined.clientToken,
        requestTimeoutMs: 5000,
      });
      sessions.push(session);
      await session.connect();
      const listed = await session.listTools();
      expect(listed.map((entry) => entry.name)).toEqual(["small"]);
      expect(session.catalogVersion).toBe(1);
      expect(session.catalogHash).toBe(accepted.body.catalogHash);
      expect(await session.callTool("small")).toMatchObject({ isError: false, structuredContent: { ok: true, tool: "small" } });
      await expect(session.callTool("big", {}, { refresh: false })).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });

      // The relay still serves the catalog it accepted, and the provider still reports the withheld one.
      expect((await rig.catalog()).body).toMatchObject({ catalogVersion: 1, catalogHash: accepted.body.catalogHash, tools: wire(smallCatalog()) });
      expect(rig.host.getSession().error).toBe(withheld);
      expect(rig.providerSocket().readyState).toBe(WebSocket.OPEN);
    });
  }

  it("gets a WebSocket agent of a new room the relay's CATALOG_UNAVAILABLE, not the catalog of the room before", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = smallCatalog();
    const rig = await relayRig(tools);
    await until(rig.catalog, (value) => value.status === 200, "first room's catalog", 5000);

    // The catalog grows past the budget, and the provider moves to a new room.
    setTools(tools, oversizedCatalog());
    const invitationUrl = await rig.host.connect({ serverUrl: rig.relay.base, alias: ALIAS });
    const roomId = rig.host.getSession().roomId!;
    expect(roomId).not.toBe(rig.roomId);
    const withheld = rig.host.getSession().error!;
    expect(withheld).toMatch(/^CATALOG_TOO_LARGE/);
    const joined = await joinPeerRoom({ invitationUrl });
    await approveAgent(rig.host, joined);
    await waitForPeerApproval({ serverUrl: rig.relay.base, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 5000 });

    // An HTTP agent gets CATALOG_UNAVAILABLE from the relay, and so does a WebSocket agent, whose
    // tools/list the provider answers (with the reason, checked against a fake relay above).
    const http = await fetch(`${rig.relay.base}/p/${roomId}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${joined.clientToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(http.status).toBe(503);
    expect(((await http.json()) as { error: unknown }).error).toMatchObject({ code: -32090, message: "CATALOG_UNAVAILABLE" });

    const session = new PeerMcpSession({
      serverUrl: rig.relay.base,
      roomId,
      sessionId: joined.sessionId,
      clientToken: joined.clientToken,
      requestTimeoutMs: 5000,
    });
    sessions.push(session);
    await session.connect();
    const failure = await session.listTools().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PeerMcpRpcError);
    expect((failure as PeerMcpRpcError).rpcError).toMatchObject({ code: -32090, message: "CATALOG_UNAVAILABLE" });
    expect(session.cachedTools).toEqual([]);
    expect((await fetch(`${rig.relay.base}/p/${roomId}/mcp/tools`)).status).toBe(503);
  });
});

describe("CRDT carrier sends nobody awaits", { timeout: 20_000 }, () => {
  it("reports a carrier message that cannot be sent instead of leaving an unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, channel } = await dataChannelRig(smallCatalog(), { enableCrdt: true });
    expect(host.getSession().crdtCapability).toBe(true);
    let carrier: ((message: unknown) => void) | undefined;
    host.attachCrdtTransport({
      documentId: "doc-1",
      attachCarrier: (send) => {
        carrier = send;
        return () => {};
      },
      broadcastAwareness: () => {},
      receiveExternal: () => {},
    });
    if (!carrier) throw new Error("the provider attached no carrier");
    const send = carrier;

    const unhandled = await recordUnhandledRejections(async () => {
      // A message JSON cannot serialize...
      send({ type: "crdt.update", documentId: "doc-1", clock: 1n });
      // ...and a multi-chunk message whose channel starts closing after the first chunk.
      channel.failAfter = channel.sent.length + 1;
      send({ type: "crdt.update", documentId: "doc-1", update: "u".repeat(10_000) });
      // Node's unhandled-rejection check runs after the next macrotask.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(unhandled).toEqual([]);
    const failures = warn.mock.calls.filter(([message]) => message === "[WebMCP] CRDT send failed:");
    expect(failures.map(([, error]) => (error as Error).name)).toEqual(["TypeError", "InvalidStateError"]);

    // The carrier keeps working once the channel can send again.
    channel.failAfter = Number.POSITIVE_INFINITY;
    send({ type: "crdt.update", documentId: "doc-1", update: "fits" });
    await until(
      () => channel.frames().filter((frame) => frame.type === "crdt"),
      (frames) => frames.some((frame) => (frame.message as { message?: { update?: string } }).message?.update === "fits"),
      "the carrier message",
      5000,
    );
  });
});
