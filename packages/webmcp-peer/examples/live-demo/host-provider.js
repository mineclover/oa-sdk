// Tier 1 — Host Provider runtime (DOM-free; runs in the browser demo and in Node tests).
// Owns the room credentials, the provider WebSocket, approval decisions, and relays MCP requests
// from the relay server into the host application runtime (`host-tools.js`).
import { PEER_PROTOCOL, WS_SUBPROTOCOL, buildInvitationUrl, redactSecrets, toWsOrigin } from "./peer-protocol.js";

/**
 * @param {{
 *   origin: string,
 *   host: ReturnType<import("./host-tools.js").createHostRuntime>,
 *   alias?: string,
 *   onEvent?: (event: { type: "wire" | "provider" | "host", [key: string]: unknown }) => void,
 * }} options
 */
export function createHostProvider({ origin, host, alias = "live-demo-host", onEvent = () => {} }) {
  const state = {
    room: null, // { id, roomEpoch, providerToken, inviteToken, invitationUrl, inviteConsumed }
    connected: false,
    pendingApproval: null, // { requestId, sessionId, roomEpoch, clientLabel }
  };
  let ws = null;

  const wire = (route, title, payload, tone = "info") => onEvent({ type: "wire", route, title, payload, tone });
  const changed = () => onEvent({ type: "provider" });

  function send(frame) {
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }

  /** Broadcasts the host's current tool surface; the relay re-hashes it and pushes list_changed. */
  function broadcastCatalog(reason) {
    const frame = { type: "register", alias, tools: host.listTools() };
    if (!send(frame)) return false;
    wire("Tier 1 → Tier 2", `WS register · ${reason} (${frame.tools.length} tools)`, frame, "purple");
    return true;
  }

  function adoptRoom(descriptor) {
    state.room = {
      id: descriptor.id,
      roomEpoch: descriptor.roomEpoch,
      providerToken: descriptor.providerToken,
      inviteToken: descriptor.inviteToken,
      invitationUrl: buildInvitationUrl(descriptor.descriptorUrl, descriptor.inviteToken),
      inviteConsumed: false,
    };
    state.pendingApproval = null;
    changed();
  }

  function attachSocket() {
    const room = state.room;
    const socket = new WebSocket(`${toWsOrigin(origin)}/p/${room.id}/provider`, [WS_SUBPROTOCOL, `ticket.${room.providerToken}`]);
    ws = socket;
    state.connected = false;
    changed();
    return new Promise((resolve, reject) => {
      let ready = false;
      socket.onmessage = (event) => {
        if (ws !== socket) return;
        const frame = JSON.parse(String(event.data));
        if (frame.type === "ready" && !ready) {
          ready = true;
          state.connected = true;
          wire("Tier 2 → Tier 1", `WS ready (provider, epoch ${frame.roomEpoch})`, frame, "ok");
          broadcastCatalog("초기 도구 표면");
          changed();
          resolve();
          return;
        }
        handleFrame(frame);
      };
      socket.onclose = () => {
        if (!ready) reject(new Error("PROVIDER_SOCKET_REJECTED"));
        if (ws !== socket) return;
        ws = null;
        state.connected = false;
        wire("Tier 1", "Provider WebSocket 종료", {}, "warn");
        changed();
      };
    });
  }

  function handleFrame(frame) {
    switch (frame.type) {
      case "approval.request": {
        const payload = frame.payload ?? frame;
        state.pendingApproval = {
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          roomEpoch: payload.roomEpoch,
          clientLabel: payload.clientLabel ?? "MCP client",
        };
        // An approval request proves the single-use invite was redeemed by someone.
        if (state.room) state.room.inviteConsumed = true;
        wire("Tier 2 → Tier 1", `WS approval.request (${state.pendingApproval.clientLabel})`, frame, "warn");
        changed();
        return;
      }
      case "approval.approved":
      case "approval.rejected":
        wire("Tier 2 → Tier 1", `WS ${frame.type} (확정 에코)`, frame, frame.type === "approval.approved" ? "ok" : "err");
        return;
      case "room.rotated":
        wire("Tier 2 → Tier 1", `WS room.rotated → ${String(frame.rotatedTo).slice(0, 10)}…`, frame, "warn");
        return;
      case "error":
        wire("Tier 2 → Tier 1", `WS error ${frame.message}`, frame, "err");
        return;
      case "mcp":
        if (frame.message?.method) handleRpc(frame.message);
        return;
      default:
        return;
    }
  }

  function reply(id, outcome) {
    const message = { jsonrpc: "2.0", id, ...outcome };
    send({ type: "mcp", message });
    return message;
  }

  /** MCP server role: answers JSON-RPC requests relayed from the agent through Tier 2. */
  function handleRpc(rpc) {
    wire("Tier 2 → Tier 1", `WS MCP request: ${rpc.method}${rpc.params?.name ? ` (${rpc.params.name})` : ""}`, rpc, "info");
    if (rpc.id === undefined || rpc.id === null) return; // notification
    if (rpc.method === "tools/list") {
      const message = reply(rpc.id, { result: { tools: host.listTools() } });
      wire("Tier 1 → Tier 2", `WS MCP result: tools/list (${message.result.tools.length})`, message, "ok");
      return;
    }
    if (rpc.method !== "tools/call") {
      reply(rpc.id, { error: { code: -32601, message: "METHOD_NOT_FOUND", data: { method: rpc.method } } });
      return;
    }
    const name = rpc.params?.name;
    try {
      const output = host.executeTool(name, rpc.params?.arguments ?? {});
      const message = reply(rpc.id, {
        result: { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output },
      });
      const receipt = output.receipt;
      wire("Tier 1 → Tier 2", `WS MCP result: ${name}${receipt ? ` (CommitReceipt ${receipt.transactionId})` : ""}`, message, "ok");
      if (receipt) onEvent({ type: "host", changed: true });
    } catch (error) {
      const code = error.code ?? "HOST_ERROR";
      const message = reply(rpc.id, { error: { code: -32000, message: code, data: { code, detail: error.message } } });
      wire("Tier 1 → Tier 2", `WS MCP error: ${name} (${code})`, message, "err");
    }
  }

  async function createRoom() {
    close();
    const response = await fetch(`${origin}/p`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, capabilities: ["mcp-control"] }),
    });
    const created = await response.json();
    if (!response.ok) {
      wire("Tier 2 → Tier 1", `POST /p 실패 (${response.status})`, created, "err");
      throw new Error(created.error ?? `ROOM_CREATE_FAILED_${response.status}`);
    }
    adoptRoom(created);
    wire("Tier 1 → Tier 2", `POST /p → room ${created.id.slice(0, 10)}… (epoch ${created.roomEpoch})`, redactSecrets(created), "ok");
    await attachSocket();
    return state.room;
  }

  function decideApproval(decision) {
    const pending = state.pendingApproval;
    const room = state.room;
    if (!pending || !room) return false;
    const now = new Date().toISOString();
    const envelope = {
      protocol: PEER_PROTOCOL,
      messageId: `approval-decision-${pending.requestId}-${Date.now()}`,
      type: "approval.decision",
      roomId: room.id,
      roomEpoch: pending.roomEpoch,
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      sentAt: now,
      payload: {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        roomId: room.id,
        roomEpoch: pending.roomEpoch,
        decision,
        decidedAt: now,
      },
    };
    const sent = send(envelope);
    wire("Tier 1 → Tier 2", `WS approval.decision (${decision})`, envelope, decision === "approved" ? "ok" : "err");
    state.pendingApproval = null;
    changed();
    return sent;
  }

  /** Zero-downtime rotation: new room id + epoch, every ticket of the old room is invalidated. */
  async function rotateRoom() {
    const room = state.room;
    if (!room) return null;
    const response = await fetch(`${origin}/p/${room.id}/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${room.providerToken}` },
      body: JSON.stringify({ roomId: room.id, roomEpoch: room.roomEpoch, requestedAt: new Date().toISOString(), alias }),
    });
    const rotated = await response.json();
    if (!response.ok) {
      wire("Tier 2 → Tier 1", `POST /rotate 실패 (${response.status})`, rotated, "err");
      throw new Error(rotated.error ?? `ROTATE_FAILED_${response.status}`);
    }
    wire(
      "Tier 1 → Tier 2",
      `POST /p/:id/rotate → epoch ${rotated.previousRoomEpoch} → ${rotated.roomEpoch} (무효화 ${rotated.invalidatedSessionCount} 세션)`,
      redactSecrets(rotated),
      "warn",
    );
    close();
    adoptRoom(rotated);
    await attachSocket();
    return rotated;
  }

  /** Revokes every agent session, then purges the host's room credentials (purgeSavedCredentials). */
  async function revokeRoom() {
    const room = state.room;
    if (!room) return null;
    const response = await fetch(`${origin}/p/${room.id}/session/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${room.providerToken}` },
      body: JSON.stringify({ reason: "host-revoke" }),
    });
    const body = await response.json();
    wire("Tier 1 → Tier 2", `POST /p/:id/session/revoke (${response.status})`, body, response.ok ? "warn" : "err");
    close();
    state.room = null;
    wire("Tier 1", "호스트 자격 증명 파기 (providerToken · inviteToken · lease)", {}, "err");
    changed();
    return body;
  }

  /** Closes the provider socket; the room credentials stay so the caller can decide what next. */
  function close() {
    const socket = ws;
    ws = null;
    state.connected = false;
    state.pendingApproval = null;
    try {
      socket?.close();
    } catch {}
  }

  function reset() {
    close();
    state.room = null;
    changed();
  }

  return { state, createRoom, rotateRoom, revokeRoom, decideApproval, broadcastCatalog, close, reset };
}
