import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

export interface PeerSocket {
  send: (value: unknown) => void;
  close: () => void;
}

export const MAX_WEBSOCKET_FRAME_BYTES = 128 * 1024;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 256 * 1024;
const MAX_WEBSOCKET_BUFFER_BYTES = MAX_WEBSOCKET_MESSAGE_BYTES + MAX_WEBSOCKET_FRAME_BYTES + 16;

export function upgradeWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  onText: (text: string) => void,
  onClose: () => void,
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

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    protocolHeader +
    `\r\n`,
  );

  let buffer = Buffer.alloc(0);
  let stopped = false;
  let fragments: Buffer[] = [];
  let fragmentBytes = 0;

  const sendFrame = (opcode: number, data: Buffer | string, fin = true) => {
    if (stopped || socket.destroyed) return;
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let header: Buffer;
    if (body.length < 126) {
      header = Buffer.from([(fin ? 0x80 : 0) | opcode, body.length]);
    } else if (body.length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = (fin ? 0x80 : 0) | opcode;
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = (fin ? 0x80 : 0) | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    socket.write(Buffer.concat([header, body]));
  };

  const sendMessage = (data: Buffer | string) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (body.length > MAX_WEBSOCKET_MESSAGE_BYTES) {
      close();
      return;
    }
    if (body.length <= MAX_WEBSOCKET_FRAME_BYTES) {
      sendFrame(1, body);
      return;
    }
    for (let offset = 0; offset < body.length; offset += MAX_WEBSOCKET_FRAME_BYTES) {
      const chunk = body.subarray(offset, offset + MAX_WEBSOCKET_FRAME_BYTES);
      const first = offset === 0;
      const last = offset + chunk.length >= body.length;
      sendFrame(first ? 1 : 0, chunk, last);
    }
  };

  const close = () => {
    if (stopped) return;
    sendFrame(8, Buffer.from([3, 232]));
    stopped = true;
    socket.end();
  };

  const parse = (data: Buffer) => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, data]);
    if (buffer.length > MAX_WEBSOCKET_BUFFER_BYTES) {
      close();
      return;
    }
    try {
      while (buffer.length >= 2) {
        const first = buffer[0]!;
        const masked = !!(buffer[1]! & 128);
        const opcode = first & 15;
        const fin = !!(first & 128);
        if ((first & 0x70) || !masked) throw new Error("BAD_FRAME");

        let len = buffer[1]! & 127;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > BigInt(MAX_WEBSOCKET_FRAME_BYTES)) throw new Error("FRAME_LIMIT");
          len = Number(large);
          offset = 10;
        }
        if (len > MAX_WEBSOCKET_FRAME_BYTES || (opcode >= 8 && (!fin || len > 125))) throw new Error("FRAME_LIMIT");
        if (buffer.length < offset + 4 + len) return;

        const mask = buffer.subarray(offset, offset + 4);
        const body = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len));
        for (let i = 0; i < len; i++) body[i]! ^= mask[i % 4]!;
        buffer = buffer.subarray(offset + 4 + len);

        if (opcode === 8) {
          close();
          return;
        }
        if (opcode === 9) {
          sendFrame(10, body);
          continue;
        }
        if (opcode === 10) continue;
        if (opcode !== 0 && opcode !== 1) throw new Error("TEXT_ONLY");
        if (opcode === 1 && fragments.length) throw new Error("INTERLEAVED");
        if (opcode === 0 && !fragments.length) throw new Error("BAD_CONTINUATION");

        fragments.push(body);
        fragmentBytes += len;
        if (fragmentBytes > MAX_WEBSOCKET_MESSAGE_BYTES) throw new Error("FRAME_LIMIT");

        if (fin) {
          const value = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          fragmentBytes = 0;
          onText(value);
        }
      }
    } catch {
      close();
    }
  };

  socket.on("data", parse);
  socket.on("error", () => {});
  socket.on("close", () => {
    stopped = true;
    onClose();
  });
  if (head.length) queueMicrotask(() => parse(head));

  return {
    send: (value: unknown) => sendMessage(JSON.stringify(value)),
    close,
  };
}
