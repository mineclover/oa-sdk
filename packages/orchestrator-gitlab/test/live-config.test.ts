import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LiveConfigProvider, watchWorkflow } from "../src/live-config.js";
import { OrchestratorRuntime } from "../src/runtime.js";

function workflowText(opts: { iid: string; pollMs?: number }): string {
  return `---
tracker:
  kind: gitlab
  base_url: http://localhost:9999
  token: glpat-fake
  project_id: 1
polling:
  interval_ms: ${String(opts.pollMs ?? 5000)}
workspace:
  root: /tmp/orch-live-test
agent:
  kind: echo
---

Fix issue ${opts.iid}: {{ issue.title }}
`;
}

describe("LiveConfigProvider", () => {
  it("swap replaces what current() returns", async () => {
    const initial = makeFakeConfig("a");
    const provider = new LiveConfigProvider(initial);
    expect(provider.current().agent.name).toBe("a");
    provider.swap(makeFakeConfig("b"));
    expect(provider.current().agent.name).toBe("b");
  });
});

describe("watchWorkflow — hot reload", () => {
  let tmpRoot: string;
  let path: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "orch-watch-"));
    path = join(tmpRoot, "WORKFLOW.md");
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("loads the initial workflow and exposes it via current()", async () => {
    await writeFile(path, workflowText({ iid: "1", pollMs: 11_111 }), "utf8");
    const handle = await watchWorkflow(path);
    try {
      expect(handle.provider.current().pollIntervalMs).toBe(11_111);
    } finally {
      handle.close();
    }
  });

  it("re-parses on file change and swaps the live config", async () => {
    await writeFile(path, workflowText({ iid: "1", pollMs: 1000 }), "utf8");
    const runtime = new OrchestratorRuntime();
    const handle = await watchWorkflow(path, { runtime, debounceMs: 30 });

    try {
      // sanity
      expect(handle.provider.current().pollIntervalMs).toBe(1000);
      expect(runtime.reloadCount).toBe(0);

      await writeFile(path, workflowText({ iid: "1", pollMs: 7777 }), "utf8");

      await waitFor(() => handle.provider.current().pollIntervalMs === 7777, 2_000);
      expect(handle.provider.current().pollIntervalMs).toBe(7777);
      expect(runtime.reloadCount).toBe(1);
      expect(runtime.lastReloadError).toBeUndefined();
    } finally {
      handle.close();
    }
  });

  it("keeps last-known-good when reload yields invalid YAML", async () => {
    await writeFile(path, workflowText({ iid: "1", pollMs: 2000 }), "utf8");
    const runtime = new OrchestratorRuntime();
    const handle = await watchWorkflow(path, { runtime, debounceMs: 30 });

    try {
      // write malformed YAML — front matter has invalid indentation/colons
      await writeFile(
        path,
        `---
this is: : not valid:
  -- yaml
---
body
`,
        "utf8",
      );

      await waitFor(() => runtime.lastReloadError !== undefined, 2_000);

      // Original config still in effect.
      expect(handle.provider.current().pollIntervalMs).toBe(2000);
      expect(runtime.reloadCount).toBe(0);
      expect(runtime.lastReloadError).toBeDefined();
      expect(runtime.lastReloadError?.msg.length).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  it("close() makes the watcher stop; subsequent edits are ignored", async () => {
    await writeFile(path, workflowText({ iid: "1", pollMs: 2000 }), "utf8");
    const runtime = new OrchestratorRuntime();
    const handle = await watchWorkflow(path, { runtime, debounceMs: 30 });
    handle.close();

    await writeFile(path, workflowText({ iid: "1", pollMs: 9999 }), "utf8");
    await sleep(120);
    expect(handle.provider.current().pollIntervalMs).toBe(2000);
    expect(runtime.reloadCount).toBe(0);
  });
});

/* helpers */

function makeFakeConfig(agentName: string): Parameters<typeof LiveConfigProvider.prototype.swap>[0] {
  return {
    tracker: {
      listEligibleIssues: async () => [],
      getIssue: async () => {
        throw new Error("not implemented");
      },
      transitionLabels: async () => undefined,
      postNote: async () => undefined,
    },
    workspace: {
      ensure: async () => ({ path: "/tmp/x", key: "x", createdNow: false }),
    },
    agent: { name: agentName, run: async () => ({ status: "succeeded", summary: "" }) },
    prompt: { build: () => "p" },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`waitFor timeout after ${String(timeoutMs)}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
