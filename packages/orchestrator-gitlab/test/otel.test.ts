/**
 * OTel instrumentation behaviour tests. We don't bring in an SDK — we verify:
 *   1. The default no-op global Meter/Tracer doesn't crash any orchestrator call site.
 *   2. The recorders accept all canonical AgentStatus values.
 *
 * Real SDK integration is operator territory; this test just guarantees the
 * surface contract our orchestrator depends on stays valid.
 */
import { describe, expect, it } from "vitest";

import {
  _resetInstrumentsForTest,
  getInstruments,
  recordDispatched,
  recordReload,
  recordTurn,
  recordWorkerExit,
  startProcessIssueSpan,
  startTurnSpan,
} from "../src/otel.js";
import type { Issue } from "../src/types.js";

function makeIssue(): Issue {
  return {
    id: "1",
    iid: "1",
    title: "t",
    description: "",
    labels: [],
    url: "http://x",
    state: "opened",
    authorUsername: undefined,
    updatedAt: "now",
  };
}

describe("otel instrumentation (no-op default provider)", () => {
  it("getInstruments returns the same handle on subsequent calls", () => {
    _resetInstrumentsForTest();
    const a = getInstruments();
    const b = getInstruments();
    expect(a).toBe(b);
  });

  it("recordDispatched / recordWorkerExit accept all AgentStatus values without throwing", () => {
    const issue = makeIssue();
    expect(() => {
      recordDispatched(issue, "echo");
      recordWorkerExit(issue, "echo", "succeeded");
      recordWorkerExit(issue, "echo", "failed");
      recordWorkerExit(issue, "echo", "timed-out");
      recordWorkerExit(issue, "echo", "cancelled");
    }).not.toThrow();
  });

  it("recordTurn accepts a result with and without tokens", () => {
    const issue = makeIssue();
    expect(() => {
      recordTurn(issue, "echo", 1, 250, { status: "succeeded", summary: "ok" });
      recordTurn(issue, "echo", 2, 400, {
        status: "succeeded",
        summary: "ok",
        tokens: { input: 100, output: 200, total: 300 },
      });
    }).not.toThrow();
  });

  it("startProcessIssueSpan / startTurnSpan return recorders that end cleanly for every status", () => {
    const issue = makeIssue();
    const a = startProcessIssueSpan(issue, "echo");
    a.end({ status: "succeeded", summary: "" });

    const b = startProcessIssueSpan(issue, "echo");
    b.end({ status: "no-turns-ran" });

    const c = startTurnSpan(issue, "echo", 1, 1);
    c.end({ status: "failed", summary: "" });

    const d = startTurnSpan(issue, "echo", 1, 2);
    d.end({ status: "cancelled", summary: "" });
  });

  it("recordReload(true) and recordReload(false) both no-op without an SDK", () => {
    expect(() => {
      recordReload(true);
      recordReload(false);
    }).not.toThrow();
  });
});
