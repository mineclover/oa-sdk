// Regression tests for the provider's tools/call handling: the shared run of untraced calls,
// the CallToolResult shape agents receive, the AI run limit, CommitReceipt gating, and the AI run
// ledger, which answers a durable request again without calling the host and holds back one whose
// outcome is unknown.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiRunController,
  AiRunLedger,
  AiRunLimitExceededError,
  InMemoryAiRunLedgerStore,
  MCP_INITIALIZE_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION,
  WebMcpPeerClient,
  isCommitReceipt,
  type CommitReceipt,
  type WebMcpHostAdapter,
} from "../src/provider.js";
import { joinPeerRoom, waitForPeerApproval } from "../src/client.js";
import {
  MAX_PAYLOAD_TEXT_BLOCK_BYTES,
  RELAY_MAX_MESSAGE_BYTES,
  encodeRelayMcpReply,
} from "../src/provider/tool-call.js";
import {
  MAX_WEBSOCKET_FRAME_BYTES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  createWebMcpPeerServer,
  type WebMcpPeerServer,
} from "../src/server.js";
import { FakeRelay, approve, callTool, installRelay, relayStamp, replyTo, until, type FakeRelaySocket } from "./provider-fakes.js";

const providers: WebMcpPeerClient[] = [];

afterEach(() => {
  for (const provider of providers.splice(0)) provider.disconnect();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tools = ["read", "validate", "soft", "readme", "mcp_err", "domain", "write", "block"].map((name) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
}));

async function approvedProvider(invoke: WebMcpHostAdapter["invoke"]): Promise<{ provider: WebMcpPeerClient; socket: FakeRelaySocket }> {
  const relay = new FakeRelay();
  installRelay(relay);
  const provider = new WebMcpPeerClient({ hostAdapter: { listTools: () => tools, invoke } });
  providers.push(provider);
  await provider.connect({ serverUrl: relay.base, alias: "tool-call-test" });
  const socket = relay.latest;
  await approve(provider, socket, relay.roomId);
  return { provider, socket };
}

describe("untraced tool calls share a run that one failure cannot terminate", () => {
  it("keeps answering untraced calls after a host throw and after an { ok: false } result", async () => {
    const { provider, socket } = await approvedProvider(async (name) => {
      if (name === "validate") throw new Error("bad input");
      if (name === "soft") return { ok: false, error: { message: "soft failure" } };
      return { ok: true, tool: name };
    });

    const thrown = await callTool(socket, 1, "validate");
    expect(thrown.result?.isError).toBe(true);

    const afterThrow = await callTool(socket, 2, "read");
    expect(afterThrow.result?.isError).toBe(false);
    expect(afterThrow.result?.structuredContent).toEqual({ ok: true, tool: "read" });

    const soft = await callTool(socket, 3, "soft");
    expect(soft.result?.isError).toBe(true);

    const afterSoft = await callTool(socket, 4, "read");
    expect(afterSoft.result?.isError).toBe(false);
    expect(provider.getAiRuns().map((run) => run.phase)).toEqual(["running"]);
  });

  it("still fails a run the agent named, and refuses later calls on it", async () => {
    const { provider, socket } = await approvedProvider(async (name) => {
      if (name === "validate") throw new Error("bad input");
      return { ok: true };
    });

    expect((await callTool(socket, 1, "validate", { runId: "task-1" })).result?.isError).toBe(true);
    expect(provider.getAiRun("task-1")).toMatchObject({ phase: "failed", terminalReason: "bad input" });

    const refused = await callTool(socket, 2, "read", { runId: "task-1" });
    expect(refused.result).toMatchObject({ isError: true, error: { code: "AI_RUN_TERMINAL" } });
    expect((await callTool(socket, 3, "read")).result?.isError).toBe(false);
  });
});

describe("tools/call results follow the MCP CallToolResult shape", () => {
  it("forwards a host CallToolResult as is instead of nesting it", async () => {
    const { socket } = await approvedProvider(async () => ({
      content: [{ type: "text", text: "hello from host" }],
      structuredContent: { v: 1 },
    }));

    const reply = await callTool(socket, 1, "readme");
    expect(reply.result).toEqual({
      content: [{ type: "text", text: "hello from host" }],
      structuredContent: { v: 1 },
      isError: false,
    });
  });

  it("reports a host's isError: true as a failed call and fails the named run", async () => {
    const { provider, socket } = await approvedProvider(async () => ({
      isError: true,
      content: [{ type: "text", text: "failed: disk full" }],
    }));

    const reply = await callTool(socket, 1, "mcp_err", { runId: "task-err" });
    expect(reply.result).toMatchObject({ isError: true, content: [{ type: "text", text: "failed: disk full" }] });
    expect(provider.getAiRun("task-err")).toMatchObject({ phase: "failed", terminalReason: "failed: disk full" });
  });

  it("publishes a plain payload as structuredContent with a JSON text block", async () => {
    const payload = { ok: true, items: [1, 2] };
    const { socket } = await approvedProvider(async () => payload);

    const reply = await callTool(socket, 1, "read");
    expect(reply.result).toEqual({
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
      data: payload,
      isError: false,
    });
  });

  it("treats a domain object with a non-MCP content member as the payload", async () => {
    const payload = { ok: true, content: [{ type: "paragraph", text: "doc text" }] };
    const { socket } = await approvedProvider(async () => payload);

    const reply = await callTool(socket, 1, "domain");
    expect(reply.result?.structuredContent).toEqual(payload);
    expect(reply.result?.content).toEqual([{ type: "text", text: JSON.stringify(payload) }]);
  });

  it("wraps a non-object result so structuredContent is always an object", async () => {
    const { socket } = await approvedProvider(async () => [1, 2, 3]);
    const reply = await callTool(socket, 1, "read");
    expect(reply.result?.structuredContent).toEqual({ value: [1, 2, 3] });
  });

  it("gives a thrown host error a readable text block", async () => {
    const { socket } = await approvedProvider(async () => {
      throw new Error("bad input");
    });
    const reply = await callTool(socket, 1, "validate");
    expect(reply.result).toMatchObject({ isError: true, content: [{ type: "text", text: "bad input" }] });
  });

  it("gives refused calls a readable text block", async () => {
    const { provider, socket } = await approvedProvider(async () => ({ ok: true }));
    await callTool(socket, 1, "read", { runId: "task-stop" });
    expect(provider.stopAiRun("task-stop")?.phase).toBe("stopped");
    const refused = await callTool(socket, 2, "read", { runId: "task-stop" });
    expect(refused.result?.content).toEqual([{ type: "text", text: "AI_RUN_TERMINAL: This AI run is already terminal." }]);
  });
});

describe("MCP requests the relay forwards", () => {
  /** Relays one request with `method` and `params` to the provider and returns its reply. */
  function relayed(socket: FakeRelaySocket, id: string | number | null, method: string, params: Record<string, unknown> = {}) {
    socket.deliver({ type: "mcp", ...relayStamp(), message: { jsonrpc: "2.0", id, method, params } });
    return replyTo(socket, id as string | number);
  }

  it("negotiates initialize as the relay's HTTP route does, never answering 2026-07-28", async () => {
    const { socket } = await approvedProvider(async () => ({ ok: true }));
    for (const [requested, negotiated] of [
      ...MCP_INITIALIZE_PROTOCOL_VERSIONS.map((version) => [version, version]),
      [MCP_PROTOCOL_VERSION, "2025-11-25"],
      ["1999-01-01", "2025-11-25"],
      [undefined, "2025-11-25"],
    ] as const) {
      const reply = await relayed(socket, `init-${requested}`, "initialize", requested ? { protocolVersion: requested } : {});
      expect(reply.result).toMatchObject({ protocolVersion: negotiated, capabilities: { tools: { listChanged: true }, stateless: true } });
    }
  });

  it("reports the relay's negotiation in a server/discover forwarded by the relay", async () => {
    const { socket } = await approvedProvider(async () => ({ ok: true }));
    await until(() => socket.sent.find((frame) => frame.type === "register"), "register frame");
    const reply = await relayed(socket, 1, "server/discover", { protocolVersion: "2025-06-18" });
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-06-18",
      supportedProtocolVersions: [...MCP_INITIALIZE_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: true }, stateless: true },
    });
    expect((await relayed(socket, 2, "server/discover", { protocolVersion: MCP_PROTOCOL_VERSION })).result).toMatchObject({ protocolVersion: "2025-11-25" });
  });

  it("answers a request with id null as an invalid request and does not run it", async () => {
    const invoked: string[] = [];
    const { socket } = await approvedProvider(async (name) => {
      invoked.push(name);
      return { ok: true };
    });
    const reply = await relayed(socket, null, "tools/call", { name: "write", arguments: {} });
    expect(reply).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    expect(invoked).toEqual([]);
  });
});

describe("tool results stay within the relay's WebSocket message limit", () => {
  const relays: WebMcpPeerServer[] = [];
  afterEach(async () => {
    for (const provider of providers.splice(0)) provider.disconnect();
    for (const relay of relays.splice(0)) await relay.close();
  });

  type McpReply = { result?: Record<string, unknown> & { content?: Array<{ type: string; text?: string }> }; error?: unknown };

  /** A provider on a real relay, with one approved agent that calls tools over Streamable HTTP. */
  async function relayedProvider(invoke: WebMcpHostAdapter["invoke"]) {
    const relay = createWebMcpPeerServer({ port: 0, host: "127.0.0.1", roomSweepIntervalMs: 0 });
    relays.push(relay);
    const serverUrl = `http://127.0.0.1:${await relay.listen()}`;
    const provider = new WebMcpPeerClient({ hostAdapter: { listTools: () => tools, invoke } });
    providers.push(provider);
    const joined = await joinPeerRoom({ invitationUrl: await provider.connect({ serverUrl, alias: "large-results" }) });
    await new Promise<void>((resolve) => {
      let unsubscribe: (() => void) | undefined;
      unsubscribe = provider.subscribe((session) => {
        if (session.approvalState !== "pending" || session.approvalRequestId !== joined.approvalRequestId) return;
        unsubscribe?.();
        provider.approveClient(session.approvalRequestId);
        resolve();
      });
    });
    await waitForPeerApproval({ serverUrl, roomId: joined.roomId, sessionId: joined.sessionId, clientToken: joined.clientToken, pollIntervalMs: 25, timeoutMs: 3000 });
    const states: string[] = [];
    provider.subscribe((session) => states.push(session.state));
    const call = async (id: number, name: string): Promise<McpReply> => {
      const response = await fetch(`${serverUrl}/p/${joined.roomId}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${joined.clientToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } }),
      });
      return (await response.json()) as McpReply;
    };
    return { provider, states, call };
  }

  it("mirrors the provider limit from the relay's frame limit", () => {
    expect(RELAY_MAX_MESSAGE_BYTES).toBe(MAX_WEBSOCKET_MESSAGE_BYTES);
    // Browser and Node WebSocket clients send each message as one frame, so a frame may carry a whole message.
    expect(MAX_WEBSOCKET_FRAME_BYTES).toBe(MAX_WEBSOCKET_MESSAGE_BYTES);
  });

  it("delivers a ~50 KB payload without the relay closing the provider socket", async () => {
    const payload = { ok: true, blob: "x".repeat(50_000) };
    const { provider, states, call } = await relayedProvider(async () => payload);

    const reply = await call(1, "read");
    expect(reply.error).toBeUndefined();
    expect(reply.result).toMatchObject({ isError: false, structuredContent: payload, data: payload });
    expect(reply.result?.content).toEqual([{ type: "text", text: expect.stringContaining("structuredContent") }]);
    expect(Buffer.byteLength(JSON.stringify({ type: "mcp", message: reply })) <= RELAY_MAX_MESSAGE_BYTES).toBe(true);

    expect((await call(2, "read")).result?.isError).toBe(false);
    // The provider stays on its relay socket ("waiting" for a DataChannel) throughout.
    expect(new Set(states)).toEqual(new Set(["waiting"]));
    expect(provider.getSession().state).toBe("waiting");
  });

  it("answers RESULT_TOO_LARGE for a result over the limit and keeps the socket open", async () => {
    const { provider, states, call } = await relayedProvider(async (name) =>
      // The payload alone is the whole limit, so its reply (structuredContent + data) is far over it.
      name === "write" ? { ok: true, blob: "x".repeat(RELAY_MAX_MESSAGE_BYTES) } : { ok: true },
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const reply = await call(1, "write");
    expect(reply.result).toMatchObject({ isError: true, error: { code: "RESULT_TOO_LARGE" } });
    expect(reply.result?.content?.[0]?.text).toMatch(/^RESULT_TOO_LARGE: The result of tool "write" is \d+ bytes/);

    expect((await call(2, "read")).result).toMatchObject({ isError: false, structuredContent: { ok: true } });
    // The provider stays on its relay socket ("waiting" for a DataChannel) throughout.
    expect(new Set(states)).toEqual(new Set(["waiting"]));
    expect(provider.getSession().state).toBe("waiting");
  });
});

describe("encodeRelayMcpReply", () => {
  const big = { jsonrpc: "2.0" as const, id: 7, result: { blob: "y".repeat(2_000) } };

  it("passes a reply within the limit through unchanged", () => {
    expect(encodeRelayMcpReply({ jsonrpc: "2.0", id: 7, method: "tools/call" }, big, 4_096)).toEqual({
      frame: JSON.stringify({ type: "mcp", message: big }),
    });
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    const wide = { jsonrpc: "2.0" as const, id: 7, result: { text: "\u00e9".repeat(1_500) } };
    const reply = encodeRelayMcpReply({ jsonrpc: "2.0", id: 7, method: "tools/call" }, wide, 2_048);
    expect(JSON.stringify({ type: "mcp", message: wide }).length).toBeLessThan(2_048);
    expect(reply.oversizeBytes).toBeGreaterThan(2_048);
  });

  it("answers a non-tools/call request with a JSON-RPC error", () => {
    const reply = encodeRelayMcpReply({ jsonrpc: "2.0", id: 7, method: "tools/list" }, big, 1_024);
    expect(JSON.parse(reply.frame!)).toEqual({
      type: "mcp",
      message: { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "RESULT_TOO_LARGE", data: { limitBytes: 1_024 } } },
    });
  });

  it("drops a reply when not even the error fits", () => {
    expect(encodeRelayMcpReply({ jsonrpc: "2.0", id: 7, method: "tools/call" }, big, 64)).toMatchObject({ frame: undefined });
  });
});

describe("payload text block", () => {
  it("repeats a payload up to the text budget and points at structuredContent past it", async () => {
    const small = { ok: true, blob: "s".repeat(MAX_PAYLOAD_TEXT_BLOCK_BYTES - 100) };
    const large = { ok: true, blob: "l".repeat(MAX_PAYLOAD_TEXT_BLOCK_BYTES) };
    const { socket } = await approvedProvider(async (name) => (name === "read" ? small : large));

    expect((await callTool(socket, 1, "read")).result?.content).toEqual([{ type: "text", text: JSON.stringify(small) }]);
    const reply = await callTool(socket, 2, "write");
    expect(reply.result?.structuredContent).toEqual(large);
    expect(reply.result?.content).toEqual([{ type: "text", text: expect.stringContaining("read it from structuredContent") }]);
  });
});

describe("AI run limit", () => {
  it("answers a call immediately when every tracked run has work in flight, then evicts idle runs", async () => {
    const gates: Array<() => void> = [];
    const { socket } = await approvedProvider(
      (name) =>
        new Promise((resolve) => {
          if (name === "block") gates.push(() => resolve({ ok: true }));
          else resolve({ ok: true });
        }),
    );

    const blocked = Array.from({ length: 128 }, (_, index) => callTool(socket, `b-${index}`, "block", { runId: `run-${index}` }));
    await vi.waitFor(() => expect(gates).toHaveLength(128), { timeout: 5000 });

    const overflow = await callTool(socket, "overflow", "read", { runId: "run-overflow", timeoutMs: 3000 });
    expect(overflow.result).toMatchObject({ isError: true, error: { code: "AI_RUN_LIMIT_EXCEEDED" } });

    for (const release of gates) release();
    for (const reply of await Promise.all(blocked)) expect(reply.result?.isError).toBe(false);

    // The 128 runs are now idle ("running" with nothing in flight) and may be evicted.
    const next = await callTool(socket, "next", "read", { runId: "run-next", timeoutMs: 3000 });
    expect(next.result?.isError).toBe(false);
  });
});

describe("AiRunController eviction", () => {
  function fill(controller: AiRunController, inFlight: boolean): AbortController[] {
    return Array.from({ length: 128 }, (_, index) => {
      const abort = new AbortController();
      controller.begin(`run-${index}`, "act");
      controller.registerAction(`run-${index}`, `req-${index}`, abort);
      if (!inFlight) controller.settleAction(`run-${index}`, `req-${index}`);
      return abort;
    });
  }

  it("evicts the oldest idle run when no run is terminal", () => {
    const controller = new AiRunController();
    fill(controller, false);
    expect(controller.begin("run-new").phase).toBe("queued");
    expect(controller.get("run-0")).toBeUndefined();
    expect(controller.get("run-1")?.phase).toBe("running");
  });

  it("prefers a terminal run over an older idle one", () => {
    const controller = new AiRunController();
    fill(controller, false);
    controller.complete("run-5");
    controller.begin("run-new");
    expect(controller.get("run-5")).toBeUndefined();
    expect(controller.get("run-0")).toBeDefined();
  });

  it("evicts a stopped run once its actions have settled", () => {
    const controller = new AiRunController();
    fill(controller, true);
    controller.stop("run-3");
    expect(() => controller.begin("run-new")).toThrow("AI run limit exceeded");
    controller.settleAction("run-3", "req-3");
    controller.begin("run-new");
    expect(controller.get("run-3")).toBeUndefined();
  });

  it("never evicts a run with work in flight", () => {
    const controller = new AiRunController();
    fill(controller, true);
    expect(() => controller.begin("run-new")).toThrow(AiRunLimitExceededError);
    expect(controller.getAll()).toHaveLength(128);
  });
});

describe("CommitReceipt gating", () => {
  const base = {
    status: "durable" as const,
    requestId: "r1",
    documentId: "d1",
    transactionId: "t1",
    committedAt: "2026-10-18T00:00:00.000Z",
  };

  it("accepts exactly the two durable shapes the CommitReceipt type declares", () => {
    expect(isCommitReceipt(base)).toBe(true);
    expect(isCommitReceipt({ ...base, operationId: "op1", replicaId: "rep1" })).toBe(true);
    expect(isCommitReceipt({ ...base, operationId: "op1", replicaId: "rep1", partial: true, appliedCommandCount: 1, requestedCommandCount: 2 })).toBe(true);
    expect(isCommitReceipt({ ...base, operationId: "op1" })).toBe(false);
    expect(isCommitReceipt({ ...base, replicaId: "rep1" })).toBe(false);
    expect(isCommitReceipt({ ...base, partial: true, appliedCommandCount: 1, requestedCommandCount: 2 })).toBe(false);
    expect(isCommitReceipt({ ...base, appliedCommandCount: 2, requestedCommandCount: 2 })).toBe(false);
  });

  it("records a valid receipt's operation as rollback-eligible", async () => {
    const receipt: CommitReceipt = { ...base, operationId: "op1", replicaId: "rep1" };
    const { provider, socket } = await approvedProvider(async () => ({ ok: true, receipt }));
    await callTool(socket, 1, "write", { runId: "task-write" });
    expect(provider.getAiRun("task-write")).toMatchObject({ operationIds: ["op1"], transactionIds: { op1: "t1" } });
  });

  it("never records an invalid receipt's operation as rollback-eligible, and says why", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { provider, socket } = await approvedProvider(async () => ({ ok: true, receipt: { ...base, operationId: "op1" } }));
    const reply = await callTool(socket, 1, "write", { runId: "task-write" });
    expect(reply.result?.isError).toBe(false);
    expect(provider.getAiRun("task-write")?.operationIds).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid CommitReceipt"), expect.anything());
  });
});

describe("the AI run ledger", () => {
  const durable: CommitReceipt = {
    status: "durable",
    requestId: "request-1",
    documentId: "d1",
    transactionId: "t1",
    committedAt: "2026-10-18T00:00:00.000Z",
  };

  it("answers a call whose request it holds as durable with the recorded receipt, without calling the host again", async () => {
    const invoke = vi.fn(async () => ({ ok: true, receipt: durable }));
    const { provider, socket } = await approvedProvider(invoke);
    provider.setAiRunLedger(new InMemoryAiRunLedgerStore());
    const args = { context: { requestId: "request-1" } };

    expect((await callTool(socket, 1, "write", { runId: "task-ledger", args })).result?.isError).toBe(false);
    const replayed = await callTool(socket, 2, "write", { runId: "task-ledger", args });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(replayed.result).toMatchObject({ isError: false, structuredContent: { ok: true, receipt: durable, data: { replayed: true } } });
  });

  it("refuses a call whose request it holds as outcome-unknown with RECONCILIATION_REQUIRED, without calling the host", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const { provider, socket } = await approvedProvider(invoke);
    const ledger = new AiRunLedger(new InMemoryAiRunLedgerStore());
    await ledger.recordReceipt({
      runId: "task-ledger",
      actionId: "write",
      stepIndex: 0,
      receipt: { status: "outcome-unknown", requestId: "request-2", documentId: "d1", message: "the commit was not confirmed" },
    });
    provider.setAiRunLedger(ledger);

    const reply = await callTool(socket, 1, "write", { runId: "task-ledger", args: { context: { requestId: "request-2" } } });
    expect(invoke).not.toHaveBeenCalled();
    expect(reply.result).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "RECONCILIATION_REQUIRED" } } });
  });
});
