import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EchoAgent } from "../src/agents/echo.js";
import { run } from "../src/orchestrator.js";
import {
  DEFAULT_LABELS,
  type Agent,
  type AgentInput,
  type AgentResult,
  type Issue,
  type LabelConfig,
  type PromptBuilder,
  type Tracker,
} from "../src/types.js";
import { FsWorkspaceManager, sanitizeKey } from "../src/workspace.js";

interface NoteRecord {
  readonly issueId: string;
  readonly body: string;
}
interface TransitionRecord {
  readonly issueId: string;
  readonly add: ReadonlyArray<string>;
  readonly remove: ReadonlyArray<string>;
}

class FakeTracker implements Tracker {
  pending: Issue[] = [];
  notes: NoteRecord[] = [];
  transitions: TransitionRecord[] = [];
  /** Snapshots returned by getIssue, keyed by id. Falls back to `liveLabels` per id when not set. */
  liveLabels: Map<string, ReadonlyArray<string>> = new Map();
  liveState: Map<string, string> = new Map();

  async listEligibleIssues(_labels: LabelConfig): Promise<ReadonlyArray<Issue>> {
    const next = this.pending;
    this.pending = [];
    return next;
  }

  async getIssue(issueId: string): Promise<Issue> {
    return {
      id: issueId,
      iid: issueId,
      title: `Issue ${issueId}`,
      description: "",
      labels: this.liveLabels.get(issueId) ?? [DEFAULT_LABELS.running],
      url: `http://localhost/issues/${issueId}`,
      state: this.liveState.get(issueId) ?? "opened",
      authorUsername: undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  async transitionLabels(
    issueId: string,
    transition: { add?: ReadonlyArray<string>; remove?: ReadonlyArray<string> },
  ): Promise<void> {
    this.transitions.push({
      issueId,
      add: transition.add ?? [],
      remove: transition.remove ?? [],
    });
    // Update liveLabels so reconciler / continuation checks see what we set.
    const current = new Set(this.liveLabels.get(issueId) ?? []);
    for (const r of transition.remove ?? []) current.delete(r);
    for (const a of transition.add ?? []) current.add(a);
    this.liveLabels.set(issueId, Array.from(current));
  }

  async postNote(issueId: string, body: string): Promise<void> {
    this.notes.push({ issueId, body });
  }
}

const promptBuilder: PromptBuilder = {
  build: (input) => `Work on ${input.issue.iid} (turn ${String(input.turnNumber)} attempt ${String(input.attempt)}): ${input.issue.title}`,
};

function makeIssue(iid: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id: iid,
    iid,
    title: `Issue ${iid}`,
    description: "",
    labels: [DEFAULT_LABELS.ready],
    url: `http://localhost/issues/${iid}`,
    state: "opened",
    authorUsername: "tester",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("orchestrator (Phase A)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "orchestrator-test-"));
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("dispatches an issue end-to-end with EchoAgent", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("42")];

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });

    const runPromise = run({
      tracker,
      workspace,
      agent: new EchoAgent(),
      prompt: promptBuilder,
      pollIntervalMs: 25,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(150);
    ac.abort();
    await runPromise;

    expect(tracker.notes.length).toBe(1);
    expect(tracker.notes[0]?.body).toContain("`succeeded`");
    expect(tracker.notes[0]?.body).toContain("Issue 42");

    const adds = tracker.transitions.flatMap((t) => t.add);
    const removes = tracker.transitions.flatMap((t) => t.remove);
    expect(adds).toContain(DEFAULT_LABELS.running);
    expect(adds).toContain(DEFAULT_LABELS.done);
    expect(removes).toContain(DEFAULT_LABELS.ready);
    expect(removes).toContain(DEFAULT_LABELS.running);
  });

  it("posts a failed note and adds the failed label when the agent throws", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("99", { title: "boom" })];

    const explosiveAgent: Agent = {
      name: "boom-agent",
      async run() {
        throw new Error("agent kaboom");
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });

    const runPromise = run({
      tracker,
      workspace,
      agent: explosiveAgent,
      prompt: promptBuilder,
      pollIntervalMs: 25,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(150);
    ac.abort();
    await runPromise;

    expect(tracker.notes.length).toBe(1);
    expect(tracker.notes[0]?.body).toContain("`failed`");
    expect(tracker.notes[0]?.body).toContain("agent kaboom");
    const adds = tracker.transitions.flatMap((t) => t.add);
    const removes = tracker.transitions.flatMap((t) => t.remove);
    expect(adds).toContain(DEFAULT_LABELS.failed);
    expect(adds).not.toContain(DEFAULT_LABELS.done);
    expect(removes).toContain(DEFAULT_LABELS.running);
    expect(removes).toContain(DEFAULT_LABELS.ready);
  });

  it("posts a failed note and finalizes labels when prompt building fails", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("100", { title: "prompt fail" })];

    const badPromptBuilder: PromptBuilder = {
      build: () => {
        throw new Error("template exploded");
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });

    const runPromise = run({
      tracker,
      workspace,
      agent: new EchoAgent(),
      prompt: badPromptBuilder,
      pollIntervalMs: 25,
      maxAttempts: 1,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(150);
    ac.abort();
    await runPromise;

    expect(tracker.notes.length).toBe(1);
    expect(tracker.notes[0]?.body).toContain("`failed`");
    expect(tracker.notes[0]?.body).toContain("template exploded");

    const adds = tracker.transitions.flatMap((t) => t.add);
    const removes = tracker.transitions.flatMap((t) => t.remove);
    expect(adds).toContain(DEFAULT_LABELS.failed);
    expect(adds).not.toContain(DEFAULT_LABELS.done);
    expect(removes).toContain(DEFAULT_LABELS.running);
    expect(removes).toContain(DEFAULT_LABELS.ready);
  });

  it("does not double-dispatch the same issue while a previous run is in flight", async () => {
    const tracker = new FakeTracker();
    const issue = makeIssue("7");
    tracker.pending = [issue];

    let activeRuns = 0;
    let maxActiveRuns = 0;

    const slowAgent: Agent = {
      name: "slow",
      async run() {
        activeRuns++;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        await sleep(80);
        activeRuns--;
        return { status: "succeeded", summary: "slow ok" };
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });

    const runPromise = run({
      tracker,
      workspace,
      agent: slowAgent,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    setTimeout(() => {
      tracker.pending = [issue];
    }, 30);

    await sleep(200);
    ac.abort();
    await runPromise;

    expect(maxActiveRuns).toBe(1);
  });

  it("sanitizeKey replaces disallowed chars", () => {
    expect(sanitizeKey("foo/bar baz!42")).toBe("foo_bar_baz_42");
    expect(sanitizeKey("abc.DEF-123_xyz")).toBe("abc.DEF-123_xyz");
  });
});

describe("orchestrator Phase B.2 — retry / reconciliation / max_turns / tokens", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "orchestrator-b2-test-"));
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("retries with backoff on failed/timed-out and succeeds on a later attempt", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("100")];

    let attemptsObserved = 0;
    const flakyAgent: Agent = {
      name: "flaky",
      async run(input: AgentInput): Promise<AgentResult> {
        attemptsObserved++;
        if ((input.attempt ?? 0) < 3) {
          return { status: "failed", summary: `fail attempt ${String(input.attempt)}`, error: "transient" };
        }
        return { status: "succeeded", summary: `ok on attempt ${String(input.attempt)}` };
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });

    const runPromise = run({
      tracker,
      workspace,
      agent: flakyAgent,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      maxAttempts: 5,
      retryBackoffBaseMs: 5,         // tiny so the test stays fast
      maxRetryBackoffMs: 50,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(300);
    ac.abort();
    await runPromise;

    expect(attemptsObserved).toBe(3);
    const adds = tracker.transitions.flatMap((t) => t.add);
    expect(adds).toContain(DEFAULT_LABELS.done);
    expect(adds).not.toContain(DEFAULT_LABELS.failed);
    expect(tracker.notes[0]?.body).toContain("`succeeded`");
    expect(tracker.notes[0]?.body).toContain("ok on attempt 3");
  });

  it("gives up after maxAttempts failures and finalizes as agent-failed", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("101")];

    let attemptsObserved = 0;
    const alwaysFail: Agent = {
      name: "always-fail",
      async run() {
        attemptsObserved++;
        return { status: "failed", summary: "nope", error: "always" };
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });
    const runPromise = run({
      tracker,
      workspace,
      agent: alwaysFail,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      maxAttempts: 2,
      retryBackoffBaseMs: 5,
      maxRetryBackoffMs: 20,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(200);
    ac.abort();
    await runPromise;

    expect(attemptsObserved).toBe(2);
    const adds = tracker.transitions.flatMap((t) => t.add);
    expect(adds).toContain(DEFAULT_LABELS.failed);
    expect(adds).not.toContain(DEFAULT_LABELS.done);
  });

  it("reconciles: cancels the in-flight agent when the issue is closed externally", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("200")];

    let agentSawAbort = false;
    const slowAgent: Agent = {
      name: "slow",
      async run(input: AgentInput): Promise<AgentResult> {
        return new Promise<AgentResult>((res) => {
          input.signal?.addEventListener("abort", () => {
            agentSawAbort = true;
            res({ status: "cancelled", summary: "agent observed abort" });
          });
          setTimeout(() => {
            res({ status: "succeeded", summary: "ran to completion (should not happen)" });
          }, 5_000);
        });
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });
    const runPromise = run({
      tracker,
      workspace,
      agent: slowAgent,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      reconciliationIntervalMs: 30,
      signal: ac.signal,
      log: () => undefined,
    });

    // Wait for the worker to start, then close the issue out-of-band.
    setTimeout(() => {
      tracker.liveState.set("200", "closed");
    }, 60);

    await sleep(300);
    ac.abort();
    await runPromise;

    expect(agentSawAbort).toBe(true);
    const adds = tracker.transitions.flatMap((t) => t.add);
    // Cancelled runs are finalized as agent-failed (they're not successes).
    expect(adds).toContain(DEFAULT_LABELS.failed);
    expect(adds).not.toContain(DEFAULT_LABELS.done);
  });

  it("runs continuation turns up to maxTurns while continueLabel persists", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("300")];

    const turnsObserved: number[] = [];
    const okAgent: Agent = {
      name: "ok",
      async run(input: AgentInput): Promise<AgentResult> {
        turnsObserved.push(input.turnNumber ?? 0);
        return {
          status: "succeeded",
          summary: `turn ${String(input.turnNumber)} done`,
          tokens: { input: 10, output: 20, total: 30 },
        };
      },
    };

    // Issue starts with the continue label set; remove it after turn 2 to end the loop.
    tracker.liveLabels.set("300", [DEFAULT_LABELS.running, "agent-continue"]);

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });
    const runPromise = run({
      tracker,
      workspace,
      agent: okAgent,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      maxTurns: 5,
      continueLabel: "agent-continue",
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    // After turn 2 completes, simulate operator removing the continue label.
    setTimeout(() => {
      const labels = tracker.liveLabels.get("300") ?? [];
      tracker.liveLabels.set("300", labels.filter((l) => l !== "agent-continue"));
    }, 80);

    await sleep(300);
    ac.abort();
    await runPromise;

    expect(turnsObserved.length).toBeGreaterThanOrEqual(2);
    expect(turnsObserved[0]).toBe(1);
    expect(turnsObserved[1]).toBe(2);
    // One note per turn.
    expect(tracker.notes.length).toBe(turnsObserved.length);
    // Final label should be `done` (the last turn succeeded).
    const adds = tracker.transitions.flatMap((t) => t.add);
    expect(adds).toContain(DEFAULT_LABELS.done);
  });

  it("includes token info in notes when the agent returns tokens", async () => {
    const tracker = new FakeTracker();
    tracker.pending = [makeIssue("400")];

    const tokenAgent: Agent = {
      name: "token-bearer",
      async run(): Promise<AgentResult> {
        return {
          status: "succeeded",
          summary: "ok",
          tokens: { input: 123, output: 456, total: 579 },
        };
      },
    };

    const ac = new AbortController();
    const workspace = new FsWorkspaceManager({ root: tmpRoot, projectSlug: "demo" });
    const runPromise = run({
      tracker,
      workspace,
      agent: tokenAgent,
      prompt: promptBuilder,
      pollIntervalMs: 20,
      reconciliationIntervalMs: 0,
      signal: ac.signal,
      log: () => undefined,
    });

    await sleep(150);
    ac.abort();
    await runPromise;

    expect(tracker.notes[0]?.body).toContain("in=123");
    expect(tracker.notes[0]?.body).toContain("out=456");
    expect(tracker.notes[0]?.body).toContain("total=579");
  });
});

describe("EchoAgent", () => {
  it("returns succeeded with workspace + prompt info", async () => {
    const agent = new EchoAgent();
    const result = await agent.run({
      workspacePath: "/tmp/x",
      prompt: "hello world",
      issue: makeIssue("1"),
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("/tmp/x");
    expect(result.summary).toContain("11");
  });

  it("respects pre-aborted signal", async () => {
    const agent = new EchoAgent();
    const ac = new AbortController();
    ac.abort();
    const result = await agent.run({
      workspacePath: "/tmp/x",
      prompt: "x",
      issue: makeIssue("1"),
      signal: ac.signal,
    });
    expect(result.status).toBe("cancelled");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
