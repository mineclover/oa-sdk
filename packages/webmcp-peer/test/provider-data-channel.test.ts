// Regression tests for the provider's side of the WebRTC DataChannel handoff, a path this package
// implements only on the provider (no package agent offers yet):
//   - an offer is answered under its own requestId, which the DataChannel's grant and the relay
//     release repeat, so the relay routes both to the agent socket that offered; an offer without a
//     requestId is not answered, and the answer waits at most 2 s for ICE gathering;
//   - the framing is the same in both directions: the provider sends a frame in at most 512 chunks
//     of 2048 UTF-16 code units, the most an agent of the same framing assembles, replaces a reply
//     too large for that with RESULT_TOO_LARGE, and does not send any other frame that large;
//   - a request whose connection the host ended while the provider read it is neither run nor
//     answered, nor is one whose connection the host ended as the provider listed its catalog.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpPeerClient, type WebMcpCrdtTransport, type WebMcpHostAdapter, type WebMcpToolSummary } from "../src/provider.js";
import {
  AGENT_SESSION_ID,
  FakeDataChannel,
  FakeRelay,
  approve,
  flushMicrotasks,
  installRelay,
  relayStamp,
  until,
  type FakeRelaySocket,
  type Frame,
} from "./provider-fakes.js";

/** The most chunks of one DataChannel message, and the code units of each chunk the provider sends. */
const MAX_CHUNKS = 512;
const CHUNK_CHARS = 2048;
const FRAME_LIMIT = MAX_CHUNKS * CHUNK_CHARS;

const providers: WebMcpPeerClient[] = [];

afterEach(() => {
  for (const provider of providers.splice(0)) provider.disconnect();
  FakePeerConnection.instances.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A peer connection that applies an offer and answers it, and on which the agent opens a DataChannel. */
class FakePeerConnection {
  static readonly instances: FakePeerConnection[] = [];
  iceGatheringState = "complete";
  remoteDescription: { type: string; sdp?: string } | null = null;
  localDescription: { type: string; sdp?: string } | null = null;
  ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
  closed = false;
  constructor() {
    FakePeerConnection.instances.push(this);
  }
  async setRemoteDescription(description: { type: string; sdp?: string }): Promise<void> {
    this.remoteDescription = description;
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: `answer to ${this.remoteDescription?.sdp ?? "nothing"}` };
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

const readTool: WebMcpToolSummary = { name: "read", description: "read tool", inputSchema: { type: "object", properties: {} } };

/**
 * A provider on a FakeRelay whose agent is approved, with the relay's echo of the approval (which
 * prepares a peer connection, as on the relay). With `enableCrdt`, the room has the `mcp-crdt`
 * capability; `listTools` replaces the host adapter's listing of `tools`.
 */
async function approvedProvider(
  tools: WebMcpToolSummary[],
  invoke: WebMcpHostAdapter["invoke"] = async () => ({ ok: true }),
  options: { enableCrdt?: boolean; listTools?: () => WebMcpToolSummary[] } = {},
) {
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
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
  const host = new WebMcpPeerClient({
    hostAdapter: { listTools: options.listTools ?? (() => tools), invoke },
    shouldSuppressAutoReconnect: () => false,
  });
  providers.push(host);
  await host.connect({ serverUrl: relay.base, alias: "data-channel", ...(options.enableCrdt ? { enableCrdt: true } : {}) });
  await approve(host, relay.latest, relay.roomId);
  relay.latest.deliver({ type: "approval.approved", requestId: `approval-${AGENT_SESSION_ID}`, sessionId: AGENT_SESSION_ID });
  await flushMicrotasks();
  return { relay, host, socket: relay.latest };
}

/** The relay forwards an offer of the approved agent; resolves to the provider's answer. */
function offer(socket: FakeRelaySocket, requestId: string): Promise<Frame> {
  socket.deliver({ type: "offer", sdp: `v=0 ${requestId}`, requestId, ...relayStamp() });
  return until(() => socket.sent.find((frame) => frame.type === "answer" && frame.requestId === requestId), `the answer to ${requestId}`);
}

/** The agent opens the `mcp` DataChannel on the provider's peer connection and says hello. */
async function openChannel(): Promise<FakeDataChannel> {
  const peerConnection = FakePeerConnection.instances.at(-1);
  if (!peerConnection?.ondatachannel) throw new Error("the provider opened no peer connection");
  const channel = new FakeDataChannel();
  peerConnection.ondatachannel({ channel });
  channel.deliver({ type: "hello" });
  await until(() => channel.frames().find((frame) => frame.type === "grant"), "the grant");
  return channel;
}

describe("an offer the relay forwards", () => {
  it("is answered under its own requestId, which the DataChannel's grant and the relay release repeat", async () => {
    const { socket } = await approvedProvider([readTool]);
    expect(await offer(socket, "offer-7")).toEqual({ type: "answer", requestId: "offer-7", sdp: "answer to v=0 offer-7" });

    const channel = await openChannel();
    expect(channel.frames().find((frame) => frame.type === "grant")).toMatchObject({
      type: "grant",
      protocol: "webmcp-peer/1",
      requestId: "offer-7",
      sessionId: AGENT_SESSION_ID,
    });
    // The relay routes the release, as it did the answer, to the agent socket that offered.
    expect(socket.sent.filter((frame) => frame.type === "release")).toEqual([{ type: "release", requestId: "offer-7" }]);
  });

  it("is not answered without a requestId to answer it under", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { socket } = await approvedProvider([readTool]);
    for (const requestId of [undefined, "", 7]) {
      socket.deliver({ type: "offer", sdp: "v=0 anonymous", ...(requestId === undefined ? {} : { requestId }), ...relayStamp() });
    }
    await flushMicrotasks(20);
    expect(socket.sent.filter((frame) => frame.type === "answer")).toEqual([]);
    expect(FakePeerConnection.instances.some((peerConnection) => peerConnection.remoteDescription !== null)).toBe(false);

    expect(await offer(socket, "offer-8")).toMatchObject({ requestId: "offer-8" });
  });

  it("waits at most 2000 ms for ICE gathering before it answers", async () => {
    const { socket } = await approvedProvider([readTool]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The peer connection the relay's approval prepared never finishes gathering.
    FakePeerConnection.instances.at(-1)!.iceGatheringState = "gathering";
    socket.deliver({ type: "offer", sdp: "v=0 slow", requestId: "slow", ...relayStamp() });
    const answers = () => socket.sent.filter((frame) => frame.type === "answer");

    await vi.advanceTimersByTimeAsync(1999);
    expect(answers()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(answers()).toEqual([{ type: "answer", requestId: "slow", sdp: "answer to v=0 slow" }]);
  });
});

describe("DataChannel framing", () => {
  it(`sends a frame in at most ${MAX_CHUNKS} chunks of at most ${CHUNK_CHARS} code units, up to ${FRAME_LIMIT} code units`, async () => {
    // A result whose reply frame is a little under the limit.
    const text = "t".repeat(FRAME_LIMIT - 8_000);
    const { socket } = await approvedProvider([readTool], async () => ({ content: [{ type: "text", text }] }));
    await offer(socket, "offer-1");
    const channel = await openChannel();

    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: {} } } });
    const reply = await channel.replyTo(1);
    expect(reply.result).toMatchObject({ isError: false, content: [{ type: "text", text }] });
    const chunks = channel.chunks().filter((chunk) => chunk.id === channel.chunks().at(-1)!.id);
    expect(chunks.length).toBeGreaterThan(MAX_CHUNKS - 5);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(chunks.every((chunk) => chunk.total === chunks.length && chunk.data.length <= CHUNK_CHARS)).toBe(true);
  });

  it("answers a tools/call whose result the framing cannot carry with an isError RESULT_TOO_LARGE result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const invoked: string[] = [];
    const { socket } = await approvedProvider([readTool], async (name) => {
      invoked.push(name);
      return { content: [{ type: "text", text: "t".repeat(FRAME_LIMIT) }] };
    });
    await offer(socket, "offer-1");
    const channel = await openChannel();

    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: {} } } });
    const reply = await channel.replyTo(1);
    // The tool ran; only its result is lost.
    expect(invoked).toEqual(["read"]);
    expect(reply.result).toMatchObject({ isError: true, error: { code: "RESULT_TOO_LARGE" } });
    expect(String(reply.result?.content?.[0]?.text)).toMatch(new RegExp(`over the DataChannel's ${FRAME_LIMIT}-code-unit message limit`));
    expect(channel.chunks().every((chunk) => chunk.total <= MAX_CHUNKS && chunk.data.length <= CHUNK_CHARS)).toBe(true);
  });

  it("answers another request whose reply the framing cannot carry with the JSON-RPC RESULT_TOO_LARGE", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // A DataChannel agent is listed the live host catalog, here larger than the framing carries.
    const { socket } = await approvedProvider([{ ...readTool, description: "d".repeat(FRAME_LIMIT) }]);
    await offer(socket, "offer-1");
    const channel = await openChannel();

    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(await channel.replyTo(2)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32603, message: "RESULT_TOO_LARGE", data: { limitCodeUnits: FRAME_LIMIT } },
    });
  });

  it("does not send a frame other than a reply that the framing cannot carry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, socket } = await approvedProvider([readTool], undefined, { enableCrdt: true });
    expect(host.getSession().crdtCapability).toBe(true);
    await offer(socket, "offer-1");
    const channel = await openChannel();
    const sentBefore = channel.sent.length;

    // A CRDT carrier message too large to frame is not sent; one that fits is.
    await host.sendCrdt({ type: "crdt.update", documentId: "doc-1", update: "u".repeat(FRAME_LIMIT) });
    expect(channel.sent.length).toBe(sentBefore);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`DataChannel frame exceeds the ${FRAME_LIMIT}-code-unit message limit; it was not sent\\.$`)));
    await host.sendCrdt({ type: "crdt.update", documentId: "doc-1", update: "fits" });
    expect(channel.frames().filter((frame) => frame.type === "crdt")).toHaveLength(1);
  });
});

describe("a request of a connection that ended while the provider read it", () => {
  it("is neither run nor answered when the host ended the session as the agent's tools/call reached its CRDT transport", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const { host, socket } = await approvedProvider([readTool], invoke, { enableCrdt: true });
    await offer(socket, "offer-1");
    const channel = await openChannel();
    // A host transport that ends the session when it is next told of the agent: the provider tells it
    // of the agent of a DataChannel tools/call before it reads the request.
    let endOnNextAgent = false;
    const transport: WebMcpCrdtTransport = {
      documentId: "doc-1",
      attachCarrier: () => () => {},
      broadcastAwareness: () => {},
      receiveExternal: () => {},
      receiveVerified: () => {
        if (endOnNextAgent) {
          endOnNextAgent = false;
          host.disconnect();
        }
        return true;
      },
    };
    host.attachCrdtTransport(transport);
    // The channel stays open to the provider, so an answer the provider gives is recorded, not hidden by
    // the channel's close.
    channel.holdOpen();
    const sentBefore = channel.sent.length;

    endOnNextAgent = true;
    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read", arguments: {} } } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(endOnNextAgent).toBe(false);
    expect(host.getSession().state).toBe("idle");
    expect(invoke).not.toHaveBeenCalled();
    expect(channel.sent.slice(sentBefore)).toEqual([]);
  });
});

describe("a request of a connection the host ended before its answer was ready", () => {
  it.each(["tools/list", "server/discover"])("is not answered when the host's listTools ends the session as the provider lists the catalog for %s", async (method) => {
    // Ends the session once, from the host's listTools, after the test arms it.
    let endSession = false;
    const { host, socket } = await approvedProvider([readTool], undefined, {
      listTools: () => {
        if (endSession) {
          endSession = false;
          host.disconnect();
        }
        return [readTool];
      },
    });
    await offer(socket, "offer-1");
    const channel = await openChannel();
    // While the session lasts, the request is answered with the live host catalog.
    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method } });
    expect((await channel.replyTo(1)).result).toMatchObject({ tools: [{ name: "read" }] });
    // The channel stays open to the provider, so an answer the provider gives is recorded, not hidden by
    // the channel's close.
    channel.holdOpen();
    const sentBefore = channel.sent.length;

    endSession = true;
    channel.deliver({ type: "mcp", message: { jsonrpc: "2.0", id: 2, method } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(endSession).toBe(false);
    expect(host.getSession().state).toBe("idle");
    expect(channel.sent.slice(sentBefore)).toEqual([]);
  });
});
