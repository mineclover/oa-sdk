// Integration tests for the relay's single message limit (256 KiB of UTF-8 JSON per relay message,
// in both directions, whether a message travels as one WebSocket frame or fragmented):
//   - provider replies and catalogs between the old 128 KiB frame limit and 256 KiB get through,
//   - an oversized catalog is withheld by the provider (CATALOG_TOO_LARGE) or refused by the relay
//     (announcements over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES, echoing the frame's registerSeq), and
//     every catalog the relay accepts can be listed by a WebSocket agent,
//   - an agent is never handed a catalog the relay refused (it gets the relay's own catalog, or the
//     refusal), a WebSocket tools/list or server/discover the provider answers with an error gets
//     the relay's catalog as HTTP does, and only a whole listing can change the room catalog,
//   - oversized HTTP bodies get a delivered 413 / BODY_TOO_LARGE instead of a reset connection, and
//     state-changing endpoints never act on a body that was too large, aborted, malformed, or
//     consumed by a customHttpHandler, nor on room state that changed while the body arrived,
//   - every agent request within PEER_RELAY_MAX_REQUEST_BYTES (1 KiB under the message limit) is
//     forwarded, even stamped and under a rewritten duplicate id, and a larger one is refused on its
//     sender's socket (REQUEST_TOO_LARGE; HTTP 413); a provider reply the relay cannot forward gets
//     RESULT_TOO_LARGE; neither closes the receiving socket; a provider socket the relay already
//     closed gets PROVIDER_UNAVAILABLE and frees the room for a reclaim; a replaced provider socket
//     is closed, a socket whose client left during a customUpgradeHandler is never attached, and a
//     client that resets its connection meanwhile cannot crash the relay,
//   - what one agent can make the relay hold or send is bounded: request ids and offer requestIds
//     (1 KiB, since the answer repeats them), pending requests per socket (64), client sockets per
//     ticket (4), no re-announced catalogs, one approval request per provider socket, and
//     clientLabels of at most 256 code points,
//   - every mcp frame forwarded to the provider carries the relay's from/sessionId stamps,
//   - inbound frames are limited with RFC 6455 close codes (1009, 1003, 1002, 1000),
//   - the agent client refuses an oversized request before sending it.
import { randomBytes } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PeerMcpError,
  PeerMcpSession,
  joinPeerRoom,
  waitForPeerApproval,
  type JoinedPeerRoom,
} from "../src/client.js";
import {
  MCP_INITIALIZE_PROTOCOL_VERSIONS,
  WebMcpPeerClient,
  toWireToolDescriptor,
  type WebMcpHostAdapter,
  type WebMcpToolSummary,
} from "../src/provider.js";
import { PEER_RELAY_MAX_ANNOUNCEMENT_BYTES, WEBMCP_CLOSE_CODES } from "../src/config.js";
import { MAX_WEBSOCKET_MESSAGE_BYTES, WebMcpPeerServer, type PeerSocket, type RoomEntry } from "../src/server.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  openProvider,
  openRecordingSocket,
  postJson,
  settleWithin,
  startRelay,
  tool,
  until,
  type Frame,
  type RecordingSocket,
  type Relay,
  type RoomDescriptor,
} from "./server-test-helpers.js";

/** The relay message limit (PEER_RELAY_MAX_MESSAGE_BYTES). */
const LIMIT = 256 * 1024;
/** The relay's single-frame limit before this change, and its outbound fragment size. */
const OLD_FRAME_LIMIT = 128 * 1024;
/** The largest request an agent may send (PEER_RELAY_MAX_REQUEST_BYTES): room for the relay's stamps and wire id. */
const REQUEST_LIMIT = LIMIT - 1024;
const REQUEST_TOO_LARGE = { code: -32600, message: "REQUEST_TOO_LARGE", data: { limitBytes: REQUEST_LIMIT } };
const RESULT_TOO_LARGE = { code: -32603, message: "RESULT_TOO_LARGE", data: { limitBytes: LIMIT } };
const PROVIDER_UNAVAILABLE = { code: -32001, message: "PROVIDER_UNAVAILABLE" };
/** The largest catalog announcement the relay accepts (PEER_RELAY_MAX_ANNOUNCEMENT_BYTES). */
const ANNOUNCEMENT_LIMIT = LIMIT - 2 * 1024;
/** The largest JSON-RPC request id the relay accepts, in bytes of its JSON text. */
const MAX_ID_BYTES = 1024;
/** A string id whose JSON text is exactly `size` bytes (its quotes included). */
const idOfJsonBytes = (size: number) => "i".repeat(size - 2);
const REQUEST_ID_TOO_LARGE = { code: -32600, message: "REQUEST_ID_TOO_LARGE", data: { limitBytes: MAX_ID_BYTES } };
/** The most requests one agent socket may have waiting for the provider. */
const MAX_PENDING_PER_SOCKET = 64;
/** The most client sockets one ticket holds open. */
const MAX_SOCKETS_PER_TICKET = 4;

const servers: WebMcpPeerServer[] = [];
const providers: WebMcpPeerClient[] = [];
const sockets: WebSocket[] = [];
const rawSockets: RawWebSocket[] = [];
const sessions: PeerMcpSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect().catch(() => {});
  for (const raw of rawSockets.splice(0)) raw.destroy();
  for (const socket of sockets.splice(0)) socket.close();
  for (const provider of providers.splice(0)) provider.disconnect();
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

/** A compact JSON text of exactly `size` UTF-8 bytes, padded through the string `build` receives. */
function sized(size: number, build: (pad: string) => unknown): string {
  const padBytes = size - bytes(build(""));
  if (padBytes < 0) throw new Error(`cannot build a ${size}-byte message`);
  const text = JSON.stringify(build("p".repeat(padBytes)));
  expect(bytes(text)).toBe(size);
  return text;
}

/** Records every frame the relay sends on `socket` (a provider socket) as the JSON text it writes. */
function recordSent(socket: PeerSocket): string[] {
  const sent: string[] = [];
  const send = socket.send;
  vi.spyOn(socket, "send").mockImplementation((value: unknown) => {
    sent.push(typeof value === "string" ? value : JSON.stringify(value));
    return send(value);
  });
  return sent;
}

/** The forwarded `mcp` frames among the `recordSent` texts, parsed. */
const sentMcp = (sent: string[]): Frame[] => sent.map((text) => JSON.parse(text) as Frame).filter((frame) => frame.type === "mcp");

const descriptorTool = (name: string, description: string): WebMcpToolSummary => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
});

// ---------------------------------------------------------------------------------------------
// A relay with a real WebMcpPeerClient provider and one approved agent ticket.
// ---------------------------------------------------------------------------------------------

interface HttpReply {
  status: number;
  /** The JSON body, or null for an empty one (a notification's 202 under Streamable HTTP). */
  body: Record<string, any> | null;
}

interface ProviderRig {
  relay: Relay;
  serverUrl: string;
  provider: WebMcpPeerClient;
  roomId: string;
  joined: JoinedPeerRoom;
  /** Provider session states observed after the agent was approved. */
  states: string[];
  room(): NonNullable<ReturnType<WebMcpPeerServer["rooms"]["get"]>>;
  /** tools/call over Streamable HTTP with the agent's client ticket. */
  call(id: number | string, name: string, args?: Record<string, unknown>): Promise<HttpReply>;
  /** A connected PeerMcpSession over the relay's client WebSocket. */
  wsSession(options?: { WebSocket?: unknown }): Promise<PeerMcpSession>;
}

async function postMcp(serverUrl: string, roomId: string, token: string, body: string): Promise<HttpReply> {
  const response = await fetch(`${serverUrl}/p/${roomId}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body,
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

async function approveAgent(provider: WebMcpPeerClient, joined: JoinedPeerRoom): Promise<void> {
  let unsubscribe: (() => void) | undefined;
  await new Promise<void>((resolve) => {
    let approved = false;
    unsubscribe = provider.subscribe((session) => {
      if (approved || session.approvalState !== "pending" || session.approvalRequestId !== joined.approvalRequestId) return;
      approved = true;
      provider.approveClient(session.approvalRequestId);
      resolve();
    });
  });
  unsubscribe?.();
}

async function providerRig(hostTools: WebMcpToolSummary[], invoke: WebMcpHostAdapter["invoke"]): Promise<ProviderRig> {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const serverUrl = relay.base;
  const provider = new WebMcpPeerClient({ hostAdapter: { listTools: () => hostTools, invoke } });
  providers.push(provider);
  const invitationUrl = await provider.connect({ serverUrl, alias: "message-limit" });
  const roomId = provider.getSession().roomId!;
  const joined = await joinPeerRoom({ invitationUrl });
  await approveAgent(provider, joined);
  await waitForPeerApproval({ serverUrl, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 5000 });
  const states: string[] = [];
  provider.subscribe((session) => states.push(session.state));
  return {
    relay,
    serverUrl,
    provider,
    roomId,
    joined,
    states,
    room: () => {
      const entry = relay.server.rooms.get(roomId);
      if (!entry) throw new Error("room is gone");
      return entry;
    },
    call: (id, name, args = {}) =>
      postMcp(serverUrl, roomId, joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })),
    wsSession: async (options = {}) => {
      const session = new PeerMcpSession({
        serverUrl,
        roomId,
        sessionId: joined.sessionId,
        clientToken: joined.clientToken,
        requestTimeoutMs: 5000,
        ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
      });
      sessions.push(session);
      await session.connect();
      return session;
    },
  };
}

/** A promise the test resolves by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** A WebSocket that records every string it sends. */
const NativeWebSocket = globalThis.WebSocket;
class RecordingWebSocket extends NativeWebSocket {
  static readonly instances: RecordingWebSocket[] = [];
  readonly sentText: string[] = [];
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    RecordingWebSocket.instances.push(this);
  }
  override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data === "string") this.sentText.push(data);
    super.send(data);
  }
}

// ---------------------------------------------------------------------------------------------
// A raw RFC 6455 client over TCP, for frame-level assertions the WHATWG WebSocket cannot make.
// ---------------------------------------------------------------------------------------------

interface RawFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

function frameHeader(opcode: number, length: number, fin: boolean, masked: boolean): Buffer {
  const first = (fin ? 0x80 : 0) | opcode;
  const mask = masked ? 0x80 : 0;
  if (length < 126) return Buffer.from([first, mask | length]);
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = first;
    header[1] = mask | 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = first;
  header[1] = mask | 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

class RawWebSocket {
  readonly frames: RawFrame[] = [];
  ended = false;
  private pending = Buffer.alloc(0);

  private constructor(private readonly socket: Socket) {}

  /** `allowHalfOpen` keeps this end open after the relay ends its side, like a peer that ignores a close. */
  static async open(base: string, path: string, ticket: string, options: { allowHalfOpen?: boolean } = {}): Promise<RawWebSocket> {
    const url = new URL(base);
    const socket = connect({ port: Number(url.port), host: url.hostname, allowHalfOpen: options.allowHalfOpen ?? false });
    const raw = new RawWebSocket(socket);
    rawSockets.push(raw);
    socket.on("error", () => {});
    socket.on("close", () => {
      raw.ended = true;
    });
    await new Promise<void>((resolve, reject) => {
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.off("data", onData);
        const status = head.subarray(0, end).toString("latin1").split("\r\n")[0] ?? "";
        if (!status.startsWith("HTTP/1.1 101")) {
          reject(new Error(`upgrade refused: ${status}`));
          return;
        }
        socket.on("data", (data: Buffer) => raw.receive(data));
        raw.receive(head.subarray(end + 4));
        resolve();
      };
      socket.on("data", onData);
      socket.once("close", () => reject(new Error("socket closed during the upgrade")));
      socket.once("connect", () => {
        socket.write(
          [
            `GET ${path} HTTP/1.1`,
            `Host: ${url.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
            "Sec-WebSocket-Version: 13",
            `Sec-WebSocket-Protocol: webmcp-peer.v1, ticket.${ticket}`,
            "",
            "",
          ].join("\r\n"),
        );
      });
    });
    return raw;
  }

  /** Writes one frame (masked, as a client must, unless `masked: false`). */
  sendFrame(opcode: number, payload: Buffer | string, options: { fin?: boolean; masked?: boolean } = {}): void {
    const body = typeof payload === "string" ? Buffer.from(payload) : payload;
    const masked = options.masked ?? true;
    const header = frameHeader(opcode, body.length, options.fin ?? true, masked);
    if (!masked) {
      this.socket.write(Buffer.concat([header, body]));
      return;
    }
    const mask = randomBytes(4);
    const maskedBody = Buffer.from(body);
    for (let index = 0; index < maskedBody.length; index++) maskedBody[index]! ^= mask[index % 4]!;
    this.socket.write(Buffer.concat([header, mask, maskedBody]));
  }

  /** Writes only a frame's header and masking key, announcing `length` payload bytes that never follow. */
  sendHeaderOnly(opcode: number, length: number, fin = true): void {
    this.socket.write(Buffer.concat([frameHeader(opcode, length, fin, true), randomBytes(4)]));
  }

  /** Text messages received so far, reassembled from their frames. */
  messages(): string[] {
    const messages: string[] = [];
    let parts: Buffer[] | null = null;
    for (const frame of this.frames) {
      if (frame.opcode === 1) parts = [frame.payload];
      else if (frame.opcode === 0 && parts) parts.push(frame.payload);
      else continue;
      if (frame.fin && parts) {
        messages.push(Buffer.concat(parts).toString("utf8"));
        parts = null;
      }
    }
    return messages;
  }

  waitForMessage(predicate: (message: Frame) => boolean, label: string): Promise<Frame> {
    return until(
      () => this.messages().map((text) => JSON.parse(text) as Frame).find(predicate),
      (message): message is Frame => message !== undefined,
      label,
      5000,
    ) as Promise<Frame>;
  }

  closeCode(): number | undefined {
    const close = this.frames.find((frame) => frame.opcode === 8);
    return close && close.payload.length >= 2 ? close.payload.readUInt16BE(0) : undefined;
  }

  async waitForClose(label: string): Promise<number> {
    return until(() => this.closeCode(), (code): code is number => code !== undefined, label, 5000) as Promise<number>;
  }

  destroy(): void {
    this.socket.destroy();
  }

  private receive(data: Buffer): void {
    this.pending = Buffer.concat([this.pending, data]);
    for (;;) {
      if (this.pending.length < 2) return;
      const first = this.pending[0]!;
      let length = this.pending[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.pending.length < 4) return;
        length = this.pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.pending.length < 10) return;
        length = Number(this.pending.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.pending.length < offset + length) return;
      this.frames.push({
        fin: (first & 0x80) !== 0,
        opcode: first & 0x0f,
        payload: Buffer.from(this.pending.subarray(offset, offset + length)),
      });
      this.pending = this.pending.subarray(offset + length);
    }
  }
}

/** A provider-side `{ type: "ping" }` relay frame of exactly `size` bytes. */
const pingOfSize = (size: number) => sized(size, (pad) => ({ type: "ping", pad }));

async function rawProviderRoom() {
  const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
  const room = await createRoom(relay.base);
  const openRaw = async () => {
    const raw = await RawWebSocket.open(relay.base, `/p/${room.id}/provider`, room.providerToken);
    await raw.waitForMessage((message) => message.type === "ready", "provider ready");
    return raw;
  };
  return { relay, room, openRaw };
}

async function roomCatalog(base: string, roomId: string): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${base}/p/${roomId}/mcp/tools`);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

/**
 * A `register` frame whose relay announcement (the frame without `registerSeq`, stamped with
 * catalogVersion/catalogHash) is exactly `size` bytes. `frame` is the announced part, `text` what
 * the provider sends. `alias: null` leaves out the alias, the smallest frame for a catalog.
 */
function registerWithAnnouncementOf(
  size: number,
  catalogVersion: number,
  options: { alias?: string | null; registerSeq?: number } = {},
) {
  const alias = options.alias === undefined ? "raw-provider" : options.alias;
  const build = (pad: string) => ({
    type: "register",
    ...(alias === null ? {} : { alias }),
    tools: [{ name: "big", description: pad, inputSchema: { type: "object", properties: {} } }],
  });
  const announcement = (frame: ReturnType<typeof build>) => ({ ...frame, catalogVersion, catalogHash: "0".repeat(64) });
  const padBytes = size - bytes(announcement(build("")));
  const frame = build("d".repeat(padBytes));
  expect(bytes(announcement(frame))).toBe(size);
  const sent = options.registerSeq === undefined ? frame : { ...frame, registerSeq: options.registerSeq };
  return { frame, text: JSON.stringify(sent) };
}

/** Answers every forwarded `tools/list` on a raw provider socket the way WebMcpPeerClient does. */
function answerToolsList(provider: { ws: WebSocket; send(frame: unknown): void }, tools: () => unknown[]): void {
  provider.ws.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    if (frame.type !== "mcp" || frame.message?.method !== "tools/list") return;
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { tools: tools() } } });
  });
}

const isListChanged = (frame: Frame) => frame.type === "mcp" && frame.message?.method === "notifications/tools/list_changed";

// =============================================================================================

describe("provider replies between the old 128 KiB frame limit and 256 KiB", { timeout: 20_000 }, () => {
  const payload = { ok: true, blob: "x".repeat(100_000) };
  const hostTools = [descriptorTool("big", "returns ~200 KB"), descriptorTool("small", "returns a little")];
  const invoke: WebMcpHostAdapter["invoke"] = async (name) => (name === "big" ? payload : { ok: true, small: true });

  it("delivers a ~200 KB tool result to an HTTP agent intact while the provider stays connected", async () => {
    expect(MAX_WEBSOCKET_MESSAGE_BYTES).toBe(LIMIT);
    const rig = await providerRig(hostTools, invoke);
    const providerSocket = rig.room().providerSocket;
    expect(providerSocket).toBeDefined();

    const reply = await rig.call(1, "big");
    expect(reply.status).toBe(200);
    expect(reply.body.error).toBeUndefined();
    expect(reply.body.result).toMatchObject({ isError: false, structuredContent: payload, data: payload });
    // The provider sent this reply to the relay as one WebSocket message over the old frame limit.
    const providerFrameBytes = bytes({ type: "mcp", message: reply.body });
    expect(providerFrameBytes).toBeGreaterThan(OLD_FRAME_LIMIT);
    expect(providerFrameBytes).toBeLessThanOrEqual(LIMIT);

    expect((await rig.call(2, "small")).body.result).toMatchObject({ isError: false, structuredContent: { ok: true, small: true } });
    expect(rig.room().providerSocket).toBe(providerSocket);
    expect(new Set(rig.states)).toEqual(new Set(["waiting"]));
    expect(rig.provider.getSession()).toMatchObject({ state: "waiting", error: null });
  });

  it("delivers a ~200 KB tool result to a WebSocket agent (fragmented by the relay) and keeps both sockets", async () => {
    const rig = await providerRig(hostTools, invoke);
    const providerSocket = rig.room().providerSocket;
    const session = await rig.wsSession();

    const result = await session.callTool("big");
    expect(result).toMatchObject({ isError: false, structuredContent: payload });
    expect(bytes(result)).toBeGreaterThan(OLD_FRAME_LIMIT);

    expect(await session.callTool("small")).toMatchObject({ isError: false, structuredContent: { ok: true, small: true } });
    expect(session.state).toBe("connected");
    expect(rig.room().providerSocket).toBe(providerSocket);
    expect(new Set(rig.states)).toEqual(new Set(["waiting"]));
  });
});

describe("tool catalog size", { timeout: 20_000 }, () => {
  it("registers a catalog whose register frame is between 128 KiB and 256 KiB and lists it to agents", async () => {
    const hostTools = Array.from({ length: 4 }, (_, index) => descriptorTool(`doc_${index}`, "d".repeat(45_000)));
    const registerBytes = bytes({ type: "register", alias: "message-limit", tools: hostTools.map(toWireToolDescriptor) });
    expect(registerBytes).toBeGreaterThan(OLD_FRAME_LIMIT);
    expect(registerBytes).toBeLessThanOrEqual(LIMIT);

    const rig = await providerRig(hostTools, async () => ({ ok: true }));
    const catalog = await until(() => roomCatalog(rig.serverUrl, rig.roomId), (value) => value.status === 200, "registered catalog", 5000);
    expect(catalog.body.tools).toEqual(hostTools.map(toWireToolDescriptor));
    expect(catalog.body.catalogVersion).toBe(1);
    expect(rig.provider.getSession().error).toBeNull();

    const httpList = await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(httpList.body.result.tools).toEqual(hostTools.map(toWireToolDescriptor));

    // Over WebSocket the provider answers tools/list itself (~180 KB) and the relay forwards it.
    const session = await rig.wsSession();
    const listed = await session.listTools();
    expect(listed.map((entry) => [entry.name, entry.description?.length])).toEqual(hostTools.map((entry) => [entry.name, 45_000]));
    expect(session.catalogHash).toBe(catalog.body.catalogHash);
    expect(new Set(rig.states)).toEqual(new Set(["waiting"]));
  });

  it("withholds a register frame over 256 KiB, reports CATALOG_TOO_LARGE on an open socket, and registers once the catalog shrinks", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    RecordingWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", RecordingWebSocket);
    const hostTools = Array.from({ length: 3 }, (_, index) => descriptorTool(`huge_${index}`, "h".repeat(100_000)));
    expect(bytes({ type: "register", alias: "message-limit", tools: hostTools.map(toWireToolDescriptor) })).toBeGreaterThan(LIMIT);
    const invoked: string[] = [];

    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const provider = new WebMcpPeerClient({
      hostAdapter: {
        listTools: () => hostTools,
        invoke: async (name) => {
          invoked.push(name);
          return { ok: true, tool: name };
        },
      },
    });
    providers.push(provider);
    const states: string[] = [];
    provider.subscribe((session) => states.push(session.state));
    const invitationUrl = await provider.connect({ serverUrl: relay.base, alias: "message-limit" });
    const roomId = provider.getSession().roomId!;
    const providerWs = RecordingWebSocket.instances.filter((ws) => ws.url.includes("/provider"));
    expect(providerWs).toHaveLength(1);
    // registerSeq (the provider's numbering of its register frames) is left out of the comparison.
    const registerFrames = () =>
      providerWs[0]!.sentText
        .map((text) => JSON.parse(text) as Frame)
        .filter((frame) => frame.type === "register")
        .map(({ registerSeq: _registerSeq, ...frame }) => frame);

    expect(provider.getSession().error).toMatch(/^CATALOG_TOO_LARGE: the register frame for 3 tools is \d+ bytes/);
    expect(registerFrames()).toEqual([]);
    expect(Math.max(0, ...providerWs[0]!.sentText.map(bytes))).toBeLessThanOrEqual(LIMIT);
    expect(provider.syncTools()).toBe(false);
    expect(registerFrames()).toEqual([]);
    expect(provider.getSession().error).toMatch(/^CATALOG_TOO_LARGE/);

    // The relay never got a catalog, and still holds the provider's one socket.
    const providerSocket = relay.server.rooms.get(roomId)!.providerSocket;
    expect(providerSocket).toBeDefined();
    expect(await roomCatalog(relay.base, roomId)).toMatchObject({ status: 503, body: { error: "CATALOG_UNAVAILABLE", catalogVersion: 0 } });

    // The socket keeps working: the provider's approval decision and a tool call travel over it.
    const joined = await joinPeerRoom({ invitationUrl });
    await approveAgent(provider, joined);
    await waitForPeerApproval({ serverUrl: relay.base, roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 5000 });
    const reply = await postMcp(relay.base, roomId, joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "huge_0", arguments: {} } }));
    expect(reply.body.result).toMatchObject({ isError: false, structuredContent: { ok: true, tool: "huge_0" } });
    expect(invoked).toEqual(["huge_0"]);

    hostTools.splice(0, hostTools.length, descriptorTool("tiny", "fits"));
    expect(provider.syncTools()).toBe(true);
    expect(provider.getSession().error).toBeNull();
    expect(registerFrames()).toEqual([{ type: "register", alias: "message-limit", tools: [toWireToolDescriptor(descriptorTool("tiny", "fits"))] }]);
    const catalog = await until(() => roomCatalog(relay.base, roomId), (value) => value.status === 200, "shrunken catalog", 5000);
    expect(catalog.body).toMatchObject({ catalogVersion: 1, tools: [toWireToolDescriptor(descriptorTool("tiny", "fits"))] });

    // No close/reconnect loop: one provider socket throughout, never disconnected.
    expect(RecordingWebSocket.instances.filter((ws) => ws.url.includes("/provider"))).toHaveLength(1);
    expect(relay.server.rooms.get(roomId)!.providerSocket).toBe(providerSocket);
    expect(states).not.toContain("disconnected");
    expect(provider.getSession().state).toBe("waiting");
  });

  it("refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog", async () => {
    expect(PEER_RELAY_MAX_ANNOUNCEMENT_BYTES).toBe(ANNOUNCEMENT_LIMIT);
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", alias: "raw-provider", tools: [tool("small")], registerSeq: 1 });
    const before = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "first catalog", 5000);
    expect(before.body.catalogVersion).toBe(1);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);

    // The register frame fits one relay message; the announcement the relay would stamp is one
    // byte over the announcement limit (registerSeq is not part of it).
    const oversized = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT + 1, 2, { registerSeq: 2 });
    expect(bytes(oversized.text)).toBeLessThan(LIMIT);
    provider.send(oversized.text);
    const error = await provider.waitFor((frame) => frame.type === "error", "CATALOG_TOO_LARGE", 5000);
    expect(error).toEqual({
      type: "error",
      code: -32602,
      message: "CATALOG_TOO_LARGE",
      limitBytes: ANNOUNCEMENT_LIMIT,
      reason: expect.stringContaining(`${ANNOUNCEMENT_LIMIT + 1} bytes`),
      registerSeq: 2,
    });

    // CATALOG_INVALID echoes a numeric registerSeq too; anything else is not echoed.
    provider.send({ type: "register", tools: [tool("dup"), tool("dup")], registerSeq: 3 });
    provider.send({ type: "register", tools: [tool("dup"), tool("dup")], registerSeq: "4" });
    const errors = await until(
      () => provider.frames.filter((frame) => frame.type === "error"),
      (frames) => frames.length === 3,
      "CATALOG_INVALID replies",
      5000,
    );
    const invalid = { type: "error", code: -32602, message: "CATALOG_INVALID", reason: expect.any(String) };
    expect(errors.slice(1)).toEqual([{ ...invalid, registerSeq: 3 }, invalid]);

    await flush(provider, "provider socket still open");
    await flush(client, "client socket still open");
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({
      catalogVersion: 1,
      catalogHash: before.body.catalogHash,
      tools: [tool("small")],
    });
    expect(client.frames.filter((frame) => frame.type === "register" || isListChanged(frame))).toEqual([]);

    // The same socket can still register a catalog that fits; agents never see registerSeq.
    provider.send({ type: "register", alias: "raw-provider", tools: [tool("small"), tool("other")], registerSeq: 5 });
    const announced = await client.waitFor((frame) => frame.type === "register", "announcement", 5000);
    expect(announced).toEqual({
      type: "register",
      alias: "raw-provider",
      tools: [tool("small"), tool("other")],
      catalogVersion: 2,
      catalogHash: (await roomCatalog(relay.base, room.id)).body.catalogHash,
    });
  });

  it("lets a WebSocket agent list every catalog the relay accepts, up to an announcement of PEER_RELAY_MAX_ANNOUNCEMENT_BYTES", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    // The smallest register frame leaves the least headroom: all of its announcement but the
    // envelope is catalog, which a tools/list reply carries in full.
    const largest = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT, 1, { alias: null });
    answerToolsList(provider, () => largest.frame.tools);
    provider.send(largest.text);
    const catalog = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "accepted catalog", 5000);
    expect(catalog.body).toMatchObject({ catalogVersion: 1, tools: largest.frame.tools });
    expect(provider.frames.filter((frame) => frame.type === "error")).toEqual([]);

    // A PeerMcpSession that connects later lists it (with catalog metadata) over the WebSocket.
    const joined = await joinRoom(relay.base, room);
    const session = new PeerMcpSession({
      serverUrl: relay.base,
      roomId: room.id,
      sessionId: joined.sessionId,
      clientToken: joined.clientToken,
      requestTimeoutMs: 5000,
    });
    sessions.push(session);
    await session.connect();
    const listed = await session.listTools();
    expect(listed.map((entry) => [entry.name, entry.description?.length])).toEqual([["big", largest.frame.tools[0]!.description.length]]);
    expect(session.catalogHash).toBe(catalog.body.catalogHash);

    // The relay answers the listing from the catalog it holds, whatever the provider replies: the
    // headroom below the message limit holds the reply envelope, the room's listing metadata with
    // the relay's catalog stamp (in result._meta, and at the top of the result for an agent that
    // sent _meta) and any request id the relay accepts (at most 1 KiB of JSON), so the reply for
    // the longest accepted id arrives intact.
    const agent = await openClient(relay, room, joined, sockets);
    const stamp = { catalogVersion: 1, catalogHash: catalog.body.catalogHash };
    const longestId = idOfJsonBytes(MAX_ID_BYTES);
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: longestId, method: "tools/list", params: { _meta: {} } } });
    const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === longestId, "reply for the longest id", 5000);
    expect(reply.message).toMatchObject({ jsonrpc: "2.0", id: longestId, result: { tools: largest.frame.tools, ...stamp, _meta: { roomId: room.id, ...stamp } } });
    expect(bytes(reply)).toBeLessThanOrEqual(LIMIT);
  });

  it("fits its own listing of the largest catalog it accepts, with the room's listing metadata, under the longest id", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    const largest = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT, 1, { alias: null });
    provider.send(largest.text);
    const catalog = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "accepted catalog", 5000);

    // A ticket waiting for approval is listed by the relay itself, with the whole listing metadata
    // in result._meta and, since it sent _meta, the stamp at the top of the result too.
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const longestId = idOfJsonBytes(MAX_ID_BYTES);
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: longestId, method: "tools/list", params: { _meta: {} } } });
    const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === longestId, "the relay's listing", 5000);
    expect(reply.message.result).toMatchObject({
      tools: largest.frame.tools,
      catalogVersion: 1,
      catalogHash: catalog.body.catalogHash,
      _meta: { roomId: room.id, catalogVersion: 1, catalogHash: catalog.body.catalogHash, auth: { state: "pending" } },
    });
    expect(bytes(reply)).toBeLessThanOrEqual(LIMIT);
    expect(provider.frames.filter((frame) => frame.type === "mcp")).toEqual([]);
  });

  it("fits its own WebSocket initialize of the largest catalog it accepts under the longest id, naming the bootstrap catalog without listing it twice", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    const largest = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT, 1, { alias: null });
    provider.send(largest.text);
    const catalog = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "accepted catalog", 5000);

    // A ticket waiting for approval is answered initialize by the relay itself.
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    const longestId = idOfJsonBytes(MAX_ID_BYTES);
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: longestId, method: "initialize", params: { protocolVersion: "2025-11-25" } } });
    const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === longestId, "the relay's initialize", 5000);
    expect(reply.message.result).toMatchObject({
      protocolVersion: "2025-11-25",
      capabilities: { tools: { listChanged: true } },
      tools: largest.frame.tools,
      _meta: {
        roomId: room.id,
        toolCount: 1,
        bootstrapCatalog: { catalogVersion: 1, catalogHash: catalog.body.catalogHash, source: "provider" },
        auth: { state: "pending" },
      },
    });
    expect(reply.message.result._meta.bootstrapCatalog).not.toHaveProperty("tools");
    expect(bytes(reply)).toBeLessThanOrEqual(LIMIT);
    expect(provider.frames.filter((frame) => frame.type === "mcp")).toEqual([]);
  });

  it("answers its own WebSocket metadata result over the message limit RESULT_TOO_LARGE instead of dropping it", async () => {
    // A server name long enough that no initialize or discover result of the catalog fits.
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [tool("echo")] }, serverName: "n".repeat(LIMIT) });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    for (const method of ["initialize", "server/discover"]) {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: method, method } });
      const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === method, `${method} reply`, 5000);
      expect(reply).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: method, error: RESULT_TOO_LARGE } });
    }
    // The socket stays open and serves what fits.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "list", method: "tools/list" } });
    const listed = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "list", "tools/list reply", 5000);
    expect(listed.message.result.tools).toEqual([tool("echo")]);
  });

  it("accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const client = await RawWebSocket.open(relay.base, `/p/${room.id}/client`, joined.clientToken);
    await client.waitForMessage((message) => message.type === "ready", "client ready");

    // registerSeq is not part of the announcement: counted in, it would take it over the bound.
    const exact = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT, 1, { registerSeq: 12345 });
    expect(bytes({ ...(JSON.parse(exact.text) as Frame), catalogVersion: 1, catalogHash: "0".repeat(64) })).toBeGreaterThan(ANNOUNCEMENT_LIMIT);
    provider.send(exact.text);
    const announced = await client.waitForMessage((message) => message.type === "register", "register announcement");
    const catalog = await roomCatalog(relay.base, room.id);
    expect(announced).toEqual({ ...exact.frame, catalogVersion: 1, catalogHash: catalog.body.catalogHash });
    expect(provider.frames.filter((frame) => frame.type === "error")).toEqual([]);

    const start = client.frames.findIndex((frame) => frame.opcode === 1 && !frame.fin);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(client.frames.slice(start, start + 2).map((frame) => [frame.opcode, frame.fin, frame.payload.length])).toEqual([
      [1, false, OLD_FRAME_LIMIT],
      [0, true, ANNOUNCEMENT_LIMIT - OLD_FRAME_LIMIT],
    ]);
  });

  it("answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", alias: "raw-provider", tools: [tool("small")] });
    const before = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "first catalog", 5000);
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    const answer = async (id: string, tools: unknown[]) => {
      await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === id, `forwarded ${id}`, 5000);
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id, result: { tools } } });
    };
    const replyTo = (id: string) => agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === id, `reply ${id}`, 5000);

    // The reply fits the message limit, but announcing its catalog would take one byte over the bound.
    const oversized = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT + 1, 2, { alias: null });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "big", method: "tools/list", params: { _meta: {} } } });
    await answer("big", oversized.frame.tools);
    // The relay's catalog, as the HTTP route lists it (the stamp in result._meta), and stamped at the
    // top of the result too for an agent that sent _meta.
    const stamp = { catalogVersion: 1, catalogHash: before.body.catalogHash };
    const big = await replyTo("big");
    expect(big.message.result).toMatchObject({ tools: [tool("small")], ...stamp, _meta: { roomId: room.id, ...stamp } });
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "plain", method: "tools/list", params: {} } });
    await answer("plain", oversized.frame.tools);
    const plain = await replyTo("plain");
    expect(plain.message.result).toMatchObject({ tools: [tool("small")], _meta: { roomId: room.id, ...stamp } });
    expect(plain.message.result).not.toHaveProperty("catalogVersion");
    // An invalid catalog (a duplicate name) is not passed on either.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "dup", method: "tools/list", params: { _meta: {} } } });
    await answer("dup", [tool("small"), tool("small")]);
    expect((await replyTo("dup")).message.result).toMatchObject({ tools: [tool("small")], ...stamp, _meta: stamp });

    await flush(agent, "agent socket still open");
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({
      catalogVersion: 1,
      catalogHash: before.body.catalogHash,
      tools: [tool("small")],
    });
    expect(agent.frames.filter(isListChanged)).toEqual([]);

    // A result whose catalog fits is not taken either while the relay holds one: the relay changes
    // its catalog for a register frame, and answers the listing from the catalog it holds.
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: "fits", method: "tools/list", params: { _meta: {} } } });
    await answer("fits", [tool("small"), tool("other")]);
    expect((await replyTo("fits")).message.result).toMatchObject({ tools: [tool("small")], ...stamp, _meta: stamp });
    await flush(agent, "agent socket still open");
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({ catalogVersion: 1, tools: [tool("small")] });
    expect(agent.frames.filter(isListChanged)).toEqual([]);
  });

  it("keeps a PeerMcpSession calling the cached tools after the provider lists a catalog the relay refuses", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", alias: "raw-provider", tools: [tool("small")] });
    const before = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "first catalog", 5000);
    // A host whose catalog grows past the announcement limit after it registered.
    const oversized = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT + 1, 2, { alias: null });
    let listed: unknown[] = [tool("small")];
    const called: string[] = [];
    provider.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type !== "mcp" || typeof frame.message?.method !== "string") return;
      if (frame.message.method === "tools/list") {
        provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { tools: listed } } });
      } else if (frame.message.method === "tools/call") {
        called.push(frame.message.params.name);
        provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { content: [{ type: "text", text: "ok" }] } } });
      }
    });
    const joined = await joinRoom(relay.base, room);
    const session = new PeerMcpSession({ serverUrl: relay.base, roomId: room.id, sessionId: joined.sessionId, clientToken: joined.clientToken, requestTimeoutMs: 5000 });
    sessions.push(session);
    await session.connect();
    await session.listTools();
    await session.callTool("small");

    listed = [tool("small"), ...oversized.frame.tools];
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["small"]);
    expect({ version: session.catalogVersion, hash: session.catalogHash }).toEqual({ version: 1, hash: before.body.catalogHash });
    expect(await session.callTool("small")).toMatchObject({ content: [{ type: "text", text: "ok" }] });
    // The relay never took `big`, so the session does not offer it.
    await expect(session.callTool("big")).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
    expect(called).toEqual(["small", "small"]);
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({ catalogVersion: 1, tools: [tool("small")] });
  });

  it("answers CATALOG_TOO_LARGE or CATALOG_INVALID to a tools/list whose catalog the relay refuses while it holds none", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const oversized = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT + 1, 1, { alias: null });
    let listed: unknown[] = oversized.frame.tools;
    answerToolsList(provider, () => listed);
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);

    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: {} } } });
    const tooLarge = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 1, "CATALOG_TOO_LARGE", 5000);
    expect(tooLarge).toEqual({
      type: "mcp",
      message: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "CATALOG_TOO_LARGE", data: { limitBytes: ANNOUNCEMENT_LIMIT, announcementBytes: ANNOUNCEMENT_LIMIT + 1 } },
      },
    });

    listed = [{ name: "no-schema" }];
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
    const invalid = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 2, "CATALOG_INVALID", 5000);
    expect(invalid).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: 2, error: { code: -32603, message: "CATALOG_INVALID" } } });

    expect(relay.server.rooms.get(room.id)!.cachedTools).toBeUndefined();
    expect(await roomCatalog(relay.base, room.id)).toMatchObject({ status: 503, body: { error: "CATALOG_UNAVAILABLE" } });
  });

  it("answers a WebSocket agent's tools/list and server/discover from the relay's catalog when the provider answers with an error", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", tools: [tool("a"), tool("b")] });
    const catalog = await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "registered catalog", 5000);
    // A provider whose last catalog the relay refused, or that reloaded and has sent none, answers
    // every relay-forwarded listing with CATALOG_UNAVAILABLE.
    const unavailable = { code: -32090, message: "CATALOG_UNAVAILABLE", data: { reason: "the relay refused the last catalog" } };
    const listed: string[] = [];
    provider.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      const method = frame.message?.method;
      if (frame.type !== "mcp" || (method !== "tools/list" && method !== "server/discover")) return;
      listed.push(frame.message.id);
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, error: unavailable } });
    });
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const ask = (id: string, method: string, params: Record<string, unknown>) => {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, method, params } });
      return agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === id, `reply ${id}`, 5000);
    };
    const stamp = { catalogVersion: 1, catalogHash: catalog.body.catalogHash };
    const httpAnswer = async (id: string, method: string, params: Record<string, unknown>) => {
      const http = await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      expect(http.status).toBe(200);
      return http.body!;
    };

    // tools/list gets what the HTTP route answers the same agent, and the stamp at the top of the
    // result for an agent that sent _meta.
    const metaListing = await ask("meta", "tools/list", { _meta: {} });
    const httpListing = await httpAnswer("meta", "tools/list", {});
    expect(metaListing.message).toEqual({ ...httpListing, result: { ...httpListing.result, ...stamp } });
    expect(metaListing.message.result).toMatchObject({ tools: [tool("a"), tool("b")], _meta: stamp });
    expect((await ask("plain", "tools/list", {})).message).toEqual(await httpAnswer("plain", "tools/list", {}));
    // server/discover gets what the HTTP route answers the same agent, but for listChanged: the
    // WebSocket gets catalog changes pushed.
    const discoverParams = { protocolVersion: "2025-06-18" };
    const discovered = await ask("discover", "server/discover", discoverParams);
    const http = await httpAnswer("discover", "server/discover", discoverParams);
    expect(http.result.capabilities).toEqual({ tools: { listChanged: false }, stateless: true });
    expect(discovered.message).toEqual({ ...http, result: { ...http.result, capabilities: { tools: { listChanged: true }, stateless: true } } });
    expect(discovered.message.result).toMatchObject({ protocolVersion: "2025-06-18", tools: [tool("a"), tool("b")], _meta: stamp });
    // The provider was asked each time: the relay answers only for the provider.
    expect(listed).toEqual(["meta", "plain", "discover"]);

    // One page of a listing is not the whole catalog: the provider's error is passed on.
    expect((await ask("page", "tools/list", { cursor: "2" })).message.error).toEqual(unavailable);
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({ catalogVersion: 1, tools: [tool("a"), tool("b")] });
  });

  it("passes on the provider's CATALOG_UNAVAILABLE to a WebSocket listing while the relay holds no catalog", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const unavailable = { code: -32090, message: "CATALOG_UNAVAILABLE", data: { reason: "no catalog yet" } };
    provider.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type !== "mcp" || typeof frame.message?.method !== "string") return;
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, error: unavailable } });
    });
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    for (const method of ["tools/list", "server/discover"]) {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: method, method, params: { _meta: {} } } });
      const reply = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === method, `${method} reply`, 5000);
      expect(reply).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: method, error: unavailable } });
    }
    expect(relay.server.rooms.get(room.id)!.cachedTools).toBeUndefined();
  });

  it("takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    let discoverTools: unknown[] = [tool("c"), tool("c")];
    provider.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type !== "mcp" || frame.message?.method !== "server/discover") return;
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "page", version: "1" }, tools: discoverTools } } });
    });
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const discover = (id: string) => {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id, method: "server/discover", params: { _meta: {} } } });
      return agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === id, `discover ${id}`, 5000);
    };

    // While the relay holds no catalog, one it refuses (a duplicate name) is never passed on: the
    // agent gets the refusal.
    expect((await discover("refused")).message).toEqual({ jsonrpc: "2.0", id: "refused", error: { code: -32603, message: "CATALOG_INVALID" } });

    // A valid catalog is the relay's from then on, and the provider's reply is stamped with it.
    discoverTools = [tool("a"), tool("b")];
    const adopted = await discover("valid");
    const after = await roomCatalog(relay.base, room.id);
    expect(after.body).toMatchObject({ catalogVersion: 1, tools: [tool("a"), tool("b")] });
    const stamp = { catalogVersion: 1, catalogHash: after.body.catalogHash };
    expect(adopted.message.result).toEqual({
      protocolVersion: "2025-06-18", serverInfo: { name: "page", version: "1" }, tools: [tool("a"), tool("b")],
      ...stamp, _meta: stamp,
    });

    // While it holds one, whatever the provider replies, the agent gets the relay's own discover
    // result, which reports its negotiation and capabilities as the provider's does.
    discoverTools = [tool("c"), tool("c")];
    const relayAnswer = await discover("held");
    expect(relayAnswer.message.result).toMatchObject({
      protocolVersion: "2025-11-25",
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: true }, stateless: true },
      serverInfo: { name: relay.server.serverName, version: relay.server.serverVersion },
      tools: [tool("a"), tool("b")],
      _meta: { roomId: room.id, ...stamp },
      ...stamp,
    });
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({ catalogVersion: 1, tools: [tool("a"), tool("b")] });
  });

  it("keeps a fresh WebSocket PeerMcpSession listing and calling the relay's catalog after the relay refused the provider's newer one", async () => {
    const hostTools = [descriptorTool("a", "first"), descriptorTool("b", "second")];
    const invoked: string[] = [];
    const rig = await providerRig(hostTools, async (name) => {
      invoked.push(name);
      return { ok: true, tool: name };
    });
    await until(() => roomCatalog(rig.serverUrl, rig.roomId), (value) => value.status === 200, "registered catalog", 5000);
    // The host grows past the relay's 128-tool bound: the relay refuses the catalog and keeps [a, b].
    hostTools.splice(0, hostTools.length, ...Array.from({ length: 129 }, (_, index) => descriptorTool(`t${index}`, "grown")));
    rig.provider.syncTools();
    await until(() => rig.provider.getSession().error, (error) => typeof error === "string" && error.includes("CATALOG_INVALID"), "the relay refuses the grown catalog", 5000);

    const session = await rig.wsSession();
    expect((await session.listTools()).map((entry) => entry.name)).toEqual(["a", "b"]);
    const http = await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(session.catalogHash).toBe(http.body.result._meta.catalogHash);
    expect(await session.callTool("a")).toMatchObject({ isError: false, structuredContent: { ok: true, tool: "a" } });
    expect(invoked).toEqual(["a"]);
  });

  it("takes a catalog only from a whole tools/list result, not from a tools/call result or a page of a listing", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    const roundTrip = async (request: Frame, result: Record<string, unknown>) => {
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", ...request } });
      await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === request.id, `forwarded ${request.id}`, 5000);
      provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: request.id, result } });
      return agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === request.id, `reply ${request.id}`, 5000);
    };

    // While the relay holds no catalog, a tool result that happens to have `tools`, a page asked for
    // with a cursor, and a first page (with nextCursor) are forwarded as the provider sent them,
    // unstamped, and none is taken as the room's catalog.
    const callResult = { content: [{ type: "text", text: "listing" }], tools: [tool("injected")] };
    const call = await roundTrip({ id: "call", method: "tools/call", params: { name: "real", arguments: {}, _meta: {} } }, callResult);
    expect(call.message.result).toEqual(callResult);
    const pageResult = { tools: [tool("page-two")] };
    expect((await roundTrip({ id: "page", method: "tools/list", params: { cursor: "2", _meta: {} } }, pageResult)).message.result).toEqual(pageResult);
    const firstPage = { tools: [tool("page-one")], nextCursor: "2" };
    expect((await roundTrip({ id: "first", method: "tools/list", params: { _meta: {} } }, firstPage)).message.result).toEqual(firstPage);

    await flush(agent, "agent socket still open");
    expect(await roomCatalog(relay.base, room.id)).toMatchObject({ status: 503, body: { error: "CATALOG_UNAVAILABLE" } });
    expect(relay.server.rooms.get(room.id)!.cachedTools).toBeUndefined();
    expect(agent.frames.filter(isListChanged)).toEqual([]);
    // No tool the replies named was taken: the next call is forwarded, unchecked, as before.
    expect((await roundTrip({ id: "again", method: "tools/call", params: { name: "real", arguments: {} } }, { content: [] })).message.result).toEqual({ content: [] });
  });

  it("announces a register only when its catalog changed", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const client = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    const announcements = () => client.frames.filter((frame) => frame.type === "register");

    provider.send({ type: "register", tools: [tool("a")], registerSeq: 1 });
    await client.waitFor((frame) => frame.type === "register", "first announcement", 5000);
    // The same catalog again (key order and tool order do not change its hash): no announcement,
    // no list_changed, no error for the provider.
    provider.send({ type: "register", tools: [{ inputSchema: { properties: {}, type: "object" }, description: "a tool", name: "a" }], registerSeq: 2 });
    provider.send({ type: "register", tools: [tool("a")], registerSeq: 3 });
    await flush(provider, "repeated registers processed");
    await flush(client, "client socket still open");
    expect(announcements()).toHaveLength(1);
    expect(client.frames.filter(isListChanged)).toHaveLength(1);
    expect(provider.frames.filter((frame) => frame.type === "error")).toEqual([]);

    provider.send({ type: "register", tools: [tool("a"), tool("b")], registerSeq: 4 });
    await until(() => announcements().length, (count) => count === 2, "changed catalog announced", 5000);
    expect(announcements()[1]).toMatchObject({ tools: [tool("a"), tool("b")], catalogVersion: 2 });
  });
});

describe("HTTP request bodies", { timeout: 20_000 }, () => {
  const hostTools = [descriptorTool("echo", "echoes"), descriptorTool("slow", "waits")];

  it("answers an MCP POST body one byte over the request limit with 413 REQUEST_TOO_LARGE, and the room keeps working", async () => {
    const invoked: string[] = [];
    const rig = await providerRig(hostTools, async (name) => {
      invoked.push(name);
      return { ok: true, echo: name };
    });
    const providerSocket = rig.room().providerSocket;
    // Over the request limit, though still within the message limit.
    const body = sized(REQUEST_LIMIT + 1, (pad) => ({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { pad } } }));

    const reply = await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, body);
    expect(reply).toEqual({ status: 413, body: { jsonrpc: "2.0", id: null, error: REQUEST_TOO_LARGE } });
    expect(invoked).toEqual([]);

    expect((await rig.call(10, "echo")).body.result).toMatchObject({ isError: false, structuredContent: { ok: true, echo: "echo" } });
    const session = await rig.wsSession();
    expect(await session.callTool("echo")).toMatchObject({ isError: false, structuredContent: { ok: true, echo: "echo" } });
    expect(rig.room().providerSocket).toBe(providerSocket);
    expect(new Set(rig.states)).toEqual(new Set(["waiting"]));
  });

  it("forwards and answers a body of exactly the request limit under a rewritten duplicate id, clears its pending slot, and refuses one byte more", async () => {
    const slow = gate();
    const invoked: string[] = [];
    const rig = await providerRig(hostTools, async (name) => {
      invoked.push(name);
      if (name === "slow") await slow.promise;
      return { ok: true, echo: name };
    });
    const providerSocket = rig.room().providerSocket!;
    const forwarded = recordSent(providerSocket);
    const body = (size: number) => sized(size, (pad) => ({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "echo", arguments: { pad } } }));

    // A request holds id 42 at the relay, so the relay must give the next id 42 a longer wire id.
    const held = rig.call(42, "slow");
    await until(() => invoked.includes("slow"), Boolean, "slow call reached the provider");
    expect([...rig.room().mcpPending.keys()]).toEqual(["number:42"]);

    // Exactly the request limit: the copy the relay forwards (stamped with from/sessionId, under the
    // rewritten id) is larger than the body but within the message limit, and it is answered.
    const atLimit = body(REQUEST_LIMIT);
    expect(await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, atLimit)).toMatchObject({
      status: 200,
      body: { jsonrpc: "2.0", id: 42, result: { isError: false, structuredContent: { echo: "echo" } } },
    });
    expect(invoked).toEqual(["slow", "echo"]);
    const copy = forwarded.find((text) => (JSON.parse(text) as Frame).message?.params?.name === "echo")!;
    expect(JSON.parse(copy)).toEqual({
      type: "mcp",
      from: "client",
      sessionId: rig.joined.sessionId,
      message: { ...JSON.parse(atLimit), id: expect.stringMatching(/^framebook:\d+:number:42$/) },
    });
    expect(bytes(copy)).toBeGreaterThan(REQUEST_LIMIT);
    expect(bytes(copy)).toBeLessThanOrEqual(LIMIT);
    // Its slot is released; only the held request is still pending.
    expect([...rig.room().mcpPending.keys()]).toEqual(["number:42"]);

    // One byte more is refused unread, with id null, and nothing is forwarded.
    const forwardedBefore = sentMcp(forwarded).length;
    expect(await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, body(REQUEST_LIMIT + 1))).toEqual({
      status: 413,
      body: { jsonrpc: "2.0", id: null, error: REQUEST_TOO_LARGE },
    });
    expect(sentMcp(forwarded)).toHaveLength(forwardedBefore);
    expect(invoked).toEqual(["slow", "echo"]);

    slow.open();
    expect((await held).body).toMatchObject({ id: 42, result: { isError: false, structuredContent: { echo: "slow" } } });
    expect(rig.room().mcpPending.size).toBe(0);
    expect(rig.room().providerSocket).toBe(providerSocket);
  });

  it("drains an oversized body up to 16x the limit so its 413 arrives, and cuts off a larger one without hanging", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const endpoint = `${relay.base}/p/${room.id}/mcp`;
    const post = (size: number) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: sized(size, (pad) => ({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad } })),
      });

    // The body read limit is the request limit, and up to 16 times as much is drained.
    const drained = await post(16 * REQUEST_LIMIT);
    expect(drained.status).toBe(413);
    expect(await drained.json()).toEqual({ jsonrpc: "2.0", id: null, error: REQUEST_TOO_LARGE });

    const cut = await settleWithin(post(16 * REQUEST_LIMIT + REQUEST_LIMIT).then((response) => ({ status: response.status }), (error: unknown) => ({ error })), 10_000);
    expect(cut.settled).toBe(true);
    expect(cut.settled && "error" in cut.value).toBe(true);

    const ping = await postJson(endpoint, { jsonrpc: "2.0", id: 2, method: "ping" });
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("delivers 413 BODY_TOO_LARGE for join bodies over 64 KiB and leaves the connection usable", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);

    // Repeated on the same keep-alive connection: a body left unread would reset (or stall) the next one.
    for (let attempt = 0; attempt < 3; attempt++) {
      const outcome = await settleWithin(
        postJson(`${relay.base}/p/${room.id}/join`, { inviteToken: room.inviteToken, pad: "j".repeat(500_000) })
          .then(async (response) => ({ status: response.status, body: (await response.json()) as unknown })),
        5000,
      );
      expect(outcome).toEqual({ settled: true, value: { status: 413, body: { error: "BODY_TOO_LARGE" } } });
    }

    // The refused joins did not consume the invite.
    expect((await joinRoom(relay.base, room)).clientToken).toMatch(/^[a-f0-9]+$/);
  });

  it("answers a body that is not valid UTF-8 with 400 PARSE_ERROR instead of acting on altered content", async () => {
    const invoked: string[] = [];
    const rig = await providerRig(hostTools, async (name) => {
      invoked.push(name);
      return { ok: true };
    });
    // 0xff can never appear in UTF-8; a lossy decoder would have turned it into U+FFFD and run the call.
    const body = Buffer.concat([
      Buffer.from('{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"echo","arguments":{"s":"'),
      Buffer.from([0xff]),
      Buffer.from('"}}}'),
    ]);
    const response = await fetch(`${rig.serverUrl}/p/${rig.roomId}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${rig.joined.clientToken}` },
      body,
    });
    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 400,
      body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "PARSE_ERROR" } },
    });
    expect(invoked).toEqual([]);

    // A JSON-body endpoint refuses it the same way instead of joining with an altered label.
    const room = rig.room();
    const join = await fetch(`${rig.serverUrl}/p/${rig.roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.concat([Buffer.from('{"inviteToken":"x","clientLabel":"'), Buffer.from([0xc3]), Buffer.from('"}')]),
    });
    expect(join.status).toBe(400);
    expect(await join.json()).toEqual({ error: "INVALID_JSON_BODY" });
    expect(rig.room()).toBe(room);
  });

  it("applies the request limit to a request as the relay re-serializes it, over HTTP and WebSocket", async () => {
    const invoked: string[] = [];
    const rig = await providerRig(hostTools, async (name) => {
      invoked.push(name);
      return { ok: true };
    });
    const forwarded = recordSent(rig.room().providerSocket!);
    // "1e20" (4 bytes) re-serializes as "100000000000000000000" (21 bytes). These requests are far
    // under the limit as sent and just over it as the relay would forward them, yet still small
    // enough that the stamped envelope fits the 256 KiB message limit: a check of the raw text alone
    // would forward them, so only measuring the re-serialized form refuses them.
    const numbers = `[${Array.from({ length: 11_900 }, () => "1e20").join(",")}]`;
    const rpc = (id: number | string) => `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"method":"tools/call","params":{"name":"echo","arguments":{"n":${numbers}}}}`;
    expect(Buffer.byteLength(rpc(22))).toBeLessThan(REQUEST_LIMIT / 2);
    const reserialized = bytes(JSON.parse(rpc(22)));
    expect(reserialized).toBeGreaterThan(REQUEST_LIMIT);
    expect(reserialized + 200).toBeLessThan(LIMIT);

    const reply = await postMcp(rig.serverUrl, rig.roomId, rig.joined.clientToken, rpc(22));
    expect(reply).toEqual({ status: 413, body: { jsonrpc: "2.0", id: 22, error: REQUEST_TOO_LARGE } });

    const agent = await openRecordingSocket(`${rig.relay.wsBase}/p/${rig.roomId}/client`, rig.joined.clientToken, sockets);
    agent.send(`{"type":"mcp","message":${rpc("ws-1e20")}}`);
    const refusal = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === "ws-1e20", "WebSocket refusal");
    expect(refusal.message?.error).toEqual(REQUEST_TOO_LARGE);

    expect(sentMcp(forwarded)).toEqual([]);
    expect(invoked).toEqual([]);
    expect((await rig.call(23, "echo")).body.result).toMatchObject({ isError: false });
  });

  it("forwards an HTTP notification of exactly the request limit, and answers one byte more with 413 and forwards nothing", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const providerSocket = relay.server.rooms.get(room.id)!.providerSocket;
    const notification = (size: number) => sized(size, (pad) => ({ jsonrpc: "2.0", method: "notifications/message", params: { pad } }));

    expect(await postMcp(relay.base, room.id, joined.clientToken, notification(REQUEST_LIMIT + 1))).toEqual({ status: 413, body: { jsonrpc: "2.0", id: null, error: REQUEST_TOO_LARGE } });

    // Exactly the request limit: the stamped `mcp` envelope around it fits, so it is forwarded.
    const atLimit = notification(REQUEST_LIMIT);
    expect(bytes({ type: "mcp", from: "client", sessionId: joined.sessionId, message: JSON.parse(atLimit) })).toBeGreaterThan(REQUEST_LIMIT);
    expect(await postMcp(relay.base, room.id, joined.clientToken, atLimit)).toEqual({ status: 202, body: null });
    await provider.waitFor((frame) => frame.type === "mcp", "forwarded notification", 5000);
    await flush(provider, "provider socket still open");
    // Only the notification that fits reached the provider.
    expect(provider.frames.filter((frame) => frame.type === "mcp")).toEqual([{ type: "mcp", from: "client", sessionId: joined.sessionId, message: JSON.parse(atLimit) }]);
    expect(relay.server.rooms.get(room.id)!.providerSocket).toBe(providerSocket);
  });
});

/**
 * Resolves with the relay's request object for the next request to `path`. The relay's own
 * handler runs first and has reached its first await (reading the body, for the room endpoints)
 * by the time this listener sees the request.
 */
function nextRequest(relay: Relay, path: string): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve) => {
    const onRequest = (req: IncomingMessage) => {
      if (req.url !== path) return;
      relay.server.server.off("request", onRequest);
      resolve(req);
    };
    relay.server.server.on("request", onRequest);
  });
}

/**
 * POSTs `body` but sends only its first byte, and resolves once the relay is reading it. `finish`
 * sends the rest and resolves with the reply.
 */
async function slowPost(relay: Relay, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ finish(): Promise<HttpReply> }> {
  const text = JSON.stringify(body);
  const seen = nextRequest(relay, path);
  const url = new URL(relay.base);
  let request!: ClientRequest;
  const reply = new Promise<HttpReply>((resolve, reject) => {
    request = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers },
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          data += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) as HttpReply["body"] }));
      },
    );
    request.on("error", reject);
  });
  request.write(text.slice(0, 1));
  await seen;
  return {
    finish: () => {
      request.end(text.slice(1));
      return reply;
    },
  };
}

describe("state-changing endpoints with a body that cannot be used", { timeout: 20_000 }, () => {
  const oversized = (body: Record<string, unknown>) => ({ ...body, pad: "o".repeat(100_000) });
  const reply = async (response: Response) => ({ status: response.status, body: (await response.json()) as unknown });

  /** POSTs a body that stops short of its Content-Length and aborts once the relay is reading it. */
  async function abortedPost(relay: Relay, path: string, authorization: string, partialBody: string): Promise<void> {
    const seen = nextRequest(relay, path);
    const url = new URL(relay.base);
    const socket = connect(Number(url.port), url.hostname);
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    socket.write(
      `POST ${path} HTTP/1.1\r\nHost: ${url.host}\r\nAuthorization: ${authorization}\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${Buffer.byteLength(partialBody) + 100}\r\n\r\n${partialBody}`,
    );
    // The relay's handler runs first and is reading the body by the time this listener sees the request.
    const req = await seen;
    socket.destroy();
    if (!req.destroyed) await new Promise<void>((resolve) => req.on("close", () => resolve()));
    // Let the handler continue past its failed read.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /** Sends a body that is not JSON. */
  const postMalformed = (url: string, authorization: string) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization }, body: "{not json" });

  it("does not decide an approval on an oversized, aborted or malformed body", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const requestId = joined.approvalRequestId!;
    const path = `/p/${room.id}/approval/${encodeURIComponent(requestId)}`;
    const authorization = `Bearer ${room.providerToken}`;
    const decision = { roomId: room.id, roomEpoch: room.roomEpoch, sessionId: joined.sessionId, decision: "approved" };
    const entry = relay.server.rooms.get(room.id)!;
    const ticket = () => [...entry.clientTickets.values()].find((candidate) => candidate.sessionId === joined.sessionId);

    expect(await reply(await postJson(`${relay.base}${path}`, oversized(decision), { authorization }))).toEqual({ status: 413, body: { error: "BODY_TOO_LARGE" } });
    await abortedPost(relay, path, authorization, JSON.stringify(decision));
    expect(await reply(await postMalformed(`${relay.base}${path}`, authorization))).toEqual({ status: 400, body: { error: "INVALID_JSON_BODY" } });
    expect(ticket()?.status).toBe("pending");
    expect(entry.pendingApprovals.has(requestId)).toBe(true);

    expect((await postJson(`${relay.base}${path}`, decision, { authorization })).status).toBe(200);
    expect(ticket()?.status).toBe("approved");
  });

  it("revokes no session on an oversized, aborted or malformed body (an empty one would revoke them all)", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const kept = await joinRoom(relay.base, room);
    const path = `/p/${room.id}/session/revoke`;
    const authorization = `Bearer ${room.providerToken}`;
    const target = { sessionId: kept.sessionId, reason: "one-session" };
    const statuses = () => [...relay.server.rooms.get(room.id)!.clientTickets.values()].map((ticket) => ticket.status);
    expect(statuses()).toEqual(["approved"]);

    expect(await reply(await postJson(`${relay.base}${path}`, oversized(target), { authorization }))).toEqual({ status: 413, body: { error: "BODY_TOO_LARGE" } });
    await abortedPost(relay, path, authorization, JSON.stringify(target));
    expect(await reply(await postMalformed(`${relay.base}${path}`, authorization))).toEqual({ status: 400, body: { error: "INVALID_JSON_BODY" } });
    expect(statuses()).toEqual(["approved"]);

    const revoked = await reply(await postJson(`${relay.base}${path}`, target, { authorization }));
    expect(revoked).toMatchObject({ status: 200, body: { sessionId: kept.sessionId, revoked: true, reason: "one-session" } });
    expect(statuses()).toEqual(["revoked"]);
  });

  it("does not rotate the room on an oversized, aborted or malformed body", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const path = `/p/${room.id}/rotate`;
    const authorization = `Bearer ${room.providerToken}`;
    const request = { roomId: room.id, roomEpoch: room.roomEpoch, alias: "rotated", ttlMs: 10 * 60_000 };
    const entry = relay.server.rooms.get(room.id)!;

    expect(await reply(await postJson(`${relay.base}${path}`, oversized(request), { authorization }))).toEqual({ status: 413, body: { error: "BODY_TOO_LARGE" } });
    await abortedPost(relay, path, authorization, JSON.stringify(request));
    expect(await reply(await postMalformed(`${relay.base}${path}`, authorization))).toEqual({ status: 400, body: { error: "INVALID_JSON_BODY" } });
    expect(entry.rotatedTo).toBeUndefined();
    expect(entry.roomState).not.toBe("rotated");
    expect([...relay.server.rooms.keys()]).toEqual([room.id]);

    const startedAt = Date.now();
    const rotated = await reply(await postJson(`${relay.base}${path}`, request, { authorization }));
    expect(rotated).toMatchObject({ status: 201, body: { alias: "rotated", previousRoomId: room.id } });
    const expiresAt = (rotated.body as { expiresAt: number }).expiresAt;
    expect(expiresAt).toBeGreaterThanOrEqual(startedAt + 10 * 60_000);
    expect(expiresAt).toBeLessThan(startedAt + 11 * 60_000);
  });

  /**
   * A relay whose customHttpHandler, for requests marked `x-test-hook`, reads the whole body
   * ("consume", like a signature check), takes its first chunk ("tee", like a logger that lets the
   * rest go by) or pauses the request ("pause"), and then lets the relay route it.
   */
  const hookedRelay = () =>
    startRelay(servers, {
      deploymentCatalog: { tools: [] },
      customHttpHandler: async (req) => {
        const mode = req.headers["x-test-hook"];
        if (mode === "consume") {
          for await (const _chunk of req) {
            // Read to the end.
          }
        } else if (mode === "tee") {
          await new Promise((resolve) => req.once("data", resolve));
        } else if (mode === "pause") {
          req.pause();
        }
        return false;
      },
    });

  it("answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused", async () => {
    const relay = await hookedRelay();
    const room = await createRoom(relay.base);
    const kept = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    const authorization = `Bearer ${room.providerToken}`;
    const consumed = { status: 500, body: { error: "BODY_CONSUMED", code: -32603 } };
    const statuses = () => [...entry.clientTickets.values()].map((ticket) => ticket.status);

    // Read as `{}`, this would revoke every session (no sessionId) instead of answering 404.
    const revoke = await postJson(`${relay.base}/p/${room.id}/session/revoke`, { sessionId: "peer-session-unknown" }, { authorization, "x-test-hook": "consume" });
    expect(await reply(revoke)).toEqual(consumed);
    expect(statuses()).toEqual(["approved"]);
    // Read as `{}` (or as what is left of it), these would rotate with the default TTL instead of
    // refusing the binding (409).
    for (const mode of ["consume", "tee"]) {
      const rotate = await postJson(`${relay.base}/p/${room.id}/rotate`, { roomId: "not-this-room", pad: "t".repeat(32_000) }, { authorization, "x-test-hook": mode });
      expect(await reply(rotate)).toEqual(consumed);
    }
    expect(entry.rotatedTo).toBeUndefined();
    const mcp = await postJson(`${relay.base}/p/${room.id}/mcp`, { jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${kept.clientToken}`, "x-test-hook": "consume" });
    expect(await reply(mcp)).toEqual({ status: 500, body: { jsonrpc: "2.0", id: null, error: { code: -32603, message: "BODY_CONSUMED" } } });

    // A refused join leaves the invite for the real one.
    const other = await createRoom(relay.base);
    expect(await reply(await postJson(`${relay.base}/p/${other.id}/join`, { inviteToken: other.inviteToken }, { "x-test-hook": "consume" }))).toEqual(consumed);
    expect((await joinRoom(relay.base, other)).clientToken).toMatch(/^[a-f0-9]+$/);

    // A paused request is resumed and read, instead of waiting for the server's request timeout.
    const paused = await settleWithin(
      postJson(`${relay.base}/p/${room.id}/rotate`, { roomId: room.id, roomEpoch: room.roomEpoch, alias: "after-pause" }, { authorization, "x-test-hook": "pause" }).then(reply),
      5000,
    );
    expect(paused).toMatchObject({ settled: true, value: { status: 201, body: { alias: "after-pause", previousRoomId: room.id } } });
  });

  it("checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    const provider = { authorization: `Bearer ${room.providerToken}` };
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };

    // Each request has passed the room checks and is waiting for the rest of its body.
    const slowRotate = await slowPost(relay, `/p/${room.id}/rotate`, binding, provider);
    const slowReclaim = await slowPost(relay, `/p/${room.id}/reclaim`, { ...binding, leaseToken: entry.reconnectLeaseToken });
    const slowRevoke = await slowPost(relay, `/p/${room.id}/session/revoke`, { sessionId: joined.sessionId }, provider);
    const slowApproval = await slowPost(
      relay,
      `/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`,
      { ...binding, sessionId: joined.sessionId, decision: "approved" },
      provider,
    );
    const other = await createRoom(relay.base);
    const slowJoin = await slowPost(relay, `/p/${other.id}/join`, { inviteToken: other.inviteToken });

    const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, binding, provider);
    expect(rotated.status).toBe(201);
    const replacement = (await rotated.json()) as RoomDescriptor;
    expect((await postJson(`${relay.base}/p/${other.id}/rotate`, {}, { authorization: `Bearer ${other.providerToken}` })).status).toBe(201);

    // Every route answers a room rotated meanwhile alike, naming its replacement: the second
    // rotation too, which mints no other one.
    const rotatedAway = { status: 410, body: { error: "ROOM_ROTATED", code: -32057, roomId: room.id, roomEpoch: room.roomEpoch, replacementRoomId: replacement.id } };
    expect(await slowRotate.finish()).toEqual(rotatedAway);
    expect(await slowReclaim.finish()).toEqual(rotatedAway);
    expect(await slowRevoke.finish()).toEqual(rotatedAway);
    expect(await slowApproval.finish()).toEqual(rotatedAway);
    expect(await slowJoin.finish()).toMatchObject({ status: 410, body: { error: "ROOM_ROTATED", code: -32057, roomId: other.id } });

    // One replacement per rotated room, nothing minted for the dead ones, tickets as rotated.
    const live = [...relay.server.rooms.values()].filter((candidate) => !candidate.rotatedTo && candidate.expiresAt > Date.now());
    expect(live.map((candidate) => candidate.roomEpoch)).toEqual([2, 2]);
    expect(live.map((candidate) => candidate.id)).toContain(replacement.id);
    expect(entry.rotatedTo).toBe(replacement.id);
    expect(entry.roomState).toBe("rotated");
    expect([...entry.clientTickets.values()].map((ticket) => ticket.status)).toEqual(["room-rotated"]);
    expect(relay.server.rooms.get(other.id)!.clientTickets.size).toBe(0);
  });

  it("refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    const stale = { authorization: `Bearer ${room.providerToken}` };
    const binding = { roomId: room.id, roomEpoch: room.roomEpoch };

    const slowApproval = await slowPost(
      relay,
      `/p/${room.id}/approval/${encodeURIComponent(joined.approvalRequestId!)}`,
      { ...binding, sessionId: joined.sessionId, decision: "approved" },
      stale,
    );
    const slowRotate = await slowPost(relay, `/p/${room.id}/rotate`, binding, stale);
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { ...binding, leaseToken: entry.reconnectLeaseToken });
    expect(reclaim.status).toBe(200);
    expect(entry.providerToken).not.toBe(room.providerToken);

    // The token the reclaim replaced is a wrong one now, not a missing one.
    expect(await slowApproval.finish()).toEqual({ status: 401, body: { error: "PROVIDER_TOKEN_INVALID" } });
    expect(await slowRotate.finish()).toEqual({ status: 401, body: { error: "PROVIDER_TOKEN_INVALID" } });
    expect([...entry.clientTickets.values()].map((ticket) => ticket.status)).toEqual(["pending"]);
    expect(entry.rotatedTo).toBeUndefined();
  });
});

describe("requests after the relay closed the provider socket", { timeout: 20_000 }, () => {
  it.each(["http", "ws"] as const)("answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider", async (transport) => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    // The provider never answers the relay's close (allowHalfOpen), so the relay's socket stays
    // half-open and its onClose does not run: only the send result tells the relay it is gone.
    const raw = await RawWebSocket.open(relay.base, `/p/${room.id}/provider`, room.providerToken, { allowHalfOpen: true });
    await raw.waitForMessage((message) => message.type === "ready", "provider ready");
    raw.sendFrame(1, JSON.stringify({ type: "register", tools: [tool("echo")] }));
    await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "catalog", 5000);
    const joined = await joinRoom(relay.base, room);
    const agent = transport === "ws" ? await openClient(relay, room, joined, sockets) : undefined;
    const entry = relay.server.rooms.get(room.id)!;

    raw.sendHeaderOnly(1, LIMIT + 1);
    expect(await raw.waitForClose("relay closes the provider with 1009")).toBe(1009);

    const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } };
    if (agent) {
      agent.send({ type: "mcp", message: call });
      const refused = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 1, "PROVIDER_UNAVAILABLE", 5000);
      expect(refused).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: 1, error: PROVIDER_UNAVAILABLE } });
    } else {
      const refused = await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify(call));
      expect(refused).toEqual({ status: 503, body: { jsonrpc: "2.0", id: 1, error: PROVIDER_UNAVAILABLE } });
    }
    expect(entry.providerSocket).toBeUndefined();
    expect(entry.mcpPending.size).toBe(0);

    // The room is free for the provider's lease: a reclaim attaches a new provider socket.
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { leaseToken: entry.reconnectLeaseToken, roomId: room.id, roomEpoch: room.roomEpoch });
    expect(reclaim.status).toBe(200);
    const reclaimed = (await reclaim.json()) as RoomDescriptor & { reclaimed?: boolean };
    expect(reclaimed).toMatchObject({ id: room.id, reclaimed: true });
    const next = await openProvider(relay, reclaimed, sockets);
    await next.waitFor((frame) => frame.type === "ready", "new provider ready", 5000);
    next.ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      if (frame.type !== "mcp" || frame.message?.method !== "tools/call") return;
      next.send({ type: "mcp", message: { jsonrpc: "2.0", id: frame.message.id, result: { ok: true } } });
    });
    expect(entry.providerSocket).toBeDefined();
    const answered = await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify({ ...call, id: 2 }));
    expect(answered).toEqual({ status: 200, body: { jsonrpc: "2.0", id: 2, result: { ok: true } } });
  });
});

describe("provider and client socket attachment", { timeout: 20_000 }, () => {
  it("closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    // allowHalfOpen: the old provider ignores the relay's close and keeps writing.
    const old = await RawWebSocket.open(relay.base, `/p/${room.id}/provider`, room.providerToken, { allowHalfOpen: true });
    await old.waitForMessage((message) => message.type === "ready", "old provider ready");
    old.sendFrame(1, JSON.stringify({ type: "register", tools: [tool("fromOld")] }));
    await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "old provider's catalog", 5000);
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fromOld", arguments: {} } } });
    await old.waitForMessage((message) => message.type === "mcp" && message.message?.id === 1, "call forwarded to the old provider");

    const next = await openProvider(relay, room, sockets);
    await next.waitFor((frame) => frame.type === "ready", "new provider ready", 5000);
    // 4001 SUPERSEDED, without a frame: the replaced provider must not reconnect and take the room back.
    expect(await old.waitForClose("old provider closed")).toBe(WEBMCP_CLOSE_CODES.SUPERSEDED);
    const failed = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 1, "the old provider's call fails", 5000);
    expect(failed.message.error).toEqual({ code: -32001, message: "PROVIDER_DISCONNECTED" });

    // Neither a late reply nor a register from the old socket reaches the room.
    old.sendFrame(1, JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id: 1, result: { late: true } } }));
    old.sendFrame(1, JSON.stringify({ type: "register", tools: [tool("fromOldAgain")] }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    next.send({ type: "register", tools: [tool("fromNew")] });
    const catalog = await until(() => roomCatalog(relay.base, room.id), (value) => value.body.catalogVersion >= 2, "new provider's catalog", 5000);
    await flush(next, "new provider still attached");
    await flush(agent, "agent socket still open");
    expect((await roomCatalog(relay.base, room.id)).body).toMatchObject({ catalogVersion: 2, catalogHash: catalog.body.catalogHash, tools: [tool("fromNew")] });
    expect(agent.frames.filter((frame) => frame.type === "mcp" && frame.message?.id === 1)).toHaveLength(1);
  });

  /** Opens every gate a holding relay still holds, so its server can close, and drops held clients. */
  const heldGates: Array<() => void> = [];
  const heldClients: Socket[] = [];
  afterEach(() => {
    for (const open of heldGates.splice(0)) open();
    for (const client of heldClients.splice(0)) client.destroy();
  });

  /**
   * Sends a WebSocket upgrade for `path` over raw TCP, marked so the test's customUpgradeHandler
   * holds it. `allowHalfOpen` lets the client end its sending side and still read.
   */
  async function heldUpgrade(relay: Relay, path: string, ticket: string): Promise<Socket> {
    const url = new URL(relay.base);
    const socket = connect({ port: Number(url.port), host: url.hostname, allowHalfOpen: true });
    heldClients.push(socket);
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    socket.write(
      [
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Protocol: webmcp-peer.v1, ticket.${ticket}`,
        "X-Test-Hold: 1",
        "",
        "",
      ].join("\r\n"),
    );
    return socket;
  }

  /**
   * A relay whose customUpgradeHandler holds marked upgrades until they are released, the way an
   * upgrade hook that awaits (an auth lookup) does.
   */
  async function holdingRelay() {
    const held: Duplex[] = [];
    const released = gate();
    heldGates.push(released.open);
    const relay = await startRelay(servers, {
      deploymentCatalog: { tools: [] },
      customUpgradeHandler: async (req, socket) => {
        if (req.headers["x-test-hold"] !== "1") return false;
        held.push(socket);
        await released.promise;
        return false;
      },
    });
    /**
     * Lets a held upgrade continue once its client has hung up and the relay's socket has seen it:
     * `end` sends FIN and keeps reading (nothing on the relay's side ever errors), `destroy` closes
     * the client socket.
     */
    const releaseAfterHangUp = async (client: Socket, hangUp: "end" | "destroy" = "end") => {
      await until(() => held.length, (count) => count > 0, "upgrade held", 5000);
      if (hangUp === "end") client.end();
      else client.destroy();
      await until(() => held[0]!.readableEnded || held[0]!.destroyed, Boolean, "the relay's socket sees the client gone", 5000);
      released.open();
      // handleUpgrade continues on the released promise.
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    return { relay, held, release: released.open, releaseAfterHangUp };
  }

  it.each(["end", "destroy"] as const)("does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting", async (hangUp) => {
    const { relay, releaseAfterHangUp } = await holdingRelay();
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;

    await releaseAfterHangUp(await heldUpgrade(relay, `/p/${room.id}/provider`, room.providerToken), hangUp);
    expect(entry.providerSocket).toBeUndefined();
    const descriptor = (await (await fetch(`${relay.base}/p/${room.id}/mcp`)).json()) as { providerConnected: boolean };
    expect(descriptor.providerConnected).toBe(false);
    // The provider's lease is not blocked by a provider that is not there.
    const reclaim = await postJson(`${relay.base}/p/${room.id}/reclaim`, { leaseToken: entry.reconnectLeaseToken, roomId: room.id, roomEpoch: room.roomEpoch });
    expect(reclaim.status).toBe(200);
  });

  it("survives a client that resets its connection while a customUpgradeHandler is awaiting", async () => {
    // Node's HTTP server no longer handles errors on an upgrade socket, so a reset (ECONNRESET)
    // during the hook's await must not become an uncaught exception that ends the relay process.
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    try {
      const { relay, held, release } = await holdingRelay();
      const room = await createRoom(relay.base);
      const client = await heldUpgrade(relay, `/p/${room.id}/provider`, room.providerToken);
      await until(() => held.length, (count) => count > 0, "upgrade held", 5000);
      client.resetAndDestroy();
      await until(() => held[0]!.destroyed, Boolean, "the relay's socket sees the reset", 5000);
      // An 'error' event nobody handles is thrown on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toEqual([]);

      // The relay keeps serving, and the reset upgrade attached nothing.
      const entry = relay.server.rooms.get(room.id)!;
      expect(entry.providerSocket).toBeUndefined();
      expect((await fetch(`${relay.base}/health`)).status).toBe(200);
      const provider = await openProvider(relay, room, sockets);
      await provider.waitFor((frame) => frame.type === "ready", "a provider attaches after the reset", 5000);
      expect(entry.providerSocket).toBeDefined();
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("does not let a dead provider upgrade displace the attached provider", async () => {
    const { relay, releaseAfterHangUp } = await holdingRelay();
    const room = await createRoom(relay.base);
    const entry = relay.server.rooms.get(room.id)!;
    const live = await openProvider(relay, room, sockets);
    await live.waitFor((frame) => frame.type === "ready", "live provider ready", 5000);
    const attached = entry.providerSocket;
    expect(attached).toBeDefined();

    await releaseAfterHangUp(await heldUpgrade(relay, `/p/${room.id}/provider`, room.providerToken));
    expect(entry.providerSocket).toBe(attached);
    await flush(live, "live provider still open");
    live.send({ type: "register", tools: [tool("live")] });
    await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "live provider's catalog", 5000);
  });

  it("does not attach a client socket whose client went away while a customUpgradeHandler was awaiting", async () => {
    const { relay, releaseAfterHangUp } = await holdingRelay();
    const room = await createRoom(relay.base);
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;

    await releaseAfterHangUp(await heldUpgrade(relay, `/p/${room.id}/client`, joined.clientToken));
    expect(entry.clientSockets.size).toBe(0);
    expect(entry.clientSocketTickets.size).toBe(0);
  });

  it("holds at most 4 client sockets per ticket, closing the oldest for a new one", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const entry = relay.server.rooms.get(room.id)!;
    const clients: RawWebSocket[] = [];
    for (let index = 0; index <= MAX_SOCKETS_PER_TICKET; index++) {
      const client = await RawWebSocket.open(relay.base, `/p/${room.id}/client`, joined.clientToken);
      await client.waitForMessage((message) => message.type === "ready", `client ${index} ready`);
      clients.push(client);
    }

    // 4001 SUPERSEDED: the session goes on, on the newer sockets.
    expect(await clients[0]!.waitForClose("the oldest socket closed")).toBe(WEBMCP_CLOSE_CODES.SUPERSEDED);
    expect(entry.clientSockets.size).toBe(MAX_SOCKETS_PER_TICKET);
    provider.send({ type: "register", tools: [tool("a")] });
    for (const client of clients.slice(1)) await client.waitForMessage((message) => message.type === "register", "announcement");
    expect(clients.slice(1).map((client) => client.closeCode())).toEqual(Array.from({ length: MAX_SOCKETS_PER_TICKET }, () => undefined));
    expect(clients[0]!.messages().map((text) => (JSON.parse(text) as Frame).type)).toEqual(["ready"]);
  });
});

describe("what one agent can make the relay hold", { timeout: 20_000 }, () => {
  it("refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", tools: [tool("echo")] });
    await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "catalog", 5000);
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const call = (id: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: {} } });
    // Measured in UTF-8 bytes of the JSON text: 511 two-byte characters fit, 512 do not.
    const fitting = [idOfJsonBytes(MAX_ID_BYTES), "é".repeat(511)];
    const oversized = [idOfJsonBytes(MAX_ID_BYTES + 1), "é".repeat(512)];
    expect([...fitting, ...oversized].map((id) => bytes(JSON.stringify(id)))).toEqual([MAX_ID_BYTES, MAX_ID_BYTES, MAX_ID_BYTES + 1, MAX_ID_BYTES + 2]);

    for (const id of oversized) {
      agent.send({ type: "mcp", message: call(id) });
      expect(await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify(call(id)))).toEqual({
        status: 400,
        body: { jsonrpc: "2.0", id: null, error: REQUEST_ID_TOO_LARGE },
      });
    }
    for (const id of fitting) agent.send({ type: "mcp", message: call(id) });
    await until(() => provider.frames.filter((frame) => frame.type === "mcp").length, (count) => count === fitting.length, "fitting ids forwarded", 5000);
    await flush(agent, "agent socket still open");
    expect(agent.frames.filter((frame) => frame.type === "mcp")).toEqual([
      { type: "mcp", message: { jsonrpc: "2.0", id: null, error: REQUEST_ID_TOO_LARGE } },
      { type: "mcp", message: { jsonrpc: "2.0", id: null, error: REQUEST_ID_TOO_LARGE } },
    ]);
    expect(provider.frames.filter((frame) => frame.type === "mcp").map((frame) => frame.message.id)).toEqual(fitting);
  });

  it("refuses an offer whose requestId is over 1 KiB of JSON without echoing or forwarding it, since the provider's answer repeats it", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const offers = (socket: { frames: Frame[] }) => socket.frames.filter((frame) => frame.type === "offer");
    // Measured as a request id is: UTF-8 bytes of its JSON text.
    const fitting = [idOfJsonBytes(MAX_ID_BYTES), "é".repeat(511)];
    const oversized = [idOfJsonBytes(MAX_ID_BYTES + 1), "é".repeat(512)];

    for (const requestId of oversized) agent.send({ type: "offer", sdp: "v=0", requestId });
    // An agent socket has one offer waiting for its answer at a time: each fitting one is answered
    // before the next is sent.
    for (const [index, requestId] of fitting.entries()) {
      agent.send({ type: "offer", sdp: "v=0", requestId });
      await until(() => offers(provider).length, (count) => count === index + 1, `fitting offer ${index} forwarded`, 5000);
      provider.send({ type: "answer", requestId, sdp: "v=0 answer" });
      await agent.waitFor((frame) => frame.type === "answer" && frame.requestId === requestId, `answer ${index}`, 5000);
    }
    await flush(agent, "agent socket still open");
    await flush(provider, "provider socket still open");
    expect(agent.frames.filter((frame) => frame.type === "offer.refused")).toEqual([
      { type: "offer.refused", error: REQUEST_ID_TOO_LARGE },
      { type: "offer.refused", error: REQUEST_ID_TOO_LARGE },
    ]);
    expect(offers(provider)).toEqual(fitting.map((requestId) => ({ type: "offer", sdp: "v=0", requestId, from: "client", sessionId: joined.sessionId })));
  });

  it("lets an agent socket have at most 64 requests waiting for the provider", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    provider.send({ type: "register", tools: [tool("slow")] });
    await until(() => roomCatalog(relay.base, room.id), (value) => value.status === 200, "catalog", 5000);
    const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
    const forwarded = () => provider.frames.filter((frame) => frame.type === "mcp");
    const call = (id: number) => ({ type: "mcp", message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "slow", arguments: {} } } });

    for (let id = 1; id <= MAX_PENDING_PER_SOCKET + 1; id++) agent.send(call(id));
    const refused = await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === MAX_PENDING_PER_SOCKET + 1, "the request past the bound", 5000);
    expect(refused.message.error).toEqual({ code: -32087, message: "TOO_MANY_PENDING_REQUESTS", data: { limit: MAX_PENDING_PER_SOCKET } });
    await until(forwarded, (frames) => frames.length === MAX_PENDING_PER_SOCKET, "requests within the bound forwarded", 5000);
    expect(relay.server.rooms.get(room.id)!.mcpPending.size).toBe(MAX_PENDING_PER_SOCKET);

    // An answer frees a slot.
    provider.send({ type: "mcp", message: { jsonrpc: "2.0", id: 1, result: { content: [] } } });
    await agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === 1, "first answer", 5000);
    agent.send(call(1000));
    await until(forwarded, (frames) => frames.some((frame) => frame.message?.id === 1000), "a request after the slot was freed", 5000);
    expect(forwarded()).toHaveLength(MAX_PENDING_PER_SOCKET + 1);
  });

  it("sends a pending ticket's approval request to each provider socket once, however often the agent calls", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base, { approvalRequired: true });
    const provider = await openProvider(relay, room, sockets);
    await provider.waitFor((frame) => frame.type === "ready", "provider ready", 5000);
    const joined = await joinRoom(relay.base, room, { clientLabel: "agent" });
    const approvalRequests = (socket: { frames: Frame[] }) => socket.frames.filter((frame) => frame.type === "approval.request");
    await provider.waitFor((frame) => frame.type === "approval.request", "the approval request", 5000);
    const status = () =>
      fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } }).then((response) => response.json());

    // MCP POSTs, a client socket and status polls from the pending ticket send nothing more.
    for (let id = 0; id < 20; id++) {
      expect((await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }))).status).toBe(200);
    }
    const client = await openClient(relay, room, joined, sockets);
    await client.waitFor((frame) => frame.type === "approval.pending", "approval.pending on the client socket", 5000);
    for (let poll = 0; poll < 3; poll++) expect(await status()).toMatchObject({ state: "pending-approval" });
    await flush(provider, "every call processed");
    expect(approvalRequests(provider)).toHaveLength(1);

    // A provider socket that attaches later (replacing this one) gets the request once as well.
    const next = await openProvider(relay, room, sockets);
    await next.waitFor((frame) => frame.type === "approval.request", "the request on the new provider socket", 5000);
    for (let id = 20; id < 25; id++) await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }));
    await flush(next, "every later call processed");
    expect(approvalRequests(next)).toHaveLength(1);
    expect(approvalRequests(next)[0]).toMatchObject({ requestId: joined.approvalRequestId, sessionId: joined.sessionId, payload: { clientLabel: "agent" } });
  });

  it("trims a join's clientLabel and keeps at most its first 256 code points", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const cases = [
      { label: `  ${"L".repeat(60_000)}  `, kept: "L".repeat(256) },
      // Cut by code point, never inside a surrogate pair.
      { label: "\u{1F600}".repeat(300), kept: "\u{1F600}".repeat(256) },
      // The cut leaves no trailing whitespace.
      { label: `${"a".repeat(255)} b`, kept: "a".repeat(255) },
      { label: "  short label  ", kept: "short label" },
    ];
    for (const { label, kept } of cases) {
      const room = await createRoom(relay.base, { approvalRequired: true });
      const provider = await openProvider(relay, room, sockets);
      await provider.waitFor((frame) => frame.type === "ready", "provider ready", 5000);
      const joined = await joinRoom(relay.base, room, { clientLabel: label });
      const request = await provider.waitFor((frame) => frame.type === "approval.request", "the approval request", 5000);
      expect(request.payload.clientLabel).toBe(kept);
      const session = (await (await fetch(`${relay.base}/p/${room.id}/sessions/${joined.sessionId}`, { headers: { authorization: `Bearer ${joined.clientToken}` } })).json()) as Frame;
      expect(session.clientLabel).toBe(kept);
    }
  });

  it("trims a room's alias and keeps at most its first 256 code points, on creation and on rotation", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const cases = [
      { alias: `  ${"A".repeat(60_000)}  `, kept: "A".repeat(256) },
      // Cut by code point, never inside a surrogate pair.
      { alias: "\u{1F600}".repeat(300), kept: "\u{1F600}".repeat(256) },
      // The cut leaves no trailing whitespace.
      { alias: `${"a".repeat(255)} b`, kept: "a".repeat(255) },
      { alias: "  short alias  ", kept: "short alias" },
    ];
    const descriptorAlias = async (roomId: string) =>
      ((await (await fetch(`${relay.base}/p/${roomId}/mcp`)).json()) as Frame).alias;
    for (const { alias, kept } of cases) {
      const created = await postJson(`${relay.base}/p`, { alias });
      const room = (await created.json()) as RoomDescriptor & { alias: string };
      expect(room.alias).toBe(kept);
      expect(await descriptorAlias(room.id)).toBe(kept);

      const rotated = await postJson(`${relay.base}/p/${room.id}/rotate`, { alias }, { authorization: `Bearer ${room.providerToken}` });
      const replacement = (await rotated.json()) as RoomDescriptor & { alias: string };
      expect(replacement.alias).toBe(kept);
      expect(await descriptorAlias(replacement.id)).toBe(kept);
    }
  });

  it("stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    const room = await createRoom(relay.base);
    const provider = await openProvider(relay, room, sockets);
    const joined = await joinRoom(relay.base, room);
    const agent = await openClient(relay, room, joined, sockets);
    const forwarded = () => provider.frames.filter((frame) => frame.type === "mcp");
    const spoofed = { from: "provider", sessionId: "someone-else" };

    agent.send({ type: "mcp", ...spoofed, message: { jsonrpc: "2.0", id: 1, method: "resources/list" } });
    agent.send({ type: "mcp", ...spoofed, message: { jsonrpc: "2.0", method: "notifications/initialized" } });
    await until(forwarded, (frames) => frames.length === 2, "WebSocket frames forwarded", 5000);
    const notification = { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } };
    expect(await postMcp(relay.base, room.id, joined.clientToken, JSON.stringify(notification))).toEqual({ status: 202, body: null });
    await until(forwarded, (frames) => frames.length === 3, "HTTP notification forwarded", 5000);

    const stamp = { from: "client", sessionId: joined.sessionId };
    expect(forwarded()).toEqual([
      { type: "mcp", ...stamp, message: { jsonrpc: "2.0", id: 1, method: "resources/list" } },
      { type: "mcp", ...stamp, message: { jsonrpc: "2.0", method: "notifications/initialized" } },
      { type: "mcp", ...stamp, message: notification },
    ]);
  });

  it("announces only the catalog it measured, never one over the announcement limit", async () => {
    class InspectableRelay extends WebMcpPeerServer {
      offerCatalog(entry: RoomEntry, tools: unknown, fields: Record<string, unknown>) {
        return this.acceptProviderCatalog(entry, tools, fields);
      }
    }
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } }, (options) => new InspectableRelay(options));
    const server = relay.server as InspectableRelay;
    const room = await createRoom(relay.base);
    const entry = server.rooms.get(room.id)!;
    // Two catalogs that differ only under an own `__proto__` key (as JSON.parse creates one): the
    // first carries 200 KB there, the second nothing, but its register frame 100 KB of other fields.
    const catalogWith = (proto: unknown) =>
      JSON.parse(`[{"name":"t","inputSchema":{"type":"object","properties":{"__proto__":${JSON.stringify(proto)}}}}]`) as unknown[];
    const first = server.offerCatalog(entry, catalogWith({ type: "string", description: "p".repeat(200_000) }), { type: "register" });
    expect(first.kind).toBe("accepted");

    const second = server.offerCatalog(entry, catalogWith({}), { type: "register", extra: "e".repeat(100_000) });
    expect(second.kind === "accepted" || second.kind === "unchanged").toBe(true);
    if (second.kind === "accepted") {
      expect(bytes(second.announcement)).toBeLessThanOrEqual(ANNOUNCEMENT_LIMIT);
      expect(second.announcement.tools).toBe(entry.cachedTools);
    }
  });
});

describe("WebSocket agent requests and replies the relay cannot forward", { timeout: 20_000 }, () => {
  it("forwards an agent request of exactly the request limit under a rewritten id, and answers one byte more with REQUEST_TOO_LARGE on the agent's socket", async () => {
    const slow = gate();
    const invoked: string[] = [];
    const rig = await providerRig([descriptorTool("echo", "echoes"), descriptorTool("slow", "waits")], async (name) => {
      invoked.push(name);
      if (name === "slow") await slow.promise;
      return { ok: true, echo: name };
    });
    const providerSocket = rig.room().providerSocket!;
    const forwarded = recordSent(providerSocket);

    // An HTTP request holds id 7 at the relay, so the relay must rewrite the agent's id 7 on the wire.
    const httpCall = rig.call(7, "slow");
    await until(() => invoked.includes("slow"), Boolean, "slow call reached the provider");
    expect([...rig.room().mcpPending.keys()]).toEqual(["number:7"]);

    const agent = await openRecordingSocket(`${rig.relay.wsBase}/p/${rig.roomId}/client`, rig.joined.clientToken, sockets);
    const frameOf = (size: number) => sized(size, (pad) => ({ type: "mcp", message: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: { pad } } } }));

    // Exactly the request limit as the agent sends it: the stamped copy under the longer wire id
    // still fits the message limit, so it is forwarded and answered under the agent's own id.
    const atLimit = frameOf(REQUEST_LIMIT);
    agent.send(atLimit);
    const answered = await agent.waitFor((value) => value.type === "mcp" && value.message?.id === 7, "answer to the request of the limit", 5000);
    expect(answered.message.result).toMatchObject({ isError: false, structuredContent: { echo: "echo" } });
    expect(invoked).toEqual(["slow", "echo"]);
    const copy = forwarded.find((text) => (JSON.parse(text) as Frame).message?.params?.name === "echo")!;
    expect(JSON.parse(copy)).toEqual({
      ...(JSON.parse(atLimit) as Frame),
      from: "client",
      sessionId: rig.joined.sessionId,
      message: { ...(JSON.parse(atLimit) as Frame).message, id: expect.stringMatching(/^framebook:\d+:number:7$/) },
    });
    expect(bytes(copy)).toBeGreaterThan(REQUEST_LIMIT);
    expect(bytes(copy)).toBeLessThanOrEqual(LIMIT);

    // One byte more is refused on the agent's socket; a notification over the limit, which has no
    // one to answer, is dropped.
    const forwardedBefore = sentMcp(forwarded).length;
    agent.send(frameOf(REQUEST_LIMIT + 1));
    const refused = await agent.waitFor((value) => value.type === "mcp" && value.message?.id === 7 && value.message.error !== undefined, "REQUEST_TOO_LARGE", 5000);
    expect(refused).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: 7, error: REQUEST_TOO_LARGE } });
    agent.send(sized(REQUEST_LIMIT + 1, (pad) => ({ type: "mcp", message: { jsonrpc: "2.0", method: "notifications/message", params: { pad } } })));
    await flush(agent, "agent socket still open");
    expect(agent.frames.filter((frame) => frame.type === "mcp")).toHaveLength(2);

    // Nothing more reached the provider, only the HTTP request holds a slot, and both sockets stay open.
    expect(sentMcp(forwarded)).toHaveLength(forwardedBefore);
    expect([...rig.room().mcpPending.keys()]).toEqual(["number:7"]);
    expect(invoked).toEqual(["slow", "echo"]);
    expect(rig.room().providerSocket).toBe(providerSocket);

    slow.open();
    expect((await httpCall).body).toMatchObject({ id: 7, result: { isError: false, structuredContent: { echo: "slow" } } });
    expect(new Set(rig.states)).toEqual(new Set(["waiting"]));
  });

  it("answers RESULT_TOO_LARGE when the relay's catalog metadata pushes a provider reply over the limit", async () => {
    const relay = await startRelay(servers, { deploymentCatalog: { tools: [] } });
    // The largest catalog the relay accepts, so the provider's tools/list reply is as large as it gets.
    const largest = registerWithAnnouncementOf(ANNOUNCEMENT_LIMIT, 1, { alias: null });
    // The relay passes a listing reply on, stamped, only while it holds no catalog (then it takes
    // the reply's), so each case is a room of its own.
    const listedRoom = async () => {
      const room = await createRoom(relay.base);
      const provider = await openProvider(relay, room, sockets);
      const agent = await openClient(relay, room, await joinRoom(relay.base, room), sockets);
      return { room, provider, agent };
    };

    // Request ids are at most 1 KiB, so the provider's reply is made 150 bytes under the limit by a
    // field of its own result next to the catalog.
    const replyTo = (id: string, extra = "") => ({ type: "mcp", message: { jsonrpc: "2.0", id, result: { tools: largest.frame.tools, extra } } });
    const sizedReply = (id: string) => replyTo(id, "r".repeat(LIMIT - 150 - bytes(replyTo(id))));
    const answer = async (provider: RecordingSocket, id: string) => {
      await provider.waitFor((frame) => frame.type === "mcp" && frame.message?.id === id, "forwarded tools/list", 5000);
      provider.send(sizedReply(id));
    };

    // Without _meta the relay adds its stamp to result._meta only (about 100 bytes): the reply fits.
    const plainRoom = await listedRoom();
    const plainId = "plain";
    plainRoom.agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: plainId, method: "tools/list", params: {} } });
    await answer(plainRoom.provider, plainId);
    const plain = await plainRoom.agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === plainId, "plain reply", 5000);
    const stamp = { catalogVersion: 1, catalogHash: (await roomCatalog(relay.base, plainRoom.room.id)).body.catalogHash };
    const sized = sizedReply(plainId);
    expect(plain).toEqual({ ...sized, message: { ...sized.message, result: { ...sized.message.result, _meta: stamp } } });
    expect(bytes(plain)).toBeLessThanOrEqual(LIMIT);

    // With _meta the relay adds the stamp at the top of the result too (about 100 bytes more).
    const metaRoom = await listedRoom();
    const metaId = "meta";
    metaRoom.agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: metaId, method: "tools/list", params: { _meta: {} } } });
    await answer(metaRoom.provider, metaId);
    const refused = await metaRoom.agent.waitFor((frame) => frame.type === "mcp" && frame.message?.id === metaId, "RESULT_TOO_LARGE", 5000);
    expect(refused).toEqual({ type: "mcp", message: { jsonrpc: "2.0", id: metaId, error: RESULT_TOO_LARGE } });

    await flush(metaRoom.agent, "agent socket still open");
    await flush(metaRoom.provider, "provider socket still open");
    expect(relay.server.rooms.get(metaRoom.room.id)!.mcpPending.size).toBe(0);
  });

  it("refuses an oversized request in the client before sending it and rejects only that call", async () => {
    const slow = gate();
    const invokedArgs: Array<[string, Record<string, unknown> | undefined]> = [];
    const rig = await providerRig([descriptorTool("echo", "echoes"), descriptorTool("slow", "waits")], async (name, args) => {
      invokedArgs.push([name, args]);
      if (name === "slow") await slow.promise;
      return { ok: true, echo: name };
    });
    // Over the request limit once wrapped, though it would fit one relay message.
    const oversized = { pad: "q".repeat(REQUEST_LIMIT) };

    // WebSocket transport: the in-flight call survives the refused one.
    RecordingWebSocket.instances.length = 0;
    const session = await rig.wsSession({ WebSocket: RecordingWebSocket });
    await session.listTools();
    const inFlight = session.callTool("slow");
    inFlight.catch(() => {}); // awaited below; never an unhandled rejection if the test fails early
    await until(() => invokedArgs.some(([name]) => name === "slow"), Boolean, "slow call reached the provider");
    const refusal = await session.callTool("echo", oversized).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(PeerMcpError);
    expect(refusal).toMatchObject({ code: "REQUEST_TOO_LARGE", details: { limitBytes: REQUEST_LIMIT } });
    const refusedBytes = (refusal as PeerMcpError & { details: { bytes: number } }).details.bytes;
    expect(refusedBytes).toBeGreaterThan(REQUEST_LIMIT);
    expect(refusedBytes).toBeLessThanOrEqual(LIMIT);
    expect(session.state).toBe("connected");
    slow.open();
    expect(await inFlight).toMatchObject({ isError: false, structuredContent: { echo: "slow" } });
    expect(await session.callTool("echo", { small: true })).toMatchObject({ isError: false });
    const sentByAgent = RecordingWebSocket.instances.flatMap((ws) => ws.sentText);
    expect(sentByAgent.length).toBeGreaterThan(0);
    expect(Math.max(...sentByAgent.map(bytes))).toBeLessThanOrEqual(REQUEST_LIMIT);

    // HTTP transport: refused before fetch is called.
    const posted: number[] = [];
    const recordingFetch: typeof fetch = (input, init) => {
      if (init?.method === "POST" && typeof init.body === "string") posted.push(bytes(init.body));
      return fetch(input, init);
    };
    const http = new PeerMcpSession({
      mcpEndpoint: rig.joined.mcpEndpoint,
      clientToken: rig.joined.clientToken,
      sessionId: rig.joined.sessionId,
      fetchImpl: recordingFetch,
      requestTimeoutMs: 5000,
    });
    sessions.push(http);
    await http.listTools();
    await expect(http.callTool("echo", oversized)).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", details: { limitBytes: REQUEST_LIMIT } });
    expect(await http.callTool("echo", { small: true })).toMatchObject({ isError: false, structuredContent: { echo: "echo" } });
    expect(Math.max(...posted)).toBeLessThanOrEqual(REQUEST_LIMIT);

    expect(invokedArgs.map(([name, args]) => [name, Object.keys(args ?? {})])).toEqual([
      ["slow", []],
      ["echo", ["small"]],
      ["echo", ["small"]],
    ]);
  });
});

describe("inbound frame limits and close codes", { timeout: 20_000 }, () => {
  it("accepts a single frame of exactly the limit and refuses one byte more with 1009 from the header alone", async () => {
    const { openRaw } = await rawProviderRoom();
    const raw = await openRaw();

    raw.sendFrame(1, pingOfSize(LIMIT));
    await raw.waitForMessage((message) => message.type === "pong", "pong for a full-size frame");
    expect(raw.closeCode()).toBeUndefined();

    // Only the header and masking key: the relay must refuse it without waiting for the payload.
    raw.sendHeaderOnly(1, LIMIT + 1);
    expect(await raw.waitForClose("close for an oversized frame")).toBe(1009);
    await until(() => raw.ended, Boolean, "relay ends the socket");
  });

  it("counts only continuation frames toward a fragmented message, not a ping between them", async () => {
    const { openRaw } = await rawProviderRoom();
    const raw = await openRaw();
    const message = Buffer.from(pingOfSize(LIMIT));
    const pingPayload = Buffer.alloc(125, 0x61);

    raw.sendFrame(1, message.subarray(0, 200_000), { fin: false });
    raw.sendFrame(9, pingPayload);
    raw.sendFrame(0, message.subarray(200_000), { fin: true });

    await raw.waitForMessage((value) => value.type === "pong", "pong for a fragmented full-size message");
    const controlPong = raw.frames.find((frame) => frame.opcode === 10);
    expect(controlPong?.payload.equals(pingPayload)).toBe(true);
    expect(raw.closeCode()).toBeUndefined();
  });

  it("closes with 1009 from the continuation header that would take the message over the limit", async () => {
    const { openRaw } = await rawProviderRoom();
    const raw = await openRaw();

    raw.sendFrame(1, Buffer.alloc(100_000, 0x20), { fin: false });
    raw.sendFrame(0, Buffer.alloc(100_000, 0x20), { fin: false });
    raw.sendHeaderOnly(0, 100_000, true);

    expect(await raw.waitForClose("close for oversized fragments")).toBe(1009);
  });

  it("closes with 1003 for binary data, 1002 for protocol violations and 1000 for a normal close", async () => {
    const { openRaw } = await rawProviderRoom();

    const binary = await openRaw();
    binary.sendFrame(2, Buffer.from([1, 2, 3]));
    expect(await binary.waitForClose("binary data")).toBe(1003);

    const unmasked = await openRaw();
    unmasked.sendFrame(1, JSON.stringify({ type: "ping" }), { masked: false });
    expect(await unmasked.waitForClose("unmasked frame")).toBe(1002);

    const orphan = await openRaw();
    orphan.sendFrame(0, "x");
    expect(await orphan.waitForClose("continuation without a message")).toBe(1002);

    const normal = await openRaw();
    normal.sendFrame(8, Buffer.from([0x03, 0xe8]));
    expect(await normal.waitForClose("normal close")).toBe(1000);
  });
});
