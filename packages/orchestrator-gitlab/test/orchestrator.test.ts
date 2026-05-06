import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EchoAgent } from "../src/agents/echo.js";
import { run } from "../src/orchestrator.js";
import {
  DEFAULT_LABELS,
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

  async listEligibleIssues(_labels: LabelConfig): Promise<ReadonlyArray<Issue>> {
    const next = this.pending;
    this.pending = [];
    return next;
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
  }

  async postNote(issueId: string, body: string): Promise<void> {
    this.notes.push({ issueId, body });
  }
}

const promptBuilder: PromptBuilder = {
  build: (issue) => `Work on ${issue.iid}: ${issue.title}`,
};

function makeIssue(iid: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id: iid,
    iid,
    title: `Issue ${iid}`,
    description: "",
    labels: ["agent-ready"],
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
      signal: ac.signal,
      log: () => undefined,
    });

    // Allow one poll tick + worker resolution.
    await sleep(150);
    ac.abort();
    await runPromise;

    expect(tracker.notes.length).toBe(1);
    expect(tracker.notes[0]?.body).toContain("`succeeded`");
    expect(tracker.notes[0]?.body).toContain("Issue 42");

    // claim + finalize transitions
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

    const explosiveAgent = {
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
    expect(adds).toContain(DEFAULT_LABELS.failed);
    expect(adds).not.toContain(DEFAULT_LABELS.done);
  });

  it("does not double-dispatch the same issue while a previous run is in flight", async () => {
    const tracker = new FakeTracker();
    const issue = makeIssue("7");
    tracker.pending = [issue];

    let activeRuns = 0;
    let maxActiveRuns = 0;

    const slowAgent = {
      name: "slow",
      async run() {
        activeRuns++;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        await sleep(80);
        activeRuns--;
        return { status: "succeeded" as const, summary: "slow ok" };
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
      signal: ac.signal,
      log: () => undefined,
    });

    // Re-queue the same issue mid-flight to simulate a tracker that hasn't
    // observed our label transition yet (race window).
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
    expect(result.summary).toContain("11"); // prompt length
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
