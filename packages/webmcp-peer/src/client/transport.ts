import { parseJsonObject, readResponseText } from "../config/json.js";
import { PEER_RELAY_MAX_REQUEST_BYTES, PEER_RELAY_MAX_REQUEST_ID_BYTES, utf8ByteLength } from "../config/limits.js";
import { WEBMCP_ROOM_ID_PATTERN } from "../config/types.js";
import { PeerMcpError } from "./errors.js";
import {
  DEFAULT_SERVER_URL,
  PACKAGE_VERSION,
  type PeerMcpTransport,
  type PeerMcpTransportCallbacks,
  type PeerMcpTransportMessage,
} from "./types.js";

export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A catalog version as the relay sends it: a finite number or a non-empty string. */
export function asCatalogVersion(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

export function normalizeServerUrl(value?: string): string {
  const raw = asNonEmptyString(value) || DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `http://${raw.replace(/\/+$/, "")}`;
}

export function websocketUrl(serverUrl: string, roomId: string): string {
  return `${normalizeServerUrl(serverUrl).replace(/^http/i, "ws")}/p/${encodeURIComponent(roomId)}/client`;
}

/**
 * The room id `value` names: a room id, `/p/<id>` or `/p/<id>/mcp`, or a URL whose path ends in
 * `/p/<id>` or `/p/<id>/mcp` (a trailing `/` allowed). Undefined when `value` is empty or names no id
 * of the protocol's grammar (`WEBMCP_ROOM_ID_PATTERN`), which is the only kind of id a relay route
 * takes.
 */
export function parseRoomId(value?: string): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) return undefined;
  let candidate: string | undefined;
  try {
    const parsed = new URL(raw);
    candidate = parsed.pathname.match(/\/p\/([^/]+)(?:\/mcp)?\/?$/)?.[1];
  } catch {
    candidate = raw.replace(/^\/p\//, "").replace(/\/mcp\/?$/, "");
  }
  return candidate !== undefined && WEBMCP_ROOM_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * The room id of a caller's option (see {@link parseRoomId}): undefined when the caller gave none,
 * and ROOM_ID_INVALID when it gave a value that names no valid room id, which no relay route would
 * take. Internal to the client tier.
 */
export function roomIdOption(value?: string): string | undefined {
  if (!asNonEmptyString(value)) return undefined;
  const roomId = parseRoomId(value);
  if (roomId === undefined) {
    // The value is not echoed: it may be an invitation URL that carries the invite token.
    throw new PeerMcpError(
      "The peer room id is invalid: a room id is 1 to 128 characters of A-Z, a-z, 0-9, '_' and '-'",
      "ROOM_ID_INVALID",
    );
  }
  return roomId;
}

/**
 * Throws REQUEST_TOO_LARGE for a request over the relay's request limit
 * (`PEER_RELAY_MAX_REQUEST_BYTES`). The relay would refuse it anyway (HTTP 413, or a JSON-RPC error
 * over WebSocket; past the message limit it would close the WebSocket and fail every pending
 * request of the session), so it is refused before it is sent and only its own caller sees it.
 */
function assertWithinRelayLimit(serialized: string): void {
  const bytes = utf8ByteLength(serialized);
  if (bytes > PEER_RELAY_MAX_REQUEST_BYTES) {
    throw new PeerMcpError(
      `Peer MCP request is ${bytes} bytes, over the relay's ${PEER_RELAY_MAX_REQUEST_BYTES}-byte request limit`,
      "REQUEST_TOO_LARGE",
      { bytes, limitBytes: PEER_RELAY_MAX_REQUEST_BYTES },
    );
  }
}

/**
 * Throws REQUEST_ID_TOO_LARGE for a request id whose JSON text is over the relay's id limit
 * (`PEER_RELAY_MAX_REQUEST_ID_BYTES`). Over a relay socket the relay answers such a request with id
 * null, which cannot be matched to the request, so it is refused before it is sent.
 */
export function assertWithinRelayIdLimit(id: string | number): void {
  if (typeof id !== "string") return;
  const bytes = utf8ByteLength(JSON.stringify(id));
  if (bytes > PEER_RELAY_MAX_REQUEST_ID_BYTES) {
    throw new PeerMcpError(
      `Peer MCP request id is ${bytes} bytes of JSON, over the relay's ${PEER_RELAY_MAX_REQUEST_ID_BYTES}-byte id limit`,
      "REQUEST_ID_TOO_LARGE",
      { bytes, limitBytes: PEER_RELAY_MAX_REQUEST_ID_BYTES },
    );
  }
}

export function createWebSocketTransport(
  url: string,
  protocols: string[],
  WebSocketImpl: unknown,
  callbacks: PeerMcpTransportCallbacks,
): PeerMcpTransport {
  if (typeof WebSocketImpl !== "function") {
    throw new PeerMcpError("WebSocket is unavailable; provide transportFactory or WebSocket", "TRANSPORT_UNAVAILABLE");
  }
  const Ctor = WebSocketImpl as new (url: string, protocols: string[]) => {
    readyState?: number;
    onopen?: () => void;
    onmessage?: (event: { data?: unknown } | unknown) => void;
    onerror?: (event: unknown) => void;
    onclose?: () => void;
    send: (data: string) => void;
    close?: () => void;
  };
  const socket = new Ctor(url, protocols);
  let opened = false;
  const onOpen = () => {
    opened = true;
    callbacks.onOpen?.();
  };
  const onMessage = (event: unknown) => {
    const ev = event as { data?: unknown } | null;
    callbacks.onMessage?.(ev?.data ?? event);
  };
  const onError = (event: unknown) =>
    callbacks.onError?.(event instanceof Error ? event : new Error("WebSocket transport error"));
  const onClose = () => callbacks.onClose?.();
  socket.onopen = onOpen;
  socket.onmessage = onMessage;
  socket.onerror = onError;
  socket.onclose = onClose;
  return {
    socket,
    send(value: PeerMcpTransportMessage) {
      if (!opened && socket.readyState !== undefined && socket.readyState !== 1) {
        throw new PeerMcpError("WebSocket is not open", "TRANSPORT_NOT_OPEN");
      }
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      assertWithinRelayLimit(serialized);
      socket.send(serialized);
    },
    close() {
      try {
        socket.close?.();
      } catch {}
    },
  };
}

/**
 * The `Accept` of every Streamable HTTP POST: MCP requires a client to list both the JSON and the
 * SSE form of a response. The relay always answers with JSON.
 */
export const MCP_HTTP_ACCEPT = "application/json, text/event-stream";

/** Options of {@link createHttpTransport}. Internal to the client tier. */
export interface HttpTransportOptions {
  /** Sent as `authorization: Bearer <clientToken>` on every POST. */
  readonly clientToken?: string;
  /**
   * The MCP revision the session's `initialize` negotiated, or undefined before it did: sent as
   * `MCP-Protocol-Version` on every later POST, as Streamable HTTP requires.
   */
  readonly protocolVersion?: () => string | undefined;
}

/**
 * The delay a `Retry-After` header asks for (RFC 9110 §10.2.3), in milliseconds: its delay-seconds,
 * or the time left until its HTTP-date (0 once that has passed). Undefined when there is no header
 * or it is neither.
 */
function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * The messages of a `text/event-stream` response body, the SSE form a Streamable HTTP server may
 * answer a POST with: the JSON object in the `data` lines of each event. An event without data, or
 * whose data is not a JSON object, carries no message.
 */
function eventStreamMessages(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const event of text.split(/\r\n\r\n|\n\n|\r\r/)) {
    const data = event
      .split(/\r\n|\n|\r/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""))
      .join("\n");
    const message = data ? parseJsonObject(data) : {};
    if (Object.keys(message).length > 0) messages.push(message);
  }
  return messages;
}

export function createHttpTransport(
  url: string,
  fetchImpl: typeof fetch | undefined,
  callbacks: PeerMcpTransportCallbacks,
  options: HttpTransportOptions = {},
): PeerMcpTransport {
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide transportFactory", "TRANSPORT_UNAVAILABLE");
  }
  const { clientToken } = options;
  callbacks.onOpen?.();
  callbacks.onMessage?.({ type: "ready", role: "client", transport: "http" });
  return {
    raw: true,
    async send(value: PeerMcpTransportMessage) {
      const valObj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
      const rpc = (valObj?.type === "mcp" && valObj.message ? valObj.message : value) as Record<string, unknown>;
      const body = JSON.stringify(rpc);
      assertWithinRelayLimit(body);
      // `initialize` negotiates the revision in its body; every later message names it.
      const protocolVersion = rpc?.method === "initialize" ? undefined : options.protocolVersion?.();
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: MCP_HTTP_ACCEPT,
          "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
          ...(clientToken ? { authorization: `Bearer ${clientToken}` } : {}),
          ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
        },
        body,
      });
      const text = await readResponseText(response);
      if (response.ok && /^text\/event-stream\b/i.test(response.headers.get("content-type") ?? "")) {
        for (const message of eventStreamMessages(text)) callbacks.onMessage?.(message);
        return;
      }
      const responseBody = parseJsonObject(text);
      if (!response.ok && responseBody?.jsonrpc === "2.0" && responseBody.error && typeof responseBody.error === "object") {
        // Keep the canonical JSON-RPC error (e.g. -32010 CATALOG_CHANGED on HTTP 409) so callers can
        // tell catalog drift from auth/room failures instead of seeing an opaque HTTP status. The
        // delay a `Retry-After` asks for (e.g. on 503 PROVIDER_BUSY) goes with it as `retryAfterMs`,
        // the least the session waits before sending a retryable request again.
        const retryAfter = retryAfterMs(response.headers.get("retry-after"));
        callbacks.onMessage?.({
          ...responseBody,
          id: responseBody.id ?? rpc?.id,
          error: {
            ...(responseBody.error as Record<string, unknown>),
            httpStatus: response.status,
            ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
          },
        });
        return;
      }
      if (!response.ok) {
        callbacks.onMessage?.({
          jsonrpc: "2.0",
          id: rpc?.id,
          error: {
            code: `HTTP_${response.status}`,
            message: (typeof responseBody?.error === "string" ? responseBody.error : undefined) || response.statusText || "MCP endpoint failed",
          },
        });
        return;
      }
      callbacks.onMessage?.(responseBody);
    },
    close() {},
  };
}
