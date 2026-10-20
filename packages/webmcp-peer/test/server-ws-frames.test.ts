// Frame-level tests of the relay's WebSocket codec (upgradeWebSocket) behind a real node:http
// 'upgrade' handler. One relay message limit (256 KiB of UTF-8) applies in both directions:
// inbound, a frame or a fragmented message over it, or over the fragment cap, is refused from the
// frame header with close code 1009 (protocol violations and reserved opcodes close with 1002, binary
// data with 1003, a text message that is not UTF-8 with 1007, and a peer's close frame is answered by
// echoing its code); PeerSocket.close sends the code it is given (1000 by default, 1013 to shed a peer
// that may retry) and throws a RangeError for one no server may send; outbound, PeerSocket.send
// reports a message it cannot send by returning 'too-large' (or 'closed' on a stopped socket)
// instead of closing the socket. What waits for a peer that is not
// reading is bounded without closing the socket for it: a message that would queue more than the
// outbound bound is refused with 'busy' and a pong is dropped, and the socket takes messages again
// once the peer reads. Only a peer that reads nothing for the stalled-queue timeout after a frame was
// refused is closed, with 1013. onClose runs exactly once, as soon as the socket stops (also for a
// socket already destroyed, ended by its peer or unwritable at the upgrade, which is destroyed), never
// before upgradeWebSocket returns; a peer that never hangs up is destroyed after the close timeout. Both timeouts must be valid timer delays. Node's
// global WebSocket stands in for a browser (one frame per message); a raw node:net client writes exact
// frames by hand for byte-exact limits, fragmentation, read boundaries, protocol violations and a peer
// that stops reading; an in-memory Duplex makes byte-exact queue sizes, partial reads, head ordering
// and dead sockets deterministic, and fake timers make the stalled-queue timeout exact. Before any of
// that, a request that is not an opening handshake the codec can complete is refused with an HTTP
// response (400 BAD_UPGRADE, or 426 for another WebSocket version), and the 101 selects only the
// webmcp-peer.v1 subprotocol, never another value a request offers. Once open, the codec pings the
// peer every 30 s and closes one it hears nothing from for 75 s with 1001.
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, IncomingMessage, type Server } from "node:http";
import { connect, Socket, type AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PEER_RELAY_MAX_MESSAGE_BYTES } from "../src/config.js";
import {
  MAX_WEBSOCKET_FRAME_BYTES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  upgradeWebSocket,
  type PeerSendResult,
  type PeerSocket,
  type WebMcpPeerServer,
} from "../src/server.js";
import {
  MAX_WEBSOCKET_MESSAGE_FRAGMENTS,
  MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES,
  MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES,
  WEBSOCKET_CLOSE_TIMEOUT_MS,
  WEBSOCKET_CLOSE_TRY_AGAIN_LATER,
  WEBSOCKET_IDLE_TIMEOUT_MS,
  WEBSOCKET_PING_INTERVAL_MS,
  WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS,
  type UpgradeWebSocketOptions,
} from "../src/server/ws-upgrade.js";
import {
  createRoom,
  flush,
  joinRoom,
  openClient,
  postJson,
  settleWithin,
  startRelay,
  until,
  type Frame,
} from "./server-test-helpers.js";

const KiB = 1024;
/** The relay message limit, in UTF-8 bytes. */
const LIMIT = 256 * KiB;
/** Outbound messages over this many bytes are sent as fragments of this size. */
const OUTBOUND_FRAGMENT = 128 * KiB;
/** The most frames one inbound message may arrive in. */
const FRAGMENT_CAP = 1024;
/** The most bytes the relay queues for a peer that is not reading: four messages of the full limit. */
const OUTBOUND_BOUND = 4 * LIMIT;
/** The header bytes of an unmasked server frame with a payload over 65,535 bytes. */
const LONG_FRAME_HEADER = 10;
/** A close frame with a status code: 2 header bytes and the 2-byte code. */
const CLOSE_FRAME_BYTES = 4;
/** The pong for a ping with the largest control payload: 2 header bytes and 125 payload bytes. */
const PONG_BYTES = 2 + 125;
const WAIT_MS = 5_000;

const OPCODE = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;
const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  invalidPayload: 1007,
  messageTooBig: 1009,
  internalError: 1011,
  tryAgainLater: 1013,
} as const;

// --- relay side: upgradeWebSocket behind a node:http 'upgrade' handler -------------------------

interface ServerPeer {
  peer: PeerSocket;
  /** The relay's end of the TCP connection. */
  socket: Duplex;
  /** Every message onText delivered, in order. */
  texts: string[];
  /** onClose has been called. */
  closed: boolean;
  /** How many times onClose has been called. */
  closeCalls: number;
  /** The relay's socket emitted 'close' (it was destroyed, or both sides finished). */
  socketClosed: boolean;
  /** Bytes and 'data' events the relay's socket received after the handshake. */
  received: number;
  reads: number;
  /** The relay socket's writableLength (bytes queued for the peer) when onClose ran. */
  queuedAtClose?: number;
}

interface Endpoint {
  port: number;
  /** One entry per accepted upgrade, in connection order. */
  peers: ServerPeer[];
}

interface EndpointOptions extends UpgradeWebSocketOptions {
  /** Called with each message after it is recorded (it may throw). */
  onText?: (text: string) => void;
}

const servers: Server[] = [];
const serverSockets = new Set<Duplex>();
const cleanups: Array<() => void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const socket of serverSockets) socket.destroy();
  serverSockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startEndpoint(options: EndpointOptions = {}): Promise<Endpoint> {
  const { onText, ...upgradeOptions } = options;
  const peers: ServerPeer[] = [];
  const server = createServer((_req, res) => {
    res.writeHead(426).end();
  });
  server.on("upgrade", (req, socket, head) => {
    serverSockets.add(socket);
    const entry = { socket, texts: [] as string[], closed: false, closeCalls: 0, socketClosed: false, received: 0, reads: 0 } as ServerPeer;
    socket.on("close", () => {
      entry.socketClosed = true;
      serverSockets.delete(socket);
    });
    entry.peer = upgradeWebSocket(
      req,
      socket,
      head,
      (text) => {
        entry.texts.push(text);
        onText?.(text);
      },
      () => {
        entry.closed = true;
        entry.closeCalls += 1;
        entry.queuedAtClose ??= socket.writableLength;
      },
      upgradeOptions,
    );
    // Added after upgradeWebSocket's own listener, so a read has been parsed when it is counted.
    socket.on("data", (chunk: Buffer) => {
      entry.received += chunk.length;
      entry.reads += 1;
    });
    peers.push(entry);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { port: (server.address() as AddressInfo).port, peers };
}

function onlyPeer(endpoint: Endpoint): ServerPeer {
  expect(endpoint.peers).toHaveLength(1);
  return endpoint.peers[0]!;
}

/** Resolves once the relay's socket has received (and parsed) `total` bytes. */
function receivedBytes(peer: ServerPeer, total: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (peer.received >= total) {
      resolve();
      return;
    }
    const check = () => {
      if (peer.received < total) return;
      clearTimeout(timer);
      peer.socket.off("data", check);
      resolve();
    };
    const timer = setTimeout(() => {
      peer.socket.off("data", check);
      reject(new Error(`timed out waiting for the relay to read ${total} bytes (read ${peer.received})`));
    }, WAIT_MS);
    peer.socket.on("data", check);
  });
}

// --- browser-like client: Node's global WebSocket sends each message as one frame --------------

interface BrowserClient {
  ws: WebSocket;
  messages: string[];
  closeEvent?: { code: number; reason: string };
}

async function openBrowserClient(endpoint: Endpoint): Promise<BrowserClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${endpoint.port}/`);
  const client: BrowserClient = { ws, messages: [] };
  cleanups.push(() => ws.close());
  ws.addEventListener("message", (event) => client.messages.push(String(event.data)));
  ws.addEventListener("close", (event) => {
    client.closeEvent = { code: event.code, reason: event.reason };
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
  });
  return client;
}

// --- raw client: hand-written handshake, masked frames and server-frame parsing ----------------

interface ServerFrame {
  fin: boolean;
  rsv: number;
  opcode: number;
  masked: boolean;
  payload: Buffer;
}

interface RawClient {
  socket: Socket;
  /** Every frame the relay sent after the handshake, in order. */
  frames: ServerFrame[];
  /** The relay ended its side of the TCP connection. */
  serverEnded: boolean;
  send(...frames: Buffer[]): void;
}

const MASK_KEY = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);

interface FrameOptions {
  opcode: number;
  fin?: boolean;
  /** RSV1..RSV3 as a 3-bit value (4 = RSV1). */
  rsv?: number;
  masked?: boolean;
}

/** A client frame header (with its masking key when masked) declaring a `length`-byte payload. */
function frameHeader(length: number, { opcode, fin = true, rsv = 0, masked = true }: FrameOptions): Buffer {
  const first = (fin ? 0x80 : 0) | (rsv << 4) | opcode;
  const maskBit = masked ? 0x80 : 0;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([first, maskBit | length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = maskBit | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return masked ? Buffer.concat([header, MASK_KEY]) : header;
}

/** The first 10 bytes of a masked frame header with a 64-bit payload length (no masking key). */
function lengthHeader64(length: bigint, opcode: number): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(length, 2);
  return header;
}

/** A complete client frame; strings are encoded as UTF-8. */
function frame(payload: Buffer | string, options: FrameOptions): Buffer {
  const body = Buffer.from(payload);
  if (options.masked ?? true) {
    for (let i = 0; i < body.length; i++) body[i] = body[i]! ^ MASK_KEY[i % 4]!;
  }
  return Buffer.concat([frameHeader(body.length, options), body]);
}

function closeFramePayload(code: number, reason: Buffer | string = ""): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return Buffer.concat([payload, Buffer.from(reason)]);
}

/** Parses the unmasked frames a server sends; returns the unconsumed tail. */
function parseServerFrames(buffer: Buffer, frames: ServerFrame[]): Buffer {
  for (;;) {
    if (buffer.length < 2) return buffer;
    let length = buffer[1]! & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return buffer;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return buffer;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = (buffer[1]! & 0x80) !== 0;
    if (masked) offset += 4;
    if (buffer.length < offset + length) return buffer;
    frames.push({
      fin: (buffer[0]! & 0x80) !== 0,
      rsv: (buffer[0]! >> 4) & 0x07,
      opcode: buffer[0]! & 0x0f,
      masked,
      payload: Buffer.from(buffer.subarray(offset, offset + length)),
    });
    buffer = buffer.subarray(offset + length);
  }
}

interface RawClientOptions {
  path?: string;
  protocols?: string[];
  /** Keep the client's side open when the relay ends the TCP connection, like a peer that ignores the close. */
  allowHalfOpen?: boolean;
}

async function openRawClient(endpoint: { port: number }, options: RawClientOptions = {}): Promise<RawClient> {
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  const socket = connect({ port: endpoint.port, host: "127.0.0.1", allowHalfOpen: options.allowHalfOpen ?? false });
  cleanups.push(() => socket.destroy());
  const client: RawClient = {
    socket,
    frames: [],
    serverEnded: false,
    send: (...frames) => {
      socket.write(Buffer.concat(frames));
    },
  };

  let pending: Buffer = Buffer.alloc(0);
  let responseHead: string | undefined;
  let resolveHandshake!: (head: string) => void;
  let rejectHandshake!: (error: Error) => void;
  const handshake = new Promise<string>((resolve, reject) => {
    resolveHandshake = resolve;
    rejectHandshake = reject;
  });
  // One listener for the whole connection, so no frame sent right after the 101 is missed.
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    if (responseHead === undefined) {
      const end = pending.indexOf("\r\n\r\n");
      if (end < 0) return;
      responseHead = pending.subarray(0, end).toString("latin1");
      pending = pending.subarray(end + 4);
      resolveHandshake(responseHead);
    }
    pending = parseServerFrames(pending, client.frames);
  });
  socket.on("end", () => {
    client.serverEnded = true;
    rejectHandshake(new Error("connection ended during the handshake"));
  });
  socket.on("error", (error) => rejectHandshake(error));

  socket.write(
    `GET ${options.path ?? "/"} HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${endpoint.port}\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${key}\r\n` +
    `Sec-WebSocket-Version: 13\r\n` +
    (options.protocols?.length ? `Sec-WebSocket-Protocol: ${options.protocols.join(", ")}\r\n` : "") +
    `\r\n`,
  );
  const head = await handshake;
  expect(head).toMatch(/^HTTP\/1\.1 101 /);
  expect(head).toContain(`Sec-WebSocket-Accept: ${expectedAccept}`);
  return client;
}

/**
 * Writes `bytes` in pieces of `size` bytes, each only once the relay has read the previous one, so
 * every piece reaches the relay as a read of its own. Returns how many writes it made.
 */
async function writeInSeparateReads(client: RawClient, peer: ServerPeer, bytes: Buffer, size: number): Promise<number> {
  let writes = 0;
  for (let offset = 0; offset < bytes.length; offset += size) {
    const piece = bytes.subarray(offset, offset + size);
    const read = receivedBytes(peer, peer.received + piece.length);
    client.socket.write(piece);
    await read;
    writes += 1;
  }
  return writes;
}

const closeFrames = (client: RawClient) => client.frames.filter((f) => f.opcode === OPCODE.close);

/** Waits for the relay's close frame and returns its status code. */
async function closeCodeOf(client: RawClient, label: string): Promise<number> {
  const [closeFrame] = await until(() => closeFrames(client), (frames) => frames.length > 0, label, WAIT_MS);
  expect(closeFrame!.fin).toBe(true);
  expect(closeFrame!.masked).toBe(false);
  expect(closeFrame!.payload.length).toBe(2);
  return closeFrame!.payload.readUInt16BE(0);
}

/** Sends a ping and waits for its pong (or a close): every frame sent before it has been processed. */
async function sync(client: RawClient, label: string): Promise<void> {
  const token = randomBytes(8).toString("hex");
  client.send(frame(token, { opcode: OPCODE.ping }));
  const reply = await until(
    () => client.frames.find((f) => (f.opcode === OPCODE.pong && f.payload.toString() === token) || f.opcode === OPCODE.close),
    (f) => f !== undefined,
    label,
    WAIT_MS,
  );
  expect(reply!.opcode).toBe(OPCODE.pong);
}

/** Reassembles the data frames the relay sent into messages. */
function dataMessages(client: RawClient): Buffer[] {
  const messages: Buffer[] = [];
  let parts: Buffer[] = [];
  for (const f of client.frames) {
    if (f.opcode >= 8) continue;
    parts.push(f.payload);
    if (f.fin) {
      messages.push(Buffer.concat(parts));
      parts = [];
    }
  }
  return messages;
}

/** The relay closed with `code`, called onClose once, ended the TCP connection, and onText was never called. */
async function expectRefused(client: RawClient, peer: ServerPeer, code: number, label: string): Promise<void> {
  expect(await closeCodeOf(client, label)).toBe(code);
  expect(closeFrames(client)).toHaveLength(1);
  await until(() => client.serverEnded && peer.closed, Boolean, `${label}: connection closed`, WAIT_MS);
  expect(peer.closeCalls).toBe(1);
  expect(peer.texts).toEqual([]);
  expect(dataMessages(client)).toEqual([]);
}

// --- in-memory socket: upgradeWebSocket over a Duplex the test drives directly ------------------

/** An upgrade request upgradeWebSocket accepts: an HTTP/1.1 GET opening handshake, with `headers` over its own. */
function upgradeRequest(headers: Record<string, string | undefined> = {}): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  const merged: Record<string, string | undefined> = {
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": randomBytes(16).toString("base64"),
    ...headers,
  };
  req.headers = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
  return req;
}

interface MemorySocket {
  socket: Duplex;
  /**
   * Every chunk the relay has handed the peer, in order: the 101 response, then frames. A stalled
   * peer holds the last of them (it is still in writableLength) until it takes it.
   */
  written: Buffer[];
  /** Lets a stalled peer take what is queued and everything written later. */
  resume(): void;
  /** Lets a stalled peer take the one chunk it holds, and then stall again: a peer that reads slowly. */
  readOne(): void;
}

/**
 * An in-memory socket whose peer takes every write at once, or, `stalled`, takes none until
 * resume() or readOne(): a peer that stopped reading, so everything the relay writes stays in
 * writableLength.
 */
function memorySocket({ stalled = false } = {}): MemorySocket {
  const written: Buffer[] = [];
  let reading = !stalled;
  let pending: (() => void) | undefined;
  const socket = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      written.push(Buffer.from(chunk));
      if (reading) callback();
      else pending = callback;
    },
  });
  cleanups.push(() => socket.destroy());
  return {
    socket,
    written,
    resume: () => {
      reading = true;
      const callback = pending;
      pending = undefined;
      callback?.();
    },
    readOne: () => {
      const callback = pending;
      pending = undefined;
      callback?.();
    },
  };
}

interface MemoryPeer {
  peer: PeerSocket;
  texts: string[];
  closeCalls: number;
  /** onText or onClose ran before upgradeWebSocket returned. */
  calledBeforeReturn: boolean;
}

function upgradeMemory(socket: Duplex, head: Buffer = Buffer.alloc(0), options?: UpgradeWebSocketOptions): MemoryPeer {
  let returned = false;
  const state: Omit<MemoryPeer, "peer"> = { texts: [], closeCalls: 0, calledBeforeReturn: false };
  const peer = upgradeWebSocket(
    upgradeRequest(),
    socket,
    head,
    (text) => {
      if (!returned) state.calledBeforeReturn = true;
      state.texts.push(text);
    },
    () => {
      if (!returned) state.calledBeforeReturn = true;
      state.closeCalls += 1;
    },
    options,
  );
  returned = true;
  return Object.assign(state, { peer });
}

/** The frames the relay wrote after its 101 response, which must parse completely. */
function writtenFrames(written: Buffer[]): ServerFrame[] {
  const bytes = Buffer.concat(written);
  const end = bytes.indexOf("\r\n\r\n");
  expect(bytes.subarray(0, end).toString("latin1")).toMatch(/^HTTP\/1\.1 101 /);
  const frames: ServerFrame[] = [];
  expect(parseServerFrames(bytes.subarray(end + 4), frames)).toHaveLength(0);
  return frames;
}

/**
 * Sends the one message that fills the queue of a stalled socket to exactly `bound` (a bound near
 * {@link MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES}), and returns it.
 */
function fillToBound(socket: Duplex, relay: MemoryPeer, bound: number): string {
  // Two fragments with 10-byte headers whose last byte lands exactly on the bound.
  const fill = "a".repeat(bound - socket.writableLength - 2 * LONG_FRAME_HEADER - 2);
  expect(Buffer.byteLength(JSON.stringify(fill))).toBeGreaterThan(OUTBOUND_FRAGMENT + 0xffff);
  expect(relay.peer.send(fill)).toBe("sent");
  expect(socket.writableLength).toBe(bound);
  return fill;
}

/** Lets every queued nextTick, microtask and I/O callback run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** `count` ASCII bytes that are not one repeated character, so a reordered or dropped chunk shows. */
function asciiPayload(count: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; text.length < count; i++) text += alphabet[i % alphabet.length];
  return text.slice(0, count);
}

// -------------------------------------------------------------------------------------------------

describe("relay WebSocket message limit", () => {
  it("uses one 256 KiB limit for single frames and assembled messages", () => {
    expect(PEER_RELAY_MAX_MESSAGE_BYTES).toBe(LIMIT);
    expect(MAX_WEBSOCKET_MESSAGE_BYTES).toBe(LIMIT);
    expect(MAX_WEBSOCKET_FRAME_BYTES).toBe(LIMIT);
  });

  it("caps a message at 1024 frames, far more than the two the relay itself sends for the largest message", () => {
    expect(MAX_WEBSOCKET_MESSAGE_FRAGMENTS).toBe(FRAGMENT_CAP);
    expect(Math.ceil(LIMIT / OUTBOUND_FRAGMENT)).toBeLessThan(FRAGMENT_CAP);
  });
});

describe("inbound frames (client to relay)", () => {
  it("delivers a single unfragmented ~200 KiB text frame intact and keeps the socket open", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    const message = JSON.stringify({ type: "register", tools: [], blob: `${asciiPayload(200 * KiB)}—✓` });
    expect(Buffer.byteLength(message)).toBeGreaterThan(OUTBOUND_FRAGMENT);
    expect(Buffer.byteLength(message)).toBeLessThan(LIMIT);
    client.ws.send(message);

    await until(() => peer.texts.length > 0 || client.closeEvent !== undefined, Boolean, "200 KiB frame delivered or refused", WAIT_MS);
    expect(client.closeEvent).toBeUndefined();
    expect(peer.texts).toEqual([message]);

    // Still open in both directions.
    expect(peer.peer.send({ type: "ack" })).toBe("sent");
    await until(() => client.messages.length > 0 || client.closeEvent !== undefined, Boolean, "ack after the 200 KiB frame", WAIT_MS);
    expect(client.messages).toEqual([JSON.stringify({ type: "ack" })]);
    expect(client.closeEvent).toBeUndefined();
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    expect(peer.closed).toBe(false);
  });

  it("accepts a single frame of exactly the limit, measured in UTF-8 bytes", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // LIMIT / 2 two-byte characters: half the limit in UTF-16 code units, exactly the limit in bytes.
    const message = "é".repeat(LIMIT / 2);
    expect(Buffer.byteLength(message)).toBe(LIMIT);
    client.send(frame(message, { opcode: OPCODE.text }));

    await until(() => peer.texts.length > 0 || closeFrames(client).length > 0, Boolean, "limit-sized frame delivered or refused", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toHaveLength(1);
    expect(peer.texts[0] === message).toBe(true);
    expect(peer.closed).toBe(false);
  });

  it("refuses a single frame of limit + 1 bytes with 1009 from its header, without waiting for the payload", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // Only the 14-byte header (64-bit length + masking key) is sent: the relay must not wait to buffer
    // a payload it is going to refuse.
    client.send(frameHeader(LIMIT + 1, { opcode: OPCODE.text }));

    await expectRefused(client, peer, CLOSE.messageTooBig, "1009 for a limit + 1 frame header");
  });

  it.each<[string, bigint]>([
    ["2^63", 2n ** 63n],
    ["2^53 + 1", 2n ** 53n + 1n],
    ["2^64 - 1", 2n ** 64n - 1n],
  ])("refuses a 64-bit payload length of %s with 1009 from the length alone", async (_label, length) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // No masking key and no payload follow: nothing past the length is needed to refuse the frame.
    client.send(lengthHeader64(length, OPCODE.text));

    await expectRefused(client, peer, CLOSE.messageTooBig, `1009 for a 64-bit length of ${length}`);
  });

  it("closes a browser WebSocket that sends a message of limit + 1 UTF-8 bytes with 1009", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    // Far fewer than LIMIT characters, but LIMIT + 1 bytes.
    const message = `${"é".repeat(LIMIT / 2)}a`;
    expect(Buffer.byteLength(message)).toBe(LIMIT + 1);
    client.ws.send(message);

    const closed = await until(() => client.closeEvent, (event) => event !== undefined, "browser socket closed", WAIT_MS);
    expect(closed!.code).toBe(CLOSE.messageTooBig);
    await until(() => peer.closed, Boolean, "relay socket closed", WAIT_MS);
    expect(peer.texts).toEqual([]);
  });

  it("closes with 1009 when the fragments of one message add up to more than the limit", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // Two fragments reach the limit exactly; the third (1 byte) goes over it.
    client.send(
      frame(asciiPayload(LIMIT / 2), { opcode: OPCODE.text, fin: false }),
      frame(asciiPayload(LIMIT / 2), { opcode: OPCODE.continuation, fin: false }),
      frame("x", { opcode: OPCODE.continuation, fin: true }),
    );

    await expectRefused(client, peer, CLOSE.messageTooBig, "1009 for an over-limit fragmented message");
  });

  it("refuses the continuation frame that would take a message over the limit from its header", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // A 192 KiB first fragment, then only the header of a 64 KiB + 1 continuation.
    client.send(
      frame(asciiPayload(192 * KiB), { opcode: OPCODE.text, fin: false }),
      frameHeader(64 * KiB + 1, { opcode: OPCODE.continuation, fin: true }),
    );

    await expectRefused(client, peer, CLOSE.messageTooBig, "1009 for an over-limit continuation header");
  });

  it("assembles a fragmented message of exactly the limit and answers a ping between its fragments", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // LIMIT bytes whose last character (2 bytes) is split across the two fragments.
    const message = `${asciiPayload(LIMIT - 2)}é`;
    const bytes = Buffer.from(message);
    expect(bytes.length).toBe(LIMIT);

    // The ping arrives when LIMIT - 1 message bytes are buffered: it must not count toward the message.
    client.send(
      frame(bytes.subarray(0, LIMIT - 1), { opcode: OPCODE.text, fin: false }),
      frame("keepalive", { opcode: OPCODE.ping }),
    );
    const pong = await until(
      () => client.frames.find((f) => f.opcode === OPCODE.pong || f.opcode === OPCODE.close),
      (f) => f !== undefined,
      "pong (or close) for the ping between fragments",
      WAIT_MS,
    );
    expect(pong).toMatchObject({ opcode: OPCODE.pong, fin: true, masked: false });
    expect(pong!.payload.toString()).toBe("keepalive");
    expect(peer.texts).toEqual([]);

    client.send(frame(bytes.subarray(LIMIT - 1), { opcode: OPCODE.continuation, fin: true }));
    await until(() => peer.texts.length > 0 || closeFrames(client).length > 0, Boolean, "fragmented message delivered or refused", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toHaveLength(1);
    expect(peer.texts[0] === message).toBe(true);
    expect(peer.closed).toBe(false);
  });

  it.each<[string, Buffer[]]>([
    ["an unmasked text frame", [frame("hello", { opcode: OPCODE.text, masked: false })]],
    ["a frame with the RSV1 bit set", [frame("hello", { opcode: OPCODE.text, rsv: 4 })]],
    ["a continuation frame with no message in progress", [frame("hello", { opcode: OPCODE.continuation })]],
    [
      "a new text frame while a fragmented message is open",
      [frame("he", { opcode: OPCODE.text, fin: false }), frame("llo", { opcode: OPCODE.text })],
    ],
    ["a fragmented ping", [frame("x", { opcode: OPCODE.ping, fin: false })]],
    ["a ping over 125 bytes", [frame("p".repeat(126), { opcode: OPCODE.ping })]],
    // A control frame with a 64-bit length over the message limit is malformed before it is too big.
    ["a ping header with a 64-bit length over the limit", [frameHeader(LIMIT + 1, { opcode: OPCODE.ping })]],
  ])("closes with 1002 on a protocol violation: %s", async (_label, frames) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(...frames);

    await expectRefused(client, peer, CLOSE.protocolError, "1002 for a protocol violation");
    expect(client.frames.filter((f) => f.opcode === OPCODE.pong)).toEqual([]);
  });

  it.each([3, 7, 11, 15])("closes with 1002 from the header of a frame with reserved opcode %i", async (opcode) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // Only the header, declaring a payload of the full limit: the opcode alone refuses the frame.
    client.send(frameHeader(LIMIT, { opcode }));

    await expectRefused(client, peer, CLOSE.protocolError, `1002 for reserved opcode ${opcode}`);
  });

  it("closes with 1003 when a binary frame arrives", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame(Buffer.from([0x7b, 0x7d, 0x00, 0xff]), { opcode: OPCODE.binary }));

    await expectRefused(client, peer, CLOSE.unsupportedData, "1003 for a binary frame");
  });

  it("closes with 1003 from a binary frame header alone, without waiting for its payload", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frameHeader(LIMIT, { opcode: OPCODE.binary }));

    await expectRefused(client, peer, CLOSE.unsupportedData, "1003 for a binary frame header");
  });

  it("closes a browser WebSocket that sends binary data with 1003", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.ws.send(new Uint8Array([0x7b, 0x7d]));

    const closed = await until(() => client.closeEvent, (event) => event !== undefined, "browser socket closed", WAIT_MS);
    expect(closed!.code).toBe(CLOSE.unsupportedData);
    expect(peer.texts).toEqual([]);
  });

  it.each<[string, Buffer[]]>([
    ["the bytes 0xff 0xfe", [frame(Buffer.from([0x22, 0xff, 0xfe, 0x22]), { opcode: OPCODE.text })]],
    ["an encoded UTF-16 surrogate", [frame(Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]), { opcode: OPCODE.text })]],
    ["an overlong encoding of '/'", [frame(Buffer.from([0xc0, 0xaf]), { opcode: OPCODE.text })]],
    [
      "a character cut off by the end of a fragmented message",
      [frame("abc", { opcode: OPCODE.text, fin: false }), frame(Buffer.from([0xc3]), { opcode: OPCODE.continuation })],
    ],
  ])("closes with 1007 for a text message that is not valid UTF-8: %s", async (_label, frames) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(...frames);

    await expectRefused(client, peer, CLOSE.invalidPayload, "1007 for invalid UTF-8");
  });

  it("delivers a text message that starts with a byte-order mark unchanged", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame("﻿{}", { opcode: OPCODE.text }), frame("", { opcode: OPCODE.text }));

    await until(() => peer.texts.length >= 2 || closeFrames(client).length > 0, Boolean, "messages delivered", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toEqual(["﻿{}", ""]);
  });

  it("answers a client close frame with 1000, calls onClose once, and send then returns 'closed'", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame(closeFramePayload(CLOSE.normal), { opcode: OPCODE.close }));

    expect(await closeCodeOf(client, "close reply")).toBe(CLOSE.normal);
    await until(() => client.serverEnded && peer.closed, Boolean, "connection closed", WAIT_MS);
    expect(peer.peer.send({ type: "late" })).toBe("closed");
    expect(dataMessages(client)).toEqual([]);
    await until(() => peer.socketClosed, Boolean, "relay socket closed", WAIT_MS);
    expect(peer.closeCalls).toBe(1);
  });

  it.each<[string, number, Buffer]>([
    ["no payload", CLOSE.normal, Buffer.alloc(0)],
    ["status 1001 and a reason", CLOSE.goingAway, closeFramePayload(CLOSE.goingAway, "tab closed")],
    ["status 1011", CLOSE.internalError, closeFramePayload(CLOSE.internalError)],
    ["library status 3000 and a non-ASCII reason", 3000, closeFramePayload(3000, "fermé ✓")],
    ["application status 4999", 4999, closeFramePayload(4999)],
    // A server never sends 1010, the code of a client whose required extension was not negotiated.
    ["status 1010, which only a client sends,", CLOSE.normal, closeFramePayload(1010)],
  ])("answers a valid close frame with %s with status %i", async (_label, expected, payload) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame(payload, { opcode: OPCODE.close }));

    expect(await closeCodeOf(client, "close reply")).toBe(expected);
    await until(() => client.serverEnded && peer.closed, Boolean, "connection closed", WAIT_MS);
    expect(peer.closeCalls).toBe(1);
  });

  it.each<[string, Buffer]>([
    ["a 1-byte payload", Buffer.from([0x03])],
    ["status 0", closeFramePayload(0)],
    ["status 999", closeFramePayload(999)],
    ["reserved status 1004", closeFramePayload(1004)],
    ["status 1005 (no status), which is never sent", closeFramePayload(1005)],
    ["status 1006 (abnormal closure), which is never sent", closeFramePayload(1006)],
    ["status 1015 (TLS failure), which is never sent", closeFramePayload(1015)],
    ["unassigned status 2999", closeFramePayload(2999)],
    ["status 5000", closeFramePayload(5000)],
    ["a reason that is not UTF-8", closeFramePayload(CLOSE.normal, Buffer.from([0x6f, 0x6b, 0xff]))],
  ])("answers a malformed close frame (%s) with 1002", async (_label, payload) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame(payload, { opcode: OPCODE.close }));

    await expectRefused(client, peer, CLOSE.protocolError, "1002 for a malformed close frame");
  });

  it("closes with 1011 when onText throws, and calls onClose once", async () => {
    const endpoint = await startEndpoint({
      onText: () => {
        throw new Error("owner bug");
      },
    });
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.send(frame("first", { opcode: OPCODE.text }), frame("second", { opcode: OPCODE.text }));

    expect(await closeCodeOf(client, "close after onText threw")).toBe(CLOSE.internalError);
    await until(() => client.serverEnded && peer.closed, Boolean, "connection closed", WAIT_MS);
    // The message after the one that threw is not delivered to a stopped socket.
    expect(peer.texts).toEqual(["first"]);
    expect(peer.closeCalls).toBe(1);
  });
});

describe("inbound frames split across reads", () => {
  it.each<[string, number, number, number]>([
    // label, payload bytes, expected header bytes (base + extended length + masking key), payload read size
    ["a 7-bit length (2-byte base header)", 100, 2 + 4, 1],
    ["a 16-bit length (4-byte header)", 300, 4 + 4, 7],
    ["a 64-bit length (10-byte header)", 70_000, 10 + 4, 4_099],
  ])("assembles a frame with %s whose header and masking key arrive one byte per read", async (_label, length, headerBytes, readSize) => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // `length` bytes ending in a 2-byte character, so a read boundary also falls inside a character.
    const message = `${asciiPayload(length - 2)}é`;
    expect(Buffer.byteLength(message)).toBe(length);
    const bytes = frame(message, { opcode: OPCODE.text });
    expect(bytes.length - length).toBe(headerBytes);

    // Every split point of the header (after 1, 2, 4, 10 and 14 bytes, among others) and of the
    // masking key is a read boundary.
    const readsBefore = peer.reads;
    const headerWrites = await writeInSeparateReads(client, peer, bytes.subarray(0, headerBytes), 1);
    expect(headerWrites).toBe(headerBytes);
    expect(peer.reads - readsBefore).toBe(headerBytes);
    expect(peer.texts).toEqual([]);

    // The payload in reads whose size is not a multiple of the 4-byte mask.
    await writeInSeparateReads(client, peer, bytes.subarray(headerBytes), readSize);

    await until(() => peer.texts.length > 0 || closeFrames(client).length > 0, Boolean, "split frame delivered or refused", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toHaveLength(1);
    expect(peer.texts[0] === message).toBe(true);
    expect(peer.closed).toBe(false);
  });

  it("assembles a fragmented message with a ping between its fragments fed one byte per read", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    const first = Buffer.from("héllo ");
    const second = Buffer.from("wörld ✓");
    // The last character of the first fragment is split from its first byte by a fragment boundary.
    const bytes = Buffer.concat([
      frame(first.subarray(0, first.length - 1), { opcode: OPCODE.text, fin: false }),
      frame("ping", { opcode: OPCODE.ping }),
      frame(Buffer.concat([first.subarray(first.length - 1), second.subarray(0, 4)]), { opcode: OPCODE.continuation, fin: false }),
      frame(Buffer.alloc(0), { opcode: OPCODE.continuation, fin: false }),
      frame(second.subarray(4), { opcode: OPCODE.continuation, fin: true }),
    ]);

    const writes = await writeInSeparateReads(client, peer, bytes, 1);
    expect(writes).toBe(bytes.length);

    await until(() => peer.texts.length > 0 || closeFrames(client).length > 0, Boolean, "split message delivered or refused", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toEqual(["héllo wörld ✓"]);
    expect(client.frames.filter((f) => f.opcode === OPCODE.pong).map((f) => f.payload.toString())).toEqual(["ping"]);
  });

  it("assembles a limit-sized frame fed one byte per read in time linear in its size", () => {
    // One upgradeWebSocket over an in-memory socket, fed one 'data' event per byte: re-copying the
    // buffered part of the frame on every read would make a 4x larger frame ~16x slower, not ~4x.
    const timeOneBytePerRead = (length: number): number => {
      const { socket } = memorySocket();
      const { texts } = upgradeMemory(socket);
      const bytes = frame(asciiPayload(length), { opcode: OPCODE.text });
      const started = performance.now();
      for (let i = 0; i < bytes.length; i++) socket.emit("data", bytes.subarray(i, i + 1));
      const elapsed = performance.now() - started;
      expect(texts).toHaveLength(1);
      expect(texts[0]!.length).toBe(length);
      socket.destroy();
      return elapsed;
    };

    // The best of three runs of each size, after a warm-up, keeps scheduling noise out of the ratio.
    const best = (length: number) => Math.min(...[0, 1, 2].map(() => timeOneBytePerRead(length)));
    timeOneBytePerRead(16 * KiB);
    const quarter = best(LIMIT / 4);
    const full = best(LIMIT);
    expect(full / quarter).toBeLessThan(8);
  });
});

describe("fragment cap", () => {
  it("assembles a message of exactly the fragment cap, one byte per fragment", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    const frames = [frame("a", { opcode: OPCODE.text, fin: false })];
    for (let i = 1; i < FRAGMENT_CAP - 1; i++) frames.push(frame("b", { opcode: OPCODE.continuation, fin: false }));
    frames.push(frame("c", { opcode: OPCODE.continuation, fin: true }));
    expect(frames).toHaveLength(FRAGMENT_CAP);
    client.send(...frames);

    await until(() => peer.texts.length > 0 || closeFrames(client).length > 0, Boolean, "capped message delivered or refused", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.texts).toEqual([`a${"b".repeat(FRAGMENT_CAP - 2)}c`]);
    expect(peer.closed).toBe(false);
  });

  it("refuses the 1-byte fragment past the cap with 1009 from its header", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    const frames = [frame("a", { opcode: OPCODE.text, fin: false })];
    for (let i = 1; i < FRAGMENT_CAP; i++) frames.push(frame("b", { opcode: OPCODE.continuation, fin: false }));
    client.send(...frames);
    // FRAGMENT_CAP frames, far under the byte limit, are accepted.
    await sync(client, "pong after the capped number of fragments");
    expect(closeFrames(client)).toEqual([]);

    client.send(frameHeader(1, { opcode: OPCODE.continuation, fin: true }));

    await expectRefused(client, peer, CLOSE.messageTooBig, "1009 for the fragment past the cap");
  });

  it("closes a flood of empty continuation frames with 1009 at the cap instead of buffering it", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // Empty fragments add nothing to the byte limit: only the cap ends the message.
    const empty = frame(Buffer.alloc(0), { opcode: OPCODE.continuation, fin: false });
    client.send(frame("{", { opcode: OPCODE.text, fin: false }), ...Array<Buffer>(FRAGMENT_CAP - 1).fill(empty));
    await sync(client, "pong after the capped number of empty fragments");
    expect(closeFrames(client)).toEqual([]);

    // 100,000 more (600 KB on the wire): the first of them is refused.
    client.send(Buffer.concat(Array<Buffer>(100_000).fill(empty)));

    await expectRefused(client, peer, CLOSE.messageTooBig, "1009 for an empty-fragment flood");
  });
});

describe("PeerSocket.send (relay to client)", () => {
  it("returns 'too-large' for a message over the limit without closing the socket; the next message arrives", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    // JSON.stringify adds 2 quote bytes: the serialized message is LIMIT + 1 UTF-8 bytes.
    const oversized = `${"é".repeat(LIMIT / 2 - 1)}a`;
    expect(Buffer.byteLength(JSON.stringify(oversized))).toBe(LIMIT + 1);
    expect(peer.peer.send(oversized)).toBe("too-large");
    expect(peer.peer.send({ type: "after" })).toBe("sent");

    await until(() => client.messages.length > 0 || client.closeEvent !== undefined, Boolean, "message after the refused one", WAIT_MS);
    expect(client.messages).toEqual([JSON.stringify({ type: "after" })]);
    expect(client.closeEvent).toBeUndefined();
    expect(client.ws.readyState).toBe(WebSocket.OPEN);

    // The socket still works inbound too.
    client.ws.send("still open");
    await until(() => peer.texts.length > 0 || client.closeEvent !== undefined, Boolean, "inbound message after the refused send", WAIT_MS);
    expect(peer.texts).toEqual(["still open"]);
    expect(peer.closed).toBe(false);
  });

  it("returns 'sent' for a 200 KiB message and sends it as 128 KiB fragments the client reassembles", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    const value = { type: "mcp", blob: asciiPayload(200 * KiB) };
    const json = JSON.stringify(value);
    expect(peer.peer.send(value)).toBe("sent");
    expect(peer.peer.send({ type: "small" })).toBe("sent");

    await until(() => dataMessages(client).length >= 2 || closeFrames(client).length > 0, Boolean, "both messages received", WAIT_MS);
    expect(closeFrames(client)).toEqual([]);
    expect(client.frames.map((f) => ({ opcode: f.opcode, fin: f.fin, masked: f.masked, rsv: f.rsv, bytes: f.payload.length }))).toEqual([
      { opcode: OPCODE.text, fin: false, masked: false, rsv: 0, bytes: OUTBOUND_FRAGMENT },
      { opcode: OPCODE.continuation, fin: true, masked: false, rsv: 0, bytes: Buffer.byteLength(json) - OUTBOUND_FRAGMENT },
      { opcode: OPCODE.text, fin: true, masked: false, rsv: 0, bytes: Buffer.byteLength(JSON.stringify({ type: "small" })) },
    ]);
    expect(dataMessages(client).map((message) => message.toString("utf8"))).toEqual([json, JSON.stringify({ type: "small" })]);
    expect(peer.closed).toBe(false);
  });

  it("returns 'sent' for a message of exactly the limit, which a browser WebSocket receives intact", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    // LIMIT bytes once serialized; the 128 KiB fragment boundary falls inside a 2-byte character.
    const value = `${"é".repeat(LIMIT / 2 - 2)}ab`;
    const json = JSON.stringify(value);
    expect(Buffer.byteLength(json)).toBe(LIMIT);
    expect(peer.peer.send(value)).toBe("sent");

    await until(() => client.messages.length > 0 || client.closeEvent !== undefined, Boolean, "limit-sized message received", WAIT_MS);
    expect(client.closeEvent).toBeUndefined();
    expect(client.messages).toHaveLength(1);
    expect(client.messages[0] === json).toBe(true);
  });

  it("returns 'closed' after the relay closes the socket, which calls onClose at once and closes only once", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    peer.peer.close();
    // The owner learns at once, without waiting for the peer to finish the closing handshake.
    expect(peer.closeCalls).toBe(1);
    expect(peer.peer.send({ type: "late" })).toBe("closed");
    peer.peer.close();

    expect(await closeCodeOf(client, "relay-initiated close")).toBe(CLOSE.normal);
    await until(() => client.serverEnded && peer.closed, Boolean, "connection closed", WAIT_MS);
    expect(peer.peer.send({ type: "later" })).toBe("closed");
    expect(closeFrames(client)).toHaveLength(1);
    expect(dataMessages(client)).toEqual([]);
    await until(() => peer.socketClosed, Boolean, "relay socket closed", WAIT_MS);
    expect(peer.closeCalls).toBe(1);
  });

  it("returns 'closed' after the client resets the connection without a close frame", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.socket.resetAndDestroy();
    await until(() => peer.closed, Boolean, "relay saw the connection reset", WAIT_MS);
    expect(peer.peer.send({ type: "late" })).toBe("closed");
    await until(() => peer.socketClosed, Boolean, "relay socket closed", WAIT_MS);
    expect(peer.closeCalls).toBe(1);
  });

  // node:http servers accept with allowHalfOpen: a peer that ends TCP without a close frame (a
  // killed process) must not leave the relay's side open.
  it("calls onClose once and destroys the socket when the client ends TCP without a close frame", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // A partial message is in progress when the peer goes away.
    client.send(frame("{", { opcode: OPCODE.text, fin: false }));
    await sync(client, "pong after the first fragment");
    client.socket.end();

    await until(() => peer.closed, Boolean, "relay saw the client end the connection", 1_000);
    expect(peer.peer.send({ type: "late" })).toBe("closed");
    await until(() => peer.socketClosed, Boolean, "relay destroyed its side", 1_000);
    expect(peer.closeCalls).toBe(1);
    expect(peer.texts).toEqual([]);
  });

  it.each<[string, (client: RawClient, peer: ServerPeer) => Promise<void>]>([
    [
      "after refusing a frame with 1009",
      async (client) => {
        client.send(frameHeader(LIMIT + 1, { opcode: OPCODE.text }));
        expect(await closeCodeOf(client, "1009")).toBe(CLOSE.messageTooBig);
      },
    ],
    [
      "after PeerSocket.close()",
      async (client, peer) => {
        peer.peer.close();
        expect(await closeCodeOf(client, "1000")).toBe(CLOSE.normal);
      },
    ],
  ])("destroys a half-open peer that ignores the close %s within the close timeout, calling onClose once", async (_label, closeIt) => {
    const closeTimeoutMs = 300;
    const endpoint = await startEndpoint({ closeTimeoutMs });
    // A peer that keeps its side open and never answers the close.
    const client = await openRawClient(endpoint, { allowHalfOpen: true });
    const peer = onlyPeer(endpoint);

    await closeIt(client, peer);
    // onClose ran when the relay closed, not when TCP finished.
    expect(peer.closeCalls).toBe(1);
    expect(peer.peer.send({ type: "late" })).toBe("closed");
    await until(() => client.serverEnded, Boolean, "relay ended its side", WAIT_MS);

    await until(() => peer.socketClosed, Boolean, "relay destroyed the half-open socket", closeTimeoutMs + 2_000);
    expect(peer.closeCalls).toBe(1);
    expect(client.socket.destroyed).toBe(false);
  });
});

describe("PeerSocket.close status codes", () => {
  it("names 1013 (Try Again Later), the code that sheds a peer it may retry", () => {
    expect(WEBSOCKET_CLOSE_TRY_AGAIN_LATER).toBe(CLOSE.tryAgainLater);
  });

  // A browser or MCP client reads 1000 as a deliberate, final close, and 1013 as shedding it may retry.
  it("closes a browser WebSocket with the code it is given, which the client reports in its close event", async () => {
    const endpoint = await startEndpoint();
    const client = await openBrowserClient(endpoint);
    const peer = onlyPeer(endpoint);

    peer.peer.close(WEBSOCKET_CLOSE_TRY_AGAIN_LATER);
    expect(peer.closeCalls).toBe(1);
    expect(peer.peer.send({ type: "late" })).toBe("closed");

    const closeEvent = await until(() => client.closeEvent, (event) => event !== undefined, "browser close event", WAIT_MS);
    expect(closeEvent).toEqual({ code: CLOSE.tryAgainLater, reason: "" });
    expect(client.messages).toEqual([]);
    await until(() => peer.socketClosed, Boolean, "relay socket closed", WAIT_MS);
    expect(peer.closeCalls).toBe(1);
  });

  it.each<[string, number]>([
    ["1001 (Going Away)", CLOSE.goingAway],
    ["1002 (Protocol Error)", CLOSE.protocolError],
    ["1003 (Unsupported Data)", CLOSE.unsupportedData],
    ["1007 (Invalid Payload)", CLOSE.invalidPayload],
    ["1008 (Policy Violation)", 1008],
    ["1009 (Message Too Big)", CLOSE.messageTooBig],
    ["1011 (Internal Error)", CLOSE.internalError],
    ["1012 (Service Restart)", 1012],
    ["1013 (Try Again Later)", CLOSE.tryAgainLater],
    ["1014 (Bad Gateway)", 1014],
    ["3000, the first library code", 3000],
    ["4999, the last application code", 4999],
  ])("sends %s as given, once; a later close with another code does nothing", (_label, code) => {
    const { socket, written } = memorySocket();
    const relay = upgradeMemory(socket);

    relay.peer.close(code);
    relay.peer.close(CLOSE.normal);
    relay.peer.close();

    expect(relay.closeCalls).toBe(1);
    expect(relay.peer.send({ type: "late" })).toBe("closed");
    const frames = writtenFrames(written);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ fin: true, opcode: OPCODE.close, masked: false });
    expect(frames[0]!.payload).toEqual(closeFramePayload(code));
  });

  it("sends 1000 (Normal Closure) for close() and close(undefined)", () => {
    for (const close of [(peer: PeerSocket) => peer.close(), (peer: PeerSocket) => peer.close(undefined)]) {
      const { socket, written } = memorySocket();
      const relay = upgradeMemory(socket);
      close(relay.peer);
      expect(relay.closeCalls).toBe(1);
      expect(writtenFrames(written).map((f) => [f.opcode, f.payload.readUInt16BE(0)])).toEqual([[OPCODE.close, CLOSE.normal]]);
    }
  });

  it.each<[string, number]>([
    ["999, below the status codes", 999],
    ["1004, reserved", 1004],
    ["1005, which never appears on the wire", 1005],
    ["1006, which never appears on the wire", 1006],
    ["1010, which only a client sends", 1010],
    ["1015, which never appears on the wire", 1015],
    ["2999, unassigned", 2999],
    ["5000, past the status codes", 5000],
    ["a fraction", 1013.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("refuses close code %s with a RangeError, sending nothing and leaving the socket open", (_label, code) => {
    const { socket, written } = memorySocket();
    const relay = upgradeMemory(socket);
    const handshakeChunks = written.length;

    expect(() => relay.peer.close(code)).toThrow(new RangeError(
      `close code must be an integer from 1000 to 1003, 1007 to 1009, 1011 to 1014 or 3000 to 4999, got ${code}`,
    ));
    expect(written).toHaveLength(handshakeChunks);
    expect(relay.closeCalls).toBe(0);
    expect(socket.writableEnded).toBe(false);
    expect(relay.peer.send({ type: "still open" })).toBe("sent");

    // The code is checked whatever state the socket is in: a closed socket refuses it as well.
    relay.peer.close();
    expect(() => relay.peer.close(code)).toThrow(RangeError);
    expect(relay.closeCalls).toBe(1);
    expect(writtenFrames(written).map((f) => f.opcode)).toEqual([OPCODE.text, OPCODE.close]);
  });
});

describe("outbound queue bound (a peer that is not reading)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Fakes setTimeout only: streams, settle() (setImmediate) and nextTick keep running for real. */
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  it("bounds the queue at four messages of the full limit, and waits 30 seconds for a peer that stops reading a full one", () => {
    expect(MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES).toBe(OUTBOUND_BOUND);
    // A full-limit message goes out as two 128 KiB fragments with 10-byte headers.
    expect(MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES).toBe(LIMIT + 2 * LONG_FRAME_HEADER);
    expect(WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS).toBe(30_000);
  });

  it("drops the pongs that do not fit for a peer that floods pings without reading them, and keeps it open", async () => {
    const { socket, written, resume } = memorySocket({ stalled: true });
    const relay = upgradeMemory(socket);
    const handshake = socket.writableLength;
    expect(handshake).toBeGreaterThan(0);

    const payload = "p".repeat(125);
    const batch = Buffer.concat(Array<Buffer>(1000).fill(frame(payload, { opcode: OPCODE.ping })));
    // 100,000 pings (13.1 MB): their pongs alone would queue 12.7 MB for a peer that reads nothing.
    for (let i = 0; i < 100; i++) socket.emit("data", batch);

    // Every pong that fits under the bound is queued, and nothing more; the socket stays open.
    const pongs = Math.floor((OUTBOUND_BOUND - handshake) / PONG_BYTES);
    const full = handshake + pongs * PONG_BYTES;
    expect(socket.writableLength).toBe(full);
    expect(relay.closeCalls).toBe(0);
    socket.emit("data", batch);
    expect(socket.writableLength).toBe(full);
    // A message larger than the room left is refused, and nothing of it is queued.
    expect(relay.peer.send("x".repeat(OUTBOUND_BOUND - full))).toBe("busy");
    expect(socket.writableLength).toBe(full);
    expect(relay.closeCalls).toBe(0);

    // Once the peer reads, it gets every queued pong intact, and the socket answers and sends again.
    resume();
    await settle();
    expect(socket.writableLength).toBe(0);
    socket.emit("data", frame("again", { opcode: OPCODE.ping }));
    expect(relay.peer.send({ type: "after" })).toBe("sent");
    const frames = writtenFrames(written);
    expect(frames).toHaveLength(pongs + 2);
    expect(frames.slice(0, pongs).every((f) => f.opcode === OPCODE.pong && f.payload.equals(Buffer.from(payload)))).toBe(true);
    expect(frames.slice(pongs).map((f) => [f.opcode, f.payload.toString()])).toEqual([
      [OPCODE.pong, "again"],
      [OPCODE.text, JSON.stringify({ type: "after" })],
    ]);
    expect(relay.closeCalls).toBe(0);
    expect(relay.texts).toEqual([]);
  });

  it("queues a message that fills the queue to exactly the bound; the next one is refused with 'busy', queuing nothing and keeping the socket open", async () => {
    const bound = MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES;
    const { socket, written, resume } = memorySocket({ stalled: true });
    const relay = upgradeMemory(socket, Buffer.alloc(0), { maxOutboundBufferBytes: bound });
    const fill = fillToBound(socket, relay, bound);

    // A message over the limit is still the caller's problem, whatever the queue holds.
    expect(relay.peer.send("é".repeat(LIMIT / 2))).toBe("too-large");
    // The smallest message (2 JSON bytes, a 4-byte frame) no longer fits.
    expect(relay.peer.send("")).toBe("busy");
    expect(relay.peer.send({ type: "later" })).toBe("busy");
    expect(socket.writableLength).toBe(bound);
    expect(relay.closeCalls).toBe(0);

    // Once the peer has read its queue, the socket takes messages again.
    resume();
    await settle();
    expect(relay.peer.send("next")).toBe("sent");
    const frames = writtenFrames(written);
    expect(frames.map((f) => ({ opcode: f.opcode, fin: f.fin }))).toEqual([
      { opcode: OPCODE.text, fin: false },
      { opcode: OPCODE.continuation, fin: true },
      { opcode: OPCODE.text, fin: true },
    ]);
    expect(Buffer.concat([frames[0]!.payload, frames[1]!.payload]).toString()).toBe(JSON.stringify(fill));
    expect(frames[2]!.payload.toString()).toBe(JSON.stringify("next"));
    expect(relay.closeCalls).toBe(0);
  });

  it("refuses messages with 'busy' while a raw client is not reading, without closing it; once it reads, it gets every message sent, in order, and the socket works again", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    // The client stops reading: the kernel buffers fill, then the relay's queue does.
    client.socket.pause();
    const sentMessages: string[] = [];
    let result: PeerSendResult = "sent";
    let maxQueued = 0;
    // 200 x 200 KiB (40 MB) would all be queued in memory without a bound.
    for (let i = 0; result === "sent" && i < 200; i++) {
      const value = `${i}:${asciiPayload(200 * KiB)}`;
      result = peer.peer.send(value);
      if (result === "sent") sentMessages.push(JSON.stringify(value));
      maxQueued = Math.max(maxQueued, peer.socket.writableLength);
    }
    expect(result).toBe("busy");
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(maxQueued).toBeLessThanOrEqual(OUTBOUND_BOUND);
    const queued = peer.socket.writableLength;
    expect(peer.peer.send(`late:${asciiPayload(200 * KiB)}`)).toBe("busy");
    expect(peer.socket.writableLength).toBe(queued);
    expect(peer.closeCalls).toBe(0);

    client.socket.resume();
    await until(() => dataMessages(client).length, (count) => count >= sentMessages.length, "every message sent before the refusals", WAIT_MS);
    await until(() => peer.socket.writableLength, (bytes) => bytes === 0, "the relay's queue drained", WAIT_MS);
    expect(peer.peer.send({ type: "after" })).toBe("sent");
    await until(() => dataMessages(client).length, (count) => count > sentMessages.length, "the message sent after the queue drained", WAIT_MS);
    // The refused messages never went out.
    expect(dataMessages(client).map((message) => message.toString("utf8"))).toEqual([...sentMessages, JSON.stringify({ type: "after" })]);
    expect(closeFrames(client)).toEqual([]);
    await sync(client, "pong after the queue drained");
    expect(peer.closed).toBe(false);
  });

  it("drops the pongs a raw client that floods pings without reading cannot take, without closing it", async () => {
    const endpoint = await startEndpoint();
    const client = await openRawClient(endpoint);
    const peer = onlyPeer(endpoint);

    client.socket.pause();
    const pingsPerBatch = 1000;
    const batch = Buffer.concat(Array<Buffer>(pingsPerBatch).fill(frame("p".repeat(125), { opcode: OPCODE.ping })));
    // Each batch is written once the relay has read the previous one, until the queue has had no
    // room for a pong after ten batches (at most 64 MiB of pings).
    let pings = 0;
    let fullBatches = 0;
    let maxQueued = 0;
    while (fullBatches < 10 && pings * (batch.length / pingsPerBatch) < 64 * KiB * KiB) {
      const read = receivedBytes(peer, peer.received + batch.length);
      client.socket.write(batch);
      await read;
      pings += pingsPerBatch;
      maxQueued = Math.max(maxQueued, peer.socket.writableLength);
      if (peer.socket.writableLength + PONG_BYTES > OUTBOUND_BOUND) fullBatches += 1;
    }
    expect(fullBatches).toBe(10);
    expect(maxQueued).toBeLessThanOrEqual(OUTBOUND_BOUND);
    expect(peer.closed).toBe(false);

    client.socket.resume();
    await until(() => peer.socket.writableLength, (bytes) => bytes === 0, "the relay's queue drained", WAIT_MS);
    // The relay answers pings and sends messages again.
    await sync(client, "pong after the flood");
    expect(peer.peer.send({ type: "after" })).toBe("sent");
    await until(() => dataMessages(client).length, (count) => count > 0, "a message after the flood", WAIT_MS);
    expect(dataMessages(client).map((message) => message.toString("utf8"))).toEqual([JSON.stringify({ type: "after" })]);
    // The pongs that did not fit were dropped, not sent late.
    expect(client.frames.filter((f) => f.opcode === OPCODE.pong).length).toBeLessThan(pings);
    expect(closeFrames(client)).toEqual([]);
    expect(peer.closed).toBe(false);
    expect(peer.texts).toEqual([]);
  });

  it("closes a peer that reads nothing for WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS after a frame was refused with 1013, calling onClose once", async () => {
    fakeTimers();
    const bound = MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES;
    const { socket, written, resume } = memorySocket({ stalled: true });
    const relay = upgradeMemory(socket, Buffer.alloc(0), { maxOutboundBufferBytes: bound });
    const fill = fillToBound(socket, relay, bound);
    expect(relay.peer.send("")).toBe("busy");

    // More refused frames, a message and a pong, do not restart the wait.
    vi.advanceTimersByTime(WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS - 1);
    expect(relay.peer.send("")).toBe("busy");
    socket.emit("data", frame("ping", { opcode: OPCODE.ping }));
    expect(socket.writableLength).toBe(bound);
    expect(relay.closeCalls).toBe(0);

    vi.advanceTimersByTime(1);
    // The owner learns at once, and send then reports the socket closed.
    expect(relay.closeCalls).toBe(1);
    expect(relay.peer.send({ type: "late" })).toBe("closed");
    expect(socket.writableLength).toBe(bound + CLOSE_FRAME_BYTES);

    // A peer that reads now gets everything queued, then the 1013.
    resume();
    const frames = writtenFrames(written);
    expect(frames.map((f) => f.opcode)).toEqual([OPCODE.text, OPCODE.continuation, OPCODE.close]);
    expect(Buffer.concat([frames[0]!.payload, frames[1]!.payload]).toString()).toBe(JSON.stringify(fill));
    expect(frames[2]!.payload.readUInt16BE(0)).toBe(CLOSE.tryAgainLater);
    // It never hangs up, so the close timeout destroys the socket; onClose does not run again.
    vi.advanceTimersByTime(WEBSOCKET_CLOSE_TIMEOUT_MS);
    expect(socket.destroyed).toBe(true);
    await settle();
    expect(relay.closeCalls).toBe(1);
  });

  it("keeps a peer open that drains its full queue within stalledOutboundTimeoutMs", async () => {
    fakeTimers();
    const stalledOutboundTimeoutMs = 1_000;
    const bound = MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES;
    const { socket, written, resume } = memorySocket({ stalled: true });
    const relay = upgradeMemory(socket, Buffer.alloc(0), { maxOutboundBufferBytes: bound, stalledOutboundTimeoutMs });
    fillToBound(socket, relay, bound);
    expect(relay.peer.send("")).toBe("busy");

    vi.advanceTimersByTime(stalledOutboundTimeoutMs - 1);
    const drained = once(socket, "drain");
    resume();
    await drained;
    // Long past the timeout: the drain ended the wait.
    vi.advanceTimersByTime(WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS);
    expect(relay.closeCalls).toBe(0);
    expect(relay.peer.send("next")).toBe("sent");
    expect(writtenFrames(written).map((f) => f.opcode)).toEqual([OPCODE.text, OPCODE.continuation, OPCODE.text]);
    expect(relay.closeCalls).toBe(0);
  });

  it("keeps a peer open that reads part of its full queue within the timeout; the next refused frame starts a new wait", async () => {
    fakeTimers();
    const stalledOutboundTimeoutMs = 1_000;
    const { socket, written, readOne, resume } = memorySocket({ stalled: true });
    const relay = upgradeMemory(socket, Buffer.alloc(0), { stalledOutboundTimeoutMs });
    // 200 KiB messages until one no longer fits the default bound.
    const message = asciiPayload(200 * KiB);
    let sent = 0;
    while (relay.peer.send(message) === "sent") sent += 1;
    expect(sent).toBeGreaterThan(0);
    expect(relay.closeCalls).toBe(0);

    // Just before the timeout the peer takes one chunk (the 101 response): it is reading, if slowly,
    // so it stays open, though its queue is still too full for the next message.
    vi.advanceTimersByTime(stalledOutboundTimeoutMs - 1);
    readOne();
    await settle();
    vi.advanceTimersByTime(stalledOutboundTimeoutMs);
    expect(relay.closeCalls).toBe(0);
    expect(relay.peer.send(message)).toBe("busy");

    // That refusal starts a new wait, which the peer, reading nothing more, runs out.
    vi.advanceTimersByTime(stalledOutboundTimeoutMs - 1);
    expect(relay.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(relay.closeCalls).toBe(1);

    resume();
    const frames = writtenFrames(written);
    expect(Buffer.concat(frames.slice(0, -1).map((f) => f.payload)).toString()).toBe(JSON.stringify(message).repeat(sent));
    expect(frames.at(-1)!.opcode).toBe(OPCODE.close);
    expect(frames.at(-1)!.payload.readUInt16BE(0)).toBe(CLOSE.tryAgainLater);
  });
});

describe("upgrade edge cases", () => {
  it.each<[string, boolean]>([
    ["after it emitted 'close'", true],
    ["before it emitted 'close'", false],
  ])("calls onClose once, after upgradeWebSocket returns, for a socket destroyed before the upgrade (%s)", async (_label, closedFirst) => {
    const { socket, written } = memorySocket();
    socket.destroy();
    if (closedFirst) await once(socket, "close");

    // head holds a complete message, which a dead socket must not deliver.
    const relay = upgradeMemory(socket, frame("hello", { opcode: OPCODE.text }));
    expect(relay.closeCalls).toBe(0);
    expect(relay.peer.send({ type: "ready" })).toBe("closed");

    await settle();
    expect(relay.closeCalls).toBe(1);
    expect(relay.calledBeforeReturn).toBe(false);
    expect(relay.texts).toEqual([]);
    // Not even the 101 went to the dead socket.
    expect(written).toEqual([]);
    relay.peer.close();
    await settle();
    expect(relay.closeCalls).toBe(1);
  });

  it("calls onClose once when an upgrade handler that awaits gets a socket the client has already reset", async () => {
    let peer: (MemoryPeer & { destroyedAtUpgrade: boolean }) | undefined;
    let upgradeSeen!: () => void;
    const seen = new Promise<void>((resolve) => {
      upgradeSeen = resolve;
    });
    const server = createServer();
    servers.push(server);
    server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
      serverSockets.add(socket);
      // Like a customUpgradeHandler doing I/O: the upgrade happens once the connection has died.
      socket.on("error", () => {});
      socket.once("close", () => {
        let returned = false;
        const state = { texts: [] as string[], closeCalls: 0, calledBeforeReturn: false, destroyedAtUpgrade: socket.destroyed };
        const upgraded = upgradeWebSocket(req, socket, head, (text) => state.texts.push(text), () => {
          if (!returned) state.calledBeforeReturn = true;
          state.closeCalls += 1;
        });
        returned = true;
        peer = Object.assign(state, { peer: upgraded });
      });
      upgradeSeen();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const client = connect({ port: (server.address() as AddressInfo).port, host: "127.0.0.1" });
    client.on("error", () => {});
    cleanups.push(() => client.destroy());
    client.write(
      "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        + `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    await seen;
    client.resetAndDestroy();

    const upgraded = await until(() => peer, (value) => value !== undefined, "upgrade of the reset socket", WAIT_MS);
    expect(upgraded!.destroyedAtUpgrade).toBe(true);
    expect(upgraded!.peer.send({ type: "ready" })).toBe("closed");
    await until(() => upgraded!.closeCalls, (calls) => calls > 0, "onClose for the reset socket", WAIT_MS);
    await settle();
    expect(upgraded!.closeCalls).toBe(1);
    expect(upgraded!.calledBeforeReturn).toBe(false);
  });

  it.each<[string, (socket: Duplex) => Promise<void>]>([
    [
      "the peer already ended its side (readableEnded)",
      async (socket) => {
        socket.push(null);
        socket.resume();
        await once(socket, "end");
      },
    ],
    [
      "its writable side already ended",
      async (socket) => {
        socket.end();
        await settle();
      },
    ],
  ])("stops and destroys a socket that is gone but not destroyed before the upgrade (%s)", async (_label, end) => {
    const { socket, written } = memorySocket();
    await end(socket);
    expect(socket.destroyed).toBe(false);

    // head holds a complete message, which a socket that is gone must not deliver.
    const relay = upgradeMemory(socket, frame("hello", { opcode: OPCODE.text }));
    expect(relay.closeCalls).toBe(0);
    expect(relay.peer.send({ type: "ready" })).toBe("closed");
    expect(socket.destroyed).toBe(true);

    await settle();
    expect(relay.closeCalls).toBe(1);
    expect(relay.calledBeforeReturn).toBe(false);
    expect(relay.texts).toEqual([]);
    // No 101 was written to it.
    expect(written).toEqual([]);
  });

  it("calls onClose once and destroys the socket when an upgrade handler that awaits gets one whose client already sent FIN", async () => {
    let peer: (MemoryPeer & { readableEndedAtUpgrade: boolean }) | undefined;
    let serverSocketClosed = false;
    const server = createServer();
    servers.push(server);
    server.on("upgrade", (req, socket: Duplex, head: Buffer) => {
      serverSockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => {
        serverSocketClosed = true;
      });
      // Like a customUpgradeHandler that reads the socket while it awaits: the client's FIN comes
      // first, so the 'end' event that stops a live WebSocket has fired before the upgrade.
      socket.once("end", () => {
        let returned = false;
        const state = { texts: [] as string[], closeCalls: 0, calledBeforeReturn: false, readableEndedAtUpgrade: socket.readableEnded };
        const upgraded = upgradeWebSocket(req, socket, head, (text) => state.texts.push(text), () => {
          if (!returned) state.calledBeforeReturn = true;
          state.closeCalls += 1;
        });
        returned = true;
        peer = Object.assign(state, { peer: upgraded });
      });
      socket.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const client = connect({ port: (server.address() as AddressInfo).port, host: "127.0.0.1" });
    const received: Buffer[] = [];
    client.on("data", (chunk: Buffer) => received.push(chunk));
    client.on("error", () => {});
    cleanups.push(() => client.destroy());
    client.end(
      "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        + `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );

    const upgraded = await until(() => peer, (value) => value !== undefined, "upgrade of the ended socket", WAIT_MS);
    expect(upgraded!.readableEndedAtUpgrade).toBe(true);
    expect(upgraded!.peer.send({ type: "ready" })).toBe("closed");
    await until(() => upgraded!.closeCalls, (calls) => calls > 0, "onClose for the ended socket", WAIT_MS);
    await until(() => serverSocketClosed, Boolean, "the relay destroyed the half-open socket", WAIT_MS);
    await settle();
    expect(upgraded!.closeCalls).toBe(1);
    expect(upgraded!.calledBeforeReturn).toBe(false);
    // The client was never told the upgrade succeeded.
    expect(Buffer.concat(received).toString("latin1")).not.toMatch(/^HTTP\/1\.1 101 /);
  });

  it.each<[string, number]>([
    ["a complete frame", 11],
    ["a frame and the first bytes of the next", 14],
    ["the first bytes of a frame", 3],
  ])("parses head (%s) before a chunk the socket emits in the same tick", async (_label, headBytes) => {
    const bytes = Buffer.concat(["first", "second", "third"].map((text) => frame(text, { opcode: OPCODE.text })));
    // Each frame is a 6-byte header (with masking key) plus its payload; "first" ends at byte 11.
    expect(frame("first", { opcode: OPCODE.text })).toHaveLength(11);
    const { socket, written } = memorySocket();
    let relay: MemoryPeer | undefined;
    // As in an I/O callback: the upgrade handler runs, then more bytes arrive in the same macrotask.
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        relay = upgradeMemory(socket, bytes.subarray(0, headBytes));
        socket.push(bytes.subarray(headBytes));
        resolve();
      });
    });
    await until(() => relay!.texts.length >= 3 || relay!.closeCalls > 0, Boolean, "three messages or a close", WAIT_MS);
    expect(relay!.texts).toEqual(["first", "second", "third"]);
    expect(relay!.closeCalls).toBe(0);
    expect(relay!.calledBeforeReturn).toBe(false);
    expect(writtenFrames(written)).toEqual([]);
  });

  it("delivers a message in head only after upgradeWebSocket returns, even with no later read", async () => {
    const { socket } = memorySocket();
    const relay = upgradeMemory(socket, frame("only", { opcode: OPCODE.text }));
    expect(relay.texts).toEqual([]);
    await settle();
    expect(relay.texts).toEqual(["only"]);
    expect(relay.calledBeforeReturn).toBe(false);
  });
});

/** The HTTP response a refused upgrade wrote: its status line, headers (lowercased names) and JSON body. */
function refusalResponse(written: Buffer[]): { statusLine: string; headers: Record<string, string>; body: unknown } {
  const bytes = Buffer.concat(written);
  const end = bytes.indexOf("\r\n\r\n");
  expect(end).toBeGreaterThan(0);
  const [statusLine, ...fields] = bytes.subarray(0, end).toString("latin1").split("\r\n");
  const headers = Object.fromEntries(fields.map((field) => {
    const colon = field.indexOf(":");
    return [field.slice(0, colon).toLowerCase(), field.slice(colon + 1).trim()];
  }));
  const body = bytes.subarray(end + 4);
  expect(body.length).toBe(Number(headers["content-length"]));
  return { statusLine: statusLine!, headers, body: JSON.parse(body.toString("utf8")) };
}

/** Upgrades `req` on a fresh in-memory socket, recording what the codec wrote and its owner's callbacks. */
function upgradeRequestOnMemory(req: IncomingMessage): MemoryPeer & { socket: Duplex; written: Buffer[] } {
  const { socket, written } = memorySocket();
  let returned = false;
  const state = { texts: [] as string[], closeCalls: 0, calledBeforeReturn: false };
  const peer = upgradeWebSocket(req, socket, frame("hello", { opcode: OPCODE.text }), (text) => state.texts.push(text), () => {
    if (!returned) state.calledBeforeReturn = true;
    state.closeCalls += 1;
  });
  returned = true;
  return Object.assign(state, { peer, socket, written });
}

describe("opening handshake", () => {
  it.each<[string, Record<string, string | undefined>, { method?: string; version?: [number, number] }]>([
    ["a POST", {}, { method: "POST" }],
    ["an HTTP/1.0 request", {}, { version: [1, 0] }],
    ["an Upgrade that does not name websocket", { upgrade: "h2c" }, {}],
    ["no Upgrade header", { upgrade: undefined }, {}],
    ["a Connection header without upgrade", { connection: "keep-alive" }, {}],
    ["no Connection header", { connection: undefined }, {}],
    ["no Sec-WebSocket-Key", { "sec-websocket-key": undefined }, {}],
    ["a Sec-WebSocket-Key that is not base64", { "sec-websocket-key": "not a key" }, {}],
    ["a Sec-WebSocket-Key of 15 bytes", { "sec-websocket-key": randomBytes(15).toString("base64") }, {}],
    ["a Sec-WebSocket-Key of 17 bytes", { "sec-websocket-key": randomBytes(17).toString("base64") }, {}],
  ])("refuses %s with 400 BAD_UPGRADE and stops the socket, without throwing", async (_label, headers, { method, version }) => {
    const req = upgradeRequest(headers);
    if (method) req.method = method;
    if (version) [req.httpVersionMajor, req.httpVersionMinor] = version;
    const relay = upgradeRequestOnMemory(req);

    expect(relay.peer.send({ type: "ready" })).toBe("closed");
    expect(relay.closeCalls).toBe(0);
    await settle();
    expect(relay.closeCalls).toBe(1);
    expect(relay.calledBeforeReturn).toBe(false);
    // The head's message is never delivered: the socket never spoke WebSocket.
    expect(relay.texts).toEqual([]);
    const response = refusalResponse(relay.written);
    expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
    expect(response.headers).toMatchObject({ "content-type": "application/json", connection: "close", "cache-control": "no-store" });
    expect(response.headers).not.toHaveProperty("sec-websocket-accept");
    expect(response.body).toEqual({ error: "BAD_UPGRADE" });
    // The connection is ended once the response is written, and then destroyed.
    expect(relay.socket.writableEnded).toBe(true);
    await until(() => relay.socket.destroyed, Boolean, "refused socket destroyed", WAIT_MS);
    expect(relay.closeCalls).toBe(1);
  });

  it.each<[string, string | undefined]>([
    ["version 8", "8"],
    ["no version", undefined],
    ["a list of versions", "13, 8"],
  ])("refuses %s with 426, naming version 13 and the protocol to upgrade to", async (_label, version) => {
    const relay = upgradeRequestOnMemory(upgradeRequest({ "sec-websocket-version": version }));

    await settle();
    expect(relay.closeCalls).toBe(1);
    const response = refusalResponse(relay.written);
    expect(response.statusLine).toBe("HTTP/1.1 426 Upgrade Required");
    expect(response.headers).toMatchObject({ "sec-websocket-version": "13", upgrade: "websocket", connection: "Upgrade, close" });
    expect(response.body).toEqual({ error: "UNSUPPORTED_WEBSOCKET_VERSION" });
  });

  it("checks the version before the key, which a client of another version may build otherwise", () => {
    const relay = upgradeRequestOnMemory(upgradeRequest({ "sec-websocket-version": "8", "sec-websocket-key": undefined }));
    expect(refusalResponse(relay.written).statusLine).toBe("HTTP/1.1 426 Upgrade Required");
  });

  it("completes a handshake whose Upgrade and Connection list their token among others, in any case", async () => {
    const key = randomBytes(16).toString("base64");
    const relay = upgradeRequestOnMemory(upgradeRequest({ upgrade: "WebSocket", connection: "keep-alive, Upgrade", "sec-websocket-key": key }));

    const head = Buffer.concat(relay.written).toString("latin1");
    expect(head).toMatch(/^HTTP\/1\.1 101 Switching Protocols\r\n/);
    expect(head).toContain(`Sec-WebSocket-Accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")}\r\n`);
    expect(relay.peer.send({ type: "ready" })).toBe("sent");
    await settle();
    expect(relay.texts).toEqual(["hello"]);
    expect(relay.closeCalls).toBe(0);
  });

  it("answers a raw client's refused upgrade with a complete response, then closes the connection", async () => {
    const endpoint = await startEndpoint();
    const socket = connect({ port: endpoint.port, host: "127.0.0.1" });
    cleanups.push(() => socket.destroy());
    const received: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => received.push(chunk));
    const closed = once(socket, "close");
    socket.write(
      `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + `Sec-WebSocket-Key: short\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    expect((await settleWithin(closed, WAIT_MS)).settled).toBe(true);

    const response = refusalResponse(received);
    expect(response.statusLine).toBe("HTTP/1.1 400 Bad Request");
    expect(response.body).toEqual({ error: "BAD_UPGRADE" });
    await until(() => onlyPeer(endpoint).closeCalls, (calls) => calls > 0, "onClose for the refused upgrade", WAIT_MS);
    expect(onlyPeer(endpoint).closeCalls).toBe(1);
  });
});

describe("subprotocol selection", () => {
  it.each<[string, string | undefined, string | undefined]>([
    ["webmcp-peer.v1 alone", "webmcp-peer.v1", "webmcp-peer.v1"],
    ["webmcp-peer.v1 after a ticket", "ticket.secret, webmcp-peer.v1", "webmcp-peer.v1"],
    ["only a ticket", "ticket.secret", undefined],
    ["an unknown subprotocol", "chat.v2, other", undefined],
    ["empty values", " , ", undefined],
    ["no Sec-WebSocket-Protocol", undefined, undefined],
  ])("selects webmcp-peer.v1 and nothing else from a request offering %s", (_label, offered, selected) => {
    const relay = upgradeRequestOnMemory(upgradeRequest({ "sec-websocket-protocol": offered }));

    const head = Buffer.concat(relay.written).toString("latin1");
    expect(head).toMatch(/^HTTP\/1\.1 101 /);
    const protocolLines = head.split("\r\n").filter((line) => line.toLowerCase().startsWith("sec-websocket-protocol:"));
    expect(protocolLines).toEqual(selected === undefined ? [] : [`Sec-WebSocket-Protocol: ${selected}`]);
    // A credential the request offered never comes back.
    expect(head).not.toContain("secret");
  });
});

describe("liveness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Fakes the timers the codec's liveness uses; streams, settle() and nextTick keep running for real. */
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const pings = (written: Buffer[]) => writtenFrames(written).filter((f) => f.opcode === OPCODE.ping);

  it("pings every 30 seconds and gives up on a peer it hears nothing from for 75", () => {
    expect(WEBSOCKET_PING_INTERVAL_MS).toBe(30_000);
    expect(WEBSOCKET_IDLE_TIMEOUT_MS).toBe(75_000);
  });

  it("pings the peer every WEBSOCKET_PING_INTERVAL_MS with an empty ping", () => {
    fakeTimers();
    const { socket, written } = memorySocket();
    upgradeMemory(socket);

    vi.advanceTimersByTime(WEBSOCKET_PING_INTERVAL_MS - 1);
    expect(pings(written)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pings(written)).toEqual([expect.objectContaining({ fin: true, masked: false, payload: Buffer.alloc(0) })]);
    vi.advanceTimersByTime(WEBSOCKET_PING_INTERVAL_MS);
    expect(pings(written)).toHaveLength(2);
  });

  it("closes a peer it hears nothing from for WEBSOCKET_IDLE_TIMEOUT_MS with 1001, and the close timeout destroys it", async () => {
    fakeTimers();
    const { socket, written } = memorySocket();
    const relay = upgradeMemory(socket);

    vi.advanceTimersByTime(WEBSOCKET_IDLE_TIMEOUT_MS - 1);
    expect(relay.closeCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(relay.closeCalls).toBe(1);
    expect(relay.peer.send({ type: "late" })).toBe("closed");
    const frames = writtenFrames(written);
    expect(frames.at(-1)!.opcode).toBe(OPCODE.close);
    expect(frames.at(-1)!.payload.readUInt16BE(0)).toBe(CLOSE.goingAway);
    // Pinged twice meanwhile, and never again once closed.
    vi.advanceTimersByTime(WEBSOCKET_PING_INTERVAL_MS);
    expect(pings(written)).toHaveLength(2);
    vi.advanceTimersByTime(WEBSOCKET_CLOSE_TIMEOUT_MS);
    expect(socket.destroyed).toBe(true);
    await settle();
    expect(relay.closeCalls).toBe(1);
  });

  it.each<[string, Buffer]>([
    ["a pong", frame("", { opcode: OPCODE.pong })],
    ["a text message", frame("{}", { opcode: OPCODE.text })],
    ["the first bytes of a frame", frame("{}", { opcode: OPCODE.text }).subarray(0, 3)],
  ])("keeps a peer open while it sends anything, %s included", (_label, bytes) => {
    fakeTimers();
    const { socket } = memorySocket();
    const relay = upgradeMemory(socket);

    vi.advanceTimersByTime(WEBSOCKET_IDLE_TIMEOUT_MS - 1);
    socket.emit("data", bytes);
    vi.advanceTimersByTime(WEBSOCKET_IDLE_TIMEOUT_MS - 1);
    expect(relay.closeCalls).toBe(0);
    // Nothing more arrives: the wait counts from the last read.
    vi.advanceTimersByTime(1);
    expect(relay.closeCalls).toBe(1);
  });

  it("does not close a socket its owner paused, whose pongs may be waiting unread, and starts the wait again", () => {
    fakeTimers();
    const { socket } = memorySocket();
    const relay = upgradeMemory(socket);
    // As the relay pauses an agent that is behind on what it asked for.
    socket.pause();

    vi.advanceTimersByTime(3 * WEBSOCKET_IDLE_TIMEOUT_MS);
    expect(relay.closeCalls).toBe(0);
    socket.resume();
    // Once reading again, a peer that sends nothing is let go within one more idle timeout.
    vi.advanceTimersByTime(WEBSOCKET_IDLE_TIMEOUT_MS);
    expect(relay.closeCalls).toBe(1);
  });

  it("stops pinging a socket the relay closed", () => {
    fakeTimers();
    const { socket, written } = memorySocket();
    const relay = upgradeMemory(socket);
    relay.peer.close();

    vi.advanceTimersByTime(3 * WEBSOCKET_PING_INTERVAL_MS);
    expect(writtenFrames(written).map((f) => f.opcode)).toEqual([OPCODE.close]);
    expect(relay.closeCalls).toBe(1);
  });

  it("uses the intervals it is given", () => {
    fakeTimers();
    const { socket, written } = memorySocket();
    const relay = upgradeMemory(socket, Buffer.alloc(0), { pingIntervalMs: 10, idleTimeoutMs: 25 });

    vi.advanceTimersByTime(20);
    expect(pings(written)).toHaveLength(2);
    expect(relay.closeCalls).toBe(0);
    vi.advanceTimersByTime(5);
    expect(relay.closeCalls).toBe(1);
  });
});

describe("upgradeWebSocket options", () => {
  type TimerOption = "closeTimeoutMs" | "stalledOutboundTimeoutMs" | "pingIntervalMs" | "idleTimeoutMs";
  const invalidDelays: Array<[string, number]> = [
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["0", 0],
    ["0.5", 0.5],
    ["-1", -1],
    ["2^31 (past the longest Node timer)", 2 ** 31],
  ];
  it.each<[TimerOption, string, number]>(
    (["closeTimeoutMs", "stalledOutboundTimeoutMs", "pingIntervalMs", "idleTimeoutMs"] as const).flatMap((option) =>
      invalidDelays.map(([label, value]): [TimerOption, string, number] => [option, label, value])),
  )("refuses %s of %s with a RangeError before answering the upgrade", (option, _label, value) => {
    const { socket, written } = memorySocket();
    const options: UpgradeWebSocketOptions = {};
    options[option] = value;
    expect(() => upgradeMemory(socket, Buffer.alloc(0), options)).toThrow(new RangeError(
      `${option} must be a number of milliseconds from 1 to ${2 ** 31 - 1}, got ${value}`,
    ));
    expect(written).toEqual([]);
  });

  it.each<[string, UpgradeWebSocketOptions]>([
    ["equal to the ping interval", { pingIntervalMs: 1_000, idleTimeoutMs: 1_000 }],
    ["shorter than the ping interval", { pingIntervalMs: 1_000, idleTimeoutMs: 999 }],
    ["shorter than the default ping interval", { idleTimeoutMs: WEBSOCKET_PING_INTERVAL_MS }],
  ])("refuses an idle timeout %s with a RangeError before answering the upgrade", (_label, options) => {
    const { socket, written } = memorySocket();
    expect(() => upgradeMemory(socket, Buffer.alloc(0), options)).toThrow(RangeError);
    expect(written).toEqual([]);
  });

  it.each<[string, number]>([
    ["one byte under the smallest bound", MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES - 1],
    ["0", 0],
    ["a fraction", MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES + 0.5],
    ["Infinity", Infinity],
    ["NaN", NaN],
  ])("refuses maxOutboundBufferBytes of %s with a RangeError before answering the upgrade", (_label, maxOutboundBufferBytes) => {
    const { socket, written } = memorySocket();
    expect(() => upgradeMemory(socket, Buffer.alloc(0), { maxOutboundBufferBytes })).toThrow(RangeError);
    expect(written).toEqual([]);
  });

  it("keeps a closed socket for the longest valid close timeout, and destroys it after the shortest", async () => {
    const longest = memorySocket();
    const shortest = memorySocket();
    upgradeMemory(longest.socket, Buffer.alloc(0), { closeTimeoutMs: 2 ** 31 - 1, maxOutboundBufferBytes: MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES }).peer.close();
    upgradeMemory(shortest.socket, Buffer.alloc(0), { closeTimeoutMs: 1 }).peer.close();
    await until(() => shortest.socket.destroyed, Boolean, "socket destroyed after a 1 ms close timeout", WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 2^31 - 1 is a real timer delay, not one Node turns into 1 ms.
    expect(longest.socket.destroyed).toBe(false);
  });

  it("keeps a stalled socket open for the longest valid stalledOutboundTimeoutMs, and closes it after the shortest", async () => {
    const bound = MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES;
    const longest = memorySocket({ stalled: true });
    const shortest = memorySocket({ stalled: true });
    const longPeer = upgradeMemory(longest.socket, Buffer.alloc(0), { maxOutboundBufferBytes: bound, stalledOutboundTimeoutMs: 2 ** 31 - 1 });
    const shortPeer = upgradeMemory(shortest.socket, Buffer.alloc(0), { maxOutboundBufferBytes: bound, stalledOutboundTimeoutMs: 1 });
    for (const [memory, relay] of [[longest, longPeer], [shortest, shortPeer]] as const) {
      fillToBound(memory.socket, relay, bound);
      expect(relay.peer.send("")).toBe("busy");
    }
    await until(() => shortPeer.closeCalls, (calls) => calls > 0, "stalled socket closed after 1 ms", WAIT_MS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 2^31 - 1 is a real timer delay, not one Node turns into 1 ms.
    expect(longPeer.closeCalls).toBe(0);
    expect(shortPeer.closeCalls).toBe(1);
  });
});

describe("relay over a provider socket the relay already closed", () => {
  const relays: WebMcpPeerServer[] = [];
  afterEach(async () => {
    // A half-open peer would hold relay.close() open until the close timeout: drop the client sockets first.
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const relay of relays.splice(0)) await relay.close();
  });

  async function openHalfOpenProvider(base: string): Promise<{ provider: RawClient; joined: Awaited<ReturnType<typeof joinRoom>>; roomId: string }> {
    const room = await createRoom(base, { approvalRequired: false });
    const joined = await joinRoom(base, room);
    const port = Number(new URL(base).port);
    const provider = await openRawClient(
      { port },
      { path: `/p/${room.id}/provider`, protocols: ["webmcp-peer.v1", `ticket.${room.providerToken}`], allowHalfOpen: true },
    );
    await until(() => dataMessages(provider).length, (count) => count > 0, "provider ready", WAIT_MS);
    return { provider, joined, roomId: room.id };
  }

  it("answers PROVIDER_UNAVAILABLE, not REQUEST_TOO_LARGE, while the closed provider has not hung up", async () => {
    const relay = await startRelay(relays);
    const { provider, joined, roomId } = await openHalfOpenProvider(relay.base);

    // The provider breaks the limit; the relay closes it with 1009, and the provider does not hang up.
    provider.send(frameHeader(LIMIT + 1, { opcode: OPCODE.text }));
    expect(await closeCodeOf(provider, "provider closed with 1009")).toBe(CLOSE.messageTooBig);

    const response = await postJson(
      `${relay.base}/p/${roomId}/mcp`,
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } },
      { authorization: `Bearer ${joined.clientToken}` },
    );
    const body = (await response.json()) as { error?: { code: number; message: string } };
    expect({ status: response.status, error: body.error }).toEqual({
      status: 503,
      error: { code: -32001, message: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("closes within the close timeout while a provider ignores the relay's close", { timeout: WEBSOCKET_CLOSE_TIMEOUT_MS + 15_000 }, async () => {
    const own: WebMcpPeerServer[] = [];
    const relay = await startRelay(own);
    const { provider } = await openHalfOpenProvider(relay.base);

    const started = Date.now();
    const close = relay.server.close();
    const closing = settleWithin(close, WEBSOCKET_CLOSE_TIMEOUT_MS + 5_000);
    // 1001 (Going Away): the relay is going, so the provider may come back to another one.
    expect(await closeCodeOf(provider, "relay shutdown close")).toBe(CLOSE.goingAway);
    const closed = await closing;
    if (!closed.settled) {
      // Let the stuck close finish before failing.
      provider.socket.destroy();
      await close;
    }
    expect(closed.settled).toBe(true);
    expect(Date.now() - started).toBeLessThan(WEBSOCKET_CLOSE_TIMEOUT_MS + 5_000);
  });
});

describe("relay over a provider that stops reading", () => {
  const relays: WebMcpPeerServer[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const relay of relays.splice(0)) await relay.close();
  });

  /** A relay message the test received: a JSON object. */
  function relayFrame(value: unknown): Frame {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("relay frame is not a JSON object");
    return value as Frame;
  }

  it("answers the agent requests a provider that stops reading cannot take with a retryable PROVIDER_BUSY, and keeps the provider", async () => {
    const relay = await startRelay(relays);
    const room = await createRoom(relay.base, { approvalRequired: false });
    const joined = await joinRoom(relay.base, room);
    const provider = await openRawClient(
      { port: Number(new URL(relay.base).port) },
      { path: `/p/${room.id}/provider`, protocols: ["webmcp-peer.v1", `ticket.${room.providerToken}`] },
    );
    await until(() => dataMessages(provider).length, (count) => count > 0, "provider ready", WAIT_MS);
    const agentSockets: WebSocket[] = [];
    cleanups.push(() => agentSockets.forEach((ws) => ws.close()));
    const agent = await openClient(relay, room, joined, agentSockets);
    await agent.waitFor((f) => f.type === "ready", "agent ready", WAIT_MS);

    // The provider stops reading; the agent keeps sending 200 KiB tool calls until one is refused.
    // At most 60, under the agent socket's cap of 64 pending requests, so only the provider's queue refuses them.
    provider.socket.pause();
    const blob = asciiPayload(200 * KiB);
    const answers = () => agent.frames.filter((f): f is Frame => f.type === "mcp" && f.message?.error !== undefined);
    let requests = 0;
    while (answers().length === 0 && requests < 60) {
      requests += 1;
      agent.send({ type: "mcp", message: { jsonrpc: "2.0", id: requests, method: "tools/call", params: { name: "echo", arguments: { blob } } } });
      if (requests % 4 === 0) await flush(agent, `relay read request ${requests}`);
    }
    await flush(agent, "relay read every request");
    expect(answers().length).toBeGreaterThan(0);
    // Only the agent is answered, at once and retryably; nothing is left waiting for the request timeout.
    for (const answer of answers()) {
      expect(answer.message.error).toEqual({ code: -32001, message: "PROVIDER_BUSY", data: { retryable: true } });
    }
    expect(agent.ws.readyState).toBe(WebSocket.OPEN);
    const refused = new Set(answers().map((f) => f.message.id));
    const forwardedIds = Array.from({ length: requests }, (_, i) => i + 1).filter((id) => !refused.has(id));
    expect(forwardedIds.length).toBeGreaterThan(0);

    // The provider was not closed: once it reads, it gets every request that was not refused, whole.
    provider.socket.resume();
    const forwarded = () => dataMessages(provider)
      .map((message) => relayFrame(JSON.parse(message.toString("utf8"))))
      .filter((f) => f.type === "mcp");
    await until(() => forwarded().length, (count) => count >= forwardedIds.length, "every forwarded request", WAIT_MS);
    expect(closeFrames(provider)).toEqual([]);
    expect(forwarded().map((f) => f.message.id)).toEqual(forwardedIds);
    for (const request of forwarded()) expect(request.message.params.arguments.blob).toBe(blob);

    // It is still the room's provider: its reply reaches the agent.
    const result = { content: [{ type: "text", text: "done" }] };
    provider.send(frame(JSON.stringify({ type: "mcp", message: { jsonrpc: "2.0", id: forwardedIds[0], result } }), { opcode: OPCODE.text }));
    const reply = await agent.waitFor((f) => f.type === "mcp" && f.message?.id === forwardedIds[0] && f.message.result !== undefined, "the provider's reply", WAIT_MS);
    expect(reply.message.result).toEqual(result);
  });
});
