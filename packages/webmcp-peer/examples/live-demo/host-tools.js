// Tier 1 host application model: dynamic tool packs, the live canvas, and the CommitReceipt ledger.
// It is transport-agnostic — app.js relays MCP frames to `executeTool` and broadcasts `listTools()`.

const objectSchema = (properties = {}, required) => ({
  type: "object",
  properties,
  ...(required ? { required } : {}),
});

const READ_ONLY = { readOnlyHint: true };
const MUTATING = { readOnlyHint: false, destructiveHint: false };

export const TOOL_PACKS = [
  {
    id: "core",
    label: "기본 캔버스 팩",
    locked: true,
    tools: [
      {
        name: "scene_list",
        description: "현재 캔버스의 장면 노드와 테마 상태를 조회합니다 (Read-Only)",
        inputSchema: objectSchema(),
        annotations: READ_ONLY,
        sampleArgs: {},
      },
      {
        name: "scene_add_node",
        description: "캔버스에 새 와이어프레임 노드를 추가하고 CommitReceipt를 발급합니다 (Write)",
        inputSchema: objectSchema({ title: { type: "string" }, role: { type: "string" } }, ["title"]),
        annotations: MUTATING,
        sampleArgs: { title: "AI 생성 결제 모달", role: "checkout-modal" },
      },
      {
        name: "scene_remove_last",
        description: "가장 최근에 추가된 노드를 제거합니다 (Write)",
        inputSchema: objectSchema(),
        annotations: { readOnlyHint: false, destructiveHint: true },
        sampleArgs: {},
      },
    ],
  },
  {
    id: "qa",
    label: "+ QA 리뷰 도구팩",
    tools: [
      {
        name: "qa_annotate_issue",
        description: "[QA 팩] 캔버스에 접근성/디자인 검토 이슈 노드를 부착합니다 (Write)",
        inputSchema: objectSchema(
          { title: { type: "string" }, severity: { type: "string", enum: ["warning", "blocker"] } },
          ["title"],
        ),
        annotations: MUTATING,
        sampleArgs: { title: "명도 대비 4.5:1 미달", severity: "warning" },
      },
      {
        name: "qa_resolve_all",
        description: "[QA 팩] 등록된 모든 QA 이슈 노드를 일괄 해결합니다 (Write)",
        inputSchema: objectSchema(),
        annotations: { readOnlyHint: false, destructiveHint: true },
        sampleArgs: {},
      },
    ],
  },
  {
    id: "deploy",
    label: "+ 릴리스/테마 팩",
    tools: [
      {
        name: "stage_switch_theme",
        description: "[릴리스 팩] 캔버스 테마(midnight | paper | editorial)를 전환합니다 (Write)",
        inputSchema: objectSchema(
          { theme: { type: "string", enum: ["midnight", "paper", "editorial"] } },
          ["theme"],
        ),
        annotations: MUTATING,
        sampleArgs: { theme: "editorial" },
      },
      {
        name: "stage_release_snapshot",
        description: "[릴리스 팩] 현재 스토리보드를 배포 스냅샷 노드로 마킹합니다 (Write)",
        inputSchema: objectSchema({ tag: { type: "string" } }, ["tag"]),
        annotations: MUTATING,
        sampleArgs: { tag: "v0.4.0-rc1" },
      },
    ],
  },
];

const THEMES = new Set(["midnight", "paper", "editorial"]);
const INITIAL_NODES = [
  { id: "node-1", title: "홈 히어로 배너", role: "hero-banner", kind: "core" },
  { id: "node-2", title: "사용자 네비게이션 바", role: "top-nav", kind: "core" },
];

export class HostToolError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export function createHostRuntime() {
  const state = {
    nodes: structuredClone(INITIAL_NODES),
    theme: "midnight",
    writeEnabled: true,
    enabledPacks: new Set(["core"]),
    customTools: [],
    /** @type {{ receipt: object, summary: string, toolName: string, status: "durable"|"rolled-back", before: { nodes: object[], theme: string } }[]} */
    ledger: [],
  };
  let nodeSeq = 0;
  const nextId = (prefix) => `${prefix}-${Date.now().toString(36).slice(-4)}${(nodeSeq += 1)}`;

  function definitions() {
    const packTools = TOOL_PACKS.filter((pack) => state.enabledPacks.has(pack.id)).flatMap((pack) => pack.tools);
    return [...packTools, ...state.customTools];
  }

  /** MCP descriptors as broadcast in `register` frames (no demo-only fields). */
  function listTools() {
    return definitions().map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(annotations ? { annotations } : {}),
    }));
  }

  function findTool(name) {
    return definitions().find((tool) => tool.name === name);
  }

  function setPack(packId, enabled) {
    const pack = TOOL_PACKS.find((candidate) => candidate.id === packId);
    if (!pack || pack.locked) return false;
    if (enabled) state.enabledPacks.add(packId);
    else state.enabledPacks.delete(packId);
    return true;
  }

  function addCustomTool(name, description) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) {
      throw new HostToolError("INVALID_TOOL_NAME", "도구 이름은 소문자/숫자/밑줄 2~64자여야 합니다");
    }
    if (findTool(name) || TOOL_PACKS.some((pack) => pack.tools.some((tool) => tool.name === name))) return false;
    state.customTools.push({
      name,
      description: description || "사용자 정의 동적 MCP 도구",
      inputSchema: objectSchema({ note: { type: "string" } }),
      annotations: MUTATING,
      sampleArgs: { note: "실시간 동적 도구 호출 테스트" },
      custom: true,
    });
    return true;
  }

  function removeCustomTool(name) {
    const before = state.customTools.length;
    state.customTools = state.customTools.filter((tool) => tool.name !== name);
    return state.customTools.length !== before;
  }

  function applyMutation(name, args) {
    switch (name) {
      case "scene_add_node": {
        const node = {
          id: nextId("node"),
          title: String(args.title || "새 컴포넌트"),
          role: String(args.role || "wireframe-box"),
          kind: "core",
        };
        state.nodes.push(node);
        return `노드 추가 ("${node.title}")`;
      }
      case "scene_remove_last": {
        const removed = state.nodes.pop();
        if (!removed) throw new HostToolError("NOTHING_TO_REMOVE", "제거할 노드가 없습니다");
        return `노드 제거 ("${removed.title}")`;
      }
      case "qa_annotate_issue": {
        const severity = args.severity === "blocker" ? "blocker" : "warning";
        const node = { id: nextId("qa"), title: `[QA] ${args.title || "검토 이슈"}`, role: `severity:${severity}`, kind: "qa" };
        state.nodes.push(node);
        return `QA 이슈 부착 ("${node.title}")`;
      }
      case "qa_resolve_all": {
        const count = state.nodes.filter((node) => node.kind === "qa").length;
        state.nodes = state.nodes.filter((node) => node.kind !== "qa");
        return `QA 이슈 ${count}건 해결`;
      }
      case "stage_switch_theme": {
        const theme = String(args.theme);
        if (!THEMES.has(theme)) throw new HostToolError("INVALID_THEME", `지원하지 않는 테마: ${theme}`);
        state.theme = theme;
        return `테마 전환 (${theme})`;
      }
      case "stage_release_snapshot": {
        const node = { id: nextId("rel"), title: `릴리스 태그: ${args.tag || "v1.0"}`, role: "release-gate", kind: "deploy" };
        state.nodes.push(node);
        return `릴리스 스냅샷 ("${node.title}")`;
      }
      default: {
        const node = { id: nextId("custom"), title: `[${name}] 실행됨`, role: JSON.stringify(args), kind: "deploy" };
        state.nodes.push(node);
        return `동적 도구 ${name} 실행`;
      }
    }
  }

  /**
   * Executes one MCP tools/call on the host. Read-only tools always pass; mutating tools require
   * the host's Write Consent and produce a durable CommitReceipt that can be rolled back.
   */
  function executeTool(name, args = {}) {
    const tool = findTool(name);
    if (!tool) throw new HostToolError("TOOL_NOT_FOUND", `호스트에 등록되지 않은 도구입니다: ${name}`);
    if (tool.annotations?.readOnlyHint) {
      return {
        ok: true,
        theme: state.theme,
        writeEnabled: state.writeEnabled,
        nodes: structuredClone(state.nodes),
        activeTools: definitions().map((candidate) => candidate.name),
      };
    }
    if (!state.writeEnabled) {
      throw new HostToolError("WRITE_DISABLED", "호스트가 에이전트 수정 권한(Write Consent)을 잠갔습니다");
    }
    const before = { nodes: structuredClone(state.nodes), theme: state.theme };
    const summary = applyMutation(name, args);
    const seq = state.ledger.length + 1;
    const receipt = {
      status: "durable",
      requestId: `req-${Date.now().toString(36)}`,
      documentId: "doc-live-storyboard",
      transactionId: `tx-${seq}`,
      operationId: `op-${seq}`,
      replicaId: "tab-provider-live",
      committedAt: new Date().toISOString(),
    };
    state.ledger.push({ receipt, summary, toolName: name, status: "durable", before });
    return { ok: true, summary, nodeCount: state.nodes.length, theme: state.theme, receipt };
  }

  /** Reverts the most recent durable commit (reverse order, like AiRunController rollback). */
  function rollbackLast() {
    const entry = [...state.ledger].reverse().find((candidate) => candidate.status === "durable");
    if (!entry) return null;
    state.nodes = entry.before.nodes;
    state.theme = entry.before.theme;
    entry.status = "rolled-back";
    return entry;
  }

  function reset() {
    state.nodes = structuredClone(INITIAL_NODES);
    state.theme = "midnight";
    state.writeEnabled = true;
    state.enabledPacks = new Set(["core"]);
    state.customTools = [];
    state.ledger = [];
  }

  return {
    state,
    listTools,
    findTool,
    setPack,
    addCustomTool,
    removeCustomTool,
    executeTool,
    rollbackLast,
    reset,
  };
}
