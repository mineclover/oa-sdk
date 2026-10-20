// Integration tests for what the relay does when a socket's outbound queue is full, i.e. when the
// peer has not read what the relay already sent it (PeerSocket.send returns "busy"):
//   - a provider that stops reading is never closed or detached for traffic its agents send it:
//     agent requests get the retryable PROVIDER_BUSY (HTTP: 503 with Retry-After), notifications are
//     dropped, offers are refused to their sender, and everything works again once it reads,
//   - an agent that falls behind on the replies it asked for is never closed for it: the replies
//     wait, in order, and go out as it reads (a reading agent that pipelines calls gets every
//     reply), while the relay reads nothing more from it,
//   - broadcasts (catalog announcements) skip an agent that is behind and keep its socket, and
//     never take the room a reply it asked for needs,
//   - a pending approval request the provider could not take goes out on the agent's next call,
//     once per provider socket.
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeerSendResult, PeerSocket, WebMcpPeerServer } from "../src/server.js";
import { PeerFrameSchema } from "../src/server/wire-schemas.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  postJson,
  RawPeer,
  startRelay,
  tool,
  until,
  type Frame,
  type JoinedSession,
  type Relay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

const PROVIDER_BUSY = { code: -32001, message: "PROVIDER_BUSY", data: { retryable: true } };
/** The largest request an agent may send (PEER_RELAY_MAX_REQUEST_BYTES): 1 KiB under the 256 KiB message limit. */
const REQUEST_LIMIT = 256 * 1024 - 1024;
const REQUEST_TOO_LARGE = { code: -32600, message: "REQUEST_TOO_LARGE", data: { limitBytes: REQUEST_LIMIT } };
/** The most requests one agent socket may have waiting for the provider. */
const MAX_PENDING_PER_SOCKET = 64;

const servers: WebMcpPeerServer[] = [];
const sockets: WebSocket[] = [];
const rawPeers: RawPeer[] = [];
const agentProcesses: ChildProcess[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of agentProcesses.splice(0)) child.kill();
  for (const raw of rawPeers.splice(0)) raw.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

// ---------------------------------------------------------------------------------------------

async function catalogRoom(body: Record<string, unknown> = { approvalRequired: false }) {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const room = await createRoom(relay.base, body);
  const entry = () => {
    const found = relay.server.rooms.get(room.id);
    if (!found) throw new Error("room is gone");
    return found;
  };
  return { relay, room, entry };
}

/** A raw provider that registers `tools` and answers every tools/call it reads with `result(id)`. */
async function rawProvider(relay: Relay, room: RoomDescriptor, result: (id: unknown) => unknown = () => ({ content: [{ type: "text", text: "ok" }] })) {
  const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, rawPeers);
  const called: unknown[] = [];
  provider.onMessage((message) => {
    if (message.type !== "mcp" || message.message?.method !== "tools/call") return;
    called.push(message.message.id);
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: message.message.id, result: result(message.message.id) } });
  });
  provider.send({ type: "register", tools: [tool("echo")] });
  await until(() => relay.server.rooms.get(room.id)?.cachedTools, Boolean, "registered catalog");
  return { provider, called };
}

const call = (id: number | string, args: Record<string, unknown> = {}) => ({
  type: "mcp",
  message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: args } },
});

function postMcp(relay: Relay, room: RoomDescriptor, joined: JoinedSession, body: unknown): Promise<Response> {
  return postJson(`${relay.base}/p/${room.id}/mcp`, body, { authorization: `Bearer ${joined.clientToken}` });
}

/** The `type` of a frame the relay sends. */
const frameType = (value: unknown): unknown => (typeof value === "object" && value !== null && "type" in value ? value.type : undefined);

/**
 * Makes `socket.send` report a full outbound queue (`busy`, nothing sent) for frames whose type is
 * in `types` while `refusing()` holds; every other frame is sent as usual.
 */
function refuseSends(socket: PeerSocket, types: readonly string[], refusing: () => boolean): void {
  const send = socket.send;
  vi.spyOn(socket, "send").mockImplementation((value: unknown): PeerSendResult => {
    const type = frameType(value);
    return refusing() && typeof type === "string" && types.includes(type) ? "busy" : send(value);
  });
}

describe("a provider whose outbound queue is full", { timeout: 30_000 }, () => {
  it("answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { provider, called } = await rawProvider(relay, room);
    const providerSocket = entry().providerSocket;
    expect(providerSocket).toBeDefined();
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const answers = (pick: (message: Frame) => boolean) =>
      agent.frames.filter((frame) => frame.type === "mcp" && typeof frame.message?.id === "number" && pick(frame.message));

    // The provider stops reading, like a tab busy with a synchronous tool. The agent stays inside
    // every limit: each request is under 256 KiB and fewer than 64 are waiting.
    provider.pause();
    const count = 60;
    expect(count).toBeLessThan(MAX_PENDING_PER_SOCKET);
    const blob = "x".repeat(200_000);
    for (let id = 1; id <= count; id++) agent.send(call(id, { blob }));
    // Each request either waits for the provider (it was queued for it) or was refused.
    await until(() => answers(() => true).length + entry().mcpPending.size, (total) => total === count, "every request queued or refused");
    const refused = answers(() => true);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.map((frame) => frame.message.error)).toEqual(refused.map(() => PROVIDER_BUSY));
    const queued = entry().mcpPending.size;
    expect(queued).toBeGreaterThan(0);

    // An HTTP agent gets the same refusal, with Retry-After; its request is at least as large as
    // the refused WebSocket ones, so it cannot fit the queue either.
    const http = await postMcp(relay, room, joined, { jsonrpc: "2.0", id: "http-1", method: "tools/call", params: { name: "echo", arguments: { blob: "h".repeat(240_000) } } });
    expect(http.status).toBe(503);
    expect(http.headers.get("retry-after")).toBe("1");
    expect(await http.json()).toEqual({ jsonrpc: "2.0", id: "http-1", error: PROVIDER_BUSY });

    // The provider was never closed or detached: no request failed with PROVIDER_DISCONNECTED or
    // PROVIDER_UNAVAILABLE, and the room still reports it.
    expect(entry().providerSocket).toBe(providerSocket);
    expect(entry().mcpPending.size).toBe(queued);
    const descriptor = (await (await fetch(`${relay.base}/p/${room.id}/mcp`)).json()) as { providerConnected: boolean };
    expect(descriptor.providerConnected).toBe(true);

    // Once the provider reads again it gets every queued request, and their results reach the agent.
    provider.resume();
    await until(() => called.length, (length) => length === queued, "the provider answers every queued request");
    await until(() => answers((message) => message.result !== undefined).length, (length) => length === queued, "results of the queued requests");
    expect(entry().mcpPending.size).toBe(0);

    // New requests go through again, over both transports.
    agent.send(call(1000));
    expect((await agent.waitFor((frame) => frame.message?.id === 1000, "a request after the provider caught up", 10_000)).message.result).toEqual({ content: [{ type: "text", text: "ok" }] });
    const again = await postMcp(relay, room, joined, { jsonrpc: "2.0", id: "http-2", method: "tools/call", params: { name: "echo", arguments: {} } });
    expect(again.status).toBe(200);
    expect(((await again.json()) as Frame).result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(entry().providerSocket).toBe(providerSocket);
    expect(provider.closeCode).toBeUndefined();
  });

  it("drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider", async () => {
    const { relay, room, entry } = await catalogRoom();
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    const providerSocket = entry().providerSocket!;
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    let full = true;
    refuseSends(providerSocket, ["mcp", "offer"], () => full);

    // A notification has no reply: it is dropped, over WebSocket; HTTP answers 503 PROVIDER_BUSY.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } } });
    const notification = await postMcp(relay, room, joined, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } });
    expect(notification.status).toBe(503);
    expect(notification.headers.get("retry-after")).toBe("1");
    expect(await notification.json()).toEqual({ jsonrpc: "2.0", id: null, error: PROVIDER_BUSY });

    // An offer waits for an answer: its sender is told under the offer's requestId.
    agent.send({ type: "offer", sdp: "v=0", requestId: "offer-1" });
    const refusal = await agent.waitFor((frame) => frame.type === "offer.refused", "offer refusal", 5000);
    expect(refusal).toEqual({ type: "offer.refused", requestId: "offer-1", error: PROVIDER_BUSY });

    await flush(agent, "agent socket still open");
    expect(entry().providerSocket).toBe(providerSocket);
    expect(provider.frames.filter((frame) => frame.type === "mcp" || frame.type === "offer")).toEqual([]);

    // With room in the queue again, both reach the provider.
    full = false;
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } } });
    agent.send({ type: "offer", sdp: "v=0", requestId: "offer-2" });
    await provider.waitFor((frame) => frame.type === "offer", "offer forwarded", 5000);
    expect(provider.frames.filter((frame) => frame.type === "mcp" || frame.type === "offer").map((frame) => frame.message?.params?.requestId ?? frame.requestId)).toEqual([3, "offer-2"]);
  });

  it("forwards an offer of exactly the request limit and refuses one byte more with REQUEST_TOO_LARGE", async () => {
    const { relay, room, entry } = await catalogRoom();
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    const providerSocket = entry().providerSocket!;
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    /** An offer whose frame is exactly `size` bytes as the agent sends it. */
    const offerOf = (size: number, requestId: string) => {
      const frame = { type: "offer", sdp: "", requestId };
      frame.sdp = "s".repeat(size - Buffer.byteLength(JSON.stringify(frame)));
      expect(Buffer.byteLength(JSON.stringify(frame))).toBe(size);
      return frame;
    };

    // One byte over the request limit (though well within the message limit): refused to its sender.
    agent.send(offerOf(REQUEST_LIMIT + 1, "big"));
    const refusal = await agent.waitFor((frame) => frame.type === "offer.refused", "offer refusal", 5000);
    expect(refusal).toEqual({ type: "offer.refused", requestId: "big", error: REQUEST_TOO_LARGE });

    // Exactly the request limit: forwarded with the relay's from/sessionId stamps, which fit the headroom.
    const edge = offerOf(REQUEST_LIMIT, "edge");
    agent.send(edge);
    const forwarded = await provider.waitFor((frame) => frame.type === "offer", "offer forwarded", 5000);
    expect(forwarded).toEqual({ ...edge, from: "client", sessionId: joined.sessionId });
    await flush(agent, "agent socket still open");
    await flush(provider, "provider socket still open");
    expect(provider.frames.filter((frame) => frame.type === "offer").map((frame) => frame.requestId)).toEqual(["edge"]);
    expect(agent.frames.filter((frame) => frame.type === "offer.refused").map((frame) => frame.requestId)).toEqual(["big"]);
    expect(entry().providerSocket).toBe(providerSocket);
  });

  it("sends a pending approval request the provider could not take on the agent's next call, and only once", async () => {
    const { relay, room, entry } = await catalogRoom({ approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    const providerSocket = entry().providerSocket!;
    const approvalRequests = () => provider.frames.filter((frame) => frame.type === "approval.request");
    let full = true;
    refuseSends(providerSocket, ["approval.request"], () => full);

    const joined = await joinRoom(relay.base, room);
    expect(joined.state).toBe("pending-approval");
    const ping = (id: number) => postMcp(relay, room, joined, { jsonrpc: "2.0", id, method: "ping" });
    const status = () =>
      fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } })
        .then((response) => response.json() as Promise<Frame>);
    // Refused while the queue is full: the provider stays attached and the request stays pending.
    expect((await ping(1)).status).toBe(200);
    expect((await status()).state).toBe("pending-approval");
    await flush(provider, "provider socket still open");
    expect(approvalRequests()).toEqual([]);
    expect(entry().providerSocket).toBe(providerSocket);

    // The agent's next status poll delivers it; later calls do not send it again.
    full = false;
    expect((await status()).state).toBe("pending-approval");
    const delivered = await provider.waitFor((frame) => frame.type === "approval.request", "approval request", 5000);
    expect(delivered).toMatchObject({ requestId: joined.approvalRequestId, sessionId: joined.sessionId });
    for (let id = 2; id < 12; id++) {
      expect((await ping(id)).status).toBe(200);
      await status();
    }
    await flush(provider, "every call processed");
    expect(approvalRequests()).toHaveLength(1);
  });
});

/**
 * An agent in a process of its own, so it reads on its own event loop as a real one does: Node's
 * built-in WebSocket client. Once ready it pipelines `count` tools/call requests, keeps its event
 * loop busy for `busyMs` (a browser main thread running other work), then reads. It prints one JSON
 * line: the id (or error message) of every reply in arrival order, and the close code if the relay
 * closed it first (null if not).
 */
const AGENT_PROCESS = `
const [url, token, countText, busyText] = process.argv.slice(1);
const count = Number(countText);
const busyMs = Number(busyText);
const replies = [];
const report = (closeCode) => {
  process.stdout.write(JSON.stringify({ replies, closeCode }) + "\\n");
  process.exit(0);
};
const ws = new WebSocket(url, ["webmcp-peer.v1", "ticket." + token]);
ws.onmessage = (event) => {
  const frame = JSON.parse(String(event.data));
  if (frame.type === "ready") {
    for (let id = 1; id <= count; id++) {
      ws.send(JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: {} } } }));
    }
    const until = Date.now() + busyMs;
    while (Date.now() < until) {}
    return;
  }
  if (frame.type === "mcp" && frame.message && frame.message.id !== undefined) {
    replies.push(frame.message.error ? frame.message.error.message : frame.message.id);
    if (replies.length === count) report(null);
  }
};
ws.onclose = (event) => report(event.code);
`;

interface AgentProcessReport {
  replies: unknown[];
  closeCode: number | null;
}

/** Validates the report line an {@link AGENT_PROCESS} prints. */
function parseAgentProcessReport(value: unknown): AgentProcessReport {
  if (typeof value !== "object" || value === null || !("replies" in value) || !("closeCode" in value)) {
    throw new TypeError("not an agent process report");
  }
  const { replies, closeCode } = value;
  if (!Array.isArray(replies) || (closeCode !== null && typeof closeCode !== "number")) {
    throw new TypeError("not an agent process report");
  }
  return { replies, closeCode };
}

/** Runs an {@link AGENT_PROCESS} against the client socket `url` and resolves to its report. */
function runAgentProcess(url: string, clientToken: string, count: number, busyMs: number): Promise<AgentProcessReport> {
  const child = spawn(process.execPath, ["--input-type=module", "-e", AGENT_PROCESS, url, clientToken, String(count), String(busyMs)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  agentProcesses.push(child);
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      try {
        if (code !== 0) throw new Error(`the agent process exited with ${code}`);
        resolve(parseAgentProcessReport(JSON.parse(output)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("an agent whose outbound queue is full", { timeout: 60_000 }, () => {
  /** The ids of the tools/call results among `messages`, in arrival order. */
  const resultIds = (messages: readonly Frame[]): unknown[] =>
    messages.filter((message) => message.type === "mcp" && message.message?.result !== undefined).map((message) => message.message.id);
  const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);
  /** A tools/call result of about `bytes` bytes that names the call it answers. */
  const sizedResult = (bytes: number) => (id: unknown) => ({ content: [{ type: "text", text: `${String(id)}:${"r".repeat(bytes)}` }] });
  /** Records what `socket.send` reported for every frame the relay gave it. */
  const recordSends = (socket: PeerSocket) => {
    const sends: Array<{ frame: Frame; sent: PeerSendResult }> = [];
    const send = socket.send;
    vi.spyOn(socket, "send").mockImplementation((value: unknown): PeerSendResult => {
      const sent = send(value);
      sends.push({ frame: PeerFrameSchema.parse(value), sent });
      return sent;
    });
    return sends;
  };
  const pendingOf = (entry: () => { mcpPending: Map<string, { socket: PeerSocket }> }, socket: PeerSocket) =>
    [...entry().mcpPending.values()].filter((pending) => pending.socket === socket);
  /**
   * The replies an agent that does not read asks for in the tests below: 60 calls (within the
   * pending cap) with results of about 240 KB (within the message limit), about 14 MB, more than a
   * loopback connection's kernel buffers (up to 8 MiB on macOS) and the relay's 1 MiB outbound
   * queue take together, so replies are left waiting for the agent however large those buffers grow.
   */
  const UNREAD_CALLS = 60;
  const UNREAD_RESULT_BYTES = 240_000;
  /** Waits until `read()` has not changed for `quietMs`: the relay has stopped making progress. */
  const untilSettled = async (read: () => number, label: string, quietMs = 300): Promise<void> => {
    let value = read();
    let since = Date.now();
    await until(() => {
      const next = read();
      if (next !== value) {
        value = next;
        since = Date.now();
      }
      return Date.now() - since >= quietMs;
    }, Boolean, label, 30_000);
  };

  it("delivers every reply, in order, to a reading agent that pipelines 40 calls with 200 KB results", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { provider } = await rawProvider(relay, room, sizedResult(200_000));
    const providerSocket = entry().providerSocket;
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);

    // About 8 MB of replies the agent asked for, within every cap (40 calls, each result under the
    // message limit), from a provider that answers as fast as it reads: far more than the agent's
    // 1 MiB outbound queue holds at once.
    const count = 40;
    expect(count).toBeLessThan(MAX_PENDING_PER_SOCKET);
    for (let id = 1; id <= count; id++) agent.send(call(id));
    await until(() => resultIds(agent.frames).length, (length) => length === count, "every reply", 30_000);
    expect(resultIds(agent.frames)).toEqual(ids(count));
    expect(agent.ws.readyState).toBe(WebSocket.OPEN);
    expect(entry().providerSocket).toBe(providerSocket);
    expect(provider.closeCode).toBeUndefined();
  });

  it("delivers every reply to an agent in its own process that pipelines 40 calls and is busy for 200 ms", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { provider } = await rawProvider(relay, room, sizedResult(200_000));
    const providerSocket = entry().providerSocket;
    const joined = await joinRoom(relay.base, room);
    // While the agent's event loop is busy its socket is not read, and the provider's replies
    // (about 8 MB) arrive meanwhile.
    const report = await runAgentProcess(`${relay.wsBase}/p/${room.id}/client`, joined.clientToken, 40, 200);
    expect(report).toEqual({ replies: ids(40), closeCode: null });
    expect(entry().providerSocket).toBe(providerSocket);
    expect(provider.closeCode).toBeUndefined();
  });

  it("keeps an agent that falls behind on the replies it asked for, reads nothing more from it meanwhile, and delivers them all in order once it reads", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { provider, called } = await rawProvider(relay, room, sizedResult(UNREAD_RESULT_BYTES));
    const providerSocket = entry().providerSocket;
    const joined = await joinRoom(relay.base, room);
    const slow = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const slowSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(slowSocket);
    const other = await openClient(relay, room, joined, sockets);

    // The agent stops reading (a busy main thread) with its calls out.
    slow.pause();
    const count = UNREAD_CALLS;
    expect(count + 2).toBeLessThanOrEqual(MAX_PENDING_PER_SOCKET);
    for (let id = 1; id <= count; id++) slow.send(call(id));
    await until(() => called.length, (length) => length === count, "the provider answers every call");
    await until(() => pendingOf(entry, slowSocket).length, (length) => length === 0, "the relay has every reply");
    // Its outbound queue did fill: the relay was refused at least one reply.
    expect(sends.some(({ sent }) => sent === "busy")).toBe(true);

    // The agent keeps its socket; the provider and the room's other agents are untouched.
    expect(entry().clientSockets.has(slowSocket)).toBe(true);
    expect(entry().providerSocket).toBe(providerSocket);
    other.send(call("other-1"));
    expect((await other.waitFor((frame) => frame.message?.id === "other-1", "the other agent's call")).message.result).toBeDefined();

    // Calls the agent sends while its replies wait are not read yet: they reach the provider only
    // once the agent has caught up.
    slow.send(call(count + 1));
    slow.send(call(count + 2));
    await new Promise((resolve) => setTimeout(resolve, 200));
    other.send(call("other-2"));
    await other.waitFor((frame) => frame.message?.id === "other-2", "the other agent's second call");
    expect(called).not.toContain(count + 1);
    expect(called).not.toContain(count + 2);

    // Once it reads, it gets every reply it asked for, in order, then the later calls are served.
    slow.resume();
    await until(() => resultIds(slow.messages).length, (length) => length === count + 2, "every reply", 30_000);
    expect(resultIds(slow.messages)).toEqual(ids(count + 2));
    expect(slow.messages.some((message) => message.type === "mcp" && message.message?.error !== undefined)).toBe(false);
    expect(slow.closeCode).toBeUndefined();
    expect(entry().clientSockets.has(slowSocket)).toBe(true);
    expect(provider.closeCode).toBeUndefined();
  });

  it("sends an agent that is behind its approval, then ready, after the replies queued before them", async () => {
    const { relay, room, entry } = await catalogRoom({ approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const agentSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(agentSocket);

    // A pending agent that stops reading and keeps calling: every call is answered
    // CLIENT_APPROVAL_REQUIRED (about 230 bytes each, some 23 MB for all of them), until the
    // answers wait for the agent and the relay reads no more of its calls.
    agent.pause();
    const calls = 100_000;
    for (let id = 1; id <= calls; id++) agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: {} } });
    await untilSettled(() => sends.length, "the relay stops answering the agent");
    expect(sends.at(-1)?.sent).toBe("busy");
    expect(sends.length).toBeLessThan(calls);

    const decided = await postJson(
      `${relay.base}/p/${room.id}/approval/${joined.approvalRequestId}`,
      { sessionId: joined.sessionId, roomId: room.id, roomEpoch: room.roomEpoch, decision: "approved" },
      { authorization: `Bearer ${room.providerToken}` },
    );
    expect(decided.status).toBe(200);
    // Both wait behind the answers queued before them; the socket stays open.
    expect(sends.some(({ frame }) => frame.type === "approval.approved")).toBe(false);
    expect(entry().clientSockets.has(agentSocket)).toBe(true);

    agent.resume();
    await agent.waitFor((message) => message.type === "ready" && message.approval === "approved", "ready after the approval", 30_000);
    const index = (predicate: (message: Frame) => boolean) => agent.messages.findIndex(predicate);
    const lastRefusal = agent.messages.map((message) => message.message?.error?.message).lastIndexOf("CLIENT_APPROVAL_REQUIRED");
    const approved = index((message) => message.type === "approval.approved");
    const ready = index((message) => message.type === "ready" && message.approval === "approved");
    expect(lastRefusal).toBeGreaterThan(0);
    expect(approved).toBeGreaterThan(lastRefusal);
    expect(ready).toBe(approved + 1);
    expect(agent.closeCode).toBeUndefined();
  });

  it("holds one catalog listing for an agent waiting for approval that does not read, however many one read asks for, and delivers every listing in order once it reads", async () => {
    // A catalog of about 200 KB, which the relay lists itself for a ticket waiting for approval.
    const tools = Array.from({ length: 100 }, (_, index) => ({ ...tool(`tool_${index}`), description: "d".repeat(2_000) }));
    const relay = await startRelay(servers, { deploymentCatalog: { tools } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const agentSocket = [...relay.server.rooms.get(room.id)!.clientSockets].at(-1)!;
    const sends = recordSends(agentSocket);
    const relayInternals = relay.server as unknown as { answerAgentMetadata: (...args: unknown[]) => boolean };
    const answered = vi.spyOn(relayInternals, "answerAgentMetadata");

    // An agent that never reads asks, in one write, for some 60 MB of listings: far more than the
    // kernel buffers and the relay's outbound queue take.
    agent.pause();
    const count = 300;
    agent.sendAll(Array.from({ length: count }, (_, index) => ({ type: "mcp", message: { jsonrpc: "2.0", id: index + 1, method: "tools/list" } })));
    await untilSettled(() => answered.mock.calls.length, "the relay stops answering the agent");
    // The relay answered until one listing had to wait, and then handled nothing more of the read:
    // every listing it made but that one went out.
    expect(sends.some(({ sent }) => sent === "busy")).toBe(true);
    expect(answered.mock.calls.length).toBeLessThan(count);
    expect(answered.mock.calls.length).toBe(sends.filter(({ sent }) => sent === "sent").length + 1);

    agent.resume();
    const listings = () => agent.messages.filter((message) => message.type === "mcp" && message.message?.result?.tools);
    await until(() => listings().length, (length) => length === count, "every listing", 30_000);
    expect(listings().map((message) => message.message.id)).toEqual(ids(count));
    expect(listings().every((message) => message.message.result.tools.length === tools.length)).toBe(true);
    expect(agent.closeCode).toBeUndefined();
  });

  it("lists the one frozen catalog it holds in every reply instead of a copy of its own", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("deployed")] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const entry = relay.server.rooms.get(room.id)!;
    // A room starts with the deployment catalog itself; a catalog its provider registers is frozen.
    expect(entry.cachedTools).toBe(relay.server.deploymentCatalog.tools);
    const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, rawPeers);
    provider.send({ type: "register", tools: [tool("echo")] });
    await until(() => entry.catalogVersion, (version) => version === 2, "registered catalog");
    const held = entry.cachedTools as Array<{ inputSchema: object }>;
    expect(Object.isFrozen(held)).toBe(true);
    expect(Object.isFrozen(held[0]!.inputSchema)).toBe(true);

    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const copies = vi.spyOn(globalThis, "structuredClone");
    for (const [id, method] of [[1, "tools/list"], [2, "server/discover"], [3, "initialize"]] as const) {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, method } });
      const reply = await agent.waitFor((message) => message.type === "mcp" && message.message?.id === id, `${method} reply`);
      expect(reply.message.result.tools).toEqual([tool("echo")]);
    }
    const response = await postMcp(relay, room, joined, { jsonrpc: "2.0", id: 4, method: "tools/list" });
    expect(((await response.json()) as Frame).result.tools).toEqual([tool("echo")]);
    expect(copies).not.toHaveBeenCalled();
  });

  it("offers the oldest waiting reply again while the agent reads nothing, so the codec's stall close stays armed", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { called } = await rawProvider(relay, room, sizedResult(UNREAD_RESULT_BYTES));
    const joined = await joinRoom(relay.base, room);
    const slow = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const slowSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(slowSocket);

    slow.pause();
    for (let id = 1; id <= UNREAD_CALLS; id++) slow.send(call(id));
    await until(() => called.length, (length) => length === UNREAD_CALLS, "the provider answers every call");
    await until(() => pendingOf(entry, slowSocket).length, (length) => length === 0, "the relay has every reply");
    await untilSettled(() => sends.filter(({ sent }) => sent === "sent").length, "the agent's queue stays full");

    // A queued write that completes ends the codec's wait, and only a refused frame starts a new
    // one: the oldest waiting reply is refused again and again while the agent reads nothing.
    const refusals = () => sends.filter(({ sent }) => sent === "busy");
    const before = refusals().length;
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const retried = refusals().slice(before);
    expect(retried.length).toBeGreaterThanOrEqual(2);
    expect(new Set(retried.map(({ frame }) => frame.message?.id)).size).toBe(1);
    expect(entry().clientSockets.has(slowSocket)).toBe(true);

    // The retries change nothing for an agent that reads again.
    slow.resume();
    await until(() => resultIds(slow.messages).length, (length) => length === UNREAD_CALLS, "every reply", 30_000);
    expect(resultIds(slow.messages)).toEqual(ids(UNREAD_CALLS));
    expect(slow.closeCode).toBeUndefined();
  });

  it("drops the replies waiting for an agent that goes away, and keeps the room serving", async () => {
    const { relay, room, entry } = await catalogRoom();
    const { provider, called } = await rawProvider(relay, room, sizedResult(UNREAD_RESULT_BYTES));
    const providerSocket = entry().providerSocket;
    const joined = await joinRoom(relay.base, room);
    const slow = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const slowSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(slowSocket);

    slow.pause();
    for (let id = 1; id <= UNREAD_CALLS; id++) slow.send(call(id));
    await until(() => called.length, (length) => length === UNREAD_CALLS, "the provider answers every call");
    await until(() => pendingOf(entry, slowSocket).length, (length) => length === 0, "the relay has every reply");
    expect(sends.some(({ sent }) => sent === "busy")).toBe(true);

    slow.destroy();
    await until(() => entry().clientSockets.has(slowSocket), (attached) => !attached, "the agent is dropped");
    expect(entry().providerSocket).toBe(providerSocket);
    const next = await openClient(relay, room, joined, sockets);
    next.send(call("next"));
    expect((await next.waitFor((frame) => frame.message?.id === "next", "a call from a new agent socket")).message.result).toBeDefined();
    expect(provider.closeCode).toBeUndefined();
  });

  it.each([
    ["its own revoke", "session.revoked", 200, (relay: Relay, room: RoomDescriptor, joined: JoinedSession) =>
      postJson(`${relay.base}/p/${room.id}/session/revoke`, {}, { authorization: `Bearer ${joined.clientToken}` })],
    ["the room's rotation", "room.rotated", 201, (relay: Relay, room: RoomDescriptor) =>
      postJson(`${relay.base}/p/${room.id}/rotate`, {}, { authorization: `Bearer ${room.providerToken}` })],
  ] as const)("ends the session of an agent that is behind on %s after the replies it asked for, then closes it", async (_label, endFrame, status, end) => {
    const { relay, room, entry } = await catalogRoom();
    const { called } = await rawProvider(relay, room, sizedResult(UNREAD_RESULT_BYTES));
    const joined = await joinRoom(relay.base, room);
    const slow = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const slowSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(slowSocket);

    // The agent stops reading with every reply it asked for (calls that ran) still to come.
    slow.pause();
    for (let id = 1; id <= UNREAD_CALLS; id++) slow.send(call(id));
    await until(() => called.length, (length) => length === UNREAD_CALLS, "the provider answers every call");
    await until(() => pendingOf(entry, slowSocket).length, (length) => length === 0, "the relay has every reply");
    expect(sends.some(({ sent }) => sent === "busy")).toBe(true);

    // The session ends meanwhile: the agent is out of the room at once.
    expect((await end(relay, room, joined)).status).toBe(status);
    expect(entry().clientSockets.has(slowSocket)).toBe(false);

    // Once it reads it gets every reply, then the frame that ends its session, then the close.
    slow.resume();
    await until(() => slow.closeCode, (code) => code !== undefined, "the close", 30_000);
    expect(slow.closeCode).toBe(1000);
    expect(resultIds(slow.messages)).toEqual(ids(UNREAD_CALLS));
    expect(slow.messages.at(-1)).toMatchObject({ type: endFrame, sessionId: joined.sessionId });
    expect(slow.messages.filter((message) => message.type === endFrame)).toHaveLength(1);
  });

  it("expires the approval of an agent that is behind after the answers it asked for, then closes it", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("echo")] }, approvalTimeoutMs: 1000 });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready");
    const joined = await joinRoom(relay.base, room);
    const agent = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    await agent.waitFor((message) => message.type === "approval.pending", "approval pending");
    const entry = relay.server.rooms.get(room.id)!;
    const agentSocket = [...entry.clientSockets].at(-1)!;
    let full = true;
    refuseSends(agentSocket, ["mcp", "approval.expired"], () => full);

    // A pending agent's discovery is the relay's to answer; its queue is full, so the answer waits.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "listing", method: "tools/list", params: {} } });
    await provider.waitFor((frame) => frame.type === "approval.expired", "the approval request expires", 5000);
    expect(entry.clientSockets.has(agentSocket)).toBe(false);
    expect(agent.closeCode).toBeUndefined();

    // Once its queue takes them: the answer, then approval.expired, then the close.
    full = false;
    await until(() => agent.closeCode, (code) => code !== undefined, "the close", 10_000);
    expect(agent.closeCode).toBe(1000);
    const after = agent.messages.slice(agent.messages.findIndex((message) => message.type === "approval.pending") + 1);
    expect(after.map((message) => message.type)).toEqual(["mcp", "approval.expired"]);
    expect(after[0]!.message).toMatchObject({ id: "listing", result: { tools: [tool("echo")] } });
    expect(after[1]).toMatchObject({ sessionId: joined.sessionId, reason: "APPROVAL_EXPIRED" });
  });

  it("skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for", async () => {
    const { relay, room, entry } = await catalogRoom();
    const provider = await RawPeer.open(relay, `/p/${room.id}/provider`, room.providerToken, rawPeers);
    const calls: Frame[] = [];
    provider.onMessage((message) => {
      if (message.type === "mcp" && message.message?.method === "tools/call") calls.push(message);
    });
    provider.send({ type: "register", tools: [tool("echo")] });
    await until(() => entry().catalogVersion, (version) => version === 1, "registered catalog");
    const joined = await joinRoom(relay.base, room);
    const idle = await RawPeer.open(relay, `/p/${room.id}/client`, joined.clientToken, rawPeers);
    const idleSocket = [...entry().clientSockets].at(-1)!;
    const sends = recordSends(idleSocket);
    const reading = await openClient(relay, room, joined, sockets);

    // The agent asks for one call, which the provider holds, and stops reading.
    idle.send(call("asked"));
    await until(() => calls.length, (length) => length === 1, "the provider has the call");
    idle.pause();

    // Meanwhile the provider publishes 7 distinct catalogs of about 200 KB each, as many as the
    // relay evaluates at once besides the first (each is announced to every agent), and sends 53
    // notifications of the same size, which the relay passes on to every agent it serves the same
    // way: 12 MB, more than the agent's kernel buffers take. Then it answers the call with a 250 KB
    // result: more than the room a frame that did not fit leaves.
    const catalogs = 7;
    const notifications = 53;
    for (let version = 1; version <= catalogs; version++) {
      provider.send({ type: "register", tools: [{ ...tool(`t${version}`), description: "d".repeat(200_000) }] });
    }
    await until(() => entry().catalogVersion, (version) => version === catalogs + 1, "every catalog accepted");
    for (let index = 1; index <= notifications; index++) {
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "n".repeat(200_000), index } } });
    }
    // The relay has handled every frame the provider sent before its ping once it answers it.
    provider.send({ type: "ping" });
    await provider.waitFor((message) => message.type === "pong", "every notification handled");
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: "asked", result: sizedResult(250_000)("asked") } });
    await until(() => entry().mcpPending.size, (size) => size === 0, "the relay has the reply");

    // The announcements and notifications stopped while they still left the queue room for a reply
    // of the full limit: the rest were skipped for this agent, and the reply went straight into the
    // queue.
    const unasked = (frame: Frame) => frame.type === "register" || frame.message?.method === "notifications/message";
    const announced = sends.filter(({ frame }) => unasked(frame));
    expect(announced.length).toBeGreaterThan(0);
    expect(announced.length).toBeLessThan(catalogs + notifications);
    expect(announced.every(({ sent }) => sent === "sent")).toBe(true);
    expect(sends.filter(({ frame }) => frame.message?.id === "asked").map(({ sent }) => sent)).toEqual(["sent"]);
    expect(entry().clientSockets.has(idleSocket)).toBe(true);
    await flush(reading, "the reading agent still attached");
    expect(reading.frames.some((frame) => frame.type === "register")).toBe(true);
    expect(reading.frames.some((frame) => frame.message?.method === "notifications/message")).toBe(true);

    // Once it reads it gets what was queued for it, the reply included, and its socket works.
    idle.resume();
    await until(() => resultIds(idle.messages), (received) => received.length === 1, "the reply it asked for");
    expect(resultIds(idle.messages)).toEqual(["asked"]);
    expect(idle.messages.filter(unasked)).toHaveLength(announced.length);
    idle.send({ type: "ping" });
    await idle.waitFor((message) => message.type === "pong", "the idle agent's pong");
    expect(idle.closeCode).toBeUndefined();
    expect(entry().clientSockets.has(idleSocket)).toBe(true);
  });
});
