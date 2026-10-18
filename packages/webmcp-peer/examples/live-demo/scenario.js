// The "⚡ 실시간 동적 MCP 자동 시연" scenario. The browser autopilot and the E2E proof test run this
// exact function, so what the page shows is what the test asserts.
import { sleep, waitUntil } from "./peer-protocol.js";

export const SCENARIO_STEPS = Object.freeze([
  { id: "room", label: "룸 생성" },
  { id: "join", label: "Join & 승인" },
  { id: "node", label: "캔버스 노드 생성" },
  { id: "packs", label: "QA·릴리스 도구팩 활성화" },
  { id: "qa", label: "신규 도구 즉시 호출" },
  { id: "theme", label: "테마 전환" },
]);

async function expectCall(agent, name, args) {
  const result = await agent.callTool(name, args);
  if (!result.ok) throw new Error(`${name} 호출 실패 (${String(result.code)})`);
  return result.data;
}

/**
 * @param {{
 *   host: ReturnType<import("./host-tools.js").createHostRuntime>,
 *   provider: ReturnType<import("./host-provider.js").createHostProvider>,
 *   agent: ReturnType<import("./agent-client.js").createAgentClient>,
 *   onStep?: (stepId: string, state: "active" | "done" | "error") => void,
 *   pace?: number, // 1 = human-watchable pauses, 0 = as fast as possible
 * }} options
 */
export async function runLiveScenario({ host, provider, agent, onStep = () => {}, pace = 1 }) {
  const pause = (ms) => (pace > 0 ? sleep(ms * pace) : Promise.resolve());
  const step = async (id, action) => {
    onStep(id, "active");
    try {
      await action();
      onStep(id, "done");
    } catch (error) {
      onStep(id, "error");
      throw error;
    }
  };

  await step("room", () => provider.createRoom());
  await pause(400);

  await step("join", async () => {
    const joined = agent.join(provider.state.room.invitationUrl);
    await waitUntil(() => provider.state.pendingApproval, { timeoutMs: 5000, label: "승인 요청" });
    await pause(700); // let the approval banner be seen
    provider.decideApproval("approved");
    const result = await joined;
    if (!result.ok) throw new Error(`에이전트 승인 실패 (${result.error})`);
  });
  await pause(500);

  await step("node", () => expectCall(agent, "scene_add_node", { title: "AI 실시간 생성: 장바구니 드로어", role: "cart-drawer" }));
  await pause(600);

  await step("packs", async () => {
    host.setPack("qa", true);
    host.setPack("deploy", true);
    provider.broadcastCatalog("QA·릴리스 팩 활성화");
    const unlocked = () => agent.state.catalog.tools.some((tool) => tool.name === "qa_annotate_issue");
    try {
      await waitUntil(unlocked, { timeoutMs: 1500, label: "카탈로그 푸시" });
    } catch {
      await agent.listTools("수동 재조회"); // auto-refresh switched off
    }
    if (!unlocked()) throw new Error("신규 도구가 카탈로그에 나타나지 않음");
  });
  await pause(600);

  await step("qa", () => expectCall(agent, "qa_annotate_issue", { title: "결제 버튼 터치 영역 44px 확장 필요", severity: "warning" }));
  await pause(500);

  await step("theme", () => expectCall(agent, "stage_switch_theme", { theme: "editorial" }));
}
