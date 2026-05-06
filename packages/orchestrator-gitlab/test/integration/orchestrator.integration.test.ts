/**
 * End-to-end integration test against a real GitLab instance.
 *
 * Required env (all of):
 *   GITLAB_INTEGRATION_BASE_URL    e.g. http://localhost:8929
 *   GITLAB_INTEGRATION_TOKEN       Personal access token with `api` scope
 *   GITLAB_INTEGRATION_PROJECT_ID  Numeric project id
 *
 * The whole describe block is skipped when any of those is missing — keeps CI
 * green without secrets, and matches the env-gated convention used by
 * spec-lens (`gitlab-adapter.integration.test.ts`).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EchoAgent } from "../../src/agents/echo.js";
import { run } from "../../src/orchestrator.js";
import { GitlabTracker } from "../../src/tracker.js";
import type { LabelConfig } from "../../src/types.js";
import { FsWorkspaceManager } from "../../src/workspace.js";
import {
  closeIssue,
  createIssue,
  type GitlabContext,
  getIssue,
  listNotes,
} from "./gitlab-helpers.js";

const ENV_BASE_URL = process.env.GITLAB_INTEGRATION_BASE_URL;
const ENV_TOKEN = process.env.GITLAB_INTEGRATION_TOKEN;
const ENV_PROJECT_ID = process.env.GITLAB_INTEGRATION_PROJECT_ID;

const ENABLED =
  ENV_BASE_URL !== undefined &&
  ENV_BASE_URL.length > 0 &&
  ENV_TOKEN !== undefined &&
  ENV_TOKEN.length > 0 &&
  ENV_PROJECT_ID !== undefined &&
  ENV_PROJECT_ID.length > 0;

const describeIfEnabled = ENABLED ? describe : describe.skip;

describeIfEnabled("orchestrator-gitlab — real GitLab integration", () => {
  // We assert ENABLED above so these are non-undefined inside the block.
  const ctx: GitlabContext = {
    baseUrl: ENV_BASE_URL as string,
    token: ENV_TOKEN as string,
    projectId: ENV_PROJECT_ID as string,
  };

  // Per-run unique label namespace so we don't fight any real workflow on the
  // same project. Test cleanup closes everything we create regardless.
  const runId = `it-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const labels: LabelConfig = {
    ready: `agent-ready-${runId}`,
    running: `agent-running-${runId}`,
    done: `agent-done-${runId}`,
    failed: `agent-failed-${runId}`,
  };

  const createdIssueIids: number[] = [];
  let tmpRoot = "";

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "orchestrator-it-"));
  });

  afterAll(async () => {
    // Best-effort cleanup: close created issues so they don't pollute the
    // project. Failures here should not mask test results.
    await Promise.allSettled(createdIssueIids.map((iid) => closeIssue(ctx, iid)));
    if (tmpRoot.length > 0) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  let perTestIid = 0;
  afterEach(async () => {
    if (perTestIid > 0) {
      // Close after each test to keep the project tidy even mid-suite.
      await closeIssue(ctx, perTestIid).catch(() => undefined);
      perTestIid = 0;
    }
  });

  it("picks up an `agent-ready` issue, runs EchoAgent, posts a note, transitions to `agent-done`", async () => {
    const created = await createIssue(ctx, {
      title: `[orch-int] echo happy path ${runId}`,
      description: "Integration test fixture — safe to close.",
      labels: [labels.ready],
    });
    perTestIid = created.iid;
    createdIssueIids.push(created.iid);

    const tracker = new GitlabTracker({
      baseUrl: ctx.baseUrl,
      token: ctx.token,
      projectId: ctx.projectId,
    });
    const workspace = new FsWorkspaceManager({
      root: tmpRoot,
      projectSlug: `it-${runId}`,
    });
    const ac = new AbortController();

    const runPromise = run({
      tracker,
      workspace,
      agent: new EchoAgent(),
      prompt: { build: ({ issue }) => `Resolve issue ${issue.iid}: ${issue.title}` },
      pollIntervalMs: 1_000,
      labels,
      signal: ac.signal,
      log: () => undefined,
    });

    // Wait until we observe the terminal label flip on GitLab's side or time out.
    const detail = await waitFor(async () => {
      const d = await getIssue(ctx, created.iid);
      const hasDone = d.labels.includes(labels.done);
      const hasFailed = d.labels.includes(labels.failed);
      return hasDone || hasFailed ? d : null;
    }, { timeoutMs: 30_000, intervalMs: 1_000 });

    ac.abort();
    await runPromise;

    expect(detail.labels).toContain(labels.done);
    expect(detail.labels).not.toContain(labels.ready);
    expect(detail.labels).not.toContain(labels.running);
    expect(detail.labels).not.toContain(labels.failed);

    const notes = await listNotes(ctx, created.iid);
    const userNotes = notes.filter((n) => !n.system);
    expect(userNotes.length).toBeGreaterThan(0);
    const last = userNotes[userNotes.length - 1];
    expect(last?.body ?? "").toContain("`succeeded`");
    expect(last?.body ?? "").toContain("echo");
  }, 60_000);

  it("on agent throw, posts a failed note and transitions to `agent-failed`", async () => {
    const created = await createIssue(ctx, {
      title: `[orch-int] failure path ${runId}`,
      description: "Integration test fixture — safe to close.",
      labels: [labels.ready],
    });
    perTestIid = created.iid;
    createdIssueIids.push(created.iid);

    const tracker = new GitlabTracker({
      baseUrl: ctx.baseUrl,
      token: ctx.token,
      projectId: ctx.projectId,
    });
    const workspace = new FsWorkspaceManager({
      root: tmpRoot,
      projectSlug: `it-${runId}`,
    });
    const ac = new AbortController();

    const explosiveAgent = {
      name: "boom",
      async run(): Promise<never> {
        throw new Error("intentional integration failure");
      },
    };

    const runPromise = run({
      tracker,
      workspace,
      agent: explosiveAgent,
      prompt: { build: () => "n/a" },
      pollIntervalMs: 1_000,
      labels,
      signal: ac.signal,
      log: () => undefined,
    });

    const detail = await waitFor(async () => {
      const d = await getIssue(ctx, created.iid);
      return d.labels.includes(labels.failed) || d.labels.includes(labels.done) ? d : null;
    }, { timeoutMs: 30_000, intervalMs: 1_000 });

    ac.abort();
    await runPromise;

    expect(detail.labels).toContain(labels.failed);
    expect(detail.labels).not.toContain(labels.done);

    const notes = await listNotes(ctx, created.iid);
    const userNotes = notes.filter((n) => !n.system);
    const last = userNotes[userNotes.length - 1];
    expect(last?.body ?? "").toContain("`failed`");
    expect(last?.body ?? "").toContain("intentional integration failure");
  }, 60_000);
});

async function waitFor<T>(
  probe: () => Promise<T | null>,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== null) return v;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  if (lastError !== undefined) {
    throw new Error(`waitFor timed out after ${String(opts.timeoutMs)}ms; last error: ${String(lastError)}`);
  }
  throw new Error(`waitFor timed out after ${String(opts.timeoutMs)}ms with no result`);
}
