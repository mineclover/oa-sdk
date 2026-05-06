/**
 * SubprocessAgent unit tests. We use `node` itself as the fake binary so
 * tests are OS-portable and don't depend on `codex` or `claude` being on PATH.
 *
 * These also validate CodexAgent + ClaudeAgent indirectly because both are
 * thin SubprocessAgent subclasses; per-adapter tests would only re-cover the
 * default-merging logic.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SubprocessAgent } from "../src/agents/subprocess.js";
import { ClaudeAgent } from "../src/agents/claude.js";
import { CodexAgent } from "../src/agents/codex.js";
import type { Issue } from "../src/types.js";

const NODE = process.execPath;

function makeIssue(): Issue {
  return {
    id: "1",
    iid: "1",
    title: "fixture",
    description: "",
    labels: [],
    url: "http://x/1",
    state: "opened",
    authorUsername: "tester",
    updatedAt: new Date().toISOString(),
  };
}

describe("SubprocessAgent", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "subprocess-agent-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns succeeded with stdout summary on exit 0 (argv prompt delivery)", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: ["-e", 'process.stdout.write("hello from prompt: " + process.argv[1]); process.exit(0);'],
      promptDelivery: "argv",
      timeoutMs: 5_000,
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "fix the thing",
      issue: makeIssue(),
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("hello from prompt: fix the thing");
  });

  it("returns succeeded reading the prompt off stdin when promptDelivery=stdin", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: [
        "-e",
        'let s = ""; process.stdin.on("data", d => { s += d.toString(); }); process.stdin.on("end", () => { process.stdout.write("got:" + s); process.exit(0); });',
      ],
      promptDelivery: "stdin",
      timeoutMs: 5_000,
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "stdin payload",
      issue: makeIssue(),
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("got:stdin payload");
  });

  it("returns failed with stderr captured on non-zero exit", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: ["-e", 'process.stderr.write("kaboom"); process.exit(2);'],
      promptDelivery: "argv",
      timeoutMs: 5_000,
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "anything",
      issue: makeIssue(),
    });
    expect(result.status).toBe("failed");
    expect(result.error ?? "").toContain("kaboom");
    expect(result.summary).toContain("code=2");
  });

  it("returns timed-out when the binary outlives timeoutMs", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: ["-e", "setTimeout(() => process.exit(0), 60_000);"],
      promptDelivery: "argv",
      timeoutMs: 200,
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "x",
      issue: makeIssue(),
    });
    expect(result.status).toBe("timed-out");
    expect(result.summary).toContain("200ms");
  });

  it("returns cancelled when the orchestrator's signal aborts mid-run", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: ["-e", "setTimeout(() => process.exit(0), 60_000);"],
      promptDelivery: "argv",
      timeoutMs: 60_000,
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "x",
      issue: makeIssue(),
      signal: ac.signal,
    });
    expect(result.status).toBe("cancelled");
  });

  it("returns cancelled immediately when signal is already aborted", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: ["-e", "process.exit(0);"],
      promptDelivery: "argv",
      timeoutMs: 5_000,
    });
    const ac = new AbortController();
    ac.abort();
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "x",
      issue: makeIssue(),
      signal: ac.signal,
    });
    expect(result.status).toBe("cancelled");
  });

  it("returns failed when the binary cannot be spawned", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: "/definitely/does/not/exist/orchestrator-test-bin",
      args: [],
      promptDelivery: "argv",
      timeoutMs: 5_000,
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "x",
      issue: makeIssue(),
    });
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("failed to spawn");
  });

  it("merges extraEnv into the spawned process env", async () => {
    const agent = new SubprocessAgent({
      name: "fake",
      bin: NODE,
      args: [
        "-e",
        'process.stdout.write("FOO=" + (process.env.FOO ?? "") + " BAR=" + (process.env.BAR ?? ""));',
      ],
      promptDelivery: "argv",
      timeoutMs: 5_000,
      extraEnv: { FOO: "from-extra" },
    });
    const result = await agent.run({
      workspacePath: cwd,
      prompt: "x",
      issue: makeIssue(),
      env: { BAR: "from-input" },
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("FOO=from-extra");
    expect(result.summary).toContain("BAR=from-input");
  });
});

describe("CodexAgent / ClaudeAgent — defaults wiring", () => {
  it("CodexAgent surfaces name=codex and runs the bin", async () => {
    const agent = new CodexAgent({
      bin: NODE,
      globalArgs: ["-e", 'console.log("codex-ok"); process.exit(0);'],
      // override subcommand to a no-op flag node accepts
      subcommand: "--",
      timeoutMs: 5_000,
    });
    expect(agent.name).toBe("codex");
    const result = await agent.run({
      workspacePath: process.cwd(),
      prompt: "p",
      issue: makeIssue(),
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("codex-ok");
  });

  it("ClaudeAgent defaults to stdin delivery and surfaces name=claude", async () => {
    const agent = new ClaudeAgent({
      bin: NODE,
      args: [
        "-e",
        'let s = ""; process.stdin.on("data", d => { s += d.toString(); }); process.stdin.on("end", () => { process.stdout.write("claude-got:" + s); process.exit(0); });',
      ],
      timeoutMs: 5_000,
    });
    expect(agent.name).toBe("claude");
    const result = await agent.run({
      workspacePath: process.cwd(),
      prompt: "hi-claude",
      issue: makeIssue(),
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("claude-got:hi-claude");
  });
});
