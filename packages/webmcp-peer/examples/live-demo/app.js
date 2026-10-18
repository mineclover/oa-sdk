// WebMCP Peer live demo — view layer. Protocol behaviour lives in DOM-free modules that the
// E2E proof test (test/live-demo.e2e.test.ts) runs unchanged against a real server:
//   host-tools.js    Tier 1 application model (tool packs, canvas, CommitReceipt ledger)
//   host-provider.js Tier 1 provider runtime (room, provider socket, approvals, MCP relay)
//   agent-client.js  Tier 3 agent runtime (join, approval wait, drift + integrity guarded calls)
//   scenario.js      the autopilot scenario
import { $, el, setBadge, setText, flash, shortHash, logWire, clearWireLog } from "./ui.js";
import { TOOL_PACKS, createHostRuntime } from "./host-tools.js";
import { createHostProvider } from "./host-provider.js";
import { createAgentClient } from "./agent-client.js";
import { SCENARIO_STEPS, runLiveScenario } from "./scenario.js";

const ORIGIN = location.origin;
const HOST_ALIAS = "live-demo-host";

const handleEvent = (event) => {
  if (event.type === "wire") logWire(event.route, event.title, event.payload, event.tone);
  else if (event.type === "provider") renderProvider();
  else if (event.type === "agent") {
    renderAgent();
    renderProvider();
  } else if (event.type === "tools") renderAgentTools(event.added);
  else if (event.type === "call") {
    $("call-name").value = event.name;
    $("call-args").value = JSON.stringify(event.args, null, 2);
    showCallOutcome(event.result);
  } else if (event.type === "host") {
    renderCanvas(true);
    renderLedger();
  }
};

const host = createHostRuntime();
const provider = createHostProvider({ origin: ORIGIN, host, alias: HOST_ALIAS, onEvent: handleEvent });
const agent = createAgentClient({ autoRefresh: () => $("auto-refresh").checked, onEvent: handleEvent });

let maskInvite = true;
let autopilotRunning = false;
let posture = null;
let postureSeq = 0;

// =====================================================================
// Rendering
// =====================================================================

function renderScenarioSteps() {
  $("scenario").replaceChildren(
    ...SCENARIO_STEPS.map((step, index) =>
      el("li", { dataset: { step: step.id } }, el("span", { class: "step-no" }, String(index + 1)), step.label),
    ),
  );
}

function setStep(stepId, state) {
  const node = document.querySelector(`#scenario [data-step="${stepId}"]`);
  if (node) node.dataset.state = state;
}

function renderPacks() {
  $("pack-grid").replaceChildren(
    ...TOOL_PACKS.map((pack) =>
      el(
        "button",
        {
          type: "button",
          class: "pack-toggle",
          "aria-pressed": String(host.state.enabledPacks.has(pack.id)),
          "data-locked": pack.locked ? "true" : null,
          title: pack.locked ? "기본 팩은 항상 활성화됩니다" : null,
          onclick: () => togglePack(pack.id),
        },
        el("strong", {}, pack.label),
        el("small", {}, pack.tools.map((tool) => tool.name).join(", ")),
      ),
    ),
  );
  $("custom-tool-list").replaceChildren(
    ...host.state.customTools.map((tool) =>
      el(
        "button",
        { type: "button", class: "badge purple", title: "클릭하면 제거됩니다", onclick: () => removeCustomTool(tool.name) },
        `${tool.name} ×`,
      ),
    ),
  );
  $("provider-tool-count").textContent = `활성 도구 ${host.listTools().length}개`;
}

const KIND_TONE = { qa: "warn", deploy: "purple", core: "info" };

function renderCanvas(changed = false) {
  const previous = new Set([...$("scene-nodes").children].map((node) => node.dataset.id));
  $("scene-nodes").replaceChildren(
    ...host.state.nodes.map((node) =>
      el(
        "div",
        { class: `scene-node${changed && !previous.has(node.id) ? " fresh" : ""}`, dataset: { kind: node.kind, id: node.id } },
        el("div", { class: "scene-node-head" }, el("span", {}, node.title), el("span", { class: `badge ${KIND_TONE[node.kind] ?? "info"}` }, node.kind)),
        el("div", { class: "scene-node-meta" }, `id: ${node.id} · role: ${node.role}`),
      ),
    ),
  );
  const stage = $("canvas-stage");
  stage.dataset.theme = host.state.theme;
  $("canvas-theme").textContent = `Theme: ${host.state.theme}`;
  $("canvas-count").textContent = `${host.state.nodes.length} Nodes`;
  if (changed) flash(stage);
}

function renderLedger() {
  const ledger = host.state.ledger;
  $("btn-rollback").disabled = !ledger.some((entry) => entry.status === "durable");
  if (ledger.length === 0) {
    $("receipt-list").replaceChildren(el("li", { class: "muted" }, "아직 기록된 CommitReceipt가 없습니다."));
    return;
  }
  $("receipt-list").replaceChildren(
    ...[...ledger].reverse().map((entry) =>
      el(
        "li",
        { dataset: { status: entry.status } },
        `[${entry.receipt.transactionId}] ${entry.summary} · ${entry.toolName} · op=${entry.receipt.operationId} · status=${entry.status}`,
      ),
    ),
  );
}

function renderWriteToggle() {
  const enabled = host.state.writeEnabled;
  const button = $("btn-toggle-write");
  button.className = enabled ? "success" : "danger";
  button.textContent = enabled ? "수정 허용됨 (Write ON)" : "읽기 전용 잠금 (Write OFF)";
  button.setAttribute("aria-pressed", String(enabled));
}

function renderProvider() {
  const { room, connected, pendingApproval } = provider.state;
  if (!room) setBadge("provider-state", "", "disconnected");
  else if (!connected) setBadge("provider-state", "warn", "connecting…");
  else if (agent.state.status === "approved" && agent.state.session?.roomId === room.id) setBadge("provider-state", "ok", "agent connected");
  else setBadge("provider-state", "info", "waiting for agent");

  setBadge("room-epoch", room ? "info" : "", room ? `Room: ${room.id.slice(0, 10)}… · Epoch: ${room.roomEpoch}` : "Room: - · Epoch: -");
  const invite = $("invite-url");
  if (!room) {
    invite.className = "mono-box muted";
    invite.textContent = "초대 룸을 생성하면 #invite= 토큰이 포함된 URL이 발급됩니다.";
  } else {
    const redacted = posture?.invitation?.redactedUrl;
    invite.className = "mono-box";
    invite.textContent = maskInvite ? redacted ?? "마스킹 계산 중…" : room.invitationUrl;
  }
  $("btn-toggle-mask").textContent = maskInvite ? "토큰 표시" : "토큰 가리기";
  $("btn-toggle-mask").setAttribute("aria-pressed", String(!maskInvite));
  $("btn-rotate-room").disabled = !room || !connected;
  $("btn-revoke-room").disabled = !room;

  $("approval-banner").hidden = !pendingApproval;
  if (pendingApproval) {
    $("approval-text").textContent = `승인 요청: ${pendingApproval.clientLabel} (${pendingApproval.sessionId.slice(0, 22)}…)`;
  }
  const join = $("btn-join");
  join.disabled = !room || agent.state.status === "joining" || agent.state.status === "pending";
  join.textContent = room?.inviteConsumed ? "초대 재사용 시도 (1회용 검증)" : "초대 링크로 Join";
}

function renderPosture() {
  if (!posture) return;
  $("transport-rows").replaceChildren(
    ...posture.transports.map((entry) => {
      const [tone, label] = entry.local ? ["ok", "루프백 허용"] : entry.secure ? ["ok", "TLS 허용"] : ["err", "평문 원격 HTTP 차단"];
      return el("tr", {}, el("td", {}, entry.url), el("td", {}, el("span", { class: `badge ${tone}` }, label)));
    }),
  );
  const profileBox = $("profile-box");
  profileBox.className = "mono-box";
  profileBox.textContent = JSON.stringify(posture.profile, null, 2);
  $("stripped-keys").replaceChildren(
    ...(posture.strippedKeys.length
      ? [el("span", { class: "field-label" }, "프로필에서 제거된 시크릿:"), ...posture.strippedKeys.map((key) => el("span", { class: "badge err" }, key))]
      : []),
  );
}

const AGENT_STATUS_BADGE = {
  idle: ["", "idle"],
  joining: ["warn", "joining…"],
  pending: ["warn", "승인 대기 (pending-approval)"],
  approved: ["ok", "approved & connected"],
  rejected: ["err", "CLIENT_APPROVAL_DENIED"],
  revoked: ["err", "SESSION_REVOKED"],
  expired: ["err", "APPROVAL_EXPIRED"],
  rotated: ["err", "ROOM_ROTATED (티켓 무효)"],
};

function renderAgent() {
  const { status, session, catalog, serverCatalog } = agent.state;
  const [tone, label] = AGENT_STATUS_BADGE[status] ?? ["", status];
  setBadge("client-state", tone, label);
  setText("client-session", session ? session.sessionId : "-");
  setText("client-epoch", session ? String(session.roomEpoch) : "-");
  setText("client-catalog", catalog.catalogHash ? `v${catalog.catalogVersion} · ${shortHash(catalog.catalogHash, 16)}` : "-");
  setText("room-catalog", serverCatalog.catalogHash ? `v${serverCatalog.catalogVersion} · ${shortHash(serverCatalog.catalogHash, 16)}` : "-");
  setText(
    "client-integrity",
    catalog.localHash ? `${shortHash(catalog.localHash, 16)} ${catalog.verified ? "✓ 릴레이 해시와 일치" : "✗ 불일치 — 호출 차단"}` : "-",
  );
  if (!catalog.catalogHash) setBadge("drift-badge", "", "미동기화");
  else if (!catalog.verified) setBadge("drift-badge", "err", "무결성 검증 실패");
  else if (serverCatalog.catalogHash && serverCatalog.catalogHash !== catalog.catalogHash) setBadge("drift-badge", "warn", "드리프트 감지 (캐시 낡음)");
  else setBadge("drift-badge", "ok", "카탈로그 동기화 · 해시 검증됨");

  $("btn-list-tools").disabled = !session;
  $("btn-call").disabled = !session;
}

function renderAgentTools(added = new Set()) {
  const tools = agent.state.catalog.tools;
  $("client-tool-count").textContent = `${tools.length} tools`;
  if (tools.length === 0) {
    $("client-tool-list").replaceChildren(el("p", { class: "muted" }, "룸에 Join하고 승인되면 호스트가 등록한 도구가 표시됩니다."));
    return;
  }
  $("client-tool-list").replaceChildren(
    ...tools.map((tool) => {
      const isNew = added.has(tool.name);
      const readOnly = tool.annotations?.readOnlyHint === true;
      return el(
        "button",
        { type: "button", class: `tool-item${isNew ? " fresh" : ""}`, onclick: () => fillCallForm(tool) },
        el(
          "span",
          {},
          el("span", { class: "tool-name" }, tool.name, isNew ? el("span", { class: "badge ok" }, "NEW") : null),
          el("span", { class: "tool-desc" }, tool.description ?? ""),
        ),
        el("span", { class: `badge ${readOnly ? "info" : "warn"}` }, readOnly ? "read" : "write"),
      );
    }),
  );
}

function setCallResult(tone, value) {
  const box = $("call-result");
  box.dataset.tone = tone;
  box.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function showCallOutcome(result) {
  if (result.ok) setCallResult("ok", result.data);
  else if (result.blocked === "CATALOG_CHANGED") {
    setCallResult("warn", {
      blocked: "CATALOG_CHANGED",
      note: result.readOnly ? "재시도 후에도 카탈로그가 변경되었습니다." : "쓰기 도구는 자동 재시도하지 않습니다. 갱신된 카탈로그를 확인한 뒤 다시 실행하세요.",
      catalog: result.body?.error?.data,
    });
  } else setCallResult("err", result.body ?? { blocked: result.code });
}

// =====================================================================
// Tier 2 snapshots & Config posture (view-only fetches)
// =====================================================================

async function refreshServer() {
  const rows = [];
  try {
    const health = await (await fetch(`${ORIGIN}/health`, { cache: "no-store" })).json();
    setBadge("server-health", health.status === "healthy" ? "ok" : "err", health.status ?? "unknown");
    rows.push(["activeRooms", health.activeRooms ?? 0], ["uptime", `${Math.round(health.uptimeSec ?? 0)}s`]);
  } catch {
    setBadge("server-health", "err", "unreachable");
  }
  const roomId = provider.state.room?.id ?? agent.state.session?.roomId;
  if (roomId) {
    // The descriptor is served with a short public max-age; revalidate so the panel shows live state.
    const catalog = await (await fetch(`${ORIGIN}/p/${roomId}/mcp/tools`, { cache: "no-cache" })).json();
    rows.push(
      ["roomId", `${roomId.slice(0, 16)}…`],
      ["state", catalog.state ?? catalog.error ?? "-"],
      ["providerConnected", String(catalog.providerConnected ?? false)],
      ["catalogVersion", String(catalog.catalogVersion ?? "-")],
      ["catalogHash", shortHash(catalog.catalogHash, 20)],
      ["tools", (catalog.tools ?? []).map((tool) => tool.name).join(", ") || "-"],
    );
    if (agent.state.session?.roomId === roomId) agent.observeServerCatalog(catalog.catalogVersion, catalog.catalogHash);
  } else {
    rows.push(["room", "미할당"]);
  }
  $("server-metrics").replaceChildren(...rows.flatMap(([key, value]) => [el("dt", {}, key), el("dd", {}, String(value))]));
}

async function refreshPosture() {
  const seq = (postureSeq += 1);
  const room = provider.state.room;
  const response = await fetch(`${ORIGIN}/demo/api/posture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serverUrl: ORIGIN,
      alias: HOST_ALIAS,
      ...(room ? { invitationUrl: room.invitationUrl, roomEpoch: room.roomEpoch } : {}),
      // Local host settings as an app would hold them — the library must strip the credentials.
      defaults: {
        approvalRequired: true,
        writeEnabled: host.state.writeEnabled,
        ...(room ? { providerToken: room.providerToken, inviteToken: room.inviteToken } : {}),
      },
    }),
  });
  const next = await response.json();
  if (seq !== postureSeq) return; // a newer room state superseded this evaluation
  posture = next;
  renderPosture();
  renderProvider();
}

const refreshSnapshots = () => Promise.all([refreshPosture(), refreshServer()]);

// =====================================================================
// Actions
// =====================================================================

function broadcast(reason) {
  renderPacks();
  if (provider.broadcastCatalog(reason)) setTimeout(() => void refreshServer(), 80);
}

function togglePack(packId) {
  if (!host.setPack(packId, !host.state.enabledPacks.has(packId))) return;
  broadcast(`${packId} 팩 ${host.state.enabledPacks.has(packId) ? "활성화" : "비활성화"}`);
}

function addCustomTool() {
  const name = $("custom-tool-name").value.trim();
  try {
    if (!host.addCustomTool(name, $("custom-tool-desc").value.trim())) {
      logWire("Tier 1", `이미 등록된 도구 이름입니다: ${name}`, {}, "warn");
      return;
    }
  } catch (error) {
    logWire("Tier 1", error.message, {}, "err");
    return;
  }
  broadcast(`커스텀 도구 ${name} 추가`);
}

function removeCustomTool(name) {
  if (host.removeCustomTool(name)) broadcast(`커스텀 도구 ${name} 제거`);
}

function sampleArgs(tool) {
  const hostSample = host.findTool(tool.name)?.sampleArgs;
  if (hostSample) return hostSample;
  const properties = tool.inputSchema?.properties ?? {};
  return Object.fromEntries(Object.entries(properties).map(([key, schema]) => [key, schema.enum?.[0] ?? ""]));
}

function fillCallForm(tool) {
  $("call-name").value = tool.name;
  $("call-args").value = JSON.stringify(sampleArgs(tool), null, 2);
}

async function joinAgent() {
  const room = provider.state.room;
  if (!room) return;
  const result = await agent.join(room.invitationUrl);
  if (!result.ok && result.body) setCallResult("err", result.body);
}

async function callFromForm() {
  const name = $("call-name").value.trim();
  let args;
  try {
    args = JSON.parse($("call-args").value || "{}");
  } catch (error) {
    setCallResult("err", `인자 JSON 파싱 실패: ${error.message}`);
    return;
  }
  await agent.callTool(name, args); // the outcome is rendered from the "call" event
}

async function runAutopilot() {
  if (autopilotRunning) return;
  autopilotRunning = true;
  $("btn-autopilot").disabled = true;
  resetAll({ keepLog: true });
  setBadge("global-status", "warn", "시나리오 실행 중…");
  try {
    await runLiveScenario({
      host,
      provider,
      agent,
      onStep: (stepId, state) => {
        setStep(stepId, state);
        if (state === "done") void refreshSnapshots();
      },
    });
    setBadge("global-status", "ok", "실시간 시연 완료");
  } catch (error) {
    setBadge("global-status", "err", `시연 중단: ${error.message}`);
    logWire("Autopilot", `시나리오 중단: ${error.message}`, {}, "err");
  } finally {
    autopilotRunning = false;
    $("btn-autopilot").disabled = false;
  }
}

function resetAll({ keepLog = false } = {}) {
  agent.close();
  provider.reset();
  host.reset();
  posture = null;
  renderScenarioSteps();
  if (!keepLog) clearWireLog();
  setCallResult("", "도구를 실행하면 CommitReceipt와 결과가 표시됩니다.");
  setBadge("global-status", "info", "준비됨");
  renderPacks();
  renderCanvas();
  renderLedger();
  renderWriteToggle();
  renderProvider();
  void refreshSnapshots();
}

// =====================================================================
// Event wiring
// =====================================================================

/** Runs a UI action and surfaces unexpected failures in the stream instead of failing silently. */
const guarded = (action) => () => {
  Promise.resolve()
    .then(action)
    .catch((error) => logWire("Demo", `오류: ${error.message}`, {}, "err"));
};

const thenRefresh = (action) => guarded(async () => {
  await action();
  await refreshSnapshots();
});

$("btn-create-room").addEventListener("click", thenRefresh(() => {
  agent.close();
  return provider.createRoom();
}));
$("btn-rotate-room").addEventListener("click", thenRefresh(() => provider.rotateRoom()));
$("btn-revoke-room").addEventListener("click", thenRefresh(() => provider.revokeRoom()));
$("btn-approve").addEventListener("click", () => provider.decideApproval("approved"));
$("btn-reject").addEventListener("click", () => provider.decideApproval("rejected"));
$("btn-toggle-write").addEventListener("click", guarded(async () => {
  host.state.writeEnabled = !host.state.writeEnabled;
  renderWriteToggle();
  logWire("Tier 1", `Write Consent → ${host.state.writeEnabled ? "ON" : "OFF (읽기 전용)"}`, { writeEnabled: host.state.writeEnabled }, host.state.writeEnabled ? "ok" : "warn");
  await refreshPosture();
}));
$("btn-toggle-mask").addEventListener("click", () => {
  maskInvite = !maskInvite;
  renderProvider();
});
$("btn-add-custom-tool").addEventListener("click", addCustomTool);
$("btn-rollback").addEventListener("click", () => {
  const entry = host.rollbackLast();
  if (!entry) return;
  renderCanvas(true);
  renderLedger();
  logWire("Tier 1", `CommitReceipt 롤백: ${entry.receipt.transactionId} (${entry.summary})`, entry.receipt, "warn");
});

$("btn-join").addEventListener("click", thenRefresh(joinAgent));
$("btn-list-tools").addEventListener("click", guarded(() => agent.listTools("수동 조회")));
$("btn-call").addEventListener("click", guarded(callFromForm));
$("btn-refresh-server").addEventListener("click", guarded(refreshServer));
$("btn-clear-log").addEventListener("click", clearWireLog);
$("btn-reset").addEventListener("click", () => resetAll());
$("btn-autopilot").addEventListener("click", () => void runAutopilot());

resetAll();
