import { describe, expect, it } from "vitest";

import { HISTORY_CAP_PER_ISSUE, OrchestratorRuntime, snapshot } from "../src/runtime.js";

function entry(at: number): Parameters<OrchestratorRuntime["appendHistory"]>[1] {
  return {
    at,
    turnNumber: 1,
    attempt: 1,
    status: "succeeded",
    durationMs: 100,
    agent: "echo",
    summarySnippet: `entry-${String(at)}`,
  };
}

describe("OrchestratorRuntime.appendHistory", () => {
  it("appends in order", () => {
    const rt = new OrchestratorRuntime();
    rt.appendHistory("1", entry(100));
    rt.appendHistory("1", entry(200));
    expect(rt.history.get("1")?.map((e) => e.at)).toEqual([100, 200]);
  });

  it("isolates buffers per issue id", () => {
    const rt = new OrchestratorRuntime();
    rt.appendHistory("1", entry(100));
    rt.appendHistory("2", entry(200));
    expect(rt.history.get("1")?.length).toBe(1);
    expect(rt.history.get("2")?.length).toBe(1);
  });

  it("caps the ring buffer at HISTORY_CAP_PER_ISSUE per issue", () => {
    const rt = new OrchestratorRuntime();
    for (let i = 0; i < HISTORY_CAP_PER_ISSUE + 5; i++) {
      rt.appendHistory("x", entry(i));
    }
    const buf = rt.history.get("x") ?? [];
    expect(buf.length).toBe(HISTORY_CAP_PER_ISSUE);
    // Oldest 5 dropped; survivors should be the last HISTORY_CAP_PER_ISSUE entries.
    expect(buf[0]?.at).toBe(5);
    expect(buf[buf.length - 1]?.at).toBe(HISTORY_CAP_PER_ISSUE + 4);
  });
});

describe("snapshot", () => {
  it("serializes elapsedMs from startedAt + 'now'", () => {
    const rt = new OrchestratorRuntime();
    rt.startedAt = 1_000;
    rt.inFlight.set("a", {
      issue: {
        id: "a",
        iid: "a",
        title: "T",
        description: "",
        labels: [],
        url: "http://x",
        state: "opened",
        authorUsername: undefined,
        updatedAt: "now",
      },
      agentName: "echo",
      startedAt: 5_000,
      turnNumber: 1,
      attempt: 1,
    });
    const snap = snapshot(rt, 7_500);
    expect(snap.uptimeMs).toBe(6_500);
    expect(snap.inFlight[0]?.elapsedMs).toBe(2_500);
  });
});
