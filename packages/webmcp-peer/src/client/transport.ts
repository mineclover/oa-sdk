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

export function normalizeServerUrl(value?: string): string {
  const raw = asNonEmptyString(value) || DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `http://${raw.replace(/\/+$/, "")}`;
}

export function websocketUrl(serverUrl: string, roomId: string): string {
  return `${normalizeServerUrl(serverUrl).replace(/^http/i, "ws")}/p/${encodeURIComponent(roomId)}/client`;
}

export function parseRoomId(value?: string): string | undefined {
  const raw = asNonEmptyString(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/\/p\/([^/]+)(?:\/mcp)?\/?$/);
    return match?.[1] || undefined;
  } catch {
    return raw.replace(/^\/p\//, "").replace(/\/mcp\/?$/, "");
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
      socket.send(typeof value === "string" ? value : JSON.stringify(value));
    },
    close() {
      try {
        socket.close?.();
      } catch {}
    },
  };
}

export function createHttpTransport(
  url: string,
  fetchImpl: typeof fetch | undefined,
  callbacks: PeerMcpTransportCallbacks,
  clientToken?: string,
): PeerMcpTransport {
  if (typeof fetchImpl !== "function") {
    throw new PeerMcpError("fetch is unavailable; provide transportFactory", "TRANSPORT_UNAVAILABLE");
  }
  callbacks.onOpen?.();
  callbacks.onMessage?.({ type: "ready", role: "client", transport: "http" });
  return {
    raw: true,
    async send(value: PeerMcpTransportMessage) {
      const valObj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
      const rpc = (valObj?.type === "mcp" && valObj.message ? valObj.message : value) as Record<string, unknown>;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": `framebook-peer-mcp-client/${PACKAGE_VERSION}`,
          ...(clientToken ? { authorization: `Bearer ${clientToken}` } : {}),
        },
        body: JSON.stringify(rpc),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok && body?.jsonrpc === "2.0" && body.error && typeof body.error === "object") {
        // Keep the canonical JSON-RPC error (e.g. -32010 CATALOG_CHANGED on HTTP 409) so callers can
        // tell catalog drift from auth/room failures instead of seeing an opaque HTTP status.
        callbacks.onMessage?.({
          ...body,
          id: body.id ?? rpc?.id,
          error: { ...(body.error as Record<string, unknown>), httpStatus: response.status },
        });
        return;
      }
      if (!response.ok) {
        callbacks.onMessage?.({
          jsonrpc: "2.0",
          id: rpc?.id,
          error: {
            code: `HTTP_${response.status}`,
            message: (typeof body?.error === "string" ? body.error : undefined) || response.statusText || "MCP endpoint failed",
          },
        });
        return;
      }
      callbacks.onMessage?.(body);
    },
    close() {},
  };
}
