import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LiquidPromptBuilder, renderPromptOnce } from "../src/prompt-liquid.js";
import {
  MissingWorkflowFileError,
  WorkflowFrontMatterNotAMapError,
  WorkflowParseError,
  WorkflowValidationError,
  buildConfigFromWorkflow,
  loadWorkflow,
  parseWorkflow,
  resolvePath,
  resolveVarRefs,
} from "../src/workflow.js";
import type { Issue, PromptInput } from "../src/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "1",
    iid: "42",
    title: "Fix the thing",
    description: "Body",
    labels: ["agent-ready"],
    url: "http://localhost/issues/42",
    state: "opened",
    authorUsername: "tester",
    updatedAt: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

function makePromptInput(overrides: Partial<PromptInput> = {}): PromptInput {
  return {
    issue: makeIssue(),
    turnNumber: 1,
    attempt: 1,
    ...overrides,
  };
}

describe("parseWorkflow", () => {
  it("returns empty config + body when no front matter", () => {
    const r = parseWorkflow("Hello {{ issue.iid }}");
    expect(r.config).toEqual({});
    expect(r.promptTemplate).toBe("Hello {{ issue.iid }}");
  });

  it("parses front matter and trims body", () => {
    const text = `---
tracker:
  kind: gitlab
  base_url: http://x
---

  Body line 1
  Body line 2
`;
    const r = parseWorkflow(text);
    expect((r.config.tracker as Record<string, unknown>).kind).toBe("gitlab");
    expect(r.promptTemplate).toBe("Body line 1\n  Body line 2");
  });

  it("rejects non-map front matter", () => {
    const text = `---
- a
- b
---
body`;
    expect(() => parseWorkflow(text)).toThrow(WorkflowFrontMatterNotAMapError);
  });

  it("wraps YAML errors as WorkflowParseError", () => {
    // intentionally malformed YAML
    const text = `---
this is: : not valid:
  -- yaml
---
body`;
    expect(() => parseWorkflow(text)).toThrow(WorkflowParseError);
  });
});

describe("resolveVarRefs / resolvePath", () => {
  it("substitutes $VAR_NAME against process.env", () => {
    process.env.WORKFLOW_TEST_VAR = "hello";
    expect(resolveVarRefs("token=$WORKFLOW_TEST_VAR")).toBe("token=hello");
    delete process.env.WORKFLOW_TEST_VAR;
  });

  it("renders empty string when env is unset", () => {
    delete process.env.WORKFLOW_NONEXISTENT;
    expect(resolveVarRefs("$WORKFLOW_NONEXISTENT")).toBe("");
  });

  it("expands leading ~/ to $HOME", () => {
    const home = process.env.HOME ?? "/Users/x";
    expect(resolvePath("~/foo")).toBe(`${home}/foo`);
  });
});

describe("LiquidPromptBuilder", () => {
  it("renders core variables", async () => {
    const tmpl = "Issue {{ issue.iid }} '{{ issue.title }}' attempt={{ attempt }}";
    const out = await renderPromptOnce(tmpl, makePromptInput({ attempt: 3 }));
    expect(out).toBe("Issue 42 'Fix the thing' attempt=3");
  });

  it("renders Symphony alias issue.identifier as #iid by default", async () => {
    const tmpl = "Ticket {{ issue.identifier }}";
    const out = await renderPromptOnce(tmpl, makePromptInput());
    expect(out).toBe("Ticket #42");
  });

  it("renders attempt as null on first try (Symphony §5.4 contract)", async () => {
    const tmpl = "{% if attempt %}retry #{{ attempt }}{% else %}first{% endif %}";
    expect(await renderPromptOnce(tmpl, makePromptInput({ attempt: 1 }))).toBe("first");
    expect(await renderPromptOnce(tmpl, makePromptInput({ attempt: 2 }))).toBe("retry #2");
  });

  it("strict mode: unknown variable raises", async () => {
    const builder = new LiquidPromptBuilder("{{ issue.assignee }}");
    await expect(builder.build(makePromptInput())).rejects.toThrow();
  });

  it("strict mode: unknown filter raises", async () => {
    const builder = new LiquidPromptBuilder("{{ issue.title | titlecase }}");
    await expect(builder.build(makePromptInput())).rejects.toThrow();
  });

  it("symphonyAliases:false removes identifier alias (raises on access)", async () => {
    const builder = new LiquidPromptBuilder(
      "{{ issue.identifier }}",
      { symphonyAliases: false },
    );
    await expect(builder.build(makePromptInput())).rejects.toThrow(/identifier/);
  });

  it("symphonyAliases:false renders attempt as the raw integer (no null on first try)", async () => {
    const out = await renderPromptOnce(
      "a={{ attempt }}",
      makePromptInput({ attempt: 1 }),
      { symphonyAliases: false },
    );
    expect(out).toBe("a=1");
  });
});

describe("buildConfigFromWorkflow", () => {
  beforeEach(() => {
    process.env.GITLAB_TOKEN_TEST = "glpat-fake";
  });
  afterEach(() => {
    delete process.env.GITLAB_TOKEN_TEST;
  });

  it("builds an OrchestratorConfig with tracker/workspace/agent/prompt", () => {
    const cfg = buildConfigFromWorkflow(
      {
        tracker: {
          kind: "gitlab",
          base_url: "http://localhost:8929",
          token: "$GITLAB_TOKEN_TEST",
          project_id: 7,
          continue_label: "agent-continue",
        },
        polling: { interval_ms: 5000 },
        workspace: { root: "/tmp/orch-ws", project_slug: "proj" },
        documents: { default_branch: "release-docs" },
        agent: {
          kind: "echo",
          max_concurrent_agents: 3,
          max_turns: 4,
        },
      },
      "Hello {{ issue.iid }}",
    );

    expect(cfg.tracker).toBeDefined();
    expect(cfg.contextSearch).toBeDefined();
    expect(cfg.documentSave).toBeDefined();
    expect(cfg.issueTasks).toBeDefined();
    expect(cfg.workspace).toBeDefined();
    expect(cfg.agent.name).toBe("echo");
    expect(cfg.pollIntervalMs).toBe(5000);
    expect(cfg.maxConcurrent).toBe(3);
    expect(cfg.maxTurns).toBe(4);
    expect(cfg.continueLabel).toBe("agent-continue");
  });

  it("rejects unsupported tracker.kind", () => {
    expect(() =>
      buildConfigFromWorkflow(
        { tracker: { kind: "linear", base_url: "x", token: "y", project_id: 1 } },
        "",
      ),
    ).toThrow(WorkflowValidationError);
  });

  it("rejects empty token after $VAR resolution", () => {
    delete process.env.MISSING_VAR_FOR_TOKEN;
    expect(() =>
      buildConfigFromWorkflow(
        {
          tracker: {
            kind: "gitlab",
            base_url: "http://x",
            token: "$MISSING_VAR_FOR_TOKEN",
            project_id: 1,
          },
          workspace: { root: "/tmp" },
        },
        "",
      ),
    ).toThrow(WorkflowValidationError);
  });

  it("requires workspace.root", () => {
    expect(() =>
      buildConfigFromWorkflow(
        {
          tracker: { kind: "gitlab", base_url: "http://x", token: "tok", project_id: 1 },
        },
        "",
      ),
    ).toThrow(WorkflowValidationError);
  });

  it("rejects unknown agent.kind", () => {
    expect(() =>
      buildConfigFromWorkflow(
        {
          tracker: { kind: "gitlab", base_url: "http://x", token: "tok", project_id: 1 },
          workspace: { root: "/tmp" },
          agent: { kind: "aider" },
        },
        "",
      ),
    ).toThrow(WorkflowValidationError);
  });

  it("accepts custom labels and resolves them on the config", () => {
    const cfg = buildConfigFromWorkflow(
      {
        tracker: {
          kind: "gitlab",
          base_url: "http://x",
          token: "tok",
          project_id: 1,
          labels: { ready: "ai/queue", done: "ai/ok" },
        },
        workspace: { root: "/tmp" },
      },
      "",
    );
    expect(cfg.labels).toEqual({ ready: "ai/queue", done: "ai/ok" });
  });
});

describe("loadWorkflow (file end-to-end)", () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "workflow-test-"));
    process.env.GITLAB_TOKEN_TEST = "glpat-fake";
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    delete process.env.GITLAB_TOKEN_TEST;
  });

  it("reads a WORKFLOW.md and produces a runnable OrchestratorConfig", async () => {
    const path = join(tmpRoot, "WORKFLOW.md");
    await writeFile(
      path,
      `---
tracker:
  kind: gitlab
  base_url: http://localhost:8929
  token: $GITLAB_TOKEN_TEST
  project_id: 9
workspace:
  root: ${tmpRoot}/ws
agent:
  kind: echo
---

Resolve issue {{ issue.iid }}.
`,
      "utf8",
    );
    const cfg = await loadWorkflow(path);
    expect(cfg.agent.name).toBe("echo");
    const rendered = await cfg.prompt.build({
      issue: makeIssue(),
      turnNumber: 1,
      attempt: 1,
    });
    expect(rendered).toBe("Resolve issue 42.");
  });

  it("throws MissingWorkflowFileError when path is unreadable", async () => {
    await expect(loadWorkflow(join(tmpRoot, "does-not-exist.md"))).rejects.toThrow(
      MissingWorkflowFileError,
    );
  });
});
