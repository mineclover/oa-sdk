// Tier 3 — External AI Agent runtime (DOM-free; runs in the browser demo and in Node tests).
// Redeems an invitation URL, waits for host approval, and calls tools over Streamable HTTP with
// two fail-closed guards:
//   1. catalog drift — the cached catalogVersion/catalogHash travel in params._meta; the relay
//      answers CATALOG_CHANGED for stale writes, and only read-only tools are retried.
//   2. catalog integrity — every tools/list is re-hashed locally; a hash that does not match the
//      relay's catalogHash blocks all calls until a verified catalog is fetched.
import { RPC_CODES, WS_SUBPROTOCOL, computeCatalogHash, parseInvitation, redactSecrets, sleep, toWsOrigin } from "./peer-protocol.js";

const EMPTY_CATALOG = Object.freeze({ tools: [], catalogVersion: 0, catalogHash: "", localHash: "", verified: false });

// An expired approval request and an expired room are different endings (APPROVAL_EXPIRED vs
// ROOM_EXPIRED), so each has a status of its own.
const TERMINAL_FRAME_STATE = {
  "approval.rejected": "rejected",
  "approval.expired": "expired",
  "session.revoked": "revoked",
  "room.rotated": "rotated",
  "room.expired": "room-expired",
};

/**
 * @param {{
 *   label?: string,
 *   autoRefresh?: () => boolean,
 *   onEvent?: (event: { type: "wire" | "agent" | "tools" | "call", [key: string]: unknown }) => void,
 * }} options
 */
export function createAgentClient({ label = "Claude / Cursor Live Agent", autoRefresh = () => true, onEvent = () => {} } = {}) {
  const state = {
    session: null, // { origin, roomId, roomEpoch, sessionId, clientToken }
    status: "idle", // idle | joining | pending | approved | rejected | revoked | expired | room-expired | rotated
    catalog: { ...EMPTY_CATALOG },
    serverCatalog: { catalogVersion: 0, catalogHash: "" },
  };
  let ws = null;
  let rpcSeq = 0;

  const wire = (route, title, payload, tone = "info") => onEvent({ type: "wire", route, title, payload, tone });

  function setStatus(status) {
    state.status = status;
    onEvent({ type: "agent" });
  }

  /** Records the relay's view of the catalog; versions only move forward. */
  function observeServerCatalog(catalogVersion, catalogHash) {
    if (typeof catalogHash !== "string" || (catalogVersion ?? 0) < (state.serverCatalog.catalogVersion ?? 0)) return;
    state.serverCatalog = { catalogVersion, catalogHash };
    onEvent({ type: "agent" });
  }

  function openSocket() {
    const session = state.session;
    const socket = new WebSocket(`${toWsOrigin(session.origin)}/p/${session.roomId}/client`, [WS_SUBPROTOCOL, `ticket.${session.clientToken}`]);
    ws = socket;
    socket.onmessage = (event) => {
      if (ws === socket) handleFrame(JSON.parse(String(event.data)));
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
    };
  }

  function handleFrame(frame) {
    if (frame.type === "ready") {
      wire("Tier 2 → Tier 3", `WS ready (client, approval=${frame.approval})`, frame, "info");
      return;
    }
    if (frame.type === "approval.pending") {
      wire("Tier 2 → Tier 3", "WS approval.pending", frame, "warn");
      return;
    }
    if (frame.type === "approval.approved") {
      wire("Tier 2 → Tier 3", "WS approval.approved (티켓 활성화)", frame, "ok");
      setStatus("approved");
      return;
    }
    if (TERMINAL_FRAME_STATE[frame.type]) {
      wire("Tier 2 → Tier 3", `WS ${frame.type} (${frame.reason ?? frame.payload?.reason ?? "terminal"})`, frame, "err");
      setStatus(TERMINAL_FRAME_STATE[frame.type]);
      return;
    }
    if (frame.type === "mcp" && frame.message?.method === "notifications/tools/list_changed") {
      const params = frame.message.params ?? {};
      wire("Tier 2 → Tier 3", `WS notifications/tools/list_changed (v${params.catalogVersion})`, frame.message, "purple");
      observeServerCatalog(params.catalogVersion, params.catalogHash);
      if (autoRefresh() && state.status === "approved") void listTools("list_changed 푸시");
    }
    // Raw `register` frames are relayed to clients too; list_changed already announces the change.
  }

  /** Resolves on a terminal approval state, via WS push with GET /p/:id/sessions/:sid as fallback. */
  async function waitForApproval(session, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let nextPoll = 0;
    while (state.session === session && Date.now() < deadline) {
      if (state.status === "approved") return true;
      if (state.status !== "pending") return false;
      if (Date.now() >= nextPoll) {
        nextPoll = Date.now() + 1000;
        const response = await fetch(`${session.origin}/p/${session.roomId}/sessions/${encodeURIComponent(session.sessionId)}`, {
          headers: { Authorization: `Bearer ${session.clientToken}` },
        });
        const status = await response.json();
        if (state.session !== session) return false;
        // A ticket expires with its room (its expiresAt is the room's), so an expired ticket past its
        // expiresAt is an expired room, and one before it an approval request that expired.
        if (status.state === "approved") setStatus("approved");
        else if (status.state === "expired") setStatus(Date.parse(status.expiresAt) <= Date.now() ? "room-expired" : "expired");
        else if (["rejected", "revoked"].includes(status.state)) setStatus(status.state);
        else if (status.error === "ROOM_ROTATED") setStatus("rotated");
      }
      await sleep(50);
    }
    return state.session === session && state.status === "approved";
  }

  /**
   * Redeems a single-use invitation URL. Resolves `{ ok: true }` once the host approves, or
   * `{ ok: false, error }` when the relay refuses the invite or the host rejects the session.
   */
  async function join(invitationUrl, { approvalTimeoutMs = 120_000 } = {}) {
    const { origin, roomId, inviteToken } = parseInvitation(invitationUrl);
    const previousStatus = state.status;
    setStatus("joining");
    const response = await fetch(`${origin}/p/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteToken, clientLabel: label }),
    });
    const joined = await response.json();
    if (!response.ok) {
      wire("Tier 2 → Tier 3", `POST /join 거부 (${response.status} ${joined.error})`, joined, "err");
      setStatus(previousStatus === "joining" ? "idle" : previousStatus);
      return { ok: false, status: response.status, error: joined.error, body: joined };
    }
    close();
    state.session = { origin, roomId: joined.roomId, roomEpoch: joined.roomEpoch, sessionId: joined.sessionId, clientToken: joined.clientToken };
    wire("Tier 3 → Tier 2", `POST /p/:id/join → ${joined.state} (초대 토큰 소비)`, redactSecrets(joined), "info");
    setStatus(joined.state === "approved" ? "approved" : "pending");
    openSocket();
    const session = state.session;
    const approved = await waitForApproval(session, approvalTimeoutMs);
    if (!approved) return { ok: false, error: state.status.toUpperCase().replaceAll("-", "_") };
    await listTools("승인 직후 초기 동기화");
    return { ok: true, session };
  }

  async function rpc(method, params) {
    const session = state.session;
    const request = { jsonrpc: "2.0", id: `agent-${(rpcSeq += 1)}`, method, params };
    const response = await fetch(`${session.origin}/p/${session.roomId}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.clientToken}` },
      body: JSON.stringify(request),
    });
    return { request, status: response.status, body: await response.json() };
  }

  function catalogMeta() {
    return {
      sessionId: state.session.sessionId,
      catalogVersion: state.catalog.catalogVersion,
      catalogHash: state.catalog.catalogHash,
    };
  }

  /** tools/list + local integrity proof of the relay's catalogHash. */
  async function listTools(reason) {
    if (!state.session) return null;
    const { status, body } = await rpc("tools/list", { _meta: catalogMeta() });
    if (body.error) {
      wire("Tier 2 → Tier 3", `tools/list 실패 (${status} ${body.error.message})`, body, "err");
      return null;
    }
    const tools = body.result?.tools ?? [];
    const meta = body.result?._meta ?? {};
    const localHash = await computeCatalogHash(tools);
    const verified = typeof meta.catalogHash === "string" && localHash === meta.catalogHash;
    const previous = new Set(state.catalog.tools.map((tool) => tool.name));
    const names = tools.map((tool) => tool.name);
    const added = previous.size ? names.filter((name) => !previous.has(name)) : [];
    const removed = [...previous].filter((name) => !names.includes(name));
    state.catalog = { tools, catalogVersion: meta.catalogVersion ?? 0, catalogHash: meta.catalogHash ?? "", localHash, verified };
    observeServerCatalog(meta.catalogVersion ?? 0, meta.catalogHash);
    const diff = [...added.map((name) => `+${name}`), ...removed.map((name) => `-${name}`)].join(" ");
    wire(
      "Tier 2 → Tier 3",
      `tools/list · ${reason} → v${meta.catalogVersion} (${tools.length} tools${diff ? `, ${diff}` : ""}) · 해시 ${verified ? "검증됨" : "불일치"}`,
      body.result,
      verified ? "ok" : "err",
    );
    onEvent({ type: "tools", added: new Set(added), removed });
    return state.catalog;
  }

  /**
   * Guarded tools/call. Emits one `{ type: "call" }` event with the final outcome.
   * @returns {Promise<{ ok: true, data: unknown } | { ok: false, code: string|number, body?: unknown, blocked?: string }>}
   */
  async function callTool(name, args = {}) {
    const result = await guardedCall(name, args, false);
    onEvent({ type: "call", name, args, result });
    return result;
  }

  async function guardedCall(name, args, retried) {
    if (!state.session) return { ok: false, code: "NO_SESSION" };
    if (state.catalog.catalogHash && !state.catalog.verified) {
      wire("Tier 3", `Fail-Closed: 카탈로그 무결성 미검증 — ${name} 호출을 로컬에서 차단`, state.catalog, "err");
      return { ok: false, code: "CATALOG_INTEGRITY_UNVERIFIED", blocked: "CATALOG_INTEGRITY_UNVERIFIED" };
    }
    const { request, status, body } = await rpc("tools/call", { name, arguments: args, _meta: catalogMeta() });
    wire("Tier 3 → Tier 2", `POST /p/:id/mcp tools/call: ${name} (v${state.catalog.catalogVersion})`, request, "info");

    if (!body.error) {
      const data = body.result?.structuredContent ?? body.result;
      wire("Tier 2 → Tier 3", `tools/call 결과: ${name}`, body.result, "ok");
      return { ok: true, data };
    }

    const { code, message } = body.error;
    if (code === RPC_CODES.CATALOG_CHANGED) {
      wire("Tier 2 → Tier 3", `Fail-Closed: CATALOG_CHANGED (${status}) — 낡은 카탈로그로 호출 차단`, body, "warn");
      await listTools("드리프트 감지 후 재조회");
      const readOnly = state.catalog.tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true;
      if (readOnly && !retried) return guardedCall(name, args, true);
      return { ok: false, code: "CATALOG_CHANGED", blocked: "CATALOG_CHANGED", body, readOnly };
    }
    if (code === RPC_CODES.ROOM_ROTATED) setStatus("rotated");
    wire("Tier 2 → Tier 3", `tools/call 거부: ${name} (${status} ${message})`, body, "err");
    return { ok: false, code: body.error.data?.code ?? message ?? code, status, body };
  }

  function close() {
    const socket = ws;
    ws = null;
    state.session = null;
    state.status = "idle";
    state.catalog = { ...EMPTY_CATALOG };
    state.serverCatalog = { catalogVersion: 0, catalogHash: "" };
    try {
      socket?.close();
    } catch {}
    onEvent({ type: "agent" });
    onEvent({ type: "tools", added: new Set(), removed: [] });
  }

  return { state, join, listTools, callTool, observeServerCatalog, close };
}
