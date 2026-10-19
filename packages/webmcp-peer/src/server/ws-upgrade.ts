import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import { PEER_RELAY_MAX_MESSAGE_BYTES } from "../config/limits.js";

/**
 * What {@link PeerSocket.send} did: `sent`; `too-large`, nothing sent because the message is over
 * {@link MAX_WEBSOCKET_MESSAGE_BYTES}; `busy`, nothing sent because the message does not fit the
 * bytes still queued for a peer that has not read them (see
 * {@link MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES}); or `closed`, nothing sent because the socket is
 * closing or closed. After `too-large` or `busy` the socket stays open, and a later `send` may
 * succeed (after `busy`, once the peer has read some of its queue).
 */
export type PeerSendResult = "sent" | "too-large" | "busy" | "closed";

export interface PeerSocket {
  /**
   * Serializes `value` as JSON and sends it. Nothing is sent for a message over the limit, a message
   * that does not fit the outbound queue, or on a closed socket, and the result says which, so the
   * caller can answer the message's sender. Neither an oversized message nor a full queue closes
   * this socket: what fills a queue may be traffic its peer never asked for. Only a peer that then
   * reads nothing for {@link WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS} is closed, later, with 1013.
   */
  send: (value: unknown) => PeerSendResult;
  /**
   * Starts the closing handshake with status `code`, 1000 (Normal Closure) when it is omitted. The
   * code is what tells the peer why: 1000 reads as a deliberate, final close, so a peer the relay
   * sheds for a condition it may retry, such as not reading what it asked for, is closed with
   * {@link WEBSOCKET_CLOSE_TRY_AGAIN_LATER} instead. The socket stops at once (`send` returns
   * `closed` and `onClose` runs); the connection is destroyed when the peer hangs up, or after
   * {@link WEBSOCKET_CLOSE_TIMEOUT_MS} if it does not. Closing a stopped socket does nothing.
   *
   * `code` must be a status code a server may send (RFC 6455 §7.4 and the IANA registry): 1000 to
   * 1003, 1007 to 1009, 1011 to 1014, or 3000 to 4999 for libraries and applications. 1004 is
   * reserved, 1005, 1006 and 1015 never appear on the wire, 1010 is sent only by a client, and
   * 1016 to 2999 are unassigned. Any other value throws a RangeError, whatever state the socket is
   * in, and sends nothing.
   */
  close: (code?: number) => void;
}

/** The largest message, in UTF-8 bytes, the relay accepts or sends: {@link PEER_RELAY_MAX_MESSAGE_BYTES}. */
export const MAX_WEBSOCKET_MESSAGE_BYTES = PEER_RELAY_MAX_MESSAGE_BYTES;
/**
 * The largest single inbound frame. Browser and Node WebSocket clients send each message as one
 * frame, so a frame may carry a whole message; this equals {@link MAX_WEBSOCKET_MESSAGE_BYTES}.
 */
export const MAX_WEBSOCKET_FRAME_BYTES = MAX_WEBSOCKET_MESSAGE_BYTES;
/**
 * The most frames one inbound message may arrive in (its first frame plus its continuation frames).
 * Browser and Node WebSocket clients send each message as one frame, and the relay's own messages
 * take at most two (128 KiB fragments of a 256 KiB message), so 1024, an average of 256 bytes per
 * frame for a message of the full limit, is far beyond what a real client sends. Empty fragments add
 * nothing to the byte limit; this cap is what bounds the work and the header bytes (at most 1024
 * 14-byte headers) one message can cost. The frame past it is refused from its header with 1009,
 * like a message over the byte limit.
 */
export const MAX_WEBSOCKET_MESSAGE_FRAGMENTS = 1024;
/**
 * How long, in milliseconds, the relay waits after sending its close frame for the peer to hang up
 * before it destroys the connection. A peer that ignores the close, or stops reading, would
 * otherwise hold the TCP connection (and the relay's `server.close()`) open indefinitely.
 */
export const WEBSOCKET_CLOSE_TIMEOUT_MS = 5_000;
/**
 * The status code 1013 (Try Again Later, IANA-registered): the relay is shedding a peer for a
 * temporary condition, which the peer may retry by connecting again. The codec closes a peer that
 * stopped reading a full outbound queue with it (see {@link WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS}),
 * and an owner passes it to {@link PeerSocket.close} for the same kind of close.
 */
export const WEBSOCKET_CLOSE_TRY_AGAIN_LATER = 1013;

/** Outbound messages over this size are sent fragmented. */
const OUTBOUND_FRAGMENT_BYTES = 128 * 1024;

/** The header bytes of an unmasked frame with a `length`-byte payload (RFC 6455 §5.2). */
function frameHeaderBytes(length: number): number {
  return length < 126 ? 2 : length <= 0xffff ? 4 : 10;
}

/** The bytes a `length`-byte text message takes on the wire as the relay sends it. */
function messageWireBytes(length: number): number {
  let bytes = 0;
  let offset = 0;
  do {
    const fragment = Math.min(OUTBOUND_FRAGMENT_BYTES, length - offset);
    bytes += frameHeaderBytes(fragment) + fragment;
    offset += fragment;
  } while (offset < length);
  return bytes;
}

/**
 * The most bytes the relay keeps queued (the socket's `writableLength`) for a peer that has not read
 * them yet: four messages of the full limit. A frame that would queue more is not queued, so the
 * queue never grows past the bound however far the peer falls behind: `send` returns `busy` for a
 * message, and the pong for a ping is dropped. A full queue does not close the socket, since it may
 * hold traffic the peer did not cause (a provider's queue holds every agent's requests); a peer
 * that reads nothing for {@link WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS} after a frame was refused is
 * closed with 1013 (Try Again Later).
 */
export const MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES = 4 * MAX_WEBSOCKET_MESSAGE_BYTES;
/**
 * How long, in milliseconds, a peer whose outbound queue is full may go without reading before the
 * relay closes it with 1013 (Try Again Later). The wait starts when a frame (a message or a pong)
 * does not fit {@link MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES}; more refused frames do not restart it.
 * Any queued write completing in that time (the peer read, which includes the queue draining) ends
 * it, so a peer that reads, however slowly, stays open, and the next refused frame starts a new
 * wait. This is the only close a full queue causes. Everything queued, then the close frame, still
 * goes out in order if the peer reads before {@link WEBSOCKET_CLOSE_TIMEOUT_MS} destroys the socket.
 */
export const WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS = 30_000;
/**
 * The smallest bound {@link UpgradeWebSocketOptions.maxOutboundBufferBytes} accepts: the wire size of
 * a message of the full limit, so every message `send` does not call `too-large` fits the queue of
 * a peer that has read everything sent to it.
 */
export const MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES = messageWireBytes(MAX_WEBSOCKET_MESSAGE_BYTES);

export interface UpgradeWebSocketOptions {
  /**
   * Overrides {@link WEBSOCKET_CLOSE_TIMEOUT_MS}: a finite number of milliseconds from 1 to
   * 2147483647, the longest delay a Node timer supports. There is no "wait forever", since a peer
   * that never hangs up would hold the connection open; any other value throws a RangeError.
   */
  closeTimeoutMs?: number;
  /**
   * Overrides {@link MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES}: a safe integer of at least
   * {@link MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES}; any other value throws a RangeError.
   */
  maxOutboundBufferBytes?: number;
  /**
   * Overrides {@link WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS}, with the values `closeTimeoutMs` takes:
   * a finite number of milliseconds from 1 to 2147483647. There is no "wait forever", since a peer
   * that never reads would hold its connection open; any other value throws a RangeError.
   */
  stalledOutboundTimeoutMs?: number;
}

/** The longest delay a Node timer supports; Node runs a longer, non-finite or sub-1 ms delay after 1 ms. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/** The first allocation for a fragmented message, which then grows geometrically up to the limit. */
const FRAGMENTED_MESSAGE_INITIAL_BYTES = 16 * 1024;
const MAX_FRAME_BYTES_BIGINT = BigInt(MAX_WEBSOCKET_FRAME_BYTES);
const MAX_CONTROL_PAYLOAD_BYTES = 125;
const MASK_BYTES = 4;
/** Two base bytes, at most eight extended-length bytes and the masking key. */
const MAX_FRAME_HEADER_BYTES = 2 + 8 + MASK_BYTES;
const EMPTY = Buffer.alloc(0);

/** A timer delay option named `name`: `fallback` when unset, else a delay a Node timer keeps as given. */
function timerDelayOption(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`${name} must be a number of milliseconds from 1 to ${MAX_TIMER_DELAY_MS}, got ${value}`);
  }
  return value;
}

function outboundBufferOption(value: number | undefined): number {
  if (value === undefined) return MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES;
  if (!Number.isSafeInteger(value) || value < MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES) {
    throw new RangeError(`maxOutboundBufferBytes must be an integer of at least ${MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES}, got ${value}`);
  }
  return value;
}

/** RFC 6455 §5.2 opcodes. */
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

/** RFC 6455 §7.4.1 close codes. */
const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_INVALID_PAYLOAD = 1007;
const CLOSE_MESSAGE_TOO_BIG = 1009;
/** Sent by a client whose required extension the server did not negotiate; a server fails the handshake instead. */
const CLOSE_MANDATORY_EXTENSION = 1010;
const CLOSE_INTERNAL_ERROR = 1011;

class FrameError extends Error {
  constructor(readonly closeCode: number, message: string) {
    super(message);
  }
}

/** Rejects ill-formed UTF-8 (RFC 3629) instead of substituting U+FFFD, and keeps a leading BOM. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Opcodes RFC 6455 defines; 3-7 and 11-15 are reserved. */
function isKnownOpcode(opcode: number): boolean {
  return opcode <= OPCODE_BINARY || (opcode >= OPCODE_CLOSE && opcode <= OPCODE_PONG);
}

/**
 * A status code a peer may send (RFC 6455 §7.4 and the IANA registry): 1004 is reserved, 1005, 1006
 * and 1015 must never appear on the wire, 1016-2999 are unassigned, and 3000-4999 belong to
 * libraries and applications.
 */
function isValidCloseCode(code: number): boolean {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)
    || (code >= 3000 && code <= 4999);
}

/** A status code the relay may put in a close frame of its own: one a peer may send, except a client's 1010. */
function isSendableCloseCode(code: number): boolean {
  return Number.isInteger(code) && code !== CLOSE_MANDATORY_EXTENSION && isValidCloseCode(code);
}

/** The status code that answers a received close frame: the one it carries, echoed (§5.5.1). */
function closeReplyCode(payload: Buffer): number {
  if (payload.length === 0) return CLOSE_NORMAL;
  if (payload.length === 1) throw new FrameError(CLOSE_PROTOCOL_ERROR, "BAD_CLOSE_PAYLOAD");
  const code = payload.readUInt16BE(0);
  if (!isValidCloseCode(code) || decodeUtf8(payload.subarray(2)) === undefined) {
    throw new FrameError(CLOSE_PROTOCOL_ERROR, "BAD_CLOSE_PAYLOAD");
  }
  return code;
}

/** An inbound frame whose header has been read and whose payload is arriving. */
interface InboundFrame {
  fin: boolean;
  opcode: number;
  length: number;
  /** Where the unmasked payload goes: the message buffer for a data frame, its own buffer for a control frame. */
  target: Buffer;
  /** Offset of this frame's payload in `target`. */
  start: number;
  /** Payload bytes read so far. */
  received: number;
}

/**
 * Completes a WebSocket upgrade on `socket` and speaks RFC 6455 text messages over it.
 *
 * `onText` receives each complete text message. Inbound frames are checked from their header,
 * before any payload is buffered: a message over {@link MAX_WEBSOCKET_MESSAGE_BYTES} or
 * {@link MAX_WEBSOCKET_MESSAGE_FRAGMENTS} closes with 1009, binary data with 1003, a protocol
 * violation with 1002, and a text message that is not valid UTF-8 with 1007.
 *
 * Outbound, at most {@link MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES} wait for a peer that is not reading:
 * a message that would queue more is refused (`send` returns `busy`) and a pong is dropped, and the
 * socket stays open. A peer that then reads nothing for {@link WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS}
 * is closed with {@link WEBSOCKET_CLOSE_TRY_AGAIN_LATER}.
 *
 * `onClose` runs exactly once, as soon as the socket stops from the relay's side: the relay closes
 * it (`close(code)`, a refused inbound frame or a stalled outbound queue), the peer sends a close
 * frame, the peer ends TCP without one, or the connection errors or closes, including before this
 * call: a socket that an upgrade handler that awaited gets already destroyed, already ended by the
 * peer (`readableEnded`) or no longer writable is not answered, is destroyed, and stops (`send`
 * returns `closed` at once). Owners can drop the socket then; they need not wait for TCP. Neither
 * `onText` nor `onClose` runs before this function has returned the PeerSocket.
 */
export function upgradeWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  onText: (text: string) => void,
  onClose: () => void,
  options: UpgradeWebSocketOptions = {},
): PeerSocket {
  const upgradeHeader = req.headers.upgrade;
  const version = req.headers["sec-websocket-version"];
  const key = req.headers["sec-websocket-key"];

  if (upgradeHeader?.toLowerCase() !== "websocket" || version !== "13" || typeof key !== "string") {
    throw new Error("BAD_UPGRADE");
  }

  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  const rawProtocol = req.headers["sec-websocket-protocol"];
  const requestedProtocols = typeof rawProtocol === "string"
    ? rawProtocol.split(",").map((p) => p.trim())
    : [];

  const protocolHeader = requestedProtocols.includes("webmcp-peer.v1")
    ? `Sec-WebSocket-Protocol: webmcp-peer.v1\r\n`
    : requestedProtocols.length > 0
      ? `Sec-WebSocket-Protocol: ${requestedProtocols[0]}\r\n`
      : "";

  // Checked before the handshake, so bad options never leave a half-set-up socket behind.
  const closeTimeoutMs = timerDelayOption("closeTimeoutMs", options.closeTimeoutMs, WEBSOCKET_CLOSE_TIMEOUT_MS);
  const maxOutboundBufferBytes = outboundBufferOption(options.maxOutboundBufferBytes);
  const stalledOutboundTimeoutMs = timerDelayOption(
    "stalledOutboundTimeoutMs",
    options.stalledOutboundTimeoutMs,
    WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS,
  );

  // Outbound state, set up before the handshake so its write is tracked like every other.
  let stopped = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Runs while the outbound queue is full and the peer has read nothing since a frame was refused. */
  let stallTimer: ReturnType<typeof setTimeout> | undefined;

  const clearStallTimer = () => {
    if (!stallTimer) return;
    clearTimeout(stallTimer);
    stallTimer = undefined;
  };

  /**
   * The callback of every write: a write completes once the peer has taken its bytes (on a TCP
   * socket, once the kernel has), so the peer is reading, however full its queue still is.
   */
  const onWritten = (error?: Error | null) => {
    if (!error) clearStallTimer();
  };

  // A socket that is already gone (while an upgrade handler awaited) has nothing to answer: one the
  // peer reset, one whose end the peer already sent (its 'end' event, which stops a live socket,
  // has fired and will not fire again, so it would stay half-open), or one that can no longer be
  // written. It is destroyed, as a live socket is when its peer ends it.
  const goneAtUpgrade = socket.destroyed || socket.readableEnded || !socket.writable;
  if (goneAtUpgrade) {
    socket.destroy();
  } else {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      protocolHeader +
      `\r\n`,
      onWritten,
    );
  }

  // Inbound state. A read is never kept: only the header of the frame in progress (at most 14
  // bytes) and the unmasked payload of the frame or message being assembled survive it.
  const header = Buffer.alloc(MAX_FRAME_HEADER_BYTES);
  let headerFill = 0;
  const mask = Buffer.alloc(MASK_BYTES);
  /** The frame whose payload is being read; undefined while a header is being read. */
  let frame: InboundFrame | undefined;
  /** The data message being assembled: its payload buffer, bytes so far, and frames so far (0: none open). */
  let message: Buffer | undefined;
  let messageBytes = 0;
  let messageFrames = 0;
  /**
   * The bytes the HTTP parser read past the upgrade request, not parsed yet. They come before any
   * read of the socket, so whichever runs first, the deferred parse or the first 'data' event,
   * parses them first.
   */
  let pendingHead: Buffer | undefined = head.length && !goneAtUpgrade ? head : undefined;

  const writable = () => !stopped && !socket.destroyed && socket.writable;

  const writeFrame = (opcode: number, body: Buffer, fin = true) => {
    const frameHeader = Buffer.alloc(frameHeaderBytes(body.length));
    frameHeader[0] = (fin ? 0x80 : 0) | opcode;
    if (body.length < 126) {
      frameHeader[1] = body.length;
    } else if (body.length <= 0xffff) {
      frameHeader[1] = 126;
      frameHeader.writeUInt16BE(body.length, 2);
    } else {
      frameHeader[1] = 127;
      frameHeader.writeBigUInt64BE(BigInt(body.length), 2);
    }
    socket.write(Buffer.concat([frameHeader, body]), onWritten);
  };

  /**
   * Whether `wireBytes` more fit the outbound queue. If they do not, the caller queues nothing, and
   * unless the wait has already started, the peer has `stalledOutboundTimeoutMs` to read some of
   * its queue before the socket is closed with 1013.
   */
  const fitsOutbound = (wireBytes: number): boolean => {
    if (socket.writableLength + wireBytes <= maxOutboundBufferBytes) return true;
    if (!stallTimer) {
      stallTimer = setTimeout(() => {
        stallTimer = undefined;
        close(WEBSOCKET_CLOSE_TRY_AGAIN_LATER);
      }, stalledOutboundTimeoutMs);
      stallTimer.unref?.();
    }
    return false;
  };

  const sendMessage = (data: string): PeerSendResult => {
    if (!writable()) return "closed";
    const length = Buffer.byteLength(data);
    // Too large for the peer to accept: report it to the caller rather than closing this socket,
    // which would drop a provider (and every agent of its room) for someone else's message.
    if (length > MAX_WEBSOCKET_MESSAGE_BYTES) return "too-large";
    // The peer is behind: refuse this message rather than close the socket for it, since the queue
    // may hold traffic the peer did not ask for. Nothing is allocated for a refused message.
    if (!fitsOutbound(messageWireBytes(length))) return "busy";
    const body = Buffer.from(data);
    if (body.length <= OUTBOUND_FRAGMENT_BYTES) {
      writeFrame(OPCODE_TEXT, body);
      return "sent";
    }
    for (let offset = 0; offset < body.length; offset += OUTBOUND_FRAGMENT_BYTES) {
      const chunk = body.subarray(offset, offset + OUTBOUND_FRAGMENT_BYTES);
      const first = offset === 0;
      const last = offset + chunk.length >= body.length;
      writeFrame(first ? OPCODE_TEXT : OPCODE_CONTINUATION, chunk, last);
    }
    return "sent";
  };

  /** Stops the socket from the relay's side, once: drops everything read so far and tells the owner. */
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearStallTimer();
    pendingHead = undefined;
    frame = undefined;
    message = undefined;
    messageBytes = 0;
    messageFrames = 0;
    headerFill = 0;
    onClose();
  };

  const close = (code = CLOSE_NORMAL) => {
    if (stopped) return;
    // The close frame is the last frame and always goes out, past the outbound bound by its 4 bytes.
    if (writable()) {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code, 0);
      writeFrame(OPCODE_CLOSE, payload);
    }
    if (!socket.destroyed) {
      socket.end();
      // Node keeps an upgraded socket half-open until the peer hangs up; one that never does must
      // not hold the connection, or the server's close(), open.
      closeTimer = setTimeout(() => socket.destroy(), closeTimeoutMs);
      closeTimer.unref?.();
    }
    stop();
  };

  /** Copies bytes of `chunk` into the header until it holds `count` bytes; returns the new offset. */
  const fillHeader = (chunk: Buffer, offset: number, count: number): number => {
    const take = Math.min(count - headerFill, chunk.length - offset);
    if (take <= 0) return offset;
    chunk.copy(header, headerFill, offset, offset + take);
    headerFill += take;
    return offset + take;
  };

  /** Checks the two base header bytes; returns how many extended-length bytes follow them. */
  const checkFrameStart = (): number => {
    const first = header[0]!;
    const second = header[1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const lengthCode = second & 0x7f;
    // No extension is negotiated, so no RSV bit may be set.
    if (first & 0x70) throw new FrameError(CLOSE_PROTOCOL_ERROR, "RESERVED_BITS");
    if (!isKnownOpcode(opcode)) throw new FrameError(CLOSE_PROTOCOL_ERROR, "RESERVED_OPCODE");
    if (opcode === OPCODE_BINARY) throw new FrameError(CLOSE_UNSUPPORTED_DATA, "TEXT_ONLY");
    if ((second & 0x80) === 0) throw new FrameError(CLOSE_PROTOCOL_ERROR, "UNMASKED_FRAME");
    if (opcode >= OPCODE_CLOSE) {
      if (!fin || lengthCode > MAX_CONTROL_PAYLOAD_BYTES) throw new FrameError(CLOSE_PROTOCOL_ERROR, "BAD_CONTROL_FRAME");
      return 0;
    }
    if (opcode === OPCODE_TEXT && messageFrames > 0) throw new FrameError(CLOSE_PROTOCOL_ERROR, "INTERLEAVED");
    if (opcode === OPCODE_CONTINUATION) {
      if (messageFrames === 0) throw new FrameError(CLOSE_PROTOCOL_ERROR, "BAD_CONTINUATION");
      if (messageFrames >= MAX_WEBSOCKET_MESSAGE_FRAGMENTS) throw new FrameError(CLOSE_MESSAGE_TOO_BIG, "FRAGMENT_LIMIT");
    }
    return lengthCode === 126 ? 2 : lengthCode === 127 ? 8 : 0;
  };

  /** Reads the payload length once the header holds its extended-length bytes, and checks it. */
  const readPayloadLength = (lengthBytes: number): number => {
    let length: number;
    if (lengthBytes === 2) {
      length = header.readUInt16BE(2);
    } else if (lengthBytes === 8) {
      const large = header.readBigUInt64BE(2);
      if (large > MAX_FRAME_BYTES_BIGINT) throw new FrameError(CLOSE_MESSAGE_TOO_BIG, "FRAME_LIMIT");
      length = Number(large);
    } else {
      length = header[1]! & 0x7f;
    }
    // Only a data frame adds to the message being assembled; a ping between fragments does not.
    const opcode = header[0]! & 0x0f;
    if (opcode < OPCODE_CLOSE && (length > MAX_WEBSOCKET_FRAME_BYTES || messageBytes + length > MAX_WEBSOCKET_MESSAGE_BYTES)) {
      throw new FrameError(CLOSE_MESSAGE_TOO_BIG, "MESSAGE_LIMIT");
    }
    return length;
  };

  /** Makes room for `needed` message bytes, keeping what is already assembled. */
  const reserveMessage = (needed: number, wholeMessage: boolean) => {
    const capacity = message?.length ?? 0;
    if (needed <= capacity) return;
    // A single-frame message gets exactly its size. A fragmented one grows geometrically, within the
    // limit, so each byte is copied O(1) times however many fragments carry it.
    const size = wholeMessage
      ? needed
      : Math.min(MAX_WEBSOCKET_MESSAGE_BYTES, Math.max(needed, capacity * 2, FRAGMENTED_MESSAGE_INITIAL_BYTES));
    // Not zero-filled: only the first messageBytes are ever read, and each is written first.
    const grown = Buffer.allocUnsafe(size);
    message?.copy(grown, 0, 0, messageBytes);
    message = grown;
  };

  /** Starts reading the payload of the frame whose complete header is in `header`. */
  const beginFrame = (lengthBytes: number, length: number) => {
    const fin = (header[0]! & 0x80) !== 0;
    const opcode = header[0]! & 0x0f;
    header.copy(mask, 0, 2 + lengthBytes, 2 + lengthBytes + MASK_BYTES);
    headerFill = 0;
    if (opcode >= OPCODE_CLOSE) {
      frame = { fin, opcode, length, target: length ? Buffer.allocUnsafe(length) : EMPTY, start: 0, received: 0 };
      return;
    }
    messageFrames += 1;
    // An empty fragment allocates nothing.
    if (length > 0) reserveMessage(messageBytes + length, fin && messageFrames === 1);
    frame = { fin, opcode, length, target: message ?? EMPTY, start: messageBytes, received: 0 };
  };

  /** Unmasks the payload bytes of `chunk` (from `offset`) into the frame's target; returns the new offset. */
  const readPayload = (chunk: Buffer, offset: number, current: InboundFrame): number => {
    const take = Math.min(current.length - current.received, chunk.length - offset);
    const { target, received } = current;
    const at = current.start + received;
    for (let i = 0; i < take; i++) target[at + i] = chunk[offset + i]! ^ mask[(received + i) & 3]!;
    current.received += take;
    return offset + take;
  };

  const handleControl = (opcode: number, payload: Buffer) => {
    if (opcode === OPCODE_PING) {
      // A pong that does not fit is dropped: a peer that pings without reading gets no more answers
      // than its queue holds, and is not closed for them.
      if (writable() && fitsOutbound(frameHeaderBytes(payload.length) + payload.length)) writeFrame(OPCODE_PONG, payload);
      return;
    }
    if (opcode === OPCODE_PONG) return;
    close(closeReplyCode(payload));
  };

  const finishFrame = (current: InboundFrame) => {
    frame = undefined;
    if (current.opcode >= OPCODE_CLOSE) {
      handleControl(current.opcode, current.target);
      return;
    }
    messageBytes += current.length;
    if (!current.fin) return;
    const text = decodeUtf8(message ? message.subarray(0, messageBytes) : EMPTY);
    message = undefined;
    messageBytes = 0;
    messageFrames = 0;
    if (text === undefined) throw new FrameError(CLOSE_INVALID_PAYLOAD, "INVALID_UTF8");
    onText(text);
  };

  const parse = (chunk: Buffer) => {
    if (stopped) return;
    let offset = 0;
    try {
      while (!stopped) {
        if (frame) {
          offset = readPayload(chunk, offset, frame);
          if (frame.received < frame.length) return;
          finishFrame(frame);
          continue;
        }
        // Each header field is checked as soon as it has arrived, so a frame the relay refuses is
        // refused before its payload (or the rest of its header) is read.
        offset = fillHeader(chunk, offset, 2);
        if (headerFill < 2) return;
        const lengthBytes = checkFrameStart();
        offset = fillHeader(chunk, offset, 2 + lengthBytes);
        if (headerFill < 2 + lengthBytes) return;
        const length = readPayloadLength(lengthBytes);
        offset = fillHeader(chunk, offset, 2 + lengthBytes + MASK_BYTES);
        if (headerFill < 2 + lengthBytes + MASK_BYTES) return;
        beginFrame(lengthBytes, length);
      }
    } catch (error) {
      // A throwing onText is the owner's fault, not the peer's: 1011, not a protocol error.
      close(error instanceof FrameError ? error.closeCode : CLOSE_INTERNAL_ERROR);
    }
  };

  const parseHead = () => {
    const bytes = pendingHead;
    if (!bytes) return;
    pendingHead = undefined;
    parse(bytes);
  };

  socket.on("data", (chunk: Buffer) => {
    parseHead();
    parse(chunk);
  });
  // The peer ended its side without a close frame (or after the closing handshake). An upgraded
  // node:http socket is half-open by default, so nothing else would end the connection.
  socket.on("end", () => {
    stop();
    socket.destroy();
  });
  socket.on("error", () => {
    stop();
    socket.destroy();
  });
  socket.on("close", () => {
    if (closeTimer) clearTimeout(closeTimer);
    stop();
  });
  // Deferred, so the owner holds the PeerSocket before onText or onClose runs. A socket gone before
  // this call may have emitted 'end' or 'close' already, which no listener above saw.
  if (goneAtUpgrade) queueMicrotask(stop);
  else if (pendingHead) queueMicrotask(parseHead);

  return {
    send: (value: unknown) => sendMessage(JSON.stringify(value)),
    close: (code: number = CLOSE_NORMAL) => {
      // Checked before anything else, so a code no server may send never reaches the wire.
      if (!isSendableCloseCode(code)) {
        throw new RangeError(`close code must be an integer from 1000 to 1003, 1007 to 1009, 1011 to 1014 or 3000 to 4999, got ${code}`);
      }
      close(code);
    },
  };
}
