// Shared fixtures for the server-*.test.ts suites: a relay on an ephemeral port, raw provider and
// client WebSockets that record every frame, a raw RFC 6455 peer that can stop reading and never
// answers a ping, and polling helpers with generous load-tolerant limits.
import { randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";
import { createWebMcpPeerServer, type WebMcpPeerServer, type WebMcpPeerServerOptions } from "../src/server.js";
import { PeerFrameSchema } from "../src/server/wire-schemas.js";

export type Frame = Record<string, any>;

export interface RoomDescriptor {
  id: string;
  roomEpoch: number;
  providerToken: string;
  inviteToken: string;
  expiresAt: number;
}

export interface JoinedSession {
  roomId: string;
  roomEpoch: number;
  clientToken: string;
  sessionId: string;
  expiresAt: number;
  approvalRequestId?: string;
  state: string;
}

export interface RecordingSocket {
  ws: WebSocket;
  frames: Frame[];
  send(frame: unknown): void;
  waitFor(predicate: (frame: Frame) => boolean, label: string, timeoutMs?: number): Promise<Frame>;
}

export interface Relay {
  server: WebMcpPeerServer;
  base: string;
  wsBase: string;
}

export async function startRelay(
  servers: WebMcpPeerServer[],
  options: WebMcpPeerServerOptions = {},
  create: (options: WebMcpPeerServerOptions) => WebMcpPeerServer = createWebMcpPeerServer,
): Promise<Relay> {
  const server = create({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0, ...options });
  servers.push(server);
  const port = await server.listen();
  return { server, base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}` };
}

export async function until<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Resolves to `{ settled: false }` instead of hanging when `promise` does not settle in time. */
export async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
  });
  try {
    return await Promise.race([promise.then((value) => ({ settled: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createRoom(
  base: string,
  body: Record<string, unknown> = { approvalRequired: false },
  headers: Record<string, string> = {},
): Promise<RoomDescriptor> {
  const response = await fetch(`${base}/p`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (response.status !== 201) throw new Error(`POST /p failed with ${response.status}`);
  return (await response.json()) as RoomDescriptor;
}

export async function joinRoom(base: string, room: RoomDescriptor, body: Record<string, unknown> = {}): Promise<JoinedSession> {
  const response = await fetch(`${base}/p/${room.id}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inviteToken: room.inviteToken, ...body }),
  });
  if (response.status !== 201) throw new Error(`POST /join failed with ${response.status}`);
  return (await response.json()) as JoinedSession;
}

export async function openRecordingSocket(url: string, ticket: string, sockets: WebSocket[]): Promise<RecordingSocket> {
  const ws = new WebSocket(url, ["webmcp-peer.v1", `ticket.${ticket}`]);
  sockets.push(ws);
  const frames: Frame[] = [];
  ws.onmessage = (event) => {
    frames.push(JSON.parse(String(event.data)) as Frame);
  };
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`WebSocket ${url} failed to open`));
  });
  return {
    ws,
    frames,
    send: (frame) => ws.send(typeof frame === "string" ? frame : JSON.stringify(frame)),
    waitFor: (predicate, label, timeoutMs) =>
      until(() => frames.find(predicate), (frame): frame is Frame => frame !== undefined, label, timeoutMs) as Promise<Frame>,
  };
}

export function openProvider(relay: Relay, room: RoomDescriptor, sockets: WebSocket[]): Promise<RecordingSocket> {
  return openRecordingSocket(`${relay.wsBase}/p/${room.id}/provider`, room.providerToken, sockets);
}

export function openClient(relay: Relay, room: RoomDescriptor, joined: JoinedSession, sockets: WebSocket[]): Promise<RecordingSocket> {
  return openRecordingSocket(`${relay.wsBase}/p/${room.id}/client`, joined.clientToken, sockets);
}

/** Sends a ping and waits for its pong: every frame sent earlier on `socket` was processed by the relay. */
export async function flush(socket: RecordingSocket, label: string): Promise<void> {
  const before = socket.frames.filter((frame) => frame.type === "pong").length;
  socket.send({ type: "ping" });
  await until(() => socket.frames.filter((frame) => frame.type === "pong").length, (count) => count > before, label);
}

export const tool = (name: string) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: {} } });

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

function maskedFrameHeader(opcode: number, length: number): Buffer {
  if (length < 126) return Buffer.from([0x80 | opcode, 0x80 | length]);
  if (length <= 0xffff) {
    const header = Buffer.from([0x80 | opcode, 0x80 | 126, 0, 0]);
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

/** `value` as JSON in one masked text frame, as a client sends it. */
function maskedTextFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const mask = randomBytes(4);
  for (let index = 0; index < body.length; index++) body[index]! ^= mask[index & 3]!;
  return Buffer.concat([maskedFrameHeader(0x1, body.length), mask, body]);
}

/**
 * A raw RFC 6455 client over TCP that can stop reading (pause) and start again (resume), the way a
 * browser tab whose main thread is busy stops draining its socket.
 */
export class RawPeer {
  /** Every complete text message received, parsed. */
  readonly messages: Frame[] = [];
  closeCode: number | undefined;
  /** The relay's 101 response, without its final blank line. */
  handshake = "";
  /** How many pings the relay sent; the peer never answers them. */
  pings = 0;
  private buffered: Buffer = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private readonly listeners: Array<(message: Frame) => void> = [];

  private constructor(private readonly socket: Socket) {}

  /** Opens `path` on the relay with `ticket`, waits for `ready`, and adds the peer to `peers` (for cleanup). */
  static async open(relay: Relay, path: string, ticket: string, peers: RawPeer[]): Promise<RawPeer> {
    const url = new URL(relay.base);
    const socket = connect({ port: Number(url.port), host: url.hostname });
    const peer = new RawPeer(socket);
    peers.push(peer);
    socket.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) return;
        socket.off("data", onData);
        peer.handshake = head.subarray(0, end).toString("latin1");
        if (!peer.handshake.startsWith("HTTP/1.1 101")) {
          reject(new Error("upgrade refused"));
          return;
        }
        socket.on("data", (data: Buffer) => peer.receive(data));
        peer.receive(head.subarray(end + 4));
        resolve();
      };
      socket.on("data", onData);
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
    await peer.waitFor((message) => message.type === "ready", `${path} ready`);
    return peer;
  }

  /** Sends `value` as one masked text frame. */
  send(value: unknown): void {
    this.socket.write(maskedTextFrame(value));
  }

  /**
   * Sends every value as a masked text frame, all in one write, so the relay reads them together
   * (one loopback read) and handles them without reading from the socket in between.
   */
  sendAll(values: readonly unknown[]): void {
    this.socket.write(Buffer.concat(values.map(maskedTextFrame)));
  }

  /** Calls `listener` with every message that arrives from now on (only while reading). */
  onMessage(listener: (message: Frame) => void): void {
    this.listeners.push(listener);
  }

  pause(): void {
    this.socket.pause();
  }

  resume(): void {
    this.socket.resume();
  }

  waitFor(predicate: (message: Frame) => boolean, label: string, timeoutMs = 10_000): Promise<Frame> {
    return until(() => this.messages.find(predicate), (message): message is Frame => message !== undefined, label, timeoutMs) as Promise<Frame>;
  }

  destroy(): void {
    this.socket.destroy();
  }

  private receive(data: Buffer): void {
    this.buffered = this.buffered.length ? Buffer.concat([this.buffered, data]) : data;
    for (;;) {
      if (this.buffered.length < 2) return;
      const first = this.buffered[0]!;
      let length = this.buffered[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffered.length < 4) return;
        length = this.buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffered.length < 10) return;
        length = Number(this.buffered.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffered.length < offset + length) return;
      const payload = Buffer.from(this.buffered.subarray(offset, offset + length));
      this.buffered = this.buffered.subarray(offset + length);
      const opcode = first & 0x0f;
      if (opcode === 0x8) {
        this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        continue;
      }
      if (opcode === 0x9) {
        this.pings += 1;
        continue;
      }
      if (opcode !== 0x1 && opcode !== 0x0) continue;
      this.parts.push(payload);
      if ((first & 0x80) === 0) continue;
      const message: Frame = PeerFrameSchema.parse(JSON.parse(Buffer.concat(this.parts).toString("utf8")));
      this.parts = [];
      this.messages.push(message);
      for (const listener of this.listeners) listener(message);
    }
  }
}
