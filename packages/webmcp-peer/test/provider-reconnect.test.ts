// Regression tests for the provider's relay session lifecycle: the relay URLs it builds, approvals
// the relay restores after a lease reclaim, the auto-reconnect backoff loop, the close codes it
// reconnects after (1001, 1006, 1013) and the final ones it stops at (1000, 4001, 4002), a lease the
// relay refuses (auto-reconnect stops instead of opening a new room), the write consent
// auto-reconnect restores, the rotate request, and relay catalog rejections.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEBMCP_CLOSE_CODES, WEBMCP_SUBPROTOCOL } from "../src/config.js";
import { WebMcpPeerClient, type WebMcpHostAdapter } from "../src/provider.js";
import {
  FakeRelay,
  callTool,
  flushMicrotasks,
  installRelay,
  relayStamp,
  type FakeRelaySocket,
} from "./provider-fakes.js";

const providers: WebMcpPeerClient[] = [];

afterEach(() => {
  for (const provider of providers.splice(0)) provider.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hostAdapter: WebMcpHostAdapter = {
  listTools: () => [{ name: "read", description: "read tool", inputSchema: { type: "object", properties: {} } }],
  invoke: async () => ({ ok: true }),
};

function provider(): WebMcpPeerClient {
  const client = new WebMcpPeerClient({ hostAdapter, shouldSuppressAutoReconnect: () => false });
  providers.push(client);
  return client;
}

/** The frame the relay sends after `ready` for a client ticket it already approved. */
function restoredFrame(roomId: string, sessionId: string): Record<string, unknown> {
  return {
    protocol: "webmcp-peer/1",
    messageId: `approval-restored-${sessionId}`,
    type: "approval.restored",
    roomId,
    roomEpoch: 1,
    sessionId,
    payload: { sessionId, roomId, roomEpoch: 1, clientLabel: "Agent", capabilities: ["mcp-control"], expiresAt: Date.now() + 60_000 },
  };
}

describe("relay URLs", () => {
  it("builds them like the agent client from a server URL of any scheme case", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider();
    const invitationUrl = await host.connect({ serverUrl: "HTTP://relay.test/", alias: "urls" });

    expect(relay.fetchCalls[0]).toEqual({ url: `${relay.base}/p`, method: "POST" });
    expect(relay.latest.url).toBe(`ws://relay.test/p/${relay.roomId}/provider`);
    expect(relay.latest.protocols).toEqual([WEBMCP_SUBPROTOCOL, "ticket.provider-1"]);
    expect(invitationUrl).toBe(`${relay.base}/p/${relay.roomId}/mcp#invite=invite-token`);
  });
});

describe("approvals the relay restores on reattach", () => {
  it("serves an approved client announced right after ready, in the same read", async () => {
    const relay = new FakeRelay();
    relay.afterReady = (socket, room) => socket.deliver(restoredFrame(room.id, "peer-session-agent"));
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "restore" });

    expect(host.getSession()).toMatchObject({ approvalState: "approved", clientLabel: "Agent" });
    expect((await callTool(relay.latest, 1, "read")).result?.isError).toBe(false);
  });

  it("ignores a restored approval for another room epoch", async () => {
    const relay = new FakeRelay();
    relay.afterReady = (socket, room) => socket.deliver({ ...restoredFrame(room.id, "s1"), roomEpoch: 7, payload: { sessionId: "s1", roomEpoch: 7 } });
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "restore" });

    expect(host.getSession().approvalState).toBe("none");
    // The relay's code for CLIENT_APPROVAL_REQUIRED, not the −32003 of a missing client token.
    expect((await callTool(relay.latest, 1, "read")).error).toEqual({ code: -32053, message: "CLIENT_APPROVAL_REQUIRED" });
  });

  it("keeps an approved agent working across a lease reclaim", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "reclaim" });
    const roomId = relay.roomId;
    await approveWithFakeTimers(host, relay.latest, roomId);
    expect((await callToolWithFakeTimers(relay.latest, 1)).result?.isError).toBe(false);

    // The relay keeps the ticket approved and, on reattach, restores it to the provider.
    relay.afterReady = (socket, room) => socket.deliver(restoredFrame(room.id, "peer-session-agent"));
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(relay.fetchCalls.some((call) => call.url.endsWith(`/p/${roomId}/reclaim`))).toBe(true);
    expect(relay.sockets).toHaveLength(2);
    expect(host.getSession()).toMatchObject({ roomId, state: "waiting", approvalState: "approved" });
    expect((await callToolWithFakeTimers(relay.latest, 2)).result?.isError).toBe(false);
  });
});

async function approveWithFakeTimers(host: WebMcpPeerClient, socket: FakeRelaySocket, roomId: string): Promise<void> {
  socket.deliver({
    protocol: "webmcp-peer/1",
    type: "approval.request",
    roomId,
    roomEpoch: 1,
    sessionId: "peer-session-agent",
    requestId: "approval-1",
    payload: { requestId: "approval-1", sessionId: "peer-session-agent", roomId, roomEpoch: 1, clientLabel: "Agent" },
  });
  await flushMicrotasks();
  expect(host.approveClient()).toBe(true);
}

/** callTool without the real-time polling helper (fake timers are installed). */
async function callToolWithFakeTimers(socket: FakeRelaySocket, id: number) {
  socket.deliver({ type: "mcp", ...relayStamp(), message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "read", arguments: {} } } });
  await flushMicrotasks(20);
  const frame = socket.sent.find((sent) => sent.type === "mcp" && (sent.message as { id?: unknown })?.id === id);
  if (!frame) throw new Error(`no reply to ${id}`);
  return frame.message as { result?: { isError?: boolean }; error?: unknown };
}

describe("auto-reconnect backoff", () => {
  it("keeps retrying with growing delays while the relay is down, then reclaims the room", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "backoff", autoReconnect: true });
    const roomId = relay.roomId;
    const callsBefore = relay.fetchCalls.length;
    const attemptsSoFar = () => relay.fetchCalls.length - callsBefore;

    relay.reachable = false;
    relay.latest.drop();

    await vi.advanceTimersByTimeAsync(999);
    expect(attemptsSoFar()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptsSoFar()).toBe(1);
    expect(host.getSession().state).toBe("error");

    // 1.5 s after the first failure, then 2.25 s after the second.
    await vi.advanceTimersByTimeAsync(1499);
    expect(attemptsSoFar()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptsSoFar()).toBe(2);
    await vi.advanceTimersByTimeAsync(2250);
    expect(attemptsSoFar()).toBe(3);

    relay.reachable = true;
    await vi.advanceTimersByTimeAsync(3375);
    await flushMicrotasks();
    expect(relay.fetchCalls[relay.fetchCalls.length - 1]?.url).toBe(`${relay.base}/p/${roomId}/reclaim`);
    expect(host.getSession()).toMatchObject({ state: "waiting", roomId, error: null });

    // A successful reconnect resets the backoff: the next drop retries after 1 s again.
    const reconnectedCalls = relay.fetchCalls.length;
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(relay.fetchCalls.length).toBe(reconnectedCalls + 1);
  });

  it("stops retrying after a manual disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "manual", autoReconnect: true });
    const callsBefore = relay.fetchCalls.length;

    relay.reachable = false;
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(relay.fetchCalls.length).toBe(callsBefore + 1);

    host.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.fetchCalls.length).toBe(callsBefore + 1);
  });
});

describe("the close code of the provider socket", () => {
  async function connectedHost(alias: string) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias, autoReconnect: true });
    return { relay, host, roomId: relay.roomId, callsBefore: relay.fetchCalls.length };
  }

  it.each<[string, number | undefined]>([
    ["1001, the relay going away or no longer hearing from it", WEBMCP_CLOSE_CODES.GOING_AWAY],
    ["1006, a connection lost without a close frame", 1006],
    ["1013, the relay shedding it for a while", WEBMCP_CLOSE_CODES.TRY_AGAIN_LATER],
    ["no code at all", undefined],
  ])("is reconnected after %s, by reclaiming its room", async (_label, code) => {
    const { relay, host, roomId, callsBefore } = await connectedHost("retry");

    relay.latest.drop(code);
    expect(host.getSession().state).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(relay.fetchCalls.slice(callsBefore)).toEqual([{ url: `${relay.base}/p/${roomId}/reclaim`, method: "POST" }]);
    expect(relay.sockets).toHaveLength(2);
    expect(host.getSession()).toMatchObject({ state: "waiting", roomId, error: null });
  });

  it.each<[string, number, string]>([
    ["4001 SUPERSEDED: another provider socket serves the room now", WEBMCP_CLOSE_CODES.SUPERSEDED, "PEER_SESSION_SUPERSEDED"],
    ["1000, a final close whose frame did not arrive", WEBMCP_CLOSE_CODES.NORMAL, "SIGNALING_CLOSED"],
    ["1009, a frame of its own the relay refused", 1009, "SIGNALING_CLOSED"],
  ])("is not reconnected after %s", async (_label, code, error) => {
    const { relay, host, roomId, callsBefore } = await connectedHost("final");

    relay.latest.drop(code);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(relay.fetchCalls.length).toBe(callsBefore);
    expect(relay.sockets).toHaveLength(1);
    expect(host.getSession()).toMatchObject({ state: "disconnected", roomId, error });
  });

  it("ends the session as expired after 4002 ROOM_EXPIRED, without reconnecting", async () => {
    const { relay, host, callsBefore } = await connectedHost("expired");

    relay.latest.drop(WEBMCP_CLOSE_CODES.ROOM_EXPIRED);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(relay.fetchCalls.length).toBe(callsBefore);
    expect(host.getSession()).toMatchObject({ state: "disconnected", approvalState: "expired", error: "ROOM_EXPIRED" });
  });
});

describe("a lease the relay refuses", () => {
  it("is forgotten, so the next auto-reconnect does not present it again", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "lease", autoReconnect: true });
    host.disconnect();
    // The saved lease is now wrong (403 ROOM_LEASE_INVALID), and no new room can be created.
    relay.replaceLease();
    relay.creatable = false;
    const reclaims = () => relay.fetchCalls.filter((call) => call.url.endsWith("/reclaim")).length;

    expect(await host.autoReconnectIfSaved()).toBe(false);
    expect(reclaims()).toBe(1);
    expect(await host.autoReconnectIfSaved()).toBe(false);
    expect(reclaims()).toBe(1);
  });
});

describe("an auto-reconnect whose lease the relay refuses", () => {
  it.each([
    [400, { error: "ROOM_LEASE_REQUIRED" }],
    [403, { error: "ROOM_LEASE_INVALID" }],
    [404, { error: "ROOM_NOT_FOUND", code: -32004 }],
    [409, { error: "ROOM_LEASE_BINDING_INVALID", code: -32002 }],
    [410, { error: "ROOM_EXPIRED", code: -32056 }],
    [410, { error: "ROOM_LEASE_EXPIRED" }],
  ] as const)("stops at ROOM_LEASE_LOST for %i %o, and opens no new room", async (status, body) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "lost", autoReconnect: true });
    const roomId = relay.roomId;
    const created = () => relay.fetchCalls.filter((call) => call.url === `${relay.base}/p` && call.method === "POST").length;
    const reclaims = () => relay.fetchCalls.filter((call) => call.url.endsWith("/reclaim")).length;

    relay.reclaimAnswer = { status, body };
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();
    expect(reclaims()).toBe(1);
    expect(host.getSession()).toMatchObject({ state: "error", error: "ROOM_LEASE_LOST", invitationUrl: null });

    // No attempt follows, and the lease is forgotten: the next page load has nothing to reconnect to.
    const calls = relay.fetchCalls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.fetchCalls.length).toBe(calls);
    expect(await host.autoReconnectIfSaved()).toBe(false);
    expect(relay.fetchCalls.length).toBe(calls);
    expect(created()).toBe(1);
    expect(relay.sockets).toHaveLength(1);
    expect(relay.roomId).toBe(roomId);
  });

  it("keeps the lease and retries a reclaim that failed for another reason, without opening a new room", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "retry", autoReconnect: true });
    const roomId = relay.roomId;
    const reclaims = () => relay.fetchCalls.filter((call) => call.url.endsWith("/reclaim")).length;

    relay.reclaimAnswer = { status: 503, body: { error: "RELAY_UNAVAILABLE" } };
    relay.latest.drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();
    expect(reclaims()).toBe(1);
    expect(host.getSession()).toMatchObject({ state: "error", error: "RELAY_UNAVAILABLE" });

    relay.reclaimAnswer = undefined;
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();
    expect(reclaims()).toBe(2);
    expect(host.getSession()).toMatchObject({ state: "waiting", roomId, error: null });
    expect(relay.fetchCalls.filter((call) => call.url === `${relay.base}/p`)).toHaveLength(1);
  });

  it("does not run without a saved lease, so a reload never opens a room by itself", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "no-lease", autoReconnect: true });
    host.disconnect();
    // The settings are saved, but the lease is gone (it expired with its room, say).
    const leaseKey = `webmcp:room-lease:${encodeURIComponent(relay.base)}:${encodeURIComponent(host.getReplicaId())}`;
    expect(localStorage.getItem(leaseKey)).not.toBeNull();
    localStorage.removeItem(leaseKey);

    expect(await host.autoReconnectIfSaved()).toBe(false);
    expect(relay.fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
  });
});

describe("write consent across an auto-reconnect", () => {
  it("is restored only as the user last set it, the rule connect() reads it by", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay, { browser: true });
    let writeEnabled = false;
    const enabled: boolean[] = [];
    const host = new WebMcpPeerClient({
      hostAdapter: {
        ...hostAdapter,
        getStatus: () => ({ writeEnabled }),
        setWriteEnabled: (value) => {
          enabled.push(value);
          writeEnabled = value;
          return { writeEnabled };
        },
        toggleWrite: () => {
          writeEnabled = !writeEnabled;
          return { writeEnabled };
        },
      },
      shouldSuppressAutoReconnect: () => false,
    });
    providers.push(host);
    const reconnect = async () => {
      const sockets = relay.sockets.length;
      relay.latest.drop();
      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      expect(relay.sockets).toHaveLength(sockets + 1);
    };

    // Never enabled: neither the connect nor the auto-reconnect enables writes.
    await host.connect({ serverUrl: relay.base, alias: "writes", autoReconnect: true });
    await reconnect();
    expect(enabled).toEqual([]);
    expect(writeEnabled).toBe(false);

    // Enabled by the user: saved, so the auto-reconnect enables it again.
    expect(host.setWriteEnabled(true)).toBe(true);
    expect(localStorage.getItem("webmcp:write-enabled")).toBe("true");
    writeEnabled = false;
    await reconnect();
    expect(enabled).toEqual([true, true]);
    expect(writeEnabled).toBe(true);

    // Turned off by the user: saved as the state the host reports, so the auto-reconnect leaves it off.
    expect(host.toggleWrite()).toBe(false);
    expect(localStorage.getItem("webmcp:write-enabled")).toBe("false");
    await reconnect();
    expect(enabled).toEqual([true, true]);
    expect(writeEnabled).toBe(false);
  });
});

describe("room rotation", () => {
  it("sends the room epoch the provider knows, and leaves out one it does not instead of guessing 0", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "rotate" });
    // From here on the relay's descriptors do not report the epoch.
    relay.reportsRoomEpoch = false;

    await host.refreshRoom();
    expect(relay.rotateBodies[0]).toMatchObject({ roomId: "abcdef0123456789", roomEpoch: 1 });
    // The replacement's epoch is unknown: a guessed 0 would be refused as ROOM_BINDING_INVALID.
    await host.refreshRoom();
    expect(relay.rotateBodies[1]).toMatchObject({ roomId: "fedcba9876543210" });
    expect(relay.rotateBodies[1]).not.toHaveProperty("roomEpoch");
    expect(host.getSession()).toMatchObject({ roomId: "fedcba9876543210", error: null });
  });
});

describe("relay catalog rejection", () => {
  it("surfaces CATALOG_INVALID as the session error until a new catalog is sent", async () => {
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "catalog" });
    const seen: Array<string | null> = [];
    host.subscribe((session) => seen.push(session.error));

    relay.latest.deliver({ type: "error", code: -32602, message: "CATALOG_INVALID", reason: "duplicate tool name" });
    await flushMicrotasks();
    expect(host.getSession().error).toBe("CATALOG_INVALID: duplicate tool name");
    expect(seen).toContain("CATALOG_INVALID: duplicate tool name");

    expect(host.syncTools()).toBe(true);
    expect(host.getSession().error).toBeNull();
    expect(relay.latest.sent.filter((frame) => frame.type === "register")).toHaveLength(2);
  });

  it("does not report unrelated relay errors as a catalog failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const relay = new FakeRelay();
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "catalog" });

    relay.latest.deliver({ type: "error", code: -32081, message: "INVALID_APPROVAL", requestId: "x" });
    await flushMicrotasks();
    expect(host.getSession().error).toBeNull();
  });
});

describe("pending approvals re-sent right after ready", () => {
  it("are not lost when they arrive in the same read as ready", async () => {
    const relay = new FakeRelay();
    relay.afterReady = (socket, room) =>
      socket.deliver({
        protocol: "webmcp-peer/1",
        type: "approval.request",
        roomId: room.id,
        roomEpoch: 1,
        sessionId: "peer-session-agent",
        requestId: "approval-early",
        payload: { requestId: "approval-early", sessionId: "peer-session-agent", roomId: room.id, roomEpoch: 1 },
      });
    installRelay(relay);
    const host = provider();
    await host.connect({ serverUrl: relay.base, alias: "early" });
    expect(host.getSession()).toMatchObject({ approvalState: "pending", approvalRequestId: "approval-early" });
  });
});
